//! Linux single-instance activation. The private directory is also the IPC
//! access boundary; the held file lock serializes socket creation and cleanup.
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    os::unix::{
        fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use fs2::FileExt;
use serde::{Deserialize, Serialize};

const MAX_REQUEST: usize = 8192;
const MAX_LINKS: usize = 16;
const IO_TIMEOUT: Duration = Duration::from_secs(1);
const FORWARD_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Activation {
    pub urls: Vec<String>,
}

impl Activation {
    pub fn from_args(args: impl IntoIterator<Item = String>) -> Self {
        Self {
            urls: args
                .into_iter()
                .filter(|arg| valid_link(arg))
                .take(MAX_LINKS)
                .collect(),
        }
    }

    fn validate(&self) -> bool {
        self.urls.len() <= MAX_LINKS && self.urls.iter().all(|url| valid_link(url))
    }
}

fn valid_link(value: &str) -> bool {
    value.len() <= 512
        && value
            .parse::<tauri::Url>()
            .is_ok_and(|url| crate::deep_link_route(&url).is_some())
}

fn effective_uid() -> u32 {
    unsafe extern "C" {
        fn geteuid() -> u32;
    }
    unsafe { geteuid() }
}

fn private_directory(path: &Path, uid: u32) -> io::Result<()> {
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    // Do not repair an unsafe pre-existing path: it may belong to another user
    // or be a symlink. Failing closed must not chmod somebody else's files.
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "desktop instance directory is not private to this user",
        ));
    }
    Ok(())
}

pub struct Instance {
    _lock: File,
    _legacy_lock: Option<File>,
    socket_path: PathBuf,
    listener: Option<UnixListener>,
    stopping: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Instance {
    /// None means the existing instance acknowledged this activation. Errors
    /// must not be mistaken for a successful second launch or start a sidecar.
    pub fn acquire(activation: &Activation) -> Result<Option<Self>, String> {
        // A fixed system temporary root keeps identity stable across launchers
        // with different TMPDIR/XDG_RUNTIME_DIR environments and login sessions.
        let directory = PathBuf::from(format!("/tmp/gajae-app-desktop-{}", effective_uid()));
        let mut instance = Self::acquire_at(&directory, activation)
            .map_err(|error| format!("desktop instance activation failed: {error}"))?;
        if let Some(primary) = instance.as_mut() {
            primary._legacy_lock = legacy_lock_at(
                &std::env::temp_dir().join("gajae-app-desktop.lock"),
            )
            .map_err(|error| format!("could not check the earlier desktop instance: {error}"))?;
        }
        Ok(instance)
    }

    fn acquire_at(directory: &Path, activation: &Activation) -> io::Result<Option<Self>> {
        private_directory(directory, effective_uid())?;
        let lock_path = directory.join("instance.lock");
        if let Ok(metadata) = fs::symlink_metadata(&lock_path) {
            if !metadata.is_file() || metadata.uid() != effective_uid() || metadata.nlink() != 1 {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "unsafe desktop instance lock",
                ));
            }
        }
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(lock_path)?;
        let socket_path = directory.join("activation.sock");
        let deadline = Instant::now() + FORWARD_TIMEOUT;
        loop {
            match lock.try_lock_exclusive() {
                Ok(()) => {
                    // A crashed primary leaves a socket inode, but no held lock.
                    match fs::symlink_metadata(&socket_path) {
                        Ok(metadata) if metadata.file_type().is_socket() => {
                            fs::remove_file(&socket_path)?
                        }
                        Ok(_) => {
                            return Err(io::Error::new(
                                io::ErrorKind::PermissionDenied,
                                "unsafe desktop activation socket",
                            ))
                        }
                        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error),
                    }
                    let listener = UnixListener::bind(&socket_path)?;
                    listener.set_nonblocking(true)?;
                    return Ok(Some(Self {
                        _lock: lock,
                        _legacy_lock: None,
                        socket_path,
                        listener: Some(listener),
                        stopping: Arc::new(AtomicBool::new(false)),
                        worker: None,
                    }));
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                Err(error) => return Err(error),
            }
            match UnixStream::connect(&socket_path) {
                Ok(stream) => {
                    // Never resend after writing: a lost acknowledgement must
                    // not duplicate a deep link that the primary already took.
                    forward(stream, activation)?;
                    return Ok(None);
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                    ) && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(25));
                }
                Err(error) => return Err(error),
            }
        }
    }

    pub fn listen(
        mut self,
        activate: impl Fn(Activation) -> bool + Send + 'static,
    ) -> io::Result<Self> {
        let listener = self
            .listener
            .take()
            .expect("instance listener already started");
        let stopping = Arc::clone(&self.stopping);
        self.worker = Some(
            thread::Builder::new()
                .name("desktop-activation".into())
                .spawn(move || {
                    while !stopping.load(Ordering::Acquire) {
                        match listener.accept() {
                            Ok((mut stream, _)) => {
                                let accepted = read_activation(&mut stream).is_ok_and(&activate);
                                let _ = stream.write_all(if accepted { b"OK" } else { b"NO" });
                            }
                            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                                thread::sleep(Duration::from_millis(25))
                            }
                            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                            Err(error) => {
                                eprintln!("desktop activation listener failed: {error}");
                                break;
                            }
                        }
                    }
                })?,
        );
        Ok(self)
    }
}

fn legacy_lock_at(path: &Path) -> io::Result<Option<File>> {
    // Existing releases used a global temporary lock. Honor an existing lock
    // owned by this user while upgrading, without creating that global file or
    // allowing another user's old lock to block the new per-user instance.
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !metadata.is_file() || metadata.uid() != effective_uid() || metadata.nlink() != 1 {
        return Ok(None);
    }
    let file = OpenOptions::new().read(true).write(true).open(path)?;
    let opened = file.metadata()?;
    if opened.dev() != metadata.dev() || opened.ino() != metadata.ino() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "legacy instance lock changed while opening",
        ));
    }
    file.try_lock_exclusive().map_err(|error| {
        if error.kind() == io::ErrorKind::WouldBlock {
            io::Error::new(
                io::ErrorKind::AlreadyExists,
                "an earlier desktop build is running; close it before starting this build",
            )
        } else {
            error
        }
    })?;
    Ok(Some(file))
}

impl Drop for Instance {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        // Keep the lock held until both the listener and socket are gone.
        self.listener.take();
        let _ = fs::remove_file(&self.socket_path);
    }
}

fn forward(mut stream: UnixStream, activation: &Activation) -> io::Result<()> {
    let data = serde_json::to_vec(activation)?;
    if !activation.validate() || data.len() > MAX_REQUEST {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid desktop activation",
        ));
    }
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    stream.set_read_timeout(Some(FORWARD_TIMEOUT))?;
    stream.write_all(&(data.len() as u32).to_be_bytes())?;
    stream.write_all(&data)?;
    let mut ack = [0u8; 2];
    stream.read_exact(&mut ack)?;
    if &ack != b"OK" {
        return Err(io::Error::new(
            io::ErrorKind::ConnectionAborted,
            "running desktop is shutting down or rejected activation",
        ));
    }
    Ok(())
}

fn read_activation(stream: &mut UnixStream) -> io::Result<Activation> {
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    let deadline = Instant::now() + IO_TIMEOUT;
    let mut size = [0u8; 4];
    read_before_deadline(stream, &mut size, deadline)?;
    let size = u32::from_be_bytes(size) as usize;
    if size > MAX_REQUEST {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "desktop activation is too large",
        ));
    }
    let mut data = vec![0; size];
    read_before_deadline(stream, &mut data, deadline)?;
    let activation: Activation = serde_json::from_slice(&data)?;
    if !activation.validate() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid desktop deep link",
        ));
    }
    Ok(activation)
}

fn read_before_deadline(
    stream: &mut UnixStream,
    mut buffer: &mut [u8],
    deadline: Instant,
) -> io::Result<()> {
    while !buffer.is_empty() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "desktop activation timed out",
            ));
        }
        stream.set_read_timeout(Some(remaining))?;
        match stream.read(buffer) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "incomplete desktop activation",
                ))
            }
            Ok(size) => buffer = &mut buffer[size..],
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let id = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Self(std::env::temp_dir().join(format!("gajae-instance-{}-{id}", std::process::id())))
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn upgrading_honors_existing_user_lock_without_creating_a_global_lock() {
        let directory = TestDirectory::new();
        private_directory(&directory.0, effective_uid()).unwrap();
        let path = directory.0.join("legacy.lock");
        assert!(legacy_lock_at(&path).unwrap().is_none());
        assert!(!path.exists());
        let old = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        old.try_lock_exclusive().unwrap();
        assert_eq!(
            legacy_lock_at(&path).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        drop(old);
        let guard = legacy_lock_at(&path).unwrap().unwrap();
        assert!(legacy_lock_at(&path).is_err());
        drop(guard);
        assert!(legacy_lock_at(&path).unwrap().is_some());
    }

    #[test]
    fn running_instance_receives_links_and_plain_launches_and_releases_lock() {
        let directory = TestDirectory::new();
        let (sender, receiver) = std::sync::mpsc::channel();
        let plain = Activation { urls: vec![] };
        let primary = Instance::acquire_at(&directory.0, &plain)
            .unwrap()
            .unwrap()
            .listen(move |activation| sender.send(activation).is_ok())
            .unwrap();
        let link = Activation::from_args(["gajae-app://open/job/job-123".into()]);
        assert!(Instance::acquire_at(&directory.0, &link).unwrap().is_none());
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(2)).unwrap().urls,
            link.urls
        );
        assert!(Instance::acquire_at(&directory.0, &plain)
            .unwrap()
            .is_none());
        assert!(receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .urls
            .is_empty());
        assert!(receiver.try_recv().is_err());
        drop(primary);
        assert!(Instance::acquire_at(&directory.0, &plain)
            .unwrap()
            .is_some());
    }

    #[test]
    fn activation_waits_for_primary_setup_without_starting_a_second_instance() {
        let directory = TestDirectory::new();
        let plain = Activation { urls: vec![] };
        let primary = Instance::acquire_at(&directory.0, &plain).unwrap().unwrap();
        thread::scope(|scope| {
            let secondary = scope.spawn(|| {
                Instance::acquire_at(&directory.0, &plain)
                    .unwrap()
                    .is_none()
            });
            thread::sleep(Duration::from_millis(50));
            let primary = primary.listen(|_| true).unwrap();
            assert!(secondary.join().unwrap());
            drop(primary);
        });
    }

    #[test]
    fn forwards_from_a_separate_process() {
        let directory = TestDirectory::new();
        let (sender, receiver) = std::sync::mpsc::channel();
        let plain = Activation { urls: vec![] };
        let _primary = Instance::acquire_at(&directory.0, &plain)
            .unwrap()
            .unwrap()
            .listen(move |activation| sender.send(activation).is_ok())
            .unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "instance::tests::secondary_process_helper",
                "--nocapture",
            ])
            .env("GAJAE_TEST_INSTANCE_DIRECTORY", &directory.0)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(2)).unwrap().urls,
            vec!["gajae-app://open/job/from-child"]
        );
    }

    #[test]
    fn secondary_process_helper() {
        let Some(directory) = std::env::var_os("GAJAE_TEST_INSTANCE_DIRECTORY") else {
            return;
        };
        let activation = Activation::from_args(["gajae-app://open/job/from-child".into()]);
        assert!(Instance::acquire_at(Path::new(&directory), &activation)
            .unwrap()
            .is_none());
    }

    #[test]
    fn stalled_client_cannot_block_later_activation_forever() {
        let directory = TestDirectory::new();
        let plain = Activation { urls: vec![] };
        let _primary = Instance::acquire_at(&directory.0, &plain)
            .unwrap()
            .unwrap()
            .listen(|_| true)
            .unwrap();
        let mut stalled = UnixStream::connect(directory.0.join("activation.sock")).unwrap();
        stalled.write_all(&[0]).unwrap();
        assert!(Instance::acquire_at(&directory.0, &plain)
            .unwrap()
            .is_none());
    }

    #[test]
    fn shutdown_rejection_is_not_reported_as_successful_forwarding() {
        let directory = TestDirectory::new();
        let plain = Activation { urls: vec![] };
        let _primary = Instance::acquire_at(&directory.0, &plain)
            .unwrap()
            .unwrap()
            .listen(|_| false)
            .unwrap();
        assert!(Instance::acquire_at(&directory.0, &plain).is_err());
    }

    #[test]
    fn stale_socket_is_reclaimed_only_after_the_lock_is_released() {
        let directory = TestDirectory::new();
        private_directory(&directory.0, effective_uid()).unwrap();
        let socket_path = directory.0.join("activation.sock");
        drop(UnixListener::bind(&socket_path).unwrap());
        let instance = Instance::acquire_at(&directory.0, &Activation { urls: vec![] })
            .unwrap()
            .unwrap();
        drop(instance);
        assert!(!socket_path.exists());
    }

    #[test]
    fn directory_requires_current_user_private_permissions_and_no_symlinks() {
        let directory = TestDirectory::new();
        private_directory(&directory.0, effective_uid()).unwrap();
        assert!(private_directory(&directory.0, effective_uid().wrapping_add(1)).is_err());
        fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(private_directory(&directory.0, effective_uid()).is_err());
        let link = TestDirectory::new();
        symlink(&directory.0, &link.0).unwrap();
        assert!(private_directory(&link.0, effective_uid()).is_err());
        fs::remove_file(&link.0).unwrap();
    }

    #[test]
    fn unexpected_lock_and_socket_files_are_preserved_and_rejected() {
        let directory = TestDirectory::new();
        private_directory(&directory.0, effective_uid()).unwrap();
        let victim = directory.0.join("keep");
        fs::write(&victim, b"keep").unwrap();
        symlink(&victim, directory.0.join("instance.lock")).unwrap();
        assert!(Instance::acquire_at(&directory.0, &Activation { urls: vec![] }).is_err());
        fs::remove_file(directory.0.join("instance.lock")).unwrap();
        fs::write(directory.0.join("activation.sock"), b"keep socket").unwrap();
        assert!(Instance::acquire_at(&directory.0, &Activation { urls: vec![] }).is_err());
        assert_eq!(fs::read(&victim).unwrap(), b"keep");
        assert_eq!(
            fs::read(directory.0.join("activation.sock")).unwrap(),
            b"keep socket"
        );
    }

    #[test]
    fn activation_protocol_rejects_untrusted_and_oversized_payloads() {
        for body in [
            r#"{"urls":["https://example.com/"]}"#,
            r#"{"urls":["gajae-app://open/job/bad%20id"]}"#,
            r#"{"urls":[],"command":"exec"}"#,
        ] {
            let (mut sender, mut receiver) = UnixStream::pair().unwrap();
            sender
                .write_all(&(body.len() as u32).to_be_bytes())
                .unwrap();
            sender.write_all(body.as_bytes()).unwrap();
            assert!(read_activation(&mut receiver).is_err());
        }
        let (mut sender, mut receiver) = UnixStream::pair().unwrap();
        sender
            .write_all(&((MAX_REQUEST + 1) as u32).to_be_bytes())
            .unwrap();
        assert!(read_activation(&mut receiver).is_err());
        let activation = Activation::from_args([
            "--some-flag".into(),
            "https://example.com/".into(),
            "gajae-app://open/job/job-123".into(),
        ]);
        assert_eq!(activation.urls, vec!["gajae-app://open/job/job-123"]);
    }
}
