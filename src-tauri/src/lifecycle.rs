use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use tauri::{AppHandle, Manager, Window};
use tokio::sync::Notify;

pub struct SidecarLifecycle {
    pid: std::sync::Mutex<Option<u32>>,
    shutting_down: AtomicBool,
    exited: Notify,
}

impl Default for SidecarLifecycle {
    fn default() -> Self {
        Self {
            pid: std::sync::Mutex::new(None),
            shutting_down: AtomicBool::new(false),
            exited: Notify::new(),
        }
    }
}

impl SidecarLifecycle {
    pub fn track(&self, pid: u32) {
        *self.pid.lock().expect("sidecar lifecycle lock poisoned") = Some(pid);
    }

    pub fn exited(&self) {
        *self.pid.lock().expect("sidecar lifecycle lock poisoned") = None;
        self.exited.notify_waiters();
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }
    pub fn has_sidecar(&self) -> bool {
        self.pid
            .lock()
            .expect("sidecar lifecycle lock poisoned")
            .is_some()
    }

    pub fn begin_shutdown(&self) -> Option<u32> {
        if self.shutting_down.swap(true, Ordering::SeqCst) {
            return None;
        }
        *self.pid.lock().expect("sidecar lifecycle lock poisoned")
    }

    async fn wait_for_exit(&self) -> Result<(), String> {
        tokio::time::timeout(Duration::from_secs(30), self.exited.notified())
            .await
            .map_err(|_| "desktop server did not complete its graceful shutdown".to_owned())
    }

    fn wait_for_exit_blocking(&self, pid: u32, timeout: Duration) {
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if !self.has_sidecar() || !process_alive(pid) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

#[cfg(unix)]
pub fn terminate_sidecar(pid: u32) -> Result<(), String> {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    const SIGTERM: i32 = 15;
    if unsafe { kill(pid as i32, SIGTERM) } == 0 {
        Ok(())
    } else {
        Err(format!("could not send SIGTERM to desktop server {pid}"))
    }
}

#[cfg(not(unix))]
pub fn terminate_sidecar(_pid: u32) -> Result<(), String> {
    Err("graceful sidecar termination is unavailable on this platform".to_owned())
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    unsafe { kill(pid as i32, 0) == 0 }
}

#[cfg(not(unix))]
fn process_alive(_pid: u32) -> bool {
    false
}

/// Last-resort synchronous shutdown for exit paths that cannot be prevented.
/// macOS delivers Quit Apple events (Cmd-Q, `osascript quit`) through
/// `applicationShouldTerminate`, which this Tauri version answers YES without
/// emitting a preventable ExitRequested — the process then exits without ever
/// signalling the sidecar, orphaning the server tree. Called from
/// `RunEvent::Exit`, this blocks the exiting thread until the sidecar's
/// graceful SIGTERM shutdown finishes (bounded at 30s).
pub fn blocking_shutdown(app: &AppHandle) {
    let lifecycle = app.state::<SidecarLifecycle>();
    match lifecycle.begin_shutdown() {
        Some(pid) => {
            let _ = terminate_sidecar(pid);
            lifecycle.wait_for_exit_blocking(pid, Duration::from_secs(30));
        }
        None => {
            // A graceful shutdown is already in flight; wait for it to settle
            // so exiting cannot outrun the sidecar's shutdown fence.
            let pid = *lifecycle
                .pid
                .lock()
                .expect("sidecar lifecycle lock poisoned");
            if let Some(pid) = pid {
                lifecycle.wait_for_exit_blocking(pid, Duration::from_secs(30));
            }
        }
    }
}

pub fn hide_on_close(window: &Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

pub fn graceful_quit(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let lifecycle = app.state::<SidecarLifecycle>();
        let had_sidecar = lifecycle.has_sidecar();
        let Some(pid) = lifecycle.begin_shutdown() else {
            if !had_sidecar {
                app.exit(0);
            }
            return;
        };
        if let Err(error) = terminate_sidecar(pid) {
            show_shutdown_error(&app, &error);
            return;
        }
        if let Err(error) = lifecycle.wait_for_exit().await {
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
        let _ = window.eval(format!("document.body.innerHTML='<main style=\"font:16px system-ui;padding:3rem\"><h1>Gajae Code App could not quit safely</h1><pre></pre></main>';document.querySelector('pre').textContent={escaped};"));
        let _ = window.show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_is_started_once() {
        let lifecycle = SidecarLifecycle::default();
        lifecycle.track(42);
        assert_eq!(lifecycle.begin_shutdown(), Some(42));
        assert_eq!(lifecycle.begin_shutdown(), None);
    }
}
