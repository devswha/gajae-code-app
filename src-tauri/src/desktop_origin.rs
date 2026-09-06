//! Keep the webview origin stable across launches so UI preferences survive.
//! The first port is OS-assigned; only a verified owned sidecar can persist it.
use std::{fs, io::Write, path::PathBuf};

#[derive(Debug)]
pub(crate) struct DesktopOrigin {
    file: PathBuf,
    port: u16,
}

impl DesktopOrigin {
    pub(crate) fn load(directory: PathBuf) -> Result<Self, String> {
        let file = directory.join("desktop-port");
        let port = match fs::symlink_metadata(&file) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
            Err(error) => return Err(format!("Could not read desktop origin: {error}")),
            Ok(metadata) => {
                if !metadata.file_type().is_file() || metadata.len() > 6 {
                    return Err("Desktop port must be a small regular file.".into());
                }
                let text = fs::read_to_string(&file).map_err(|error| error.to_string())?;
                text.trim()
                    .parse::<u16>()
                    .ok()
                    .filter(|port| *port >= 1024)
                    .ok_or("Desktop port is invalid; refusing to change the stored origin.")?
            }
        };
        Ok(Self { file, port })
    }

    pub(crate) fn requested_port(&self) -> u16 {
        self.port
    }

    pub(crate) fn persist_verified_port(&self, port: u16) -> Result<(), String> {
        if port < 1024 || (self.port != 0 && self.port != port) {
            return Err("The verified desktop server changed its assigned origin.".into());
        }
        if self.port != 0 {
            return Ok(());
        }
        let parent = self
            .file
            .parent()
            .ok_or("Desktop origin directory is missing.")?;
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(parent)
            .map_err(|error| format!("Could not create desktop origin directory: {error}"))?;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = match options.open(&self.file) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return if Self::load(parent.to_path_buf())?.port == port {
                    Ok(())
                } else {
                    Err("Desktop origin changed during startup; refusing to overwrite it.".into())
                };
            }
            Err(error) => return Err(format!("Could not preserve desktop origin: {error}")),
        };
        if let Err(error) = writeln!(file, "{port}").and_then(|()| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&self.file);
            return Err(format!("Could not preserve desktop origin: {error}"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let mut id = [0; 8];
            getrandom::getrandom(&mut id).unwrap();
            Self(std::env::temp_dir().join(format!(
                "gajae-origin-{}-{:x}",
                std::process::id(),
                u64::from_ne_bytes(id)
            )))
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn first_verified_port_is_reused_after_restart() {
        let directory = Temp::new();
        let first = DesktopOrigin::load(directory.0.clone()).unwrap();
        assert_eq!(first.requested_port(), 0);
        assert!(!directory.0.exists());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        first.persist_verified_port(port).unwrap();
        let next = DesktopOrigin::load(directory.0.clone()).unwrap();
        assert_eq!(next.requested_port(), port);
        assert!(std::net::TcpListener::bind(("127.0.0.1", next.requested_port())).is_err());
        drop(listener);
        let restarted = std::net::TcpListener::bind(("127.0.0.1", next.requested_port())).unwrap();
        assert_eq!(restarted.local_addr().unwrap().port(), port);
        next.persist_verified_port(port).unwrap();
        assert!(next
            .persist_verified_port(if port == 65535 { port - 1 } else { port + 1 })
            .is_err());
    }

    #[test]
    fn rejects_foreign_invalid_and_conflicting_port_records() {
        let directory = Temp::new();
        fs::create_dir(&directory.0).unwrap();
        let file = directory.0.join("desktop-port");
        for text in ["0", "80", "65536", "bad", "1234\n5678"] {
            fs::write(&file, text).unwrap();
            assert!(DesktopOrigin::load(directory.0.clone()).is_err());
            assert_eq!(fs::read_to_string(&file).unwrap(), text);
        }
        fs::remove_file(&file).unwrap();
        let first = DesktopOrigin::load(directory.0.clone()).unwrap();
        assert!(first.persist_verified_port(0).is_err());
        assert!(!file.exists());
        fs::write(&file, "49152\n").unwrap();
        assert!(first.persist_verified_port(49153).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "49152\n");
        #[cfg(unix)]
        {
            fs::remove_file(&file).unwrap();
            let target = directory.0.join("foreign");
            fs::write(&target, "49153\n").unwrap();
            std::os::unix::fs::symlink(&target, &file).unwrap();
            assert!(DesktopOrigin::load(directory.0.clone()).is_err());
            assert!(first.persist_verified_port(49153).is_err());
        }
    }
}
