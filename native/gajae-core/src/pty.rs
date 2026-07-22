use std::ffi::OsString;
use std::io::{BufRead, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use base64::Engine;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::Deserialize;
use serde_json::{Value, json};

const MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_WRITE_BYTES: usize = 48 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol_version: u8,
    method: String,
    data: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

pub fn run(program: OsString, args: Vec<OsString>) -> bool {
    let pair = match native_pty_system().openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(_) => return false,
    };
    let mut command = CommandBuilder::new(program);
    command.args(args);
    let mut child = match pair.slave.spawn_command(command) {
        Ok(child) => child,
        Err(_) => return false,
    };
    drop(pair.slave);

    let mut reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => Arc::new(Mutex::new(writer)),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
    };
    let mut killer = child.clone_killer();
    let output_lock = Arc::new(Mutex::new(()));
    let failed = Arc::new(AtomicBool::new(false));

    let reader_output = Arc::clone(&output_lock);
    let reader_failed = Arc::clone(&failed);
    let reader_thread = thread::Builder::new()
        .name("gajae-core-pty-reader".into())
        .spawn(move || {
            let mut buffer = [0_u8; 16 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => return,
                    Ok(count) => {
                        let data =
                            base64::engine::general_purpose::STANDARD.encode(&buffer[..count]);
                        if !write_frame(
                            &reader_output,
                            json!({
                                "protocolVersion": 1,
                                "kind": "output",
                                "data": data,
                            }),
                        ) {
                            reader_failed.store(true, Ordering::Release);
                            return;
                        }
                    }
                    Err(_) => return,
                }
            }
        });
    if reader_thread.is_err() {
        let _ = killer.kill();
        let _ = child.wait();
        return false;
    }

    let wait_output = Arc::clone(&output_lock);
    let wait_failed = Arc::clone(&failed);
    let wait_thread = thread::Builder::new()
        .name("gajae-core-pty-wait".into())
        .spawn(move || match child.wait() {
            Ok(status) => {
                if !write_frame(
                    &wait_output,
                    json!({
                        "protocolVersion": 1,
                        "kind": "exit",
                        "exitCode": status.exit_code(),
                    }),
                ) {
                    wait_failed.store(true, Ordering::Release);
                }
            }
            Err(_) => wait_failed.store(true, Ordering::Release),
        });
    let wait_thread = match wait_thread {
        Ok(thread) => thread,
        Err(_) => {
            let _ = killer.kill();
            return false;
        }
    };

    if !write_frame(&output_lock, json!({"protocolVersion": 1, "kind": "ready"})) {
        let _ = killer.kill();
        let _ = wait_thread.join();
        return false;
    }

    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let mut frame = Vec::new();
    loop {
        frame.clear();
        let read = match Read::by_ref(&mut input)
            .take(MAX_FRAME_BYTES as u64 + 1)
            .read_until(b'\n', &mut frame)
        {
            Ok(read) => read,
            Err(_) => {
                failed.store(true, Ordering::Release);
                break;
            }
        };
        if read == 0 {
            let _ = killer.kill();
            break;
        }
        if frame.len() > MAX_FRAME_BYTES || !frame.ends_with(b"\n") {
            failed.store(true, Ordering::Release);
            let _ = killer.kill();
            break;
        }
        frame.pop();
        let request: Request = match serde_json::from_slice::<Request>(&frame) {
            Ok(request) if request.protocol_version == 1 => request,
            _ => {
                failed.store(true, Ordering::Release);
                let _ = killer.kill();
                break;
            }
        };
        match request.method.as_str() {
            "pty.write" => {
                let Some(data) = request.data else {
                    failed.store(true, Ordering::Release);
                    let _ = killer.kill();
                    break;
                };
                let decoded = match base64::engine::general_purpose::STANDARD.decode(data) {
                    Ok(decoded) if decoded.len() <= MAX_WRITE_BYTES => decoded,
                    _ => {
                        failed.store(true, Ordering::Release);
                        let _ = killer.kill();
                        break;
                    }
                };
                let write_result = writer
                    .lock()
                    .map_err(|_| ())
                    .and_then(|mut writer| writer.write_all(&decoded).map_err(|_| ()))
                    .and_then(|_| {
                        writer
                            .lock()
                            .map_err(|_| ())
                            .and_then(|mut writer| writer.flush().map_err(|_| ()))
                    });
                if write_result.is_err() {
                    failed.store(true, Ordering::Release);
                    let _ = killer.kill();
                    break;
                }
            }
            "pty.resize" => {
                let (Some(cols), Some(rows)) = (request.cols, request.rows) else {
                    failed.store(true, Ordering::Release);
                    let _ = killer.kill();
                    break;
                };
                if !(1..=1000).contains(&cols)
                    || !(1..=1000).contains(&rows)
                    || pair
                        .master
                        .resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        })
                        .is_err()
                {
                    failed.store(true, Ordering::Release);
                    let _ = killer.kill();
                    break;
                }
            }
            "pty.shutdown" => {
                let _ = killer.kill();
                break;
            }
            _ => {
                failed.store(true, Ordering::Release);
                let _ = killer.kill();
                break;
            }
        }
    }

    if wait_thread.join().is_err() {
        return false;
    }
    !failed.load(Ordering::Acquire)
}

fn write_frame(lock: &Mutex<()>, frame: Value) -> bool {
    let Ok(_guard) = lock.lock() else {
        return false;
    };
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, &frame).is_ok()
        && output.write_all(b"\n").is_ok()
        && output.flush().is_ok()
}
