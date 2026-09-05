//! A suspended spawn closes the race between starting Node and owning its tree.
//! The unnamed, non-inheritable job also reaps descendants if the shell crashes.
use std::{
    collections::BTreeMap,
    ffi::{OsStr, OsString},
    fs::File,
    io::{Read, Write},
    mem::{size_of, zeroed},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
    sync::{Arc, Mutex},
};

use tauri::async_runtime::{channel, Receiver, Sender};
use tauri_plugin_shell::process::{CommandEvent, TerminatedPayload};
use windows_sys::Win32::{
    Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT, WAIT_OBJECT_0, WAIT_TIMEOUT},
    Security::SECURITY_ATTRIBUTES,
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
            JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
            TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Pipes::CreatePipe,
        Threading::{
            CreateProcessW, GetExitCodeProcess, ResumeThread, TerminateProcess,
            WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
            INFINITE, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
        },
    },
};

pub struct OwnedProcess {
    pid: u32,
    process: OwnedHandle,
    job: OwnedHandle,
    stdin: Mutex<File>,
}

fn failure(context: &str) -> String {
    format!("{context}: {}", std::io::Error::last_os_error())
}

fn wide(value: &OsStr) -> Result<Vec<u16>, String> {
    let mut value: Vec<u16> = value.encode_wide().collect();
    if value.contains(&0) {
        return Err("Windows process argument contains a NUL character".to_owned());
    }
    value.push(0);
    Ok(value)
}

// CommandLineToArgvW/CRT quoting, including quotes and trailing backslashes.
fn quote(value: &OsStr) -> Result<Vec<u16>, String> {
    let value = wide(value)?;
    let mut result = vec![b'"' as u16];
    let mut slashes = 0;
    for &unit in &value[..value.len() - 1] {
        if unit == b'\\' as u16 {
            slashes += 1;
            continue;
        }
        result.extend(
            std::iter::repeat(b'\\' as u16).take(if unit == b'"' as u16 {
                slashes * 2 + 1
            } else {
                slashes
            }),
        );
        slashes = 0;
        result.push(unit);
    }
    result.extend(std::iter::repeat(b'\\' as u16).take(slashes * 2));
    result.push(b'"' as u16);
    Ok(result)
}

fn environment(overrides: &[(OsString, OsString)]) -> Result<Vec<u16>, String> {
    // Windows environment names are case insensitive (notably Path vs PATH).
    let mut entries = BTreeMap::new();
    for (key, value) in std::env::vars_os().chain(overrides.iter().cloned()) {
        entries.insert(key.to_string_lossy().to_uppercase(), (key, value));
    }
    // A bundled runtime must not execute an ambient Node preload.
    entries.remove("NODE_OPTIONS");
    entries.remove("NODE_PATH");
    let mut block = Vec::new();
    for (_, (key, value)) in entries {
        let mut entry = key;
        entry.push("=");
        entry.push(value);
        block.extend(wide(&entry)?);
    }
    block.push(0);
    if block.len() == 1 {
        block.push(0);
    }
    Ok(block)
}

fn pipe(parent_reads: bool) -> Result<(OwnedHandle, OwnedHandle), String> {
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let (mut read, mut write) = (null_mut(), null_mut());
    if unsafe { CreatePipe(&mut read, &mut write, &security, 0) } == 0 {
        return Err(failure("could not create sidecar pipe"));
    }
    let read = unsafe { OwnedHandle::from_raw_handle(read) };
    let write = unsafe { OwnedHandle::from_raw_handle(write) };
    let (parent, child) = if parent_reads {
        (read, write)
    } else {
        (write, read)
    };
    if unsafe { SetHandleInformation(parent.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) } == 0 {
        return Err(failure("could not protect parent pipe handle"));
    }
    Ok((parent, child))
}

impl OwnedProcess {
    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn request_shutdown(&self) -> Result<(), String> {
        self.stdin
            .lock()
            .map_err(|_| "sidecar stdin lock poisoned".to_owned())?
            .write_all(b"gajae-desktop-shutdown\n")
            .map_err(|error| format!("could not request server shutdown: {error}"))
    }

    pub fn terminate(&self) -> Result<(), String> {
        if unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) } == 0 {
            return Err(failure("could not terminate owned server job"));
        }
        Ok(())
    }

    pub fn tree_is_empty(&self) -> Result<bool, String> {
        if self.is_alive()? {
            return Ok(false);
        }
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
        if unsafe {
            QueryInformationJobObject(
                self.job.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(failure("could not inspect owned server job"));
        }
        Ok(info.ActiveProcesses == 0)
    }

    pub fn is_alive(&self) -> Result<bool, String> {
        match unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } {
            WAIT_OBJECT_0 => Ok(false),
            WAIT_TIMEOUT => Ok(true),
            _ => Err(failure("could not inspect server process")),
        }
    }
}

impl Drop for OwnedProcess {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

pub fn spawn(
    program: &Path,
    args: &[OsString],
    cwd: &Path,
    overrides: &[(OsString, OsString)],
) -> Result<(Receiver<CommandEvent>, Arc<OwnedProcess>), String> {
    let application = wide(program.as_os_str())?;
    let cwd = wide(cwd.as_os_str())?;
    let mut command_line = quote(program.as_os_str())?;
    for arg in args {
        command_line.push(b' ' as u16);
        command_line.extend(quote(arg)?);
    }
    command_line.push(0);
    let environment = environment(overrides)?;
    let handle = unsafe { CreateJobObjectW(null(), null()) };
    if handle.is_null() {
        return Err(failure("could not create server job"));
    }
    let job = unsafe { OwnedHandle::from_raw_handle(handle) };
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err(failure("could not configure server job"));
    }
    let (stdout, child_stdout) = pipe(true)?;
    let (stderr, child_stderr) = pipe(true)?;
    let (stdin, child_stdin) = pipe(false)?;
    let mut startup: STARTUPINFOW = unsafe { zeroed() };
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = child_stdin.as_raw_handle();
    startup.hStdOutput = child_stdout.as_raw_handle();
    startup.hStdError = child_stderr.as_raw_handle();
    let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
    if unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null(),
            null(),
            1,
            CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            environment.as_ptr().cast(),
            cwd.as_ptr(),
            &startup,
            &mut info,
        )
    } == 0
    {
        return Err(failure("could not start suspended server"));
    }
    let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess) };
    let thread = unsafe { OwnedHandle::from_raw_handle(info.hThread) };
    if unsafe { AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) } == 0 {
        let error = failure("could not assign server to owned job");
        unsafe {
            TerminateProcess(process.as_raw_handle(), 1);
        }
        return Err(error);
    }
    let owned = Arc::new(OwnedProcess {
        pid: info.dwProcessId,
        process,
        job,
        stdin: Mutex::new(File::from(stdin)),
    });
    if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
        return Err(failure("could not resume owned server"));
    }
    drop((child_stdin, child_stdout, child_stderr));
    let (tx, rx) = channel(64);
    pump(File::from(stdout), tx.clone(), CommandEvent::Stdout);
    pump(File::from(stderr), tx.clone(), CommandEvent::Stderr);
    let waiting = Arc::clone(&owned);
    std::thread::spawn(move || {
        if unsafe { WaitForSingleObject(waiting.process.as_raw_handle(), INFINITE) }
            != WAIT_OBJECT_0
        {
            let _ = tx.blocking_send(CommandEvent::Error(failure("could not wait for server")));
            return;
        }
        // A child can keep its parent's stdout open. Reap the job independently
        // of pipe EOF and never let output readers hold the termination event.
        let _ = waiting.terminate();
        let mut code = 1;
        unsafe {
            GetExitCodeProcess(waiting.process.as_raw_handle(), &mut code);
        }
        let _ = tx.blocking_send(CommandEvent::Terminated(TerminatedPayload {
            code: Some(code as i32),
            signal: None,
        }));
    });
    Ok((rx, owned))
}

fn pump(mut reader: File, tx: Sender<CommandEvent>, wrap: fn(Vec<u8>) -> CommandEvent) {
    std::thread::spawn(move || {
        let mut buffer = [0; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(count) => {
                    if tx.blocking_send(wrap(buffer[..count].to_vec())).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = tx.blocking_send(CommandEvent::Error(error.to_string()));
                    return;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestProcess(Arc<OwnedProcess>);

    impl Drop for TestProcess {
        fn drop(&mut self) {
            let _ = self.0.terminate();
        }
    }

    #[test]
    fn quotes_empty_arguments_spaces_unicode_and_trailing_backslashes() {
        for (argument, expected) in [
            ("", "\"\""),
            ("한 글", "\"한 글\""),
            ("a\"b", "\"a\\\"b\""),
            ("C:\\a b\\", "\"C:\\a b\\\\\""),
        ] {
            assert_eq!(
                String::from_utf16(&quote(OsStr::new(argument)).unwrap()).unwrap(),
                expected
            );
        }
        assert!(quote(OsStr::new("bad\0argument")).is_err());
    }

    #[test]
    fn environment_overrides_path_case_insensitively_and_removes_node_preloads() {
        let block = environment(&[
            ("Path".into(), "owned runtime".into()),
            ("NODE_OPTIONS".into(), "--require=untrusted".into()),
        ])
        .unwrap();
        assert!(block.ends_with(&[0, 0]));
        let text = String::from_utf16_lossy(&block);
        assert_eq!(
            text.split('\0')
                .filter(|entry| entry.to_ascii_lowercase().starts_with("path="))
                .collect::<Vec<_>>(),
            vec!["Path=owned runtime"]
        );
        assert!(!text.contains("NODE_OPTIONS="));
    }

    // Spawn this same test executable to avoid depending on Node, PowerShell,
    // or a shell's quoting rules in the native process ownership regression.
    #[test]
    #[ignore = "fixture launched only by the job ownership test"]
    fn process_tree_fixture() {
        let role = std::env::var("GAJAE_DESKTOP_JOB_FIXTURE").expect("fixture role");
        if role == "parent" {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--ignored",
                    "--exact",
                    "windows_process::tests::process_tree_fixture",
                    "--nocapture",
                ])
                .env("GAJAE_DESKTOP_JOB_FIXTURE", "descendant")
                .spawn()
                .unwrap();
            println!("owned-descendant:{}", child.id());
            std::io::stdout().flush().unwrap();
            let _ = child.wait();
        } else {
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    }

    #[test]
    fn terminating_owned_job_reaps_descendants_with_inherited_output_handles() {
        tauri::async_runtime::block_on(async {
            let executable = std::env::current_exe().unwrap();
            let (mut events, process) = spawn(
                &executable,
                &[
                    "--ignored".into(),
                    "--exact".into(),
                    "windows_process::tests::process_tree_fixture".into(),
                    "--nocapture".into(),
                ],
                executable.parent().unwrap(),
                &[("GAJAE_DESKTOP_JOB_FIXTURE".into(), "parent".into())],
            )
            .unwrap();
            let _cleanup = TestProcess(Arc::clone(&process));
            let mut output = String::new();
            let ready = tokio::time::timeout(std::time::Duration::from_secs(10), async {
                while let Some(event) = events.recv().await {
                    if let CommandEvent::Stdout(bytes) = event {
                        output.push_str(&String::from_utf8_lossy(&bytes));
                        if output.contains("owned-descendant:") {
                            return;
                        }
                    }
                }
                panic!("fixture exited before it spawned a descendant: {output}");
            })
            .await;
            // Also clean up on a readiness failure so CI never leaves a fixture.
            process.terminate().unwrap();
            ready.expect("fixture did not become ready");
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                while !process.tree_is_empty().unwrap() {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("the entire owned tree must exit, including the descendant");
        });
    }

    #[test]
    fn node_graceful_shutdown_reaps_detached_descendant_in_owned_job() {
        use std::{
            path::PathBuf,
            time::{Duration, SystemTime, UNIX_EPOCH},
        };
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE};

        let node = std::env::var_os("npm_node_execpath")
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .unwrap_or_else(|| {
                let found = std::process::Command::new("where.exe")
                    .arg("node.exe")
                    .output()
                    .expect("native Windows regression requires Node on PATH");
                assert!(
                    found.status.success(),
                    "native Windows regression requires Node on PATH"
                );
                PathBuf::from(
                    String::from_utf8(found.stdout)
                        .unwrap()
                        .lines()
                        .next()
                        .unwrap()
                        .trim(),
                )
            });
        let directory = std::env::temp_dir().join(format!(
            "gajae job 한글 {}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let entrypoint = directory.join("server fixture.cjs");
        std::fs::write(
            &entrypoint,
            r#"
            const { spawn } = require('node:child_process');
            const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
                detached: true, stdio: 'ignore'
            });
            child.unref();
            process.on('SIGTERM', () => {
                process.stdout.write('graceful-shutdown\n', () => process.exit(0));
            });
            console.log('descendant:' + child.pid);
            setInterval(() => {}, 1000);
        "#,
        )
        .unwrap();
        tauri::async_runtime::block_on(async {
            let (mut events, process) = spawn(
                &node,
                &[
                    "--eval".into(),
                    include_str!("windows-server-bootstrap.cjs").into(),
                    entrypoint.into_os_string(),
                ],
                &directory,
                &[],
            )
            .unwrap();
            let _cleanup = TestProcess(Arc::clone(&process));
            let mut output = String::new();
            let descendant_pid = tokio::time::timeout(Duration::from_secs(10), async {
                while let Some(event) = events.recv().await {
                    if let CommandEvent::Stdout(bytes) = event {
                        output.push_str(&String::from_utf8_lossy(&bytes));
                        for line in output
                            .split_inclusive('\n')
                            .filter(|line| line.ends_with('\n'))
                        {
                            if let Some(pid) = line.trim().strip_prefix("descendant:") {
                                return pid.parse::<u32>().expect("fixture must report a real PID");
                            }
                        }
                    }
                }
                panic!("Node fixture exited before readiness: {output}");
            })
            .await
            .expect("Node fixture startup exceeded deadline");
            let descendant = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, descendant_pid) };
            assert!(
                !descendant.is_null(),
                "detached child must be running before Quit"
            );
            let descendant = unsafe { OwnedHandle::from_raw_handle(descendant) };
            assert_eq!(
                unsafe { WaitForSingleObject(descendant.as_raw_handle(), 0) },
                WAIT_TIMEOUT
            );
            assert!(process.is_alive().unwrap());
            process.request_shutdown().unwrap();
            let mut exit_code = None;
            tokio::time::timeout(Duration::from_secs(10), async {
                // Drain to EOF because root exit and output readers race.
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            output.push_str(&String::from_utf8_lossy(&bytes))
                        }
                        CommandEvent::Terminated(status) => exit_code = status.code,
                        _ => {}
                    }
                }
                while !process.tree_is_empty().unwrap() {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("graceful shutdown must also reap the detached child");
            assert_eq!(
                exit_code,
                Some(0),
                "server should complete its SIGTERM handler"
            );
            assert!(output.contains("graceful-shutdown"), "{output}");
            // Job accounting can reach zero just before the kernel signals
            // the last process handle. Require that signal within a bound.
            assert_eq!(
                unsafe { WaitForSingleObject(descendant.as_raw_handle(), 5_000) },
                WAIT_OBJECT_0
            );
            assert!(process.tree_is_empty().unwrap());
        });
        std::fs::remove_dir_all(directory).unwrap();
    }
}
