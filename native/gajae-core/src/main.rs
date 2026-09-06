#![forbid(unsafe_code)]

use std::io::{self, Read, Write};
use std::process::{Child, Command, ExitCode, ExitStatus, Stdio};
use std::thread;

use gajae_core::{Command as CliCommand, git, jobs, map_exit_status, parse_args, pty, watcher};

const USAGE_ERROR: &[u8] = b"gajae-core: usage error\n";
const SPAWN_ERROR: &[u8] = b"gajae-core: spawn failed\n";
const PROXY_ERROR: &[u8] = b"gajae-core: proxy failed\n";
const JOBS_ERROR: &[u8] = b"gajae-core: jobs protocol failed\n";
const GIT_ERROR: &[u8] = b"gajae-core: git protocol failed\n";
const PTY_ERROR: &[u8] = b"gajae-core: pty protocol failed\n";

fn main() -> ExitCode {
    match parse_args(std::env::args_os().skip(1)) {
        Ok(CliCommand::Version) => {
            println!("gajae-core {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Ok(CliCommand::Proxy { program, args }) => run_proxy(program, args),
        Ok(CliCommand::Watch { roots }) => {
            if watcher::run(roots) {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Ok(CliCommand::Jobs { database }) => {
            if jobs::run(&database, io::stdin().lock(), io::stdout().lock()) {
                ExitCode::SUCCESS
            } else {
                fail(JOBS_ERROR)
            }
        }
        Ok(CliCommand::Git { workdir }) => {
            if git::run(&workdir, io::stdin().lock(), io::stdout().lock()) {
                ExitCode::SUCCESS
            } else {
                fail(GIT_ERROR)
            }
        }
        Ok(CliCommand::Pty { program, args }) => {
            if pty::run(program, args) {
                ExitCode::SUCCESS
            } else {
                fail(PTY_ERROR)
            }
        }
        Err(_) => fail(USAGE_ERROR),
    }
}

fn run_proxy(program: std::ffi::OsString, args: Vec<std::ffi::OsString>) -> ExitCode {
    let mut child = match Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return fail(SPAWN_ERROR),
    };

    let child_stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            kill_and_reap(&mut child);
            return fail(PROXY_ERROR);
        }
    };
    let copier = thread::Builder::new()
        .name("gajae-core-stdin".into())
        .spawn(move || copy_stdin(child_stdin));

    let copier = match copier {
        Ok(copier) => copier,
        Err(_) => {
            kill_and_reap(&mut child);
            return fail(PROXY_ERROR);
        }
    };

    let status = match child.wait() {
        Ok(status) => status,
        Err(_) => {
            kill_and_reap(&mut child);
            return fail(PROXY_ERROR);
        }
    };

    // A parent stdin can remain open after the child exits. Do not join a
    // copier blocked in that read; process shutdown will release it. If the
    // copier already finished, the child's observed status remains
    // authoritative: BrokenPipe is expected when the child closes stdin.
    if copier.is_finished() {
        let _ = copier.join();
    }

    ExitCode::from(map_status(&status))
}

fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn copy_stdin(mut output: std::process::ChildStdin) -> io::Result<()> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            return Ok(());
        }
        output.write_all(&buffer[..count])?;
        output.flush()?;
    }
}

fn map_status(status: &ExitStatus) -> u8 {
    map_exit_status(status.code(), signal(status))
}

#[cfg(unix)]
fn signal(status: &ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;

    status.signal()
}

#[cfg(not(unix))]
fn signal(_: &ExitStatus) -> Option<i32> {
    None
}

fn fail(message: &[u8]) -> ExitCode {
    let _ = io::stderr().write_all(message);
    ExitCode::FAILURE
}
