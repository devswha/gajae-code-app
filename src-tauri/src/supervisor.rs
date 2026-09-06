#[cfg(windows)]
use std::ffi::OsString;
use std::fmt::Write as _;
use std::{
    collections::VecDeque,
    env,
    io::{Read, Write},
    net::TcpStream,
    path::PathBuf,
    time::{Duration, Instant},
};

use getrandom::getrandom;
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_shell::process::CommandEvent;
#[cfg(unix)]
use tauri_plugin_shell::ShellExt;
use tokio::time;

const READY_KIND: &str = "gajae-desktop-ready";
const PROTOCOL_VERSION: u32 = 1;
const OUTPUT_LIMIT: usize = 64 * 1024;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(100);
const FAILED_STOP_GRACE: Duration = Duration::from_secs(5);
const FAILED_KILL_TIMEOUT: Duration = Duration::from_secs(5);
const SESSION_STOP_GRACE: Duration = Duration::from_secs(30);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
const HEALTH_RESPONSE_LIMIT: usize = 16 * 1024;

#[derive(Default)]
pub(crate) struct RecoveryScreen(std::sync::Mutex<Option<(String, bool)>>);

#[derive(Debug, Deserialize)]
struct ReadyFrame {
    kind: String,
    pid: u32,
    host: String,
    port: u16,
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    version: String,
}

impl ReadyFrame {
    fn matches_sidecar(&self, pid: u32) -> bool {
        self.kind == READY_KIND
            && self.pid == pid
            && self.host == "127.0.0.1"
            && self.port != 0
            && self.protocol_version == PROTOCOL_VERSION
    }
}

#[derive(Debug, Deserialize)]
struct Health {
    status: String,
    product: String,
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    version: String,
}

#[derive(Default)]
struct OutputRing {
    bytes: VecDeque<u8>,
}

impl OutputRing {
    fn push(&mut self, output: &[u8]) {
        self.bytes.extend(output);
        while self.bytes.len() > OUTPUT_LIMIT {
            self.bytes.pop_front();
        }
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes.iter().copied().collect::<Vec<_>>()).into_owned()
    }
}

fn random_secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom(&mut bytes)
        .map_err(|error| format!("could not generate desktop credential: {error}"))?;
    let mut secret = String::with_capacity(64);
    for byte in bytes {
        write!(&mut secret, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(secret)
}

fn payload_root(app: &AppHandle) -> Result<PathBuf, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| format!("could not locate application resources: {error}"))?;
    let root = ["server-payload", "resources/server-payload"]
        .iter()
        .map(|relative| resources.join(relative))
        // Keep ordinary Windows paths: canonicalize adds a verbatim prefix
        // that third-party Node tools do not consistently accept.
        .find(|candidate| candidate.is_dir())
        .ok_or_else(|| "server payload is missing".to_owned())?;
    for relative in [
        "dist-server/server/index.js",
        "dist",
        "node_modules",
        "dist-native",
    ] {
        let path = root.join(relative);
        if !path.exists() {
            return Err(format!(
                "server payload is incomplete (missing {})",
                path.display()
            ));
        }
    }
    #[cfg(windows)]
    for relative in ["dist-native/bun.exe", "dist-native/gajae-core.exe"] {
        if !root.join(relative).is_file() {
            return Err(format!("server payload is incomplete (missing {relative})"));
        }
    }
    if !root.is_dir() {
        return Err("server payload root is not a directory".to_owned());
    }
    Ok(root)
}

fn endpoint(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn health_check(port: u16, expected_version: &str) -> Result<(), String> {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .map_err(|error| format!("invalid loopback address: {error}"))?,
        HEALTH_TIMEOUT,
    )
    .map_err(|error| format!("health connection failed: {error}"))?;
    stream
        .set_write_timeout(Some(deadline.saturating_duration_since(Instant::now())))
        .map_err(|error| format!("could not set health write timeout: {error}"))?;
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|error| format!("health request failed: {error}"))?;
    let response = read_health_response(&mut stream, deadline)?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "malformed health response".to_owned())?;
    if !headers.starts_with("HTTP/1.1 200") {
        return Err(format!(
            "health endpoint rejected request: {}",
            headers.lines().next().unwrap_or_default()
        ));
    }
    let health: Health =
        serde_json::from_str(body).map_err(|error| format!("invalid health response: {error}"))?;
    if health.status != "ok"
        || health.product != "gajae-app"
        || health.protocol_version != PROTOCOL_VERSION
        || health.version != expected_version
    {
        return Err("health endpoint identity did not match the supervised server".to_owned());
    }
    Ok(())
}

fn read_health_response(stream: &mut TcpStream, deadline: Instant) -> Result<String, String> {
    let mut response = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("health response exceeded its deadline".to_owned());
        }
        stream
            .set_read_timeout(Some(remaining))
            .map_err(|error| format!("could not set health read timeout: {error}"))?;
        let size = match stream.read(&mut buffer) {
            Ok(size) => size,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("health response failed: {error}")),
        };
        if size == 0 {
            return String::from_utf8(response)
                .map_err(|error| format!("invalid health response encoding: {error}"));
        }
        if response.len() + size > HEALTH_RESPONSE_LIMIT {
            return Err("health response exceeded its size limit".to_owned());
        }
        response.extend_from_slice(&buffer[..size]);
    }
}

fn recovery_script(message: &str, retry_enabled: bool) -> String {
    let escaped =
        serde_json::to_string(message).unwrap_or_else(|_| "\"Desktop server failed\"".to_owned());
    // The retry listener is attached programmatically: inline onclick handlers
    // are blocked by the page CSP (script-src 'self'), and the invoke API
    // global requires withGlobalTauri (enabled in tauri.conf.json).
    let disabled = if retry_enabled { "" } else { " disabled" };
    format!(
        "document.body.innerHTML = '<main style=\"font:16px system-ui;padding:3rem;max-width:48rem\"><h1>Gajae Code App could not start</h1><pre style=\"white-space:pre-wrap\"></pre><button id=\"gajae-retry\" type=\"button\"{disabled}>Retry</button></main>';document.querySelector('pre').textContent={escaped};document.getElementById('gajae-retry').addEventListener('click',async function(){{var button=this;if(button.disabled)return;button.disabled=true;button.textContent='Starting…';try{{var t=window.__TAURI__;if(t&&t.core&&t.core.invoke){{await t.core.invoke('retry_desktop_server');}}else if(window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.invoke){{await window.__TAURI_INTERNALS__.invoke('retry_desktop_server');}}else{{throw new Error('Desktop command bridge is unavailable.');}}}}catch(error){{button.disabled=false;button.textContent='Retry';document.querySelector('pre').textContent=String(error);}}}});"
    )
}

fn reset_desktop_readiness(app: &AppHandle) {
    app.state::<crate::navigation::LoopbackOrigin>().clear();
    crate::reset_deep_link_readiness(app);
}

fn show_error(window: &WebviewWindow, message: &str, retry_enabled: bool) {
    let app = window.app_handle();
    let lifecycle = app.state::<crate::lifecycle::SidecarLifecycle>();
    if lifecycle.is_shutting_down() || (retry_enabled && lifecycle.has_sidecar()) {
        return;
    }
    reset_desktop_readiness(app);
    *app.state::<RecoveryScreen>()
        .0
        .lock()
        .expect("recovery screen lock poisoned") = Some((message.to_owned(), retry_enabled));
    let local_page = window.url().is_ok_and(|url| is_recovery_origin(&url));
    if local_page {
        let _ = window.eval(recovery_script(message, retry_enabled));
    } else {
        // A failed server leaves the webview on its HTTP origin, which has no
        // local IPC capability. Restore the bundled page before wiring Retry.
        #[cfg(not(target_os = "windows"))]
        let url = "tauri://localhost/index.html";
        #[cfg(target_os = "windows")]
        let url = "http://tauri.localhost/index.html";
        if let Err(error) = window.navigate(url.parse().expect("valid bundled recovery URL")) {
            eprintln!("could not open desktop recovery page: {error}");
        }
    }
    let _ = window.show();
}

fn is_recovery_origin(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
}

/// Called by the main page-load hook after the bundled document finishes.
/// Keep the message until the next accepted start, including cleanup updates
/// that can arrive while navigation back from a dead HTTP origin is pending.
pub(crate) fn restore_recovery(webview: &tauri::Webview<tauri::Wry>) {
    if webview.label() != "main" || !webview.url().is_ok_and(|url| is_recovery_origin(&url)) {
        return;
    }
    let app = webview.app_handle();
    let Some(lifecycle) = app.try_state::<crate::lifecycle::SidecarLifecycle>() else {
        return;
    };
    if lifecycle.is_shutting_down() {
        return;
    }
    let Some(recovery) = app.try_state::<RecoveryScreen>() else {
        return;
    };
    let message = recovery
        .0
        .lock()
        .expect("recovery screen lock poisoned")
        .clone();
    if let Some((message, retry_enabled)) = message {
        let _ = webview.eval(recovery_script(&message, retry_enabled));
    }
}

async fn wait_for_sidecar_exit(
    lifecycle: &crate::lifecycle::SidecarLifecycle,
    pid: u32,
    events: &mut tauri::async_runtime::Receiver<CommandEvent>,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if lifecycle.reap_if_stopped(pid) {
            return true;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return lifecycle.reap_if_stopped(pid);
        }
        let event = time::timeout(remaining.min(PROCESS_POLL_INTERVAL), events.recv()).await;
        if matches!(event, Ok(Some(CommandEvent::Terminated(_)))) && lifecycle.reap_if_stopped(pid)
        {
            return true;
        }
        // The plugin reaps before waiting for output readers, so inherited
        // pipes can delay Terminated even though the child is already gone.
        #[cfg(unix)]
        if !crate::lifecycle::process_alive(pid) && lifecycle.reap_if_stopped(pid) {
            return true;
        }
        if matches!(event, Ok(None)) {
            time::sleep(
                PROCESS_POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())),
            )
            .await;
        }
    }
}

async fn stop_failed_sidecar(
    lifecycle: &crate::lifecycle::SidecarLifecycle,
    pid: u32,
    events: &mut tauri::async_runtime::Receiver<CommandEvent>,
    force_stop: Option<impl FnOnce() -> Result<(), String>>,
    grace: Duration,
    kill_timeout: Duration,
) -> Result<(), String> {
    let term_error = lifecycle.stop(pid, false).err();
    if wait_for_sidecar_exit(lifecycle, pid, events, grace).await {
        return Ok(());
    }
    let Some(force_stop) = force_stop else {
        return Err(format!(
            "Desktop server {pid} did not complete graceful shutdown. Retry remains disabled until it exits."
        ));
    };
    let kill_error = force_stop().err();
    if wait_for_sidecar_exit(lifecycle, pid, events, kill_timeout).await {
        return Ok(());
    }
    let detail = kill_error
        .or(term_error)
        .unwrap_or_else(|| "exit was not confirmed".to_owned());
    Err(format!(
        "Desktop server {pid} could not be stopped: {detail}. Retry remains disabled until it exits."
    ))
}

async fn handle_sidecar_failure(
    app: &AppHandle,
    window: &WebviewWindow,
    pid: u32,
    events: &mut tauri::async_runtime::Receiver<CommandEvent>,
    message: String,
    was_ready: bool,
) {
    let lifecycle = app.state::<crate::lifecycle::SidecarLifecycle>();
    reset_desktop_readiness(app);
    show_error(
        window,
        &format!("{message}\n\nStopping the previous server…"),
        false,
    );
    let result = stop_failed_sidecar(
        &lifecycle,
        pid,
        events,
        (!was_ready).then_some(|| lifecycle.stop(pid, true)),
        if was_ready {
            SESSION_STOP_GRACE
        } else {
            FAILED_STOP_GRACE
        },
        FAILED_KILL_TIMEOUT,
    )
    .await;
    if let Err(error) = result {
        show_error(window, &format!("{message}\n\n{error}"), false);
        // Cleanup has reported its bounded failure. Keep observing without
        // signalling again so a late exit can still release Quit and Retry.
        while !wait_for_sidecar_exit(&lifecycle, pid, events, Duration::from_secs(1)).await {}
    }
    show_error(window, &message, true);
}

/// Pipes are byte streams: JSON can be split across reads, including UTF-8.
/// An overlong line is discarded through its newline, never parsed as a suffix.
#[derive(Default)]
struct ReadyLines {
    pending: Vec<u8>,
    discarding: bool,
}

impl ReadyLines {
    fn push(&mut self, bytes: &[u8]) -> Vec<ReadyFrame> {
        let mut frames = Vec::new();
        for &byte in bytes {
            if byte == b'\n' {
                if !self.discarding {
                    if let Ok(frame) = serde_json::from_slice::<ReadyFrame>(&self.pending) {
                        frames.push(frame);
                    }
                }
                self.pending.clear();
                self.discarding = false;
            } else if !self.discarding {
                if self.pending.len() == OUTPUT_LIMIT {
                    self.pending.clear();
                    self.discarding = true;
                } else {
                    self.pending.push(byte);
                }
            }
        }
        frames
    }
}

fn navigate_and_show(
    app: &AppHandle,
    window: &WebviewWindow,
    port: u16,
    nonce: &str,
) -> Result<(), String> {
    let lifecycle = app.state::<crate::lifecycle::SidecarLifecycle>();
    if lifecycle.is_shutting_down() {
        return Err("Desktop server startup was cancelled.".to_owned());
    }
    let origin = endpoint(port);
    app.state::<crate::navigation::LoopbackOrigin>().set(origin);
    let url = crate::navigation::bootstrap_url(port, nonce)?;
    window
        .navigate(url)
        .map_err(|error| format!("could not open supervised server: {error}"))?;
    if lifecycle.is_shutting_down() {
        reset_desktop_readiness(app);
        return Err("Desktop server startup was cancelled.".to_owned());
    }
    window
        .show()
        .map_err(|error| format!("could not show main window: {error}"))
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let window = match app.get_webview_window("main") {
            Some(window) => window,
            None => return,
        };
        let lifecycle = app.state::<crate::lifecycle::SidecarLifecycle>();
        if lifecycle.is_shutting_down() || lifecycle.has_sidecar() {
            return;
        }
        let origin_directory = app.path().app_local_data_dir();
        #[cfg(target_os = "macos")]
        let origin_directory =
            if let Some(profile) = app.try_state::<crate::qa_profile::QaProfile>() {
                Ok(profile.home().join(".gajae-app"))
            } else {
                origin_directory
            };
        let desktop_origin = match origin_directory
            .map_err(|error| error.to_string())
            .and_then(crate::desktop_origin::DesktopOrigin::load)
        {
            Ok(origin) => origin,
            Err(error) => {
                show_error(&window, &error, true);
                return;
            }
        };
        let payload = match payload_root(&app) {
            Ok(payload) => payload,
            Err(error) => {
                show_error(&window, &error, true);
                return;
            }
        };
        let api_key = match random_secret() {
            Ok(value) => value,
            Err(error) => {
                show_error(&window, &error, true);
                return;
            }
        };
        let nonce = match random_secret() {
            Ok(value) => value,
            Err(error) => {
                show_error(&window, &error, true);
                return;
            }
        };
        let entrypoint = payload.join("dist-server/server/index.js");
        let requested_port = desktop_origin.requested_port().to_string();
        #[cfg(windows)]
        let mut environment: Vec<(OsString, OsString)> = [
            ("HOST", "127.0.0.1"),
            ("SERVER_PORT", requested_port.as_str()),
            ("NODE_ENV", "production"),
            ("GJC_DESKTOP", "1"),
            ("GJC_DESKTOP_API_KEY", &api_key),
            ("GJC_DESKTOP_BOOTSTRAP_NONCE", &nonce),
        ]
        .into_iter()
        .map(|(key, value)| (key.into(), value.into()))
        .collect();
        // Preserve the user's inherited environment and Unicode home directory.
        let home = app
            .path()
            .home_dir()
            .ok()
            .map(|path| path.into_os_string())
            .or_else(|| env::var_os("HOME"))
            .unwrap_or_default();
        #[cfg(windows)]
        environment.push(("HOME".into(), home));
        let native = payload.join("dist-native");
        let inherited_path = env::var_os("PATH").unwrap_or_default();
        let path =
            env::join_paths(std::iter::once(native).chain(env::split_paths(&inherited_path)));
        let path = match path {
            Ok(path) => path,
            Err(error) => {
                show_error(&window, &format!("invalid server PATH: {error}"), true);
                return;
            }
        };
        #[cfg(windows)]
        environment.push(("PATH".into(), path));
        let command = lifecycle.start(|| {
            reset_desktop_readiness(&app);
            *app.state::<RecoveryScreen>()
                .0
                .lock()
                .expect("recovery screen lock poisoned") = None;
            #[cfg(unix)]
            let command = app
                .shell()
                .sidecar("gajae-app-server")
                .map_err(|error| format!("could not prepare server sidecar: {error}"))?
                .arg(entrypoint.to_string_lossy().as_ref());
            #[cfg(target_os = "macos")]
            let command = if let Some(profile) = app.try_state::<crate::qa_profile::QaProfile>() {
                if payload.join(".env").exists() {
                    return Err(
                        "QA refuses a server payload containing an environment file.".into(),
                    );
                }
                command
                    .env_clear()
                    .envs(profile.environment())
                    .current_dir(profile.home())
            } else {
                command
                    .env("HOME", &home)
                    .env("PATH", &path)
                    .current_dir(&payload)
            };
            #[cfg(all(unix, not(target_os = "macos")))]
            let command = command
                .env("HOME", &home)
                .env("PATH", &path)
                .current_dir(&payload);
            #[cfg(unix)]
            let (events, child) = command
                .env("HOST", "127.0.0.1")
                .env("SERVER_PORT", &requested_port)
                .env("NODE_ENV", "production")
                .env("GJC_DESKTOP", "1")
                .env("GJC_DESKTOP_API_KEY", &api_key)
                .env("GJC_DESKTOP_BOOTSTRAP_NONCE", &nonce)
                .set_raw_out(true)
                .spawn()
                .map_err(|error| format!("could not start server sidecar: {error}"))?;
            #[cfg(unix)]
            let sidecar_pid = child.pid();
            #[cfg(unix)]
            let tracked = crate::lifecycle::Sidecar::unix_owned(child);
            #[cfg(windows)]
            let (events, child) = {
                let executable = std::env::current_exe().map_err(|error| error.to_string())?;
                let directory = executable
                    .parent()
                    .ok_or_else(|| "desktop executable has no directory".to_owned())?;
                crate::windows_process::spawn(
                    &directory.join("gajae-app-server.exe"),
                    &[
                        "--eval".into(),
                        include_str!("windows-server-bootstrap.cjs").into(),
                        entrypoint.into_os_string(),
                    ],
                    &payload,
                    &environment,
                )?
            };
            #[cfg(windows)]
            let sidecar_pid = child.pid();
            #[cfg(windows)]
            let tracked = crate::lifecycle::Sidecar::windows(std::sync::Arc::clone(&child));
            Ok((tracked, (events, sidecar_pid)))
        });
        let (mut events, sidecar_pid) = match command {
            Ok(Some(child)) => child,
            Ok(None) => return,
            Err(error) => {
                show_error(&window, &error, true);
                return;
            }
        };
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let mut output = OutputRing::default();
        let mut ready = false;
        let mut ready_lines = ReadyLines::default();
        loop {
            if !ready && lifecycle.is_shutting_down() {
                handle_sidecar_failure(
                    &app,
                    &window,
                    sidecar_pid,
                    &mut events,
                    "Desktop server startup was cancelled.".to_owned(),
                    false,
                )
                .await;
                return;
            }
            let remaining = if ready {
                PROCESS_POLL_INTERVAL
            } else {
                deadline.saturating_duration_since(Instant::now())
            };
            if remaining.is_zero() {
                handle_sidecar_failure(
                    &app,
                    &window,
                    sidecar_pid,
                    &mut events,
                    format!(
                        "Desktop server did not become ready before the startup timeout.\n\n{}",
                        output.text()
                    ),
                    false,
                )
                .await;
                return;
            }
            // Poll even after readiness: an inherited output pipe can delay
            // the plugin's Terminated event after its waiter reaps the server.
            if lifecycle.reap_if_stopped(sidecar_pid) {
                reset_desktop_readiness(&app);
                if !lifecycle.is_shutting_down() {
                    show_error(
                        &window,
                        &format!(
                            "Desktop server exited before its output closed.\n\n{}",
                            output.text()
                        ),
                        true,
                    );
                }
                return;
            }
            let event =
                match time::timeout(remaining.min(PROCESS_POLL_INTERVAL), events.recv()).await {
                    Ok(event) => event,
                    Err(_) => continue,
                };
            let Some(event) = event else {
                handle_sidecar_failure(
                    &app,
                    &window,
                    sidecar_pid,
                    &mut events,
                    format!(
                        "Desktop server output closed unexpectedly.\n\n{}",
                        output.text()
                    ),
                    ready,
                )
                .await;
                return;
            };
            match event {
                CommandEvent::Stderr(line) => output.push(&line),
                CommandEvent::Stdout(line) => {
                    output.push(&line);
                    if ready || lifecycle.is_shutting_down() {
                        continue;
                    }
                    for ready_frame in ready_lines.push(&line) {
                        if !ready_frame.matches_sidecar(sidecar_pid) {
                            continue;
                        }
                        match health_check(ready_frame.port, &ready_frame.version) {
                            Ok(()) => {
                                // Quit can arrive during the health request.
                                if lifecycle.is_shutting_down() {
                                    handle_sidecar_failure(
                                        &app,
                                        &window,
                                        sidecar_pid,
                                        &mut events,
                                        "Desktop server startup was cancelled.".to_owned(),
                                        false,
                                    )
                                    .await;
                                    return;
                                }
                                if let Err(error) = desktop_origin
                                    .persist_verified_port(ready_frame.port)
                                    .and_then(|()| {
                                        navigate_and_show(&app, &window, ready_frame.port, &nonce)
                                    })
                                {
                                    handle_sidecar_failure(
                                        &app,
                                        &window,
                                        sidecar_pid,
                                        &mut events,
                                        error,
                                        false,
                                    )
                                    .await;
                                    return;
                                }
                                ready = true;
                                break;
                            }
                            Err(error) => {
                                handle_sidecar_failure(
                                    &app,
                                    &window,
                                    sidecar_pid,
                                    &mut events,
                                    format!("Desktop server did not pass identity verification: {error}\n\n{}", output.text()),
                                    false,
                                ).await;
                                return;
                            }
                        }
                    }
                }
                CommandEvent::Terminated(status) => {
                    reset_desktop_readiness(&app);
                    lifecycle.exited(sidecar_pid);
                    if lifecycle.has_sidecar() {
                        handle_sidecar_failure(
                            &app,
                            &window,
                            sidecar_pid,
                            &mut events,
                            format!(
                                "Desktop server exited unexpectedly ({status:?}).\n\n{}",
                                output.text()
                            ),
                            false,
                        )
                        .await;
                        return;
                    }
                    if !lifecycle.is_shutting_down() {
                        show_error(
                            &window,
                            &format!(
                                "Desktop server exited unexpectedly ({status:?}).\n\n{}",
                                output.text()
                            ),
                            true,
                        );
                    }
                    return;
                }
                CommandEvent::Error(error) => {
                    handle_sidecar_failure(
                        &app,
                        &window,
                        sidecar_pid,
                        &mut events,
                        format!("Desktop server failed: {error}\n\n{}", output.text()),
                        ready,
                    )
                    .await;
                    return;
                }
                _ => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_check_accepts_only_the_expected_server_identity() {
        for version in ["expected", "wrong"] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let responder = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0u8; 1024];
                assert!(socket.read(&mut request).unwrap() > 0);
                let body = format!(
                    r#"{{"status":"ok","product":"gajae-app","protocolVersion":1,"version":"{version}"}}"#
                );
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            });
            assert_eq!(
                health_check(port, "expected").is_ok(),
                version == "expected"
            );
            responder.join().unwrap();
        }
    }

    #[test]
    fn trickling_health_response_cannot_extend_the_deadline() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let responder = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            for _ in 0..100 {
                if socket.write_all(b"x").is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        let start = Instant::now();
        assert!(read_health_response(&mut stream, start + Duration::from_millis(100)).is_err());
        assert!(start.elapsed() < Duration::from_secs(1));
        drop(stream);
        responder.join().unwrap();
    }

    #[test]
    fn oversized_health_response_is_rejected() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let responder = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let _ = socket.write_all(&vec![b'x'; HEALTH_RESPONSE_LIMIT + 1]);
        });
        assert!(
            read_health_response(&mut stream, Instant::now() + HEALTH_TIMEOUT)
                .unwrap_err()
                .contains("size limit")
        );
        responder.join().unwrap();
    }

    #[test]
    fn output_ring_is_bounded() {
        let mut ring = OutputRing::default();
        ring.push(&vec![b'x'; OUTPUT_LIMIT + 1]);
        assert_eq!(ring.bytes.len(), OUTPUT_LIMIT);
    }

    #[cfg(unix)]
    mod process_tests {
        use super::*;
        use crate::lifecycle::SidecarLifecycle;
        use std::io::BufRead;
        use std::os::unix::process::ExitStatusExt;
        use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
        use std::sync::{Arc, Mutex};

        struct TestChild {
            child: Arc<Mutex<Child>>,
            input: ChildStdin,
            pid: u32,
            waiter: Option<std::thread::JoinHandle<ExitStatus>>,
        }

        impl TestChild {
            fn spawn(
                ignore_term: bool,
                send_exit: bool,
            ) -> (Self, tauri::async_runtime::Receiver<CommandEvent>) {
                let script = if ignore_term {
                    "trap '' TERM; printf 'ready\\n'; read line"
                } else {
                    "trap 'exit 0' TERM; printf 'ready\\n'; read line"
                };
                let mut child = Command::new("/bin/sh")
                    .args(["-c", script])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap();
                let stdout = child.stdout.take().unwrap();
                let input = child.stdin.take().unwrap();
                let mut fixture = Self {
                    pid: child.id(),
                    child: Arc::new(Mutex::new(child)),
                    input,
                    waiter: None,
                };
                // Establish that TERM handling is installed, without relying
                // on sleeps or leaving a child behind if an assertion fails.
                let (ready_tx, ready_rx) = std::sync::mpsc::channel();
                let reader = std::thread::spawn(move || {
                    let mut line = String::new();
                    std::io::BufReader::new(stdout)
                        .read_line(&mut line)
                        .unwrap();
                    let _ = ready_tx.send(line);
                });
                assert_eq!(
                    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
                    "ready\n"
                );
                reader.join().unwrap();
                let (sender, events) = tauri::async_runtime::channel(2);
                sender
                    .try_send(CommandEvent::Error("output reader failed".to_owned()))
                    .unwrap();
                let sender = send_exit.then_some(sender);
                let waiting_child = Arc::clone(&fixture.child);
                fixture.waiter = Some(std::thread::spawn(move || loop {
                    let status = waiting_child.lock().unwrap().try_wait().unwrap();
                    if let Some(status) = status {
                        if let Some(sender) = sender {
                            let _ = sender.try_send(CommandEvent::Terminated(
                                tauri_plugin_shell::process::TerminatedPayload {
                                    code: status.code(),
                                    signal: status.signal(),
                                },
                            ));
                        }
                        return status;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }));
                (fixture, events)
            }

            fn kill(&self) -> Result<(), String> {
                self.child
                    .lock()
                    .unwrap()
                    .kill()
                    .map_err(|error| error.to_string())
            }

            fn status(&mut self) -> ExitStatus {
                self.waiter.take().unwrap().join().unwrap()
            }
        }

        impl Drop for TestChild {
            fn drop(&mut self) {
                let mut child = self.child.lock().unwrap();
                let _ = child.kill();
                let _ = child.wait();
                drop(child);
                if let Some(waiter) = self.waiter.take() {
                    let _ = waiter.join();
                }
            }
        }

        #[test]
        fn hung_startup_cleanup_keeps_retry_fenced_until_exit() {
            tauri::async_runtime::block_on(async {
                for send_exit in [true, false] {
                    let lifecycle = SidecarLifecycle::default();
                    let (mut child, mut events) = TestChild::spawn(true, send_exit);
                    lifecycle
                        .start(|| Ok((crate::lifecycle::Sidecar::unmanaged(child.pid), ())))
                        .unwrap();
                    let mut stopping = Box::pin(stop_failed_sidecar(
                        &lifecycle,
                        child.pid,
                        &mut events,
                        Some(|| child.kill()),
                        Duration::from_millis(150),
                        Duration::from_secs(2),
                    ));
                    assert!(time::timeout(Duration::from_millis(30), &mut stopping)
                        .await
                        .is_err());
                    assert!(lifecycle.has_sidecar());
                    assert_eq!(
                        lifecycle.start::<()>(|| panic!("cleanup still owns the child")),
                        Ok(None)
                    );
                    time::timeout(Duration::from_secs(3), stopping)
                        .await
                        .unwrap()
                        .unwrap();
                    assert_eq!(child.status().signal(), Some(9));
                    assert!(!crate::lifecycle::process_alive(child.pid));
                    let (mut retry, mut retry_events) = TestChild::spawn(false, true);
                    assert_eq!(
                        lifecycle
                            .start(|| Ok((crate::lifecycle::Sidecar::unmanaged(retry.pid), ())))
                            .unwrap(),
                        Some(())
                    );
                    lifecycle.exited(child.pid);
                    assert!(
                        lifecycle.has_sidecar(),
                        "a stale exit must not clear Retry's PID"
                    );
                    stop_failed_sidecar(
                        &lifecycle,
                        retry.pid,
                        &mut retry_events,
                        Some(|| retry.kill()),
                        Duration::from_secs(2),
                        Duration::from_secs(1),
                    )
                    .await
                    .unwrap();
                    assert!(retry.status().success());
                }
            });
        }

        #[test]
        fn closing_during_startup_reaps_the_child_and_permanently_fences_retry() {
            tauri::async_runtime::block_on(async {
                let lifecycle = SidecarLifecycle::default();
                let (mut child, mut events) = TestChild::spawn(true, true);
                lifecycle
                    .start(|| Ok((crate::lifecycle::Sidecar::unmanaged(child.pid), ())))
                    .unwrap();
                assert_eq!(lifecycle.begin_shutdown(), Some(child.pid));
                assert_eq!(lifecycle.begin_shutdown(), None);
                assert!(!lifecycle.shutdown_complete());
                stop_failed_sidecar(
                    &lifecycle,
                    child.pid,
                    &mut events,
                    Some(|| child.kill()),
                    Duration::from_millis(50),
                    Duration::from_secs(2),
                )
                .await
                .unwrap();
                assert_eq!(child.status().signal(), Some(9));
                assert!(lifecycle.shutdown_complete());
                assert_eq!(
                    lifecycle.start::<()>(|| panic!("Quit already began")),
                    Ok(None)
                );
            });
        }

        #[test]
        fn failed_kill_is_bounded_and_never_releases_a_live_child() {
            tauri::async_runtime::block_on(async {
                let lifecycle = SidecarLifecycle::default();
                let (mut child, mut events) = TestChild::spawn(true, false);
                lifecycle
                    .start(|| Ok((crate::lifecycle::Sidecar::unmanaged(child.pid), ())))
                    .unwrap();
                let error = time::timeout(
                    Duration::from_secs(2),
                    stop_failed_sidecar(
                        &lifecycle,
                        child.pid,
                        &mut events,
                        Some(|| Err("injected kill failure".to_owned())),
                        Duration::from_millis(30),
                        Duration::from_millis(30),
                    ),
                )
                .await
                .unwrap()
                .unwrap_err();
                assert!(error.contains("injected kill failure"));
                assert!(lifecycle.has_sidecar());
                assert!(crate::lifecycle::process_alive(child.pid));
                assert_eq!(
                    lifecycle.start::<()>(|| panic!("exit remains unconfirmed")),
                    Ok(None)
                );
                child.input.write_all(b"exit\n").unwrap();
                assert!(
                    wait_for_sidecar_exit(
                        &lifecycle,
                        child.pid,
                        &mut events,
                        Duration::from_secs(2)
                    )
                    .await
                );
                lifecycle.exited(child.pid);
                assert!(child.status().success());
                assert!(!lifecycle.has_sidecar());
            });
        }

        #[test]
        fn ready_session_shutdown_never_escalates_to_sigkill() {
            tauri::async_runtime::block_on(async {
                let lifecycle = SidecarLifecycle::default();
                let (mut child, mut events) = TestChild::spawn(true, true);
                lifecycle
                    .start(|| Ok((crate::lifecycle::Sidecar::unmanaged(child.pid), ())))
                    .unwrap();
                let result = stop_failed_sidecar(
                    &lifecycle,
                    child.pid,
                    &mut events,
                    None::<fn() -> Result<(), String>>,
                    Duration::from_millis(30),
                    Duration::from_millis(30),
                )
                .await;
                assert!(result.is_err());
                assert!(crate::lifecycle::process_alive(child.pid));
                assert!(lifecycle.has_sidecar());
                child.input.write_all(b"exit\n").unwrap();
                assert!(
                    wait_for_sidecar_exit(
                        &lifecycle,
                        child.pid,
                        &mut events,
                        Duration::from_secs(2)
                    )
                    .await
                );
                lifecycle.exited(child.pid);
                assert!(child.status().success());
            });
        }
    }

    #[test]
    fn readiness_reassembles_fragmented_and_coalesced_crlf_frames() {
        let frame = b"{\"kind\":\"gajae-desktop-ready\",\"pid\":1,\"host\":\"127.0.0.1\",\"port\":1234,\"protocolVersion\":1,\"version\":\"0.2.0\"}\r\n";
        for split in 0..frame.len() {
            let mut lines = ReadyLines::default();
            assert!(lines.push(&frame[..split]).is_empty());
            let ready = lines.push(&frame[split..]);
            assert_eq!(ready.len(), 1);
            assert!(ready[0].matches_sidecar(1));
        }
        let mut lines = ReadyLines::default();
        assert_eq!(
            lines
                .push(&[b"ordinary log\n".as_slice(), frame, frame].concat())
                .len(),
            2
        );
        assert!(lines.push(&vec![b'x'; OUTPUT_LIMIT + 1]).is_empty());
        assert!(
            lines.push(frame).is_empty(),
            "an oversized line must not yield a valid suffix"
        );
        assert_eq!(lines.push(frame).len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn failed_startup_cleanup_is_bounded_when_output_closes_and_sigterm_is_ignored() {
        use std::io::BufRead;
        use std::process::{Command, Stdio};
        tauri::async_runtime::block_on(async {
            let mut child = Command::new("/bin/sh")
                .args(["-c", "trap '' TERM; printf 'ready\\n'; read line"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let mut line = String::new();
            std::io::BufReader::new(child.stdout.take().unwrap())
                .read_line(&mut line)
                .unwrap();
            let pid = child.id();
            let lifecycle = crate::lifecycle::SidecarLifecycle::default();
            lifecycle
                .start(|| Ok((crate::lifecycle::Sidecar::unmanaged(pid), ())))
                .unwrap();
            let (sender, mut events) = tauri::async_runtime::channel(1);
            drop(sender);
            let cleanup = time::timeout(
                Duration::from_secs(3),
                stop_failed_sidecar(
                    &lifecycle,
                    pid,
                    &mut events,
                    None::<fn() -> Result<(), String>>,
                    Duration::from_millis(100),
                    Duration::from_secs(2),
                ),
            )
            .await
            .expect("closed output must not make cleanup loop forever")
            .unwrap_err();
            assert!(cleanup.contains("did not complete graceful shutdown"));
            child.kill().unwrap();
            assert!(!child.wait().unwrap().success());
            lifecycle.exited(pid);
            assert!(!lifecycle.has_sidecar());
        });
    }

    #[test]
    fn ready_frame_requires_loopback_contract() {
        let ready: ReadyFrame = serde_json::from_str(r#"{"kind":"gajae-desktop-ready","pid":1,"host":"127.0.0.1","port":1234,"protocolVersion":1,"version":"0.2.0"}"#).unwrap();
        assert!(ready.matches_sidecar(1));
        assert!(!ready.matches_sidecar(2));
        for (field, value) in [
            ("kind", serde_json::json!("other-ready")),
            ("pid", serde_json::json!(0)),
            ("host", serde_json::json!("example.com")),
            ("port", serde_json::json!(0)),
            ("protocolVersion", serde_json::json!(2)),
        ] {
            let mut frame = serde_json::json!({"kind":READY_KIND,"pid":1,"host":"127.0.0.1","port":1234,"protocolVersion":1,"version":"0.2.0"});
            frame[field] = value;
            assert!(!serde_json::from_value::<ReadyFrame>(frame)
                .unwrap()
                .matches_sidecar(1));
        }
    }
}
