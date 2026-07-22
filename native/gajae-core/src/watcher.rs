use std::ffi::OsStr;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, TrySendError};
use std::thread;
use std::time::Duration;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

const READY_FRAME: &[u8] = b"{\"protocolVersion\":1,\"kind\":\"ready\"}\n";
const WATCH_ERROR: &[u8] = b"gajae-core: watcher failed\n";
const MAX_FRAME_BYTES: usize = 64 * 1024;
const EVENT_CHANNEL_CAPACITY: usize = 256;

#[derive(Clone, Copy)]
enum OutputEvent {
    Add,
    Change,
}

impl OutputEvent {
    fn name(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Change => "change",
        }
    }
}

/// Runs a parent-owned recursive watcher until stdin reaches EOF.
pub fn run(roots: Vec<PathBuf>) -> bool {
    let (events_tx, events_rx) = mpsc::sync_channel(EVENT_CHANNEL_CAPACITY);
    let failed = Arc::new(AtomicBool::new(false));
    let callback_failed = Arc::clone(&failed);
    let mut watcher = match RecommendedWatcher::new(
        move |result: notify::Result<Event>| match events_tx.try_send(result.map_err(|_| ())) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                callback_failed.store(true, Ordering::Release);
            }
        },
        Config::default(),
    ) {
        Ok(watcher) => watcher,
        Err(_) => return fail(),
    };

    for root in &roots {
        if watcher.watch(root, RecursiveMode::Recursive).is_err() {
            return fail();
        }
    }

    let mut stdout = io::stdout().lock();
    if stdout.write_all(READY_FRAME).is_err() || stdout.flush().is_err() {
        return fail();
    }

    let (shutdown_tx, shutdown_rx) = mpsc::sync_channel(1);
    if thread::Builder::new()
        .name("gajae-core-watch-stdin".into())
        .spawn(move || {
            let _ = shutdown_tx.send(wait_for_stdin_eof());
        })
        .is_err()
    {
        return fail();
    }

    loop {
        if failed.load(Ordering::Acquire) {
            return fail();
        }
        match shutdown_rx.try_recv() {
            Ok(true) => return true,
            Ok(false) => return fail(),
            Err(mpsc::TryRecvError::Disconnected) => return fail(),
            Err(mpsc::TryRecvError::Empty) => {}
        }

        match events_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(event)) => {
                if !write_event_frames(&mut stdout, &roots, event) {
                    return fail();
                }
            }
            Ok(Err(())) | Err(RecvTimeoutError::Disconnected) => return fail(),
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

fn wait_for_stdin_eof() -> bool {
    let stdin = io::stdin();
    let mut stdin = stdin.lock();
    let mut buffer = [0_u8; 4096];
    loop {
        match stdin.read(&mut buffer) {
            Ok(0) => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
}

fn write_event_frames(stdout: &mut impl Write, roots: &[PathBuf], event: Event) -> bool {
    let Some((kind, destination_only)) = output_event(event.kind) else {
        return true;
    };

    let paths: &[PathBuf] = if destination_only {
        event.paths.last().map_or(&[], std::slice::from_ref)
    } else {
        &event.paths
    };
    for path in paths {
        if let Some(frame) = frame_for_path(kind, path, roots) {
            if stdout.write_all(&frame).is_err() || stdout.flush().is_err() {
                return false;
            }
        }
    }
    true
}

fn output_event(kind: EventKind) -> Option<(OutputEvent, bool)> {
    match kind {
        EventKind::Create(_) => Some((OutputEvent::Add, false)),
        EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::From)) => None,
        EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::Both)) => {
            Some((OutputEvent::Change, true))
        }
        EventKind::Modify(_) => Some((OutputEvent::Change, false)),
        _ => None,
    }
}

fn frame_for_path(kind: OutputEvent, path: &Path, roots: &[PathBuf]) -> Option<Vec<u8>> {
    let resolved = std::fs::canonicalize(path).ok()?;
    frame_for_resolved_path(kind, &resolved, roots)
}

fn frame_for_resolved_path(kind: OutputEvent, path: &Path, roots: &[PathBuf]) -> Option<Vec<u8>> {
    if path.extension() != Some(OsStr::new("jsonl"))
        || !roots.iter().any(|root| is_inside_root(path, root))
    {
        return None;
    }
    let path = path.to_str()?;
    let mut frame = String::with_capacity(path.len() + 64);
    frame.push_str("{\"protocolVersion\":1,\"kind\":\"event\",\"event\":\"");
    frame.push_str(kind.name());
    frame.push_str("\",\"path\":\"");
    push_json_string(&mut frame, path);
    frame.push_str("\"}\n");

    (frame.len() <= MAX_FRAME_BYTES).then_some(frame.into_bytes())
}
fn is_inside_root(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        !relative
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    })
}

fn push_json_string(output: &mut String, value: &str) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0C}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            control if control <= '\u{1F}' => {
                let code = control as usize;
                output.push_str("\\u00");
                output.push(HEX[code >> 4] as char);
                output.push(HEX[code & 0x0f] as char);
            }
            other => output.push(other),
        }
    }
}

fn fail() -> bool {
    let _ = io::stderr().write_all(WATCH_ERROR);
    false
}

#[cfg(test)]
mod tests {
    use super::{OutputEvent, frame_for_path, frame_for_resolved_path};
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn frames_only_canonical_jsonl_paths_inside_roots() {
        let container = std::env::temp_dir().join(format!(
            "gajae-core-watch-frame-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        let root = container.join("root");
        let transcripts = root.join("transcripts");
        fs::create_dir_all(&transcripts).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let session = transcripts.join("session.jsonl");
        let ignored = transcripts.join("session.txt");
        fs::write(&session, b"{}\n").unwrap();
        fs::write(&ignored, b"ignored").unwrap();

        assert!(frame_for_path(OutputEvent::Add, &session, std::slice::from_ref(&root),).is_some());
        assert_eq!(
            frame_for_path(OutputEvent::Change, &ignored, std::slice::from_ref(&root),),
            None
        );

        let outside = container.join("outside.jsonl");
        fs::write(&outside, b"{}\n").unwrap();
        assert_eq!(
            frame_for_path(OutputEvent::Change, &outside, std::slice::from_ref(&root),),
            None
        );

        #[cfg(unix)]
        {
            let linked = transcripts.join("linked.jsonl");
            std::os::unix::fs::symlink(&outside, &linked).unwrap();
            assert_eq!(
                frame_for_path(OutputEvent::Change, &linked, std::slice::from_ref(&root),),
                None
            );
        }

        fs::remove_dir_all(container).unwrap();
    }

    #[test]
    fn rejects_frames_larger_than_the_protocol_limit() {
        let root = PathBuf::from("/workspace/project");
        let oversized = root.join(format!("{}.jsonl", "a".repeat(64 * 1024)));
        assert_eq!(
            frame_for_resolved_path(OutputEvent::Add, &oversized, &[root]),
            None
        );
    }
}
