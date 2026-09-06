use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, Window};
use tokio::sync::Notify;

pub const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(windows)]
pub const FORCE_STOP_TIMEOUT: Duration = Duration::from_secs(5);

pub struct Sidecar {
    pub pid: u32,
    #[cfg(unix)]
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    #[cfg(windows)]
    process: Option<std::sync::Arc<crate::windows_process::OwnedProcess>>,
}

impl Sidecar {
    #[cfg(test)]
    pub(crate) fn unmanaged(pid: u32) -> Self {
        Self {
            pid,
            #[cfg(unix)]
            child: Mutex::new(None),
            #[cfg(windows)]
            process: None,
        }
    }

    #[cfg(unix)]
    pub fn unix_owned(child: tauri_plugin_shell::process::CommandChild) -> Self {
        let pid = child.pid();
        Self {
            pid,
            child: Mutex::new(Some(child)),
        }
    }

    #[cfg(windows)]
    pub fn windows(process: std::sync::Arc<crate::windows_process::OwnedProcess>) -> Self {
        Self {
            pid: process.pid(),
            process: Some(process),
        }
    }

    fn stop(&self, force: bool) -> Result<(), String> {
        #[cfg(unix)]
        {
            if force {
                let child = self
                    .child
                    .lock()
                    .expect("sidecar child lock poisoned")
                    .take();
                let child = child.ok_or_else(|| {
                    "desktop server has no owned child for forced shutdown".to_owned()
                })?;
                return child
                    .kill()
                    .map_err(|error| format!("could not force-stop desktop server: {error}"));
            }
            return signal_sidecar(self.pid, 15);
        }
        #[cfg(windows)]
        {
            let process = self
                .process
                .as_ref()
                .ok_or_else(|| "server has no owned job".to_owned())?;
            if force {
                process.terminate()
            } else {
                process.request_shutdown()
            }
        }
    }

    fn stopped(&self) -> bool {
        #[cfg(unix)]
        return !process_alive(self.pid);
        #[cfg(windows)]
        self.process
            .as_ref()
            .is_some_and(|process| process.tree_is_empty().unwrap_or(false))
    }
}

pub struct SidecarLifecycle {
    sidecar: Mutex<Option<Sidecar>>,
    shutting_down: AtomicBool,
    shutdown_waiting: AtomicBool,
    exited: Notify,
}

impl Default for SidecarLifecycle {
    fn default() -> Self {
        Self {
            sidecar: Mutex::new(None),
            shutting_down: AtomicBool::new(false),
            shutdown_waiting: AtomicBool::new(false),
            exited: Notify::new(),
        }
    }
}

impl SidecarLifecycle {
    /// Spawn, tree ownership and publication share the Quit critical section.
    pub fn start<T>(
        &self,
        spawn: impl FnOnce() -> Result<(Sidecar, T), String>,
    ) -> Result<Option<T>, String> {
        let mut sidecar = self
            .sidecar
            .lock()
            .expect("sidecar lifecycle lock poisoned");
        if sidecar.is_some() || self.is_shutting_down() {
            return Ok(None);
        }
        let (started, child) = spawn()?;
        *sidecar = Some(started);
        Ok(Some(child))
    }

    pub fn exited(&self, exited_pid: u32) {
        let mut sidecar = self
            .sidecar
            .lock()
            .expect("sidecar lifecycle lock poisoned");
        if sidecar
            .as_ref()
            .is_some_and(|child| child.pid == exited_pid)
        {
            // A root exit is insufficient on Windows: descendants may still be
            // exiting after TerminateJobObject. Retry must wait for an empty job.
            #[cfg(windows)]
            if sidecar
                .as_ref()
                .is_some_and(|child| child.process.is_some() && !child.stopped())
            {
                return;
            }
            *sidecar = None;
            self.exited.notify_waiters();
        }
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }

    pub fn has_sidecar(&self) -> bool {
        self.current_pid().is_some()
    }

    pub fn shutdown_complete(&self) -> bool {
        self.is_shutting_down() && !self.has_sidecar()
    }

    fn current_pid(&self) -> Option<u32> {
        self.sidecar
            .lock()
            .expect("sidecar lifecycle lock poisoned")
            .as_ref()
            .map(|child| child.pid)
    }

    pub fn begin_shutdown(&self) -> Option<u32> {
        let sidecar = self
            .sidecar
            .lock()
            .expect("sidecar lifecycle lock poisoned");
        if self.shutting_down.swap(true, Ordering::SeqCst) {
            return None;
        }
        sidecar.as_ref().map(|child| child.pid)
    }

    pub fn stop(&self, pid: u32, force: bool) -> Result<(), String> {
        let sidecar = self
            .sidecar
            .lock()
            .expect("sidecar lifecycle lock poisoned");
        match sidecar.as_ref().filter(|child| child.pid == pid) {
            Some(child) => child.stop(force),
            None => Ok(()), // An old supervisor must never stop a replacement.
        }
    }

    pub fn reap_if_stopped(&self, pid: u32) -> bool {
        let mut sidecar = self
            .sidecar
            .lock()
            .expect("sidecar lifecycle lock poisoned");
        match sidecar.as_ref().filter(|child| child.pid == pid) {
            Some(child) if !child.stopped() => false,
            _ => {
                if sidecar.as_ref().is_some_and(|child| child.pid == pid) {
                    *sidecar = None;
                    self.exited.notify_waiters();
                }
                true
            }
        }
    }

    async fn wait_for_exit(&self, timeout: Duration) -> Result<(), String> {
        tokio::time::timeout(timeout, async {
            loop {
                // Register before checking durable state: exit can happen
                // before this wait begins or between the check and await.
                let exited = self.exited.notified();
                if !self.has_sidecar() {
                    return;
                }
                exited.await;
            }
        })
        .await
        .map_err(|_| "desktop server did not complete its graceful shutdown".to_owned())
    }

    fn wait_for_exit_blocking(&self, pid: u32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self.reap_if_stopped(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        self.reap_if_stopped(pid)
    }

    pub async fn stop_and_wait(&self, pid: u32, grace: Duration) -> Result<(), String> {
        #[cfg(unix)]
        {
            // Unix has no process-tree ownership here. Never SIGKILL a ready
            // server root: its workers and PTYs would be orphaned. Keep the
            // sidecar tracked so the caller can report the error and retry.
            self.stop(pid, false)?;
            return self.wait_for_exit(grace).await;
        }
        #[cfg(windows)]
        {
            // The supervisor drains output concurrently. A closed stdin or
            // failed signal skips directly to the bounded Job force-stop.
            if self.stop(pid, false).is_ok() && self.wait_for_exit(grace).await.is_ok() {
                return Ok(());
            }
            self.stop(pid, true)?;
            let deadline = Instant::now() + FORCE_STOP_TIMEOUT;
            while Instant::now() < deadline {
                if self.reap_if_stopped(pid) {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err("desktop server tree did not exit after forced shutdown".to_owned())
        }
    }
}

#[cfg(unix)]
fn signal_sidecar(pid: u32, signal: i32) -> Result<(), String> {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    if pid == 0 || pid > i32::MAX as u32 {
        return Err("invalid desktop server PID".to_owned());
    }
    if unsafe { kill(pid as i32, signal) } == 0 || !process_alive(pid) {
        Ok(())
    } else {
        Err(format!("could not signal desktop server {pid}"))
    }
}

#[cfg(unix)]
pub(crate) fn process_alive(pid: u32) -> bool {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    let Some(target) = i32::try_from(pid).ok().filter(|pid| *pid > 0) else {
        return true; // An invalid PID must never authorize Retry or app exit.
    };
    if unsafe { kill(target, 0) } == 0 {
        true
    } else {
        // Permission and probe failures are not evidence of process exit.
        std::io::Error::last_os_error().raw_os_error() != Some(3)
    }
}

/// macOS Apple-event Quit can bypass ExitRequested in this Tauri version.
pub fn blocking_shutdown(app: &AppHandle) {
    let lifecycle = app.state::<SidecarLifecycle>();
    if let Some(pid) = lifecycle.begin_shutdown() {
        let _ = lifecycle.stop(pid, false);
    }
    if let Some(pid) = lifecycle.current_pid() {
        #[cfg(windows)]
        if !lifecycle.wait_for_exit_blocking(pid, SHUTDOWN_TIMEOUT) {
            let _ = lifecycle.stop(pid, true);
            lifecycle.wait_for_exit_blocking(pid, FORCE_STOP_TIMEOUT);
        }
        #[cfg(unix)]
        let _ = lifecycle.wait_for_exit_blocking(pid, SHUTDOWN_TIMEOUT);
    }
}

pub fn handle_close_request(window: &Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        // Keep the window alive until the server finishes: shutdown errors
        // still need a visible window, and destroying it must not skip Quit.
        api.prevent_close();

        // Linux has no macOS Reopen event (and no tray UI in this app). Hiding
        // the last window would leave the server and instance lock invisible.
        #[cfg(target_os = "linux")]
        graceful_quit(window.app_handle().clone());

        // Preserve macOS close-to-hide and its Dock/Reopen behavior.
        #[cfg(target_os = "macos")]
        let _ = window.hide();

        // There is no Windows dock or tray from which to reopen a hidden app.
        #[cfg(target_os = "windows")]
        graceful_quit(window.app_handle().clone());

        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        graceful_quit(window.app_handle().clone());
    }
}

pub fn graceful_quit(app: AppHandle) {
    // Fence spawning on the event thread, before scheduling asynchronous work.
    // Otherwise a queued Retry/startup can spawn after CloseRequested returns.
    let lifecycle = app.state::<SidecarLifecycle>();
    lifecycle.begin_shutdown();
    if lifecycle.shutdown_complete() {
        app.exit(0);
        return;
    }
    if lifecycle.shutdown_waiting.swap(true, Ordering::SeqCst) {
        return;
    }
    let pid = lifecycle.current_pid();
    tauri::async_runtime::spawn(async move {
        let lifecycle = app.state::<SidecarLifecycle>();
        let result = match pid {
            Some(pid) => lifecycle.stop_and_wait(pid, SHUTDOWN_TIMEOUT).await,
            None => Ok(()),
        };
        // Keep the spawn fence, but let another Close/Quit retry a failed
        // signal or wait. The sidecar itself remains tracked on failure.
        lifecycle.shutdown_waiting.store(false, Ordering::SeqCst);
        if let Err(error) = result {
            show_shutdown_error(&app, &error);
            return;
        }
        app.exit(0);
    });
}

fn show_shutdown_error(app: &AppHandle, error: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let escaped =
            serde_json::to_string(error).unwrap_or_else(|_| "\"Shutdown failed\"".to_owned());
        let _ = window.eval(format!("document.body.innerHTML='<main><h1>Gajae Code App could not quit safely</h1><pre></pre></main>';document.querySelector('pre').textContent={escaped};"));
        let _ = window.show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_is_started_once() {
        let lifecycle = SidecarLifecycle::default();
        lifecycle
            .start(|| Ok((Sidecar::unmanaged(42), ())))
            .unwrap();
        assert_eq!(lifecycle.begin_shutdown(), Some(42));
        assert_eq!(lifecycle.begin_shutdown(), None);
    }

    #[test]
    fn shell_exit_requires_shutdown_even_before_the_server_starts() {
        let lifecycle = SidecarLifecycle::default();
        assert!(!lifecycle.shutdown_complete());
        assert_eq!(lifecycle.begin_shutdown(), None);
        assert!(lifecycle.shutdown_complete());
        assert_eq!(
            lifecycle.start::<()>(|| panic!("closing during startup must prevent a late spawn")),
            Ok(None)
        );
    }

    #[test]
    fn repeated_close_cannot_release_the_shutdown_fence_early() {
        let lifecycle = SidecarLifecycle::default();
        lifecycle
            .start(|| Ok((Sidecar::unmanaged(42), ())))
            .unwrap();
        assert!(!lifecycle.shutdown_complete());
        assert_eq!(lifecycle.begin_shutdown(), Some(42));
        assert!(!lifecycle.shutdown_complete());
        assert_eq!(lifecycle.begin_shutdown(), None);
        assert!(!lifecycle.shutdown_complete());

        lifecycle.exited(43);
        assert!(!lifecycle.shutdown_complete());
        lifecycle.exited(42);
        assert!(lifecycle.shutdown_complete());
        assert_eq!(
            lifecycle.start::<()>(|| panic!("a completed shutdown must still reject Retry")),
            Ok(None)
        );
    }

    #[test]
    fn unexpected_server_exit_does_not_count_as_a_requested_shutdown() {
        let lifecycle = SidecarLifecycle::default();
        lifecycle
            .start(|| Ok((Sidecar::unmanaged(42), ())))
            .unwrap();
        lifecycle.exited(42);
        assert!(!lifecycle.shutdown_complete());
        assert_eq!(lifecycle.begin_shutdown(), None);
        assert!(lifecycle.shutdown_complete());
    }

    #[test]
    fn exit_before_waiting_completes_shutdown_immediately() {
        let lifecycle = SidecarLifecycle::default();
        lifecycle
            .start(|| Ok((Sidecar::unmanaged(42), ())))
            .unwrap();
        assert_eq!(lifecycle.begin_shutdown(), Some(42));
        lifecycle.exited(42);
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                Duration::from_millis(100),
                lifecycle.wait_for_exit(SHUTDOWN_TIMEOUT),
            )
            .await
            .expect("an already exited server must not wait for another notification")
            .unwrap();
        });
    }

    #[test]
    fn retry_does_not_spawn_another_server_until_the_previous_one_exits() {
        let lifecycle = SidecarLifecycle::default();
        assert_eq!(
            lifecycle
                .start(|| Ok((Sidecar::unmanaged(42), "first")))
                .unwrap(),
            Some("first")
        );
        assert_eq!(
            lifecycle.start::<()>(|| panic!("the previous server is still tracked")),
            Ok(None)
        );
        lifecycle.exited(42);
        assert_eq!(
            lifecycle
                .start(|| Ok((Sidecar::unmanaged(43), "retry")))
                .unwrap(),
            Some("retry")
        );
        lifecycle.exited(42);
        assert_eq!(lifecycle.begin_shutdown(), Some(43));
    }

    #[test]
    fn failed_spawn_can_retry_but_shutdown_cannot_spawn() {
        let lifecycle = SidecarLifecycle::default();
        assert!(lifecycle
            .start::<()>(|| Err("spawn failed".to_owned()))
            .is_err());
        assert_eq!(
            lifecycle
                .start(|| Ok((Sidecar::unmanaged(42), ())))
                .unwrap(),
            Some(())
        );
        assert_eq!(lifecycle.begin_shutdown(), Some(42));
        lifecycle.exited(42);
        assert_eq!(
            lifecycle.start::<()>(|| panic!("Quit already began")),
            Ok(None)
        );
    }

    #[test]
    fn quit_cannot_miss_a_spawn_whose_pid_is_not_yet_published() {
        use std::sync::{Arc, Barrier};

        let lifecycle = SidecarLifecycle::default();
        let spawning = Arc::new(Barrier::new(2));
        std::thread::scope(|threads| {
            let spawn_barrier = Arc::clone(&spawning);
            let starting_lifecycle = &lifecycle;
            let start = threads.spawn(move || {
                starting_lifecycle.start(|| {
                    spawn_barrier.wait();
                    Ok((Sidecar::unmanaged(42), ()))
                })
            });
            spawning.wait();
            assert_eq!(lifecycle.begin_shutdown(), Some(42));
            assert_eq!(start.join().unwrap().unwrap(), Some(()));
        });
    }

    #[test]
    fn shutdown_waits_for_the_tracked_server_to_exit() {
        let lifecycle = SidecarLifecycle::default();
        lifecycle
            .start(|| Ok((Sidecar::unmanaged(42), ())))
            .unwrap();
        assert_eq!(lifecycle.begin_shutdown(), Some(42));
        tauri::async_runtime::block_on(async {
            let mut waiting = Box::pin(lifecycle.wait_for_exit(SHUTDOWN_TIMEOUT));
            assert!(
                tokio::time::timeout(Duration::from_millis(20), &mut waiting)
                    .await
                    .is_err()
            );
            lifecycle.exited(43);
            assert!(lifecycle.has_sidecar());
            assert!(
                tokio::time::timeout(Duration::from_millis(20), &mut waiting)
                    .await
                    .is_err()
            );
            lifecycle.exited(42);
            tokio::time::timeout(Duration::from_millis(100), waiting)
                .await
                .expect("the existing shutdown waiter must wake when the tracked server exits")
                .unwrap();
            assert!(lifecycle.shutdown_complete());
        });
    }

    #[cfg(unix)]
    #[test]
    fn unix_graceful_shutdown_timeout_keeps_the_root_alive() {
        use std::io::{BufRead, BufReader};
        use std::process::{Child, Command, Stdio};

        struct Fixture(Child);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut child = Fixture(
            Command::new("/bin/sh")
                .args(["-c", "trap '' TERM; printf 'ready\\n'; read line"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let mut ready = String::new();
        BufReader::new(child.0.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        assert_eq!(ready, "ready\n");
        let pid = child.0.id();
        let lifecycle = SidecarLifecycle::default();
        lifecycle
            .start(|| Ok((Sidecar::unmanaged(pid), ())))
            .unwrap();

        tauri::async_runtime::block_on(async {
            let error = tokio::time::timeout(
                Duration::from_secs(2),
                lifecycle.stop_and_wait(pid, Duration::from_millis(50)),
            )
            .await
            .expect("graceful shutdown must report its own timeout")
            .unwrap_err();
            assert!(error.contains("did not complete its graceful shutdown"));
        });
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "Unix graceful Quit must leave the server running, not an unreaped zombie"
        );
        assert!(lifecycle.has_sidecar());
    }

    #[cfg(windows)]
    #[test]
    fn windows_unconfirmed_tree_exit_remains_owned_for_observation() {
        let lifecycle = SidecarLifecycle::default();
        lifecycle
            .start(|| Ok((Sidecar::unmanaged(42), ())))
            .unwrap();
        assert!(
            lifecycle.has_sidecar(),
            "a sidecar must remain owned until the Job tree is proven empty"
        );
        assert!(!lifecycle.reap_if_stopped(42));
    }
}
