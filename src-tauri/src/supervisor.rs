use std::fmt::Write as _;
use std::{
    collections::VecDeque,
    env,
    ffi::OsString,
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
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .map_err(|error| format!("invalid loopback address: {error}"))?,
        Duration::from_secs(2),
    )
    .map_err(|error| format!("health connection failed: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| format!("could not set health read timeout: {error}"))?;
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|error| format!("health request failed: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("health response failed: {error}"))?;
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

fn show_error(window: &WebviewWindow, message: &str) {
    let escaped =
        serde_json::to_string(message).unwrap_or_else(|_| "\"Desktop server failed\"".to_owned());
    // The retry listener is attached programmatically: inline onclick handlers
    // are blocked by the page CSP (script-src 'self'), and the invoke API
    // global requires withGlobalTauri (enabled in tauri.conf.json).
    let script = format!(
        "document.body.innerHTML = '<main style=\"font:16px system-ui;padding:3rem;max-width:48rem\"><h1>Gajae Code App could not start</h1><pre style=\"white-space:pre-wrap\"></pre><button id=\"gajae-retry\" type=\"button\">Retry</button></main>';document.querySelector('pre').textContent={escaped};document.getElementById('gajae-retry').addEventListener('click',function(){{var t=window.__TAURI__;if(t&&t.core&&t.core.invoke){{t.core.invoke('retry_desktop_server');}}else if(window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.invoke){{window.__TAURI_INTERNALS__.invoke('retry_desktop_server');}}}});"
    );
    let _ = window.eval(&script);
    let _ = window.show();
}

async fn stop_failed_sidecar(
    lifecycle: &crate::lifecycle::SidecarLifecycle,
    pid: u32,
    events: tauri::async_runtime::Receiver<CommandEvent>,
) {
    stop_failed_sidecar_with_timeouts(
        lifecycle,
        pid,
        events,
        crate::lifecycle::SHUTDOWN_TIMEOUT,
        crate::lifecycle::FORCE_STOP_TIMEOUT,
    )
    .await;
}

async fn stop_failed_sidecar_with_timeouts(
    lifecycle: &crate::lifecycle::SidecarLifecycle,
    pid: u32,
    mut events: tauri::async_runtime::Receiver<CommandEvent>,
    grace: Duration,
    force: Duration,
) {
    let mut forced = lifecycle.stop(pid, false).is_err();
    if forced {
        let _ = lifecycle.stop(pid, true);
    }
    let mut deadline = Instant::now() + if forced { force } else { grace };
    loop {
        if lifecycle.reap_if_stopped(pid) {
            return;
        }
        if Instant::now() >= deadline {
            if forced {
                // Retain ownership and block Retry if exit cannot be verified.
                // This task itself must not hang indefinitely on a closed pipe.
                eprintln!("desktop server {pid} did not stop within the cleanup deadline");
                return;
            }
            let _ = lifecycle.stop(pid, true);
            forced = true;
            deadline = Instant::now() + force;
        }
        match time::timeout(Duration::from_millis(50), events.recv()).await {
            Ok(Some(CommandEvent::Terminated(_))) => lifecycle.exited(pid),
            Ok(None) => time::sleep(Duration::from_millis(50)).await,
            _ => {}
        }
    }
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
    let origin = endpoint(port);
    app.state::<crate::navigation::LoopbackOrigin>().set(origin);
    let url = crate::navigation::bootstrap_url(port, nonce)?;
    window
        .navigate(url)
        .map_err(|error| format!("could not open supervised server: {error}"))?;
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
        let payload = match payload_root(&app) {
            Ok(payload) => payload,
            Err(error) => {
                show_error(&window, &error);
                return;
            }
        };
        let api_key = match random_secret() {
            Ok(value) => value,
            Err(error) => {
                show_error(&window, &error);
                return;
            }
        };
        let nonce = match random_secret() {
            Ok(value) => value,
            Err(error) => {
                show_error(&window, &error);
                return;
            }
        };
        let entrypoint = payload.join("dist-server/server/index.js");
        let mut environment: Vec<(OsString, OsString)> = [
            ("HOST", "127.0.0.1"),
            ("SERVER_PORT", "0"),
            ("NODE_ENV", "production"),
            ("GJC_DESKTOP", "1"),
            ("GJC_DESKTOP_API_KEY", &api_key),
            ("GJC_DESKTOP_BOOTSTRAP_NONCE", &nonce),
        ]
        .into_iter()
        .map(|(key, value)| (key.into(), value.into()))
        .collect();
        // Preserve the user's inherited environment and Unicode home directory.
        if let Ok(home) = app.path().home_dir() {
            environment.push(("HOME".into(), home.into_os_string()));
        }
        let native = payload.join("dist-native");
        let inherited_path = env::var_os("PATH").unwrap_or_default();
        let path =
            env::join_paths(std::iter::once(native).chain(env::split_paths(&inherited_path)));
        let path = match path {
            Ok(path) => path,
            Err(error) => {
                show_error(&window, &format!("invalid server PATH: {error}"));
                return;
            }
        };
        environment.push(("PATH".into(), path));
        let command = lifecycle.start(|| {
            #[cfg(unix)]
            let (events, child) = app
                .shell()
                .sidecar("gajae-app-server")
                .map_err(|error| format!("could not prepare server sidecar: {error}"))?
                .arg(&entrypoint)
                .current_dir(&payload)
                .envs(environment)
                .set_raw_out(true)
                .spawn()
                .map_err(|error| format!("could not start server sidecar: {error}"))?;
            #[cfg(unix)]
            let tracked = crate::lifecycle::Sidecar::unix(child.pid());
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
            let tracked = crate::lifecycle::Sidecar::windows(std::sync::Arc::clone(&child));
            Ok((tracked, (events, child)))
        });
        let (mut events, child) = match command {
            Ok(Some(child)) => child,
            Ok(None) => return,
            Err(error) => {
                show_error(&window, &error);
                return;
            }
        };
        let sidecar_pid = child.pid();
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let mut output = OutputRing::default();
        let mut ready = false;
        let mut ready_lines = ReadyLines::default();
        loop {
            let event = if ready {
                events.recv().await
            } else {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    show_error(
                        &window,
                        &format!(
                            "Desktop server did not become ready before the startup timeout.\n\n{}",
                            output.text()
                        ),
                    );
                    stop_failed_sidecar(&lifecycle, sidecar_pid, events).await;
                    return;
                }
                match time::timeout(remaining, events.recv()).await {
                    Ok(event) => event,
                    Err(_) => {
                        show_error(&window, &format!("Desktop server did not become ready before the startup timeout.\n\n{}", output.text()));
                        stop_failed_sidecar(&lifecycle, sidecar_pid, events).await;
                        return;
                    }
                }
            };
            let Some(event) = event else {
                if !lifecycle.is_shutting_down() {
                    show_error(
                        &window,
                        &format!(
                            "Desktop server output closed unexpectedly.\n\n{}",
                            output.text()
                        ),
                    );
                }
                stop_failed_sidecar(&lifecycle, sidecar_pid, events).await;
                return;
            };
            match event {
                CommandEvent::Stderr(line) => output.push(&line),
                CommandEvent::Stdout(line) => {
                    output.push(&line);
                    if ready {
                        continue;
                    }
                    for ready_frame in ready_lines.push(&line) {
                        if !ready_frame.matches_sidecar(sidecar_pid) {
                            continue;
                        }
                        match health_check(ready_frame.port, &ready_frame.version) {
                            Ok(()) => {
                                if lifecycle.is_shutting_down() {
                                    stop_failed_sidecar(&lifecycle, sidecar_pid, events).await;
                                    return;
                                }
                                if let Err(error) =
                                    navigate_and_show(&app, &window, ready_frame.port, &nonce)
                                {
                                    show_error(&window, &error);
                                    stop_failed_sidecar(&lifecycle, sidecar_pid, events).await;
                                    return;
                                }
                                ready = true;
                                break;
                            }
                            Err(error) => {
                                show_error(&window, &format!("Desktop server did not pass identity verification: {error}\n\n{}", output.text()));
                                stop_failed_sidecar(&lifecycle, sidecar_pid, events).await;
                                return;
                            }
                        }
                    }
                }
                CommandEvent::Terminated(status) => {
                    lifecycle.exited(sidecar_pid);
                    #[cfg(windows)]
                    stop_failed_sidecar(&lifecycle, sidecar_pid, events).await;
                    if !lifecycle.is_shutting_down() {
                        show_error(
                            &window,
                            &format!(
                                "Desktop server exited unexpectedly ({status:?}).\n\n{}",
                                output.text()
                            ),
                        );
                    }
                    return;
                }
                CommandEvent::Error(error) => {
                    show_error(
                        &window,
                        &format!("Desktop server failed: {error}\n\n{}", output.text()),
                    );
                    stop_failed_sidecar(&lifecycle, sidecar_pid, events).await;
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
    fn output_ring_is_bounded() {
        let mut ring = OutputRing::default();
        ring.push(&vec![b'x'; OUTPUT_LIMIT + 1]);
        assert_eq!(ring.bytes.len(), OUTPUT_LIMIT);
    }

    #[cfg(unix)]
    #[test]
    fn failed_sidecar_stays_tracked_until_exit_even_when_retry_and_quit_race() {
        use std::io::BufRead;
        use std::os::unix::process::ExitStatusExt;
        use std::process::{Command, Stdio};

        tauri::async_runtime::block_on(async {
            let lifecycle = crate::lifecycle::SidecarLifecycle::default();
            let mut child = Command::new("/bin/sh")
                .args(["-c", "trap '' TERM; printf 'ready\\n'; read line"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            lifecycle
                .start(|| Ok((crate::lifecycle::Sidecar::unix(child.id()), ())))
                .unwrap();
            let mut ready = String::new();
            std::io::BufReader::new(child.stdout.take().unwrap())
                .read_line(&mut ready)
                .unwrap();
            assert_eq!(ready, "ready\n");
            let pid = child.id();
            let mut input = child.stdin.take().unwrap();
            let (sender, events) = tauri::async_runtime::channel(2);
            sender
                .try_send(CommandEvent::Error("output reader failed".to_owned()))
                .unwrap();
            let waiter = std::thread::spawn(move || {
                let status = child.wait().unwrap();
                // Match the shell plugin's independent process waiter.
                let _ = sender.blocking_send(CommandEvent::Terminated(
                    tauri_plugin_shell::process::TerminatedPayload {
                        code: status.code(),
                        signal: status.signal(),
                    },
                ));
            });
            let mut stopping = Box::pin(stop_failed_sidecar(&lifecycle, pid, events));
            assert!(time::timeout(Duration::from_millis(50), &mut stopping)
                .await
                .is_err());
            assert!(
                lifecycle.has_sidecar(),
                "SIGTERM is not proof of process exit"
            );
            assert_eq!(
                lifecycle.start::<()>(|| panic!("Retry must not spawn while cleanup is pending")),
                Ok(None)
            );
            assert_eq!(lifecycle.begin_shutdown(), Some(pid));
            input.write_all(b"exit\n").unwrap();
            drop(input);
            time::timeout(Duration::from_secs(5), stopping)
                .await
                .expect("cleanup must finish when the child actually exits");
            waiter.join().unwrap();
            assert!(!lifecycle.has_sidecar());
            assert_eq!(
                lifecycle.start::<()>(|| panic!("Retry must not restart after Quit begins")),
                Ok(None)
            );
        });
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
                .start(|| Ok((crate::lifecycle::Sidecar::unix(pid), ())))
                .unwrap();
            let reaper = std::thread::spawn(move || child.wait().unwrap());
            let (sender, events) = tauri::async_runtime::channel(1);
            drop(sender);
            time::timeout(
                Duration::from_secs(3),
                stop_failed_sidecar_with_timeouts(
                    &lifecycle,
                    pid,
                    events,
                    Duration::from_millis(100),
                    Duration::from_secs(2),
                ),
            )
            .await
            .expect("closed output must not make cleanup loop forever");
            assert!(!reaper.join().unwrap().success());
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
