//! Explicit, credential-free profiles for installed-app acceptance.
//! A HOME override alone does not isolate WKWebView's default data store.
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

const MANIFEST: &str = "desktop-qa-profile.json";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u8,
    root: PathBuf,
    webkit_store: [u8; 16],
}

#[derive(Debug)]
pub(crate) struct QaProfile {
    root: PathBuf,
    webkit_store: [u8; 16],
}

pub(crate) fn requested_root(
    args: impl IntoIterator<Item = String>,
) -> Result<Option<PathBuf>, String> {
    let mut args = args.into_iter();
    let mut root = None;
    while let Some(arg) = args.next() {
        if arg == "--qa-profile" {
            if root.is_some() {
                return Err("Specify --qa-profile once.".into());
            }
            let path = args
                .next()
                .filter(|value| !value.starts_with('-'))
                .ok_or("--qa-profile requires an absolute directory.")?;
            if !Path::new(&path).is_absolute() {
                return Err("--qa-profile requires an absolute directory.".into());
            }
            root = Some(PathBuf::from(path));
        } else if arg.starts_with("--qa-profile=") {
            return Err("Use --qa-profile /absolute/directory.".into());
        }
    }
    Ok(root)
}

pub(crate) fn require_supported_os(version: &str) -> Result<(), String> {
    let major = version
        .trim()
        .split('.')
        .next()
        .and_then(|part| part.parse::<u32>().ok());
    if major.is_some_and(|major| major >= 14) {
        Ok(())
    } else {
        Err(
            "Isolated desktop QA requires macOS 14 or newer; refusing the default WebKit store."
                .into(),
        )
    }
}

fn private_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(format!(
                "QA path must be a real directory: {}",
                path.display()
            ))
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path)
                .map_err(|error| format!("Could not create QA directory: {error}"))?;
        }
        Err(error) => return Err(format!("Could not inspect QA directory: {error}")),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Could not protect QA directory: {error}"))?;
    }
    Ok(())
}

impl QaProfile {
    pub(crate) fn open(path: &Path) -> Result<Self, String> {
        if !path.is_absolute()
            || fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err("QA root must be an absolute non-symlink directory.".into());
        }
        // An existing directory belongs to QA only if empty or carrying our
        // root-bound manifest. Never adopt an existing home or project.
        if path.exists()
            && !path.join(MANIFEST).exists()
            && fs::read_dir(path)
                .map_err(|e| e.to_string())?
                .next()
                .is_some()
        {
            return Err("QA root must be empty or an existing desktop QA profile.".into());
        }
        if !path.exists() {
            private_directory(path)?;
        }
        let root = path.canonicalize().map_err(|error| error.to_string())?;
        let manifest_path = root.join(MANIFEST);
        if fs::symlink_metadata(&manifest_path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("QA manifest cannot be a symlink.".into());
        }
        let manifest: Manifest = if manifest_path.exists() {
            if fs::metadata(&manifest_path)
                .map_err(|error| error.to_string())?
                .len()
                > 4096
            {
                return Err("Invalid desktop QA manifest size.".into());
            }
            let bytes = fs::read(&manifest_path).map_err(|error| error.to_string())?;
            serde_json::from_slice(&bytes).map_err(|_| "Invalid desktop QA manifest.")?
        } else {
            private_directory(&root)?;
            let mut webkit_store = [0; 16];
            getrandom::getrandom(&mut webkit_store).map_err(|error| error.to_string())?;
            webkit_store[6] = (webkit_store[6] & 0x0f) | 0x40;
            webkit_store[8] = (webkit_store[8] & 0x3f) | 0x80;
            let manifest = Manifest {
                version: 1,
                root: root.clone(),
                webkit_store,
            };
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&manifest_path)
                .map_err(|error| error.to_string())?;
            file.write_all(&serde_json::to_vec(&manifest).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            manifest
        };
        if manifest.version != 1 || manifest.root != root || manifest.webkit_store == [0; 16] {
            return Err("Desktop QA manifest does not belong to this directory.".into());
        }
        private_directory(&root)?;
        for name in [
            "home",
            "home/.gajae-app",
            "home/.gjc",
            "home/.gjc/agent",
            "home/.gjc/live-sessions",
            "home/.config",
            "home/.cache",
            "home/.local",
            "home/.local/share",
            "home/.local/state",
            "workspaces",
            "tmp",
            "browser",
            "browser/profile",
            "browser/chromium",
        ] {
            private_directory(&root.join(name))?;
        }
        Ok(Self {
            root,
            webkit_store: manifest.webkit_store,
        })
    }

    pub(crate) fn home(&self) -> PathBuf {
        self.root.join("home")
    }
    pub(crate) fn lock_path(&self) -> PathBuf {
        self.root.join("desktop.lock")
    }

    pub(crate) fn configure(&self, config: &mut tauri::utils::config::Config) {
        for window in &mut config.app.windows {
            window.data_store_identifier = Some(self.webkit_store);
            window.title = format!("{} — QA", window.title);
        }
    }

    pub(crate) fn environment(&self) -> BTreeMap<String, String> {
        let mut result = BTreeMap::from([
            ("PATH".into(), "/usr/bin:/bin:/usr/sbin:/sbin".into()),
            ("LANG".into(), "en_US.UTF-8".into()),
        ]);
        for (name, relative) in [
            ("HOME", "home"),
            ("USERPROFILE", "home"),
            ("DATABASE_PATH", "home/.gajae-app/auth.db"),
            ("GJC_CODING_AGENT_DIR", "home/.gjc/agent"),
            ("GJC_WORKER_AGENT_DIR", "home/.gjc/agent"),
            ("GJC_LIVE_SESSION_DIR", "home/.gjc/live-sessions"),
            ("WORKSPACES_ROOT", "workspaces"),
            ("XDG_CONFIG_HOME", "home/.config"),
            ("XDG_CACHE_HOME", "home/.cache"),
            ("XDG_DATA_HOME", "home/.local/share"),
            ("XDG_STATE_HOME", "home/.local/state"),
            ("TMPDIR", "tmp"),
            ("GAJAE_BROWSER_PROFILE_DIR", "browser/profile"),
            ("GAJAE_BROWSER_CACHE_DIR", "browser/chromium"),
        ] {
            result.insert(
                name.into(),
                self.root.join(relative).to_string_lossy().into_owned(),
            );
        }
        result
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
            let path = std::env::temp_dir().join(format!(
                "gajae-profile-{}-{:x}",
                std::process::id(),
                u64::from_ne_bytes(id)
            ));
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn profile_switch_is_explicit_and_unambiguous() {
        assert_eq!(
            requested_root(vec!["gajae-app://open/job/test".into()]).unwrap(),
            None
        );
        for args in [
            vec!["--qa-profile"],
            vec!["--qa-profile", "relative"],
            vec!["--qa-profile", "/a", "--qa-profile", "/b"],
            vec!["--qa-profile=/tmp/a"],
        ] {
            assert!(requested_root(args.into_iter().map(str::to_owned)).is_err());
        }
        assert_eq!(
            requested_root(vec!["--qa-profile".into(), "/tmp/qa".into()]).unwrap(),
            Some(PathBuf::from("/tmp/qa"))
        );
        for version in ["13.6.9", "11.0", "", "unknown"] {
            assert!(require_supported_os(version).is_err());
        }
        assert!(require_supported_os("14.0\n").is_ok());
        assert!(require_supported_os("26.6.2").is_ok());
    }

    #[test]
    fn profiles_persist_their_own_webkit_store_and_reject_copied_identity() {
        let a = Temp::new();
        let b = Temp::new();
        let first = QaProfile::open(&a.0).unwrap();
        let again = QaProfile::open(&a.0).unwrap();
        let other = QaProfile::open(&b.0).unwrap();
        assert_eq!(first.webkit_store, again.webkit_store);
        assert_ne!(first.webkit_store, other.webkit_store);
        fs::copy(a.0.join(MANIFEST), b.0.join(MANIFEST)).unwrap();
        assert!(QaProfile::open(&b.0).is_err());
    }

    #[test]
    fn refuses_existing_user_data_and_symlinked_paths() {
        let root = Temp::new();
        fs::create_dir(&root.0).unwrap();
        fs::write(root.0.join("user-data"), "keep").unwrap();
        assert!(QaProfile::open(&root.0).is_err());
        assert_eq!(
            fs::read_to_string(root.0.join("user-data")).unwrap(),
            "keep"
        );
        #[cfg(unix)]
        {
            let profile = Temp::new();
            QaProfile::open(&profile.0).unwrap();
            let home = profile.0.join("home");
            fs::remove_dir_all(&home).unwrap();
            std::os::unix::fs::symlink(&root.0, &home).unwrap();
            assert!(QaProfile::open(&profile.0).is_err());
        }
    }

    #[test]
    fn isolates_every_window_and_server_path_without_inherited_credentials() {
        let root = Temp::new();
        let profile = QaProfile::open(&root.0).unwrap();
        let mut config = tauri::utils::config::Config::default();
        config
            .app
            .windows
            .push(tauri::utils::config::WindowConfig::default());
        profile.configure(&mut config);
        assert!(config
            .app
            .windows
            .iter()
            .all(
                |window| window.data_store_identifier == Some(profile.webkit_store)
                    && window.title.ends_with(" — QA")
            ));
        let environment = profile.environment();
        for (name, value) in &environment {
            if name != "PATH" && name != "LANG" {
                assert!(Path::new(value).starts_with(&profile.root), "{name}");
            }
        }
        assert_eq!(environment["HOME"], profile.home().to_string_lossy());
        assert!(!environment.contains_key("OPENAI_API_KEY"));
        assert!(!environment.contains_key("NODE_OPTIONS"));
        assert!(profile.lock_path().starts_with(&profile.root));
    }
}
