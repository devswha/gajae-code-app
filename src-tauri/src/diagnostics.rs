//! Bounded, privacy-safe desktop startup/shutdown incident diagnostics.
//!
//! This extends the diagnostic model the updater restart path already uses
//! (`updater_restart::Attempt::trace`): the same hardened private JSONL
//! writer, one record per lifecycle stage, closed vocabularies only. It is
//! deliberately not a second telemetry framework — `append_bounded` below is
//! the single writer both paths share.
//!
//! A record carries build/runtime identity, lifecycle stage, process
//! generation, owned child identity and port intent. It never carries message
//! text, supervised server output, environment, filesystem paths, URLs or any
//! user content: failures are reduced to a fixed category plus the byte length
//! of the operator-visible message.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, AtomicU64, Ordering},
        Mutex,
    },
    time::Instant,
};

use tauri::{AppHandle, Manager};

/// Records are appended here under the desktop data root.
const FILE: &str = "desktop-startup.jsonl";
/// Matches the updater-restart diagnostic bound: a truncating 64 KiB ring.
const LIMIT: u64 = 64 * 1024;
const UNSET_PORT: u32 = u32::MAX;

/// Closed lifecycle-stage vocabulary. Never built from input.
pub(crate) const STAGES: [&str; 7] = [
    "start-requested",
    "origin-resolved",
    "sidecar-spawned",
    "ready",
    "failure",
    "shutdown-requested",
    "shutdown-settled",
];

/// Closed failure vocabulary. `classify` only ever returns one of these.
pub(crate) const CATEGORIES: [&str; 13] = [
    "startup_cancelled",
    "startup_timeout",
    "identity_verification_failed",
    "server_exited_early",
    "server_output_closed",
    "sidecar_stream_failed",
    "sidecar_spawn_failed",
    "payload_unverified",
    "desktop_origin_invalid",
    "credential_unavailable",
    "navigation_failed",
    "cleanup_unconfirmed",
    "shutdown_failed",
];

/// Reduce an operator-visible failure message to one fixed category.
///
/// Supervisor failure messages are built from fixed templates in
/// `supervisor.rs`/`lifecycle.rs`, but they interpolate OS errors and up to
/// 64 KiB of supervised server output. Only the leading template is matched,
/// and only the category is ever recorded, so interpolated content cannot
/// reach a diagnostic record. Anything unrecognised stays `unclassified`
/// rather than being guessed.
pub(crate) fn classify(message: &str) -> &'static str {
    const PREFIXES: [(&str, &str); 17] = [
        ("Desktop server startup was cancelled.", "startup_cancelled"),
        ("Desktop server did not become ready", "startup_timeout"),
        (
            "Desktop server did not pass identity verification",
            "identity_verification_failed",
        ),
        (
            "Desktop server exited before its output closed",
            "server_exited_early",
        ),
        ("Desktop server exited unexpectedly", "server_exited_early"),
        (
            "Desktop server output closed unexpectedly",
            "server_output_closed",
        ),
        ("Desktop server failed:", "sidecar_stream_failed"),
        ("could not start server sidecar", "sidecar_spawn_failed"),
        ("could not prepare server sidecar", "sidecar_spawn_failed"),
        ("QA refuses a server payload", "sidecar_spawn_failed"),
        ("server payload", "payload_unverified"),
        (
            "could not locate application resources",
            "payload_unverified",
        ),
        ("Desktop port", "desktop_origin_invalid"),
        ("Desktop origin", "desktop_origin_invalid"),
        ("Could not read desktop origin", "desktop_origin_invalid"),
        (
            "Could not preserve desktop origin",
            "desktop_origin_invalid",
        ),
        (
            "The verified desktop server changed its assigned origin.",
            "desktop_origin_invalid",
        ),
    ];
    for (prefix, category) in PREFIXES {
        if message.starts_with(prefix) {
            return category;
        }
    }
    // Secondary templates that only ever appear appended to a primary
    // failure, or that carry no distinguishing prefix of their own.
    const CONTAINED: [(&str, &str); 6] = [
        (
            "could not generate desktop credential",
            "credential_unavailable",
        ),
        ("could not open supervised server", "navigation_failed"),
        ("could not show main window", "navigation_failed"),
        (
            "Retry remains disabled until it exits.",
            "cleanup_unconfirmed",
        ),
        ("did not complete its graceful shutdown", "shutdown_failed"),
        (
            "could not send SIGTERM to desktop server",
            "shutdown_failed",
        ),
    ];
    for (needle, category) in CONTAINED {
        if message.contains(needle) {
            return category;
        }
    }
    "unclassified"
}

fn run_id() -> String {
    use std::fmt::Write as _;
    let mut bytes = [0u8; 16];
    if getrandom::getrandom(&mut bytes).is_err() {
        return "unknown".to_owned();
    }
    let mut text = String::with_capacity(32);
    for byte in bytes {
        write!(text, "{byte:02x}").expect("writing to a String cannot fail");
    }
    text
}

/// Per-app-process startup/shutdown recorder.
///
/// `generation` is the supervised-start attempt counter: the first start is 1
/// and every accepted Retry increments it, so repeated Retry attempts stay
/// individually attributable in the log.
pub(crate) struct Startup {
    run_id: String,
    generation: AtomicU64,
    started: Instant,
    requested_port: AtomicU32,
    listening_port: AtomicU32,
    root: Mutex<Option<PathBuf>>,
}

impl Default for Startup {
    fn default() -> Self {
        Self {
            run_id: run_id(),
            generation: AtomicU64::new(0),
            started: Instant::now(),
            requested_port: AtomicU32::new(UNSET_PORT),
            listening_port: AtomicU32::new(UNSET_PORT),
            root: Mutex::new(None),
        }
    }
}

impl Startup {
    /// Open a new supervised-start attempt. Per-attempt port intent is
    /// cleared so a Retry can never inherit the previous attempt's evidence.
    pub(crate) fn begin(&self) -> u64 {
        self.requested_port.store(UNSET_PORT, Ordering::SeqCst);
        self.listening_port.store(UNSET_PORT, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub(crate) fn bind_root(&self, root: &Path) {
        if let Ok(mut slot) = self.root.lock() {
            *slot = Some(root.to_path_buf());
        }
    }

    /// The port the desktop asked the server to bind (0 = OS-assigned).
    pub(crate) fn requested(&self, port: u16) {
        self.requested_port.store(u32::from(port), Ordering::SeqCst);
    }

    /// The port the verified server actually reported listening on.
    pub(crate) fn listening(&self, port: u16) {
        self.listening_port.store(u32::from(port), Ordering::SeqCst);
    }

    fn port(value: &AtomicU32) -> Option<u32> {
        match value.load(Ordering::SeqCst) {
            UNSET_PORT => None,
            port => Some(port),
        }
    }

    /// Record a non-failure lifecycle stage against an already-held handle.
    pub(crate) fn emit_stage(&self, stage: &'static str, server_pid: Option<u32>) {
        self.emit(stage, server_pid, None, None);
    }

    fn emit(
        &self,
        stage: &'static str,
        server_pid: Option<u32>,
        category: Option<&'static str>,
        message_bytes: Option<usize>,
    ) {
        debug_assert!(STAGES.contains(&stage), "stage vocabulary is closed");
        debug_assert!(
            category.is_none_or(|value| value == "unclassified" || CATEGORIES.contains(&value)),
            "failure vocabulary is closed"
        );
        let record = serde_json::json!({
            "event": "desktop_startup",
            "schemaVersion": 1,
            "runId": self.run_id,
            "generation": self.generation(),
            "stage": stage,
            "category": category,
            "messageBytes": message_bytes,
            "elapsedMs": self.started.elapsed().as_millis(),
            "shellPid": std::process::id(),
            "serverPid": server_pid,
            "requestedPort": Self::port(&self.requested_port),
            "listeningPort": Self::port(&self.listening_port),
            "productVersion": env!("GJC_EXPECTED_PAYLOAD_VERSION"),
            "desktopVersion": env!("CARGO_PKG_VERSION"),
            "updateMode": env!("GJC_UPDATE_MODE"),
            "debug": cfg!(debug_assertions),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "timeMs": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
        })
        .to_string();
        eprintln!("{record}");
        // Logging never supplies authority: a failed write cannot change
        // startup, Retry admission, shutdown or updater behaviour.
        if let Some(root) = self.root.lock().ok().and_then(|slot| slot.clone()) {
            let _ = append_bounded(&root, FILE, &record);
        }
    }
}

/// Record a non-failure lifecycle stage for the current attempt.
pub(crate) fn stage(app: &AppHandle, stage: &'static str, server_pid: Option<u32>) {
    if let Some(startup) = app.try_state::<Startup>() {
        startup.emit(stage, server_pid, None, None);
    }
}

/// Record a failure as one fixed category plus the message's byte length.
/// The message itself is never written: it can embed OS errors and supervised
/// server output.
pub(crate) fn failure(app: &AppHandle, message: &str) {
    if let Some(startup) = app.try_state::<Startup>() {
        startup.emit(
            "failure",
            None,
            Some(classify(message)),
            Some(message.len()),
        );
    }
}

/// Bounded private append-only diagnostics shared with the updater restart
/// path. The file stays owner-only and regular: a replaced, symlinked,
/// hard-linked or foreign-owned path is refused instead of being written
/// through. Oversized files truncate rather than grow without bound.
#[cfg(unix)]
pub(crate) fn append_bounded(root: &Path, name: &str, record: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
    static WRITER: Mutex<()> = Mutex::new(());
    // Diagnostics must never block or deadlock a lifecycle path.
    let Ok(_guard) = WRITER.try_lock() else {
        return Ok(());
    };
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(root.join(name))?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err(std::io::Error::other("Invalid diagnostic file"));
    }
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    if metadata.len() + record.len() as u64 + 1 > LIMIT {
        file.set_len(0)?;
    }
    writeln!(file, "{record}")
}

#[cfg(not(unix))]
pub(crate) fn append_bounded(_root: &Path, _name: &str, _record: &str) -> std::io::Result<()> {
    Ok(())
}

/// `append_bounded` deliberately skips its write when another thread already
/// holds the writer, so a diagnostic can never block a lifecycle path. Tests
/// that assert on written bytes must therefore serialize across every module
/// that shares the writer.
#[cfg(test)]
pub(crate) static TEST_WRITER: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) fn serialize_writer() -> std::sync::MutexGuard<'static, ()> {
    TEST_WRITER
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("gajae-diagnostics-{}", run_id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn records(root: &Path) -> Vec<serde_json::Value> {
        let text = std::fs::read_to_string(root.join(FILE)).unwrap_or_default();
        text.lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn every_supervisor_failure_template_maps_to_a_closed_category() {
        // The left column is copied from the messages `show_error` receives in
        // supervisor.rs and lifecycle.rs, including their interpolations.
        for (message, expected) in [
            (
                "Desktop server startup was cancelled.",
                "startup_cancelled",
            ),
            (
                "Desktop server did not become ready before the startup timeout.\n\nnoise",
                "startup_timeout",
            ),
            (
                "Desktop server did not pass identity verification: health connection failed: x\n\nnoise",
                "identity_verification_failed",
            ),
            (
                "Desktop server exited before its output closed.\n\nnoise",
                "server_exited_early",
            ),
            (
                "Desktop server exited unexpectedly (TerminatedPayload { code: Some(1), signal: None }).\n\nnoise",
                "server_exited_early",
            ),
            (
                "Desktop server output closed unexpectedly.\n\nnoise",
                "server_output_closed",
            ),
            (
                "Desktop server failed: output reader failed\n\nnoise",
                "sidecar_stream_failed",
            ),
            (
                "could not start server sidecar: No such file or directory (os error 2)",
                "sidecar_spawn_failed",
            ),
            (
                "could not prepare server sidecar: sidecar not found",
                "sidecar_spawn_failed",
            ),
            (
                "QA refuses a server payload containing an environment file.",
                "sidecar_spawn_failed",
            ),
            ("server payload is missing", "payload_unverified"),
            (
                "server payload is incomplete (missing /x/dist)",
                "payload_unverified",
            ),
            (
                "could not locate application resources: nope",
                "payload_unverified",
            ),
            (
                "Desktop port must be a small regular file.",
                "desktop_origin_invalid",
            ),
            (
                "Desktop port is invalid; refusing to change the stored origin.",
                "desktop_origin_invalid",
            ),
            (
                "Desktop origin changed during startup; refusing to overwrite it.",
                "desktop_origin_invalid",
            ),
            (
                "Could not read desktop origin: permission denied",
                "desktop_origin_invalid",
            ),
            (
                "The verified desktop server changed its assigned origin.",
                "desktop_origin_invalid",
            ),
            (
                "could not generate desktop credential: entropy unavailable",
                "credential_unavailable",
            ),
            (
                "could not open supervised server: navigation refused",
                "navigation_failed",
            ),
            ("could not show main window: no window", "navigation_failed"),
            (
                "desktop server did not complete its graceful shutdown",
                "shutdown_failed",
            ),
            (
                "could not send SIGTERM to desktop server 42: operation not permitted",
                "shutdown_failed",
            ),
        ] {
            assert_eq!(classify(message), expected, "message: {message}");
            assert!(
                CATEGORIES.contains(&expected),
                "category vocabulary is closed"
            );
        }
    }

    #[test]
    fn a_primary_failure_outranks_appended_cleanup_text_and_unknowns_stay_unclassified() {
        // handle_sidecar_failure appends cleanup outcomes to the primary
        // message; the primary cause must still be the recorded category.
        let composed = "Desktop server did not become ready before the startup timeout.\n\nout\n\nDesktop server 42 could not be stopped: kill denied. Retry remains disabled until it exits.";
        assert_eq!(classify(composed), "startup_timeout");
        // Cleanup only classifies when nothing more specific matched.
        assert_eq!(
            classify("Desktop server 42 did not complete graceful shutdown. Retry remains disabled until it exits."),
            "cleanup_unconfirmed"
        );
        assert_eq!(classify("something new nobody mapped"), "unclassified");
        assert_eq!(classify(""), "unclassified");
    }

    #[test]
    fn records_carry_bounded_identity_and_never_the_failure_message() {
        let _serial = serialize_writer();
        let root = Temp::new();
        let startup = Startup::default();
        startup.bind_root(&root.0);
        assert_eq!(startup.begin(), 1);
        startup.requested(60278);
        startup.emit("origin-resolved", None, None, None);
        let secret = "Could not read desktop origin: /Users/someone/secret-token-abc";
        startup.emit("failure", None, Some(classify(secret)), Some(secret.len()));

        let records = records(&root.0);
        assert_eq!(records.len(), 2);
        let failure = &records[1];
        assert_eq!(failure["event"], "desktop_startup");
        assert_eq!(failure["schemaVersion"], 1);
        assert_eq!(failure["stage"], "failure");
        assert_eq!(failure["category"], "desktop_origin_invalid");
        assert_eq!(failure["messageBytes"], secret.len());
        assert_eq!(failure["generation"], 1);
        assert_eq!(failure["requestedPort"], 60278);
        assert_eq!(failure["listeningPort"], serde_json::Value::Null);
        assert_eq!(failure["shellPid"], std::process::id());
        assert_eq!(
            failure["productVersion"],
            env!("GJC_EXPECTED_PAYLOAD_VERSION")
        );
        assert_eq!(failure["desktopVersion"], env!("CARGO_PKG_VERSION"));
        assert_eq!(failure["updateMode"], env!("GJC_UPDATE_MODE"));
        assert_eq!(failure.as_object().unwrap().len(), 19);

        let text = std::fs::read_to_string(root.0.join(FILE)).unwrap();
        assert!(
            !text.contains("secret-token-abc"),
            "message text must not leak"
        );
        assert!(!text.contains("/Users/"), "paths must not leak");
    }

    #[test]
    fn requested_and_actual_ports_are_both_recorded_and_can_disagree() {
        let _serial = serialize_writer();
        let root = Temp::new();
        let startup = Startup::default();
        startup.bind_root(&root.0);
        startup.begin();
        startup.requested(0);
        startup.listening(52341);
        startup.emit("ready", Some(4711), None, None);
        let ready = &records(&root.0)[0];
        assert_eq!(
            ready["requestedPort"], 0,
            "0 means OS-assigned, not unknown"
        );
        assert_eq!(ready["listeningPort"], 52341);
        assert_eq!(ready["serverPid"], 4711);
    }

    #[test]
    fn repeated_retry_attempts_stay_individually_attributable() {
        let _serial = serialize_writer();
        let root = Temp::new();
        let startup = Startup::default();
        startup.bind_root(&root.0);
        for attempt in 1..=3u64 {
            assert_eq!(startup.begin(), attempt);
            startup.requested(60278);
            startup.emit("start-requested", None, None, None);
            let message = "could not start server sidecar: Address already in use (os error 48)";
            startup.emit(
                "failure",
                None,
                Some(classify(message)),
                Some(message.len()),
            );
        }
        let records = records(&root.0);
        assert_eq!(records.len(), 6);
        for attempt in 1..=3usize {
            assert_eq!(records[(attempt - 1) * 2]["generation"], attempt);
            assert_eq!(records[(attempt - 1) * 2 + 1]["generation"], attempt);
            assert_eq!(
                records[(attempt - 1) * 2 + 1]["category"],
                "sidecar_spawn_failed"
            );
        }
        assert_eq!(startup.generation(), 3);
    }

    #[test]
    fn a_new_attempt_never_inherits_the_previous_attempts_port_evidence() {
        let _serial = serialize_writer();
        let root = Temp::new();
        let startup = Startup::default();
        startup.bind_root(&root.0);
        startup.begin();
        startup.requested(60278);
        startup.listening(60278);
        startup.emit("ready", None, None, None);
        startup.begin();
        startup.emit("start-requested", None, None, None);
        let records = records(&root.0);
        assert_eq!(records[1]["requestedPort"], serde_json::Value::Null);
        assert_eq!(records[1]["listeningPort"], serde_json::Value::Null);
    }

    #[test]
    fn shutdown_progress_survives_a_failed_startup_in_the_same_log() {
        let _serial = serialize_writer();
        let root = Temp::new();
        let startup = Startup::default();
        startup.bind_root(&root.0);
        startup.begin();
        let message = "Desktop server did not become ready before the startup timeout.\n\nout";
        startup.emit(
            "failure",
            None,
            Some(classify(message)),
            Some(message.len()),
        );
        startup.emit("shutdown-requested", Some(4711), None, None);
        startup.emit("shutdown-settled", Some(4711), None, None);
        let stages: Vec<_> = records(&root.0)
            .iter()
            .map(|record| record["stage"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            stages,
            ["failure", "shutdown-requested", "shutdown-settled"],
            "a failure must not erase later shutdown evidence"
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_shared_writer_is_private_bounded_and_refuses_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let _serial = serialize_writer();
        let root = Temp::new();
        let file = root.0.join(FILE);
        append_bounded(&root.0, FILE, "{\"stage\":\"failure\"}").unwrap();
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::write(&file, vec![b'x'; LIMIT as usize]).unwrap();
        append_bounded(&root.0, FILE, "{}").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{}\n");
        std::fs::remove_file(&file).unwrap();
        let other = root.0.join("untouched");
        std::fs::write(&other, "unchanged").unwrap();
        symlink(&other, &file).unwrap();
        assert!(append_bounded(&root.0, FILE, "{}").is_err());
        assert_eq!(std::fs::read_to_string(other).unwrap(), "unchanged");
    }

    #[test]
    fn an_unwritable_root_never_breaks_a_lifecycle_path() {
        // Holds the shared writer while its open fails, so it must serialize
        // with the tests that assert on written bytes.
        let _serial = serialize_writer();
        let startup = Startup::default();
        startup.bind_root(Path::new("/nonexistent-gajae-diagnostics-root"));
        startup.begin();
        startup.emit("start-requested", None, None, None);
    }
}
