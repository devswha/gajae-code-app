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
pub const FORCE_STOP_TIMEOUT: Duration = Duration::from_secs(5);

pub struct Sidecar {
    pub pid: u32,
    #[cfg(windows)]
    process: Option<std::sync::Arc<crate::windows_process::OwnedProcess>>,
}

impl Sidecar {
    #[cfg(any(unix, test))]
    fn unmanaged(pid: u32) -> Self {
        Self {
            pid,
            #[cfg(windows)]
            process: None,
        }
    }

    #[cfg(unix)]
    pub fn unix(pid: u32) -> Self {
        Self::unmanaged(pid)
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
        return signal_sidecar(self.pid, if force { 9 } else { 15 });
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
    exited: Notify,
}

impl Default for SidecarLifecycle {
    fn default() -> Self {
        Self {
            sidecar: Mutex::new(None),
            shutting_down: AtomicBool::new(false),
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
    pub fn may_exit(&self) -> bool {
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

    async fn wait_for_exit(&self) -> Result<(), String> {
        tokio::time::timeout(SHUTDOWN_TIMEOUT, async {
            loop {
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

    pub async fn stop_and_wait(&self, pid: u32) -> Result<(), String> {
        // The supervisor drains output concurrently. A closed stdin or failed
        // signal skips directly to the bounded force-stop fallback.
        if self.stop(pid, false).is_ok() && self.wait_for_exit().await.is_ok() {
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
    // EPERM means it exists but is not signalable. Never release ownership on
    // an inspection error; PID 0 would address our own process group.
    pid != 0
        && pid <= i32::MAX as u32
        && (unsafe { kill(pid as i32, 0) } == 0
            || std::io::Error::last_os_error().raw_os_error() != Some(3))
}

/// macOS Apple-event Quit can bypass ExitRequested in this Tauri version.
pub fn blocking_shutdown(app: &AppHandle) {
    let lifecycle = app.state::<SidecarLifecycle>();
    if let Some(pid) = lifecycle.begin_shutdown() {
        let _ = lifecycle.stop(pid, false);
    }
    if let Some(pid) = lifecycle.current_pid() {
        if !lifecycle.wait_for_exit_blocking(pid, SHUTDOWN_TIMEOUT) {
            let _ = lifecycle.stop(pid, true);
            lifecycle.wait_for_exit_blocking(pid, FORCE_STOP_TIMEOUT);
        }
    }
}

pub fn hide_on_close(window: &Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        #[cfg(target_os = "macos")]
        let _ = window.hide();
        // There is no Windows dock or tray from which to reopen a hidden app.
        #[cfg(not(target_os = "macos"))]
        graceful_quit(window.app_handle().clone());
    }
}

pub fn graceful_quit(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let lifecycle = app.state::<SidecarLifecycle>();
        let Some(pid) = lifecycle.begin_shutdown() else {
            if !lifecycle.has_sidecar() {
                app.exit(0);
            }
            return;
        };
        if let Err(error) = lifecycle.stop_and_wait(pid).await {
            // Keep ownership, but allow the user to try Quit again.
            lifecycle.shutting_down.store(false, Ordering::SeqCst);
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
    fn programmatic_exit_is_allowed_only_after_shutdown_finishes() {
        let lifecycle = SidecarLifecycle::default();
        assert!(!lifecycle.may_exit());
        lifecycle
            .start(|| Ok((Sidecar::unmanaged(42), ())))
            .unwrap();
        lifecycle.begin_shutdown();
        assert!(!lifecycle.may_exit());
        lifecycle.exited(42);
        assert!(lifecycle.may_exit());
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
            tokio::time::timeout(Duration::from_millis(100), lifecycle.wait_for_exit())
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
            assert!(
                tokio::time::timeout(Duration::from_millis(20), lifecycle.wait_for_exit())
                    .await
                    .is_err()
            );
            lifecycle.exited(43);
            assert!(lifecycle.has_sidecar());
            lifecycle.exited(42);
            lifecycle.wait_for_exit().await.unwrap();
        });
    }
}
