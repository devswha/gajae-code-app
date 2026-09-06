use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

const TIMEOUT: Duration = Duration::from_secs(10);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "gajae core 한글 {label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        // Windows may briefly retain the copied fixture executable while
        // ConPTY exits. Never double-panic during a timeout's stack unwind.
        for _ in 0..20 {
            match std::fs::remove_dir_all(&self.0) {
                Ok(()) => return,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                Err(_) => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        let _ = writeln!(std::io::stderr(), "fixture cleanup failed: {:?}", self.0);
    }
}

struct CoreChild(Child);

impl CoreChild {
    fn wait(&mut self) -> ExitStatus {
        let deadline = Instant::now() + TIMEOUT;
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "core did not exit within {TIMEOUT:?}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for CoreChild {
    fn drop(&mut self) {
        // Closing input lets the core kill/reap its own PTY child and close
        // ConPTY before the executable's directory is removed.
        self.0.stdin.take();
        for _ in 0..100 {
            if matches!(self.0.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn spawn_fixture(mode: &str, directory: &TestDirectory) -> CoreChild {
    // Re-execute this Rust test binary, so the tests do not depend on a Unix
    // shell, Node, or an executable script. Exercise spaces/Unicode in argv[0].
    let fixture = directory
        .0
        .join(format!("child fixture{}", std::env::consts::EXE_SUFFIX));
    std::fs::copy(std::env::current_exe().unwrap(), &fixture).unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_gajae-core"));
    if mode == "pty" {
        command.arg("pty");
    }
    CoreChild(
        command
            .arg("--")
            .arg(fixture)
            .args(["--exact", "child_fixture", "--nocapture"])
            .env("GAJAE_CORE_CHILD_FIXTURE", mode)
            .current_dir(&directory.0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    )
}

fn expected_cwd(directory: &TestDirectory) -> String {
    format!(
        "fixture-cwd={}",
        json!(std::fs::canonicalize(&directory.0).unwrap())
    )
}

#[test]
fn child_fixture() {
    let Ok(mode) = std::env::var("GAJAE_CORE_CHILD_FIXTURE") else {
        return;
    };
    if mode == "proxy" {
        println!(
            "fixture-cwd={}",
            json!(std::fs::canonicalize(std::env::current_dir().unwrap()).unwrap())
        );
        let mut bytes = Vec::new();
        std::io::stdin().read_to_end(&mut bytes).unwrap();
        println!("fixture-input={}", STANDARD.encode(bytes));
        std::io::stdout().flush().unwrap();
        std::process::exit(23);
    }
    // The protocol's ready frame means the PTY exists, not that its child has
    // finished console initialization. On ConPTY a cursor query can precede it.
    writeln!(std::io::stdout().lock(), "fixture-ready").unwrap();
    std::io::stdout().flush().unwrap();
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        // Input follows resize, so ConPTY cannot wrap the long path at its
        // initial 80 columns and split the marker we assert below.
        println!(
            "fixture-cwd={}",
            json!(std::fs::canonicalize(std::env::current_dir().unwrap()).unwrap())
        );
        println!("fixture-input={}", line.unwrap());
        std::io::stdout().flush().unwrap();
    }
}

#[derive(Default)]
struct TerminalOutput {
    bytes: Vec<u8>,
    answered_cursor_queries: usize,
}

impl TerminalOutput {
    fn push(&mut self, bytes: &[u8]) -> usize {
        self.bytes.extend_from_slice(bytes);
        // portable-pty uses PSEUDOCONSOLE_INHERIT_CURSOR. A real terminal
        // answers CSI 6 n; ignoring it can deadlock ResizePseudoConsole.
        // Count over the accumulated bytes to handle split output frames.
        let queries = self
            .bytes
            .windows(4)
            .filter(|part| *part == b"\x1b[6n")
            .count();
        let pending = queries - self.answered_cursor_queries;
        self.answered_cursor_queries = queries;
        pending
    }

    fn contains(&self, text: &str) -> bool {
        self.bytes
            .windows(text.len())
            .any(|part| part == text.as_bytes())
    }
}

fn write_request(input: &mut impl Write, request: Value) {
    writeln!(input, "{request}").unwrap();
    input.flush().unwrap();
}

fn receive_frame(
    receiver: &mpsc::Receiver<Result<Value, String>>,
    deadline: Instant,
    phase: &str,
    output: &TerminalOutput,
    diagnostics: &Mutex<Vec<u8>>,
) -> Value {
    match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(Ok(frame)) => frame,
        failure => {
            let message = format!(
                "PTY {phase} failed: {failure:?}; output={:?}; stderr={:?}",
                String::from_utf8_lossy(&output.bytes),
                String::from_utf8_lossy(&diagnostics.lock().unwrap()),
            );
            // Bypass libtest capture so timeout diagnostics survive even if
            // another Windows cleanup failure aborts the harness.
            let _ = writeln!(std::io::stderr().lock(), "{message}");
            panic!("{message}");
        }
    }
}

#[test]
fn terminal_answers_cursor_queries_split_across_output_frames_once() {
    let mut terminal = TerminalOutput::default();
    assert_eq!(terminal.push(b"\x1b["), 0);
    assert_eq!(terminal.push(b"6nfixture-ready"), 1);
    assert_eq!(terminal.push(b"\r\n"), 0);
    assert_eq!(terminal.push(b"\x1b[6n"), 1);
    assert!(terminal.contains("fixture-ready"));
}

#[test]
fn proxy_preserves_project_cwd_binary_stdin_and_child_exit_code() {
    let directory = TestDirectory::new("proxy");
    let mut core = spawn_fixture("proxy", &directory);
    let bytes = b"native\0agent\xff\r\n";
    core.0.stdin.take().unwrap().write_all(bytes).unwrap();
    assert_eq!(core.wait().code(), Some(23));
    let mut output = String::new();
    core.0
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut output)
        .unwrap();
    assert!(output.contains(&expected_cwd(&directory)), "{output}");
    assert!(
        output.contains(&format!("fixture-input={}", STANDARD.encode(bytes))),
        "{output}"
    );
    let mut stderr = String::new();
    core.0
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    assert!(stderr.is_empty(), "{stderr}");
}

#[test]
fn pty_starts_in_project_directory_and_supports_resize_input_and_shutdown() {
    let directory = TestDirectory::new("pty");
    let mut core = spawn_fixture("pty", &directory);
    let stdout = core.0.stdout.take().unwrap();
    let mut stderr = core.0.stderr.take().unwrap();
    let diagnostics = Arc::new(Mutex::new(Vec::new()));
    let stderr_capture = Arc::clone(&diagnostics);
    let stderr_reader = std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        while let Ok(count) = stderr.read(&mut buffer) {
            if count == 0 {
                break;
            }
            stderr_capture
                .lock()
                .unwrap()
                .extend_from_slice(&buffer[..count]);
        }
    });
    let (sender, receiver) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let frame = line.map_err(|error| error.to_string()).and_then(|line| {
                serde_json::from_str::<Value>(&line).map_err(|error| format!("{error}: {line:?}"))
            });
            if sender.send(frame).is_err() {
                break;
            }
        }
    });
    let mut output = TerminalOutput::default();
    let first = receive_frame(
        &receiver,
        Instant::now() + TIMEOUT,
        "host readiness",
        &output,
        &diagnostics,
    );
    assert_eq!(first, json!({"protocolVersion": 1, "kind": "ready"}));
    let mut stdin = core.0.stdin.take().unwrap();
    // Answer terminal queries before resize: ResizePseudoConsole may block
    // while ConPTY waits for the cursor reply on its input pipe.
    let deadline = Instant::now() + TIMEOUT;
    while !output.contains("fixture-ready") {
        let frame = receive_frame(
            &receiver,
            deadline,
            "child readiness",
            &output,
            &diagnostics,
        );
        assert_eq!(frame["kind"], "output", "unexpected frame: {frame}");
        let bytes = STANDARD.decode(frame["data"].as_str().unwrap()).unwrap();
        for _ in 0..output.push(&bytes) {
            write_request(
                &mut stdin,
                json!({"protocolVersion": 1, "method": "pty.write", "data": STANDARD.encode(b"\x1b[1;1R")}),
            );
        }
    }
    for request in [
        json!({"protocolVersion": 1, "method": "pty.resize", "cols": 1000, "rows": 30}),
        json!({"protocolVersion": 1, "method": "pty.write", "data": STANDARD.encode(b"native-pty-token\r")}),
    ] {
        write_request(&mut stdin, request);
    }
    let deadline = Instant::now() + TIMEOUT;
    loop {
        let frame = receive_frame(&receiver, deadline, "input echo", &output, &diagnostics);
        assert_eq!(frame["kind"], "output", "unexpected frame: {frame}");
        let bytes = STANDARD.decode(frame["data"].as_str().unwrap()).unwrap();
        for _ in 0..output.push(&bytes) {
            write_request(
                &mut stdin,
                json!({"protocolVersion": 1, "method": "pty.write", "data": STANDARD.encode(b"\x1b[1;1R")}),
            );
        }
        if output.contains(&expected_cwd(&directory))
            && output.contains("fixture-input=native-pty-token")
        {
            break;
        }
    }
    writeln!(
        stdin,
        "{}",
        json!({"protocolVersion": 1, "method": "pty.shutdown"})
    )
    .unwrap();
    drop(stdin);
    assert!(core.wait().success());
    reader.join().unwrap();
    stderr_reader.join().unwrap();
    assert!(
        receiver
            .try_iter()
            .any(|frame| frame.unwrap()["kind"] == "exit")
    );
    assert!(diagnostics.lock().unwrap().is_empty());
}
