use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
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
        std::fs::remove_dir_all(&self.0).unwrap();
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
    let (sender, receiver) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let frame = serde_json::from_str::<Value>(&line.unwrap()).unwrap();
            if sender.send(frame).is_err() {
                break;
            }
        }
    });
    let first = receiver
        .recv_timeout(TIMEOUT)
        .expect("PTY did not become ready");
    assert_eq!(first, json!({"protocolVersion": 1, "kind": "ready"}));
    let mut stdin = core.0.stdin.take().unwrap();
    for request in [
        json!({"protocolVersion": 1, "method": "pty.resize", "cols": 1000, "rows": 30}),
        json!({"protocolVersion": 1, "method": "pty.write", "data": STANDARD.encode(b"native-pty-token\r")}),
    ] {
        writeln!(stdin, "{request}").unwrap();
    }
    let mut output = Vec::new();
    let deadline = Instant::now() + TIMEOUT;
    loop {
        let frame = receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("PTY did not echo input");
        assert_eq!(frame["kind"], "output", "unexpected frame: {frame}");
        output.extend(STANDARD.decode(frame["data"].as_str().unwrap()).unwrap());
        let text = String::from_utf8_lossy(&output);
        if text.contains(&expected_cwd(&directory))
            && text.contains("fixture-input=native-pty-token")
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
    assert!(receiver.try_iter().any(|frame| frame["kind"] == "exit"));
}
