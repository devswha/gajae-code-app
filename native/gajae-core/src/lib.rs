#![forbid(unsafe_code)]
pub mod git;
pub mod jobs;
pub mod pty;
pub mod watcher;

use std::ffi::OsString;
use std::path::PathBuf;

/// The supported invocations for the core host.
#[derive(Debug, Eq, PartialEq)]
pub enum Command {
    Version,
    Proxy {
        program: OsString,
        args: Vec<OsString>,
    },
    Watch {
        roots: Vec<PathBuf>,
    },
    Jobs {
        database: PathBuf,
    },
    Git {
        workdir: PathBuf,
    },
    Pty {
        program: OsString,
        args: Vec<OsString>,
    },
}

#[derive(Debug, Eq, PartialEq)]
pub struct ParseError;

/// Parses command-line arguments after the executable name.
///
/// Program names and arguments remain [`OsString`] values so they can be
/// forwarded without requiring Unicode or shell interpretation.
pub fn parse_args<I>(args: I) -> Result<Command, ParseError>
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    match args.next() {
        Some(flag) if flag == "--version" => {
            if args.next().is_none() {
                Ok(Command::Version)
            } else {
                Err(ParseError)
            }
        }
        Some(separator) if separator == "--" => match args.next() {
            Some(program) => Ok(Command::Proxy {
                program,
                args: args.collect(),
            }),
            None => Err(ParseError),
        },
        Some(command) if command == "watch" => parse_watch_args(args),
        Some(command) if command == "jobs" => parse_jobs_args(args),
        Some(command) if command == "git" => parse_git_args(args),
        Some(command) if command == "pty" => parse_pty_args(args),
        _ => Err(ParseError),
    }
}

fn parse_jobs_args<I>(args: I) -> Result<Command, ParseError>
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--database")) {
        return Err(ParseError);
    }
    let database = args.next().map(PathBuf::from).ok_or(ParseError)?;
    if !database.is_absolute() || args.next().is_some() {
        return Err(ParseError);
    }
    Ok(Command::Jobs { database })
}

fn parse_git_args<I>(args: I) -> Result<Command, ParseError>
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--workdir")) {
        return Err(ParseError);
    }
    let workdir = args.next().map(PathBuf::from).ok_or(ParseError)?;
    if !workdir.is_absolute() || args.next().is_some() {
        return Err(ParseError);
    }
    Ok(Command::Git { workdir })
}
fn parse_pty_args<I>(args: I) -> Result<Command, ParseError>
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--")) {
        return Err(ParseError);
    }
    let program = args.next().ok_or(ParseError)?;
    Ok(Command::Pty {
        program,
        args: args.collect(),
    })
}
fn parse_watch_args<I>(args: I) -> Result<Command, ParseError>
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    let mut roots = Vec::new();
    let mut canonical_roots = Vec::new();

    while let Some(flag) = args.next() {
        if flag != "--root" {
            return Err(ParseError);
        }
        let Some(root) = args.next() else {
            return Err(ParseError);
        };
        if root == "--root" {
            return Err(ParseError);
        }

        let root = PathBuf::from(root);
        let metadata = std::fs::symlink_metadata(&root).map_err(|_| ParseError)?;
        if !root.is_absolute() || metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(ParseError);
        }
        let canonical = std::fs::canonicalize(&root).map_err(|_| ParseError)?;
        if canonical_roots
            .iter()
            .any(|existing| existing == &canonical)
        {
            return Err(ParseError);
        }

        roots.push(canonical.clone());
        canonical_roots.push(canonical);
        if roots.len() > 8 {
            return Err(ParseError);
        }
    }

    if roots.is_empty() {
        Err(ParseError)
    } else {
        Ok(Command::Watch { roots })
    }
}

/// Converts an operating-system exit result into the host's process exit code.
///
/// Normal process exit codes are preserved when representable. On Unix, signal
/// termination is conventionally represented as `128 + signal`; unsupported or
/// unavailable status information is a deterministic failure (`1`).
pub fn map_exit_status(code: Option<i32>, signal: Option<i32>) -> u8 {
    if let Some(code) = code {
        return u8::try_from(code).unwrap_or(1);
    }

    match signal {
        Some(signal @ 1..=127) => 128 + signal as u8,
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::{Command, ParseError, map_exit_status, parse_args};
    use std::ffi::OsString;

    fn os(value: &str) -> OsString {
        OsString::from(value)
    }

    #[test]
    fn parses_version_only() {
        assert_eq!(parse_args([os("--version")]), Ok(Command::Version));
        assert_eq!(parse_args([os("--version"), os("extra")]), Err(ParseError));
    }

    #[test]
    fn parses_opaque_program_and_arguments() {
        assert_eq!(
            parse_args([os("--"), os("program name"), os("$not-expanded")]),
            Ok(Command::Proxy {
                program: os("program name"),
                args: vec![os("$not-expanded")],
            })
        );
    }

    #[test]
    fn parses_opaque_pty_program_and_arguments() {
        assert_eq!(
            parse_args([os("pty"), os("--"), os("program name"), os("$not-expanded")]),
            Ok(Command::Pty {
                program: os("program name"),
                args: vec![os("$not-expanded")],
            })
        );
        assert_eq!(parse_args([os("pty"), os("program")]), Err(ParseError));
    }
    #[test]
    fn parses_absolute_git_workdir_only() {
        let workdir = std::env::temp_dir().join("repository");
        assert_eq!(
            parse_args([os("git"), os("--workdir"), workdir.clone().into_os_string()]),
            Ok(Command::Git { workdir })
        );
        assert_eq!(
            parse_args([os("git"), os("--workdir"), os("relative")]),
            Err(ParseError)
        );
        assert_eq!(parse_args([os("git")]), Err(ParseError));
    }

    #[test]
    fn parses_absolute_jobs_database_only() {
        let database = std::env::temp_dir().join("jobs.sqlite");
        assert_eq!(
            parse_args([
                os("jobs"),
                os("--database"),
                database.clone().into_os_string()
            ]),
            Ok(Command::Jobs { database })
        );
        assert_eq!(
            parse_args([os("jobs"), os("--database"), os("relative.sqlite")]),
            Err(ParseError)
        );
    }

    #[cfg(windows)]
    #[test]
    fn parses_windows_absolute_paths_and_rejects_drive_relative_paths() {
        for path in [
            r"C:\work space\한글",
            r"\\server\share\repo",
            r"\\?\C:\repo",
        ] {
            assert_eq!(
                parse_args([os("git"), os("--workdir"), os(path)]),
                Ok(Command::Git {
                    workdir: path.into()
                })
            );
        }
        for path in [r"C:repo", r"\repo", "/tmp/repository"] {
            assert_eq!(
                parse_args([os("git"), os("--workdir"), os(path)]),
                Err(ParseError)
            );
        }
    }

    #[test]
    fn rejects_malformed_invocations() {
        assert_eq!(parse_args(std::iter::empty()), Err(ParseError));
        assert_eq!(parse_args([os("program")]), Err(ParseError));
        assert_eq!(parse_args([os("--")]), Err(ParseError));
    }
    #[test]
    fn parses_existing_absolute_watch_roots_only() {
        let root = std::env::temp_dir().join(format!(
            "gajae-core-parse-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir(&root).unwrap();

        let canonical_root = std::fs::canonicalize(&root).unwrap();
        let root_arg = root.clone().into_os_string();
        assert_eq!(
            parse_args([os("watch"), os("--root"), root_arg]),
            Ok(Command::Watch {
                roots: vec![canonical_root]
            })
        );
        assert_eq!(
            parse_args([os("watch"), os("--root"), os("/definitely-not-a-root")]),
            Err(ParseError)
        );
        assert_eq!(parse_args([os("watch")]), Err(ParseError));
        assert_eq!(
            parse_args([
                os("watch"),
                os("--root"),
                root.clone().into_os_string(),
                os("--extra")
            ]),
            Err(ParseError)
        );

        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn maps_normal_exit_codes() {
        assert_eq!(map_exit_status(Some(0), None), 0);
        assert_eq!(map_exit_status(Some(1), None), 1);
        assert_eq!(map_exit_status(Some(42), None), 42);
        assert_eq!(map_exit_status(Some(256), None), 1);
    }

    #[test]
    fn maps_unix_signals_and_unknown_statuses_deterministically() {
        assert_eq!(map_exit_status(None, Some(15)), 143);
        assert_eq!(map_exit_status(None, Some(127)), 255);
        assert_eq!(map_exit_status(None, Some(0)), 1);
        assert_eq!(map_exit_status(None, None), 1);
    }
}
