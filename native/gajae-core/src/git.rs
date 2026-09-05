use std::ffi::OsStr;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_DIFF_BYTES: usize = 16 * 1024 * 1024;
const MAX_DIFF_ITEMS: usize = 10_000;
const CHUNK_BYTES: usize = 36 * 1024;
const MAX_GIT_OUTPUT_BYTES: usize = MAX_DIFF_BYTES;
type ReadResult = Result<(bool, Vec<u8>, bool), GitError>;
type ReadHandle = thread::JoinHandle<Result<Option<Vec<u8>>, GitError>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol_version: u8,
    kind: String,
    id: String,
    method: String,
    params: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response<'a> {
    protocol_version: u8,
    kind: &'static str,
    id: &'a str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Error>,
}

#[derive(Serialize)]
struct Error {
    code: &'static str,
}

#[derive(Clone, Copy, Debug)]
enum GitError {
    InvalidRequest,
    InvalidPath,
    NotRepository,
    NotManagedWorktree,
    AlreadyExists,
    BranchConflict,
    DirtyWorktree,
    UnsupportedEncoding,
    OutputTooLarge,
    GitFailed,
}

impl GitError {
    fn code(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::InvalidPath => "invalid_path",
            Self::NotRepository => "not_repository",
            Self::NotManagedWorktree => "not_managed_worktree",
            Self::AlreadyExists => "already_exists",
            Self::BranchConflict => "branch_conflict",
            Self::DirtyWorktree => "dirty_worktree",
            Self::UnsupportedEncoding => "unsupported_encoding",
            Self::OutputTooLarge => "output_too_large",
            Self::GitFailed => "git_failed",
        }
    }
}

#[derive(Clone)]
struct Worktree {
    path: PathBuf,
    head: String,
    branch: Option<String>,
    locked: bool,
    prunable: bool,
}

/// Runs the version 1 git NDJSON protocol. A false result is a process-fatal
/// protocol or startup error; semantic request failures are correlated replies.
pub fn run<R: BufRead, W: Write>(workdir: &Path, mut input: R, mut output: W) -> bool {
    let workdir = match validate_workdir(workdir) {
        Ok(path) => path,
        Err(_) => return false,
    };
    if !write_json(&mut output, &json!({"protocolVersion": 1, "kind": "ready"})) {
        return false;
    }
    let mut frame = Vec::new();
    loop {
        frame.clear();
        let read = match Read::by_ref(&mut input)
            .take(MAX_FRAME_BYTES as u64 + 2)
            .read_until(b'\n', &mut frame)
        {
            Ok(value) => value,
            Err(_) => return false,
        };
        if read == 0 {
            return true;
        }
        if !frame.ends_with(b"\n") {
            return false;
        }
        frame.pop();
        if frame.len() > MAX_FRAME_BYTES {
            return false;
        }
        let request: Request = match serde_json::from_slice(&frame) {
            Ok(value) => value,
            Err(_) => return false,
        };
        if request.protocol_version != 1 || request.kind != "request" || !valid_id(&request.id) {
            return false;
        }
        let mut stream = Vec::new();
        let response = match dispatch(&workdir, &request, &mut stream) {
            Ok(result) => Response {
                protocol_version: 1,
                kind: "response",
                id: &request.id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(error) => Response {
                protocol_version: 1,
                kind: "response",
                id: &request.id,
                ok: false,
                result: None,
                error: Some(Error { code: error.code() }),
            },
        };
        for value in stream {
            if !write_json(&mut output, &value) {
                return false;
            }
        }
        let encoded = match serde_json::to_vec(&response) {
            Ok(value) if value.len() <= MAX_FRAME_BYTES => value,
            _ => return false,
        };
        if output.write_all(&encoded).is_err()
            || output.write_all(b"\n").is_err()
            || output.flush().is_err()
        {
            return false;
        }
    }
}

fn write_json<W: Write>(output: &mut W, value: &Value) -> bool {
    match serde_json::to_vec(value) {
        Ok(bytes) if bytes.len() <= MAX_FRAME_BYTES => {
            output.write_all(&bytes).is_ok()
                && output.write_all(b"\n").is_ok()
                && output.flush().is_ok()
        }
        _ => false,
    }
}

fn dispatch(workdir: &Path, request: &Request, stream: &mut Vec<Value>) -> Result<Value, GitError> {
    match request.method.as_str() {
        "worktree.create" => create(workdir, &request.params),
        "worktree.list" => list(workdir, &request.id, &request.params, stream),
        "status" => status(workdir, &request.id, &request.params, stream),
        "diff" => diff(workdir, &request.id, &request.params, stream),
        "worktree.prune" => prune(workdir, &request.params),
        _ => Err(GitError::InvalidRequest),
    }
}

fn fields(params: &Value, confirmed: bool) -> Result<(String, String, PathBuf), GitError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Fields {
        job_id: String,
        branch: String,
        path: PathBuf,
        #[serde(default)]
        confirmed: bool,
    }
    let fields: Fields =
        serde_json::from_value(params.clone()).map_err(|_| GitError::InvalidRequest)?;
    if confirmed && !fields.confirmed {
        return Err(GitError::InvalidRequest);
    }
    if !valid_id(&fields.job_id) || fields.branch != format!("job/{}", fields.job_id) {
        return Err(GitError::InvalidRequest);
    }
    Ok((fields.job_id, fields.branch, fields.path))
}

fn create(workdir: &Path, params: &Value) -> Result<Value, GitError> {
    let (job_id, branch, path) = fields(params, false)?;
    let path = managed_path(workdir, &job_id, &path)?;
    let entries = worktrees(workdir)?;
    if let Some(existing) = entries.iter().find(|item| item.path == path) {
        if existing.branch.as_deref() == Some(&format!("refs/heads/{branch}")) {
            return Ok(worktree_result(false, &job_id, &branch, existing));
        }
        return Err(GitError::BranchConflict);
    }
    if entries
        .iter()
        .any(|item| item.branch.as_deref() == Some(&format!("refs/heads/{branch}")))
    {
        return Err(GitError::BranchConflict);
    }
    if git_status(
        workdir,
        [
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    ) {
        return Err(GitError::BranchConflict);
    }
    if path.exists() {
        return Err(GitError::AlreadyExists);
    }
    let root = managed_root(workdir)?;
    std::fs::create_dir_all(&root).map_err(|_| GitError::InvalidPath)?;
    let base = git_text(workdir, ["rev-parse", "HEAD^{commit}"])?;
    let status = git_status(
        workdir,
        [
            "worktree",
            "add",
            "-b",
            &branch,
            "--",
            path.to_str().ok_or(GitError::UnsupportedEncoding)?,
            &base,
        ],
    );
    if !status {
        return Err(GitError::GitFailed);
    }
    let item = worktrees(workdir)?
        .into_iter()
        .find(|item| item.path == path)
        .ok_or(GitError::GitFailed)?;
    Ok(worktree_result(true, &job_id, &branch, &item))
}

fn list(
    workdir: &Path,
    id: &str,
    params: &Value,
    stream: &mut Vec<Value>,
) -> Result<Value, GitError> {
    if params.as_object().is_none_or(|object| !object.is_empty()) {
        return Err(GitError::InvalidRequest);
    }
    let mut count = 0_u64;
    for item in worktrees(workdir)? {
        let job_id = item
            .path
            .file_name()
            .and_then(OsStr::to_str)
            .expect("managed worktree paths have a valid job ID");
        let Some(branch) = item
            .branch
            .as_deref()
            .and_then(|value| value.strip_prefix("refs/heads/"))
        else {
            continue;
        };
        if branch != format!("job/{job_id}") {
            continue;
        }
        stream.push(json!({"protocolVersion":1,"kind":"item","id":id,"sequence":count,"item":{"worktreeId":item.path,"jobId":job_id,"path":item.path,"branch":branch,"head":item.head,"locked":item.locked,"prunable":item.prunable}}));
        count += 1;
    }
    Ok(json!({"count": count}))
}

fn status(
    workdir: &Path,
    id: &str,
    params: &Value,
    stream: &mut Vec<Value>,
) -> Result<Value, GitError> {
    let (job_id, branch, requested) = fields(params, false)?;
    let path = registered(workdir, &job_id, &branch, &requested)?;
    let bytes = git_bytes(
        &path,
        [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignored=no",
        ],
    )?;
    let mut records = bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty());
    let mut count = 0_u64;
    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            return Err(GitError::GitFailed);
        }
        let index = record[0] as char;
        let worktree = record[1] as char;
        let path_value =
            std::str::from_utf8(&record[3..]).map_err(|_| GitError::UnsupportedEncoding)?;
        let original = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            Some(
                std::str::from_utf8(records.next().ok_or(GitError::GitFailed)?)
                    .map_err(|_| GitError::UnsupportedEncoding)?,
            )
        } else {
            None
        };
        let kind = match (index, worktree) {
            ('?', '?') => "untracked",
            ('A', _) | (_, 'A') => "added",
            ('D', _) | (_, 'D') => "deleted",
            ('R', _) | (_, 'R') => "renamed",
            ('C', _) | (_, 'C') => "copied",
            ('U', _) | (_, 'U') => "unmerged",
            _ => "modified",
        };
        stream.push(json!({"protocolVersion":1,"kind":"item","id":id,"sequence":count,"item":{"path":path_value,"kind":kind,"index":index.to_string(),"worktree":worktree.to_string(),"originalPath":original}}));
        count += 1;
    }
    Ok(json!({"clean": count == 0, "count": count}))
}

fn diff(
    workdir: &Path,
    id: &str,
    params: &Value,
    stream: &mut Vec<Value>,
) -> Result<Value, GitError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Diff {
        job_id: String,
        branch: String,
        path: PathBuf,
        mode: String,
        #[serde(default)]
        include_untracked: bool,
        base_commit: Option<String>,
    }
    let value: Diff =
        serde_json::from_value(params.clone()).map_err(|_| GitError::InvalidRequest)?;
    if !valid_id(&value.job_id) || value.branch != format!("job/{}", value.job_id) {
        return Err(GitError::InvalidRequest);
    }
    let path = registered(workdir, &value.job_id, &value.branch, &value.path)?;
    let mut args = vec![
        "diff",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
    ];
    match value.mode.as_str() {
        "head" => args.push("HEAD"),
        "base" => args.push(
            value
                .base_commit
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or(GitError::InvalidRequest)?,
        ),
        "staged" => args.push("--cached"),
        "unstaged" => {}
        _ => return Err(GitError::InvalidRequest),
    }
    args.push("--");
    let mut bytes = git_bytes_limited(&path, args, MAX_DIFF_BYTES)?;
    if value.include_untracked {
        let untracked = git_bytes(&path, ["ls-files", "--others", "--exclude-standard", "-z"])?;
        let paths: Vec<&str> = untracked
            .split(|b| *b == 0)
            .filter(|v| !v.is_empty())
            .map(|v| std::str::from_utf8(v).map_err(|_| GitError::UnsupportedEncoding))
            .collect::<Result<_, _>>()?;
        if paths.len() > MAX_DIFF_ITEMS {
            return Err(GitError::OutputTooLarge);
        }
        for name in paths {
            let output = git_output_limited(
                &path,
                [
                    "diff",
                    "--binary",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-color",
                    "--no-index",
                    "--",
                    "/dev/null",
                    name,
                ],
                MAX_DIFF_BYTES - bytes.len(),
            )?;
            if !output.status.success() && output.status.code() != Some(1) {
                return Err(GitError::GitFailed);
            }
            bytes.extend_from_slice(&output.stdout);
            if bytes.len() > MAX_DIFF_BYTES {
                return Err(GitError::OutputTooLarge);
            }
        }
    }
    if bytes.len() > MAX_DIFF_BYTES {
        return Err(GitError::OutputTooLarge);
    }
    let chunks = bytes.chunks(CHUNK_BYTES).enumerate().map(|(sequence, chunk)| { stream.push(json!({"protocolVersion":1,"kind":"chunk","id":id,"sequence":sequence,"encoding":"base64","data":STANDARD.encode(chunk)})); 1_u64 }).sum::<u64>();
    Ok(json!({"bytes":bytes.len(),"chunks":chunks,"truncated":false}))
}

fn prune(workdir: &Path, params: &Value) -> Result<Value, GitError> {
    let (job_id, branch, requested) = fields(params, true)?;
    let path = registered(workdir, &job_id, &branch, &requested)?;
    if !git_bytes(
        &path,
        [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignored=no",
        ],
    )?
    .is_empty()
    {
        return Err(GitError::DirtyWorktree);
    }
    if !git_status(
        workdir,
        [
            "worktree",
            "remove",
            "--",
            path.to_str().ok_or(GitError::UnsupportedEncoding)?,
        ],
    ) {
        return Err(GitError::GitFailed);
    }
    Ok(json!({"pruned":true,"branchRetained":true}))
}

fn registered(
    workdir: &Path,
    job_id: &str,
    branch: &str,
    requested: &Path,
) -> Result<PathBuf, GitError> {
    let path = managed_path(workdir, job_id, requested)?;
    if canonicalize_existing_prefix(requested)? != path {
        return Err(GitError::InvalidPath);
    }
    let item = worktrees(workdir)?
        .into_iter()
        .find(|item| item.path == path)
        .ok_or(GitError::NotManagedWorktree)?;
    if item.branch.as_deref() != Some(&format!("refs/heads/{branch}")) {
        return Err(GitError::NotManagedWorktree);
    }
    Ok(path)
}

fn worktree_result(created: bool, job_id: &str, branch: &str, item: &Worktree) -> Value {
    json!({"created":created,"worktree":{"worktreeId":item.path,"jobId":job_id,"path":item.path,"branch":branch,"head":item.head}})
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

fn validate_workdir(workdir: &Path) -> Result<PathBuf, GitError> {
    if !workdir.is_absolute()
        || std::fs::symlink_metadata(workdir)
            .map_err(|_| GitError::InvalidPath)?
            .file_type()
            .is_symlink()
    {
        return Err(GitError::InvalidPath);
    }
    let canonical = std::fs::canonicalize(workdir).map_err(|_| GitError::InvalidPath)?;
    let top = git_text(&canonical, ["rev-parse", "--show-toplevel"])
        .map_err(|_| GitError::NotRepository)?;
    // Git for Windows returns ordinary drive/UNC paths, while Rust returns
    // verbatim paths (\\?\...) from canonicalize. Compare filesystem identities
    // instead of rejecting a repository because of its path spelling.
    let top = canonicalize_git_path(&canonical, top).map_err(|_| GitError::InvalidPath)?;
    if canonical != top {
        return Err(GitError::InvalidPath);
    }
    Ok(canonical)
}

fn managed_root(workdir: &Path) -> Result<PathBuf, GitError> {
    let root = workdir.join(".gjc-worktrees");
    if std::fs::symlink_metadata(&root).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(GitError::InvalidPath);
    }
    Ok(root)
}

fn managed_path(workdir: &Path, job_id: &str, requested: &Path) -> Result<PathBuf, GitError> {
    if !requested.is_absolute() {
        return Err(GitError::InvalidPath);
    }
    // `workdir` is already canonical (validate_workdir); the caller's requested
    // path may be non-canonical (e.g. macOS /var vs /private/var), so resolve it
    // through its nearest existing ancestor before the exact managed comparison.
    let root = managed_root(workdir)?;
    let expected = root.join(job_id);
    let canonical_requested = canonicalize_existing_prefix(requested)?;
    if canonical_requested != expected {
        return Err(GitError::InvalidPath);
    }
    Ok(expected)
}

fn canonicalize_existing_prefix(path: &Path) -> Result<PathBuf, GitError> {
    let ancestor = nearest_existing(path)?;
    let canonical_ancestor = std::fs::canonicalize(&ancestor).map_err(|_| GitError::InvalidPath)?;
    let tail = path
        .strip_prefix(&ancestor)
        .map_err(|_| GitError::InvalidPath)?;
    // A resolved tail must not escape upward; nearest_existing only strips
    // trailing components, so any `..` here is a traversal attempt.
    if tail
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(GitError::InvalidPath);
    }
    if tail.as_os_str().is_empty() {
        Ok(canonical_ancestor)
    } else {
        Ok(canonical_ancestor.join(tail))
    }
}

fn nearest_existing(path: &Path) -> Result<PathBuf, GitError> {
    let mut current = path;
    while !current.exists() {
        current = current.parent().ok_or(GitError::InvalidPath)?;
    }
    Ok(current.to_path_buf())
}

fn worktrees(workdir: &Path) -> Result<Vec<Worktree>, GitError> {
    let output = git_output(workdir, ["worktree", "list", "--porcelain", "-z"])?;
    if output.status.success() {
        let root = managed_root(workdir)?;
        Ok(parse_nul_worktrees(output.stdout)?
            .into_iter()
            .filter_map(|item| canonical_managed_worktree(&root, item))
            .collect())
    } else {
        parse_registered_newline_worktrees(
            workdir,
            git_bytes(workdir, ["worktree", "list", "--porcelain"])?,
        )
    }
}

fn parse_registered_newline_worktrees(
    workdir: &Path,
    bytes: Vec<u8>,
) -> Result<Vec<Worktree>, GitError> {
    let root = managed_root(workdir)?;
    let common_git_dir = common_git_dir(workdir)?;
    Ok(parse_newline_worktrees(bytes)?
        .into_iter()
        .filter_map(|item| canonical_managed_worktree(&root, item))
        .filter(|item| is_registered_with_common_git_dir(&common_git_dir, &item.path))
        .collect())
}

fn canonical_managed_worktree(root: &Path, mut item: Worktree) -> Option<Worktree> {
    if !item.path.is_absolute()
        || item
            .path
            .as_os_str()
            .to_string_lossy()
            .chars()
            .any(char::is_control)
    {
        return None;
    }
    // Resolve the existing prefix so missing/prunable worktrees remain visible.
    // Containment is checked after resolution, including symlink targets.
    item.path = canonicalize_existing_prefix(&item.path).ok()?;
    is_managed_worktree_path(root, &item.path).then_some(item)
}

fn common_git_dir(workdir: &Path) -> Result<PathBuf, GitError> {
    let path = git_text(workdir, ["rev-parse", "--git-common-dir"])?;
    canonicalize_git_path(workdir, path)
}

fn is_registered_with_common_git_dir(common_git_dir: &Path, path: &Path) -> bool {
    let Ok(common_git_dir_for_path) = git_text(path, ["rev-parse", "--git-common-dir"]) else {
        return false;
    };
    if !canonicalize_git_path(path, common_git_dir_for_path)
        .is_ok_and(|common_git_dir_for_path| common_git_dir_for_path == common_git_dir)
    {
        return false;
    }
    let Ok(git_dir) = git_text(path, ["rev-parse", "--absolute-git-dir"]) else {
        return false;
    };
    let Ok(git_dir) = canonicalize_git_path(path, git_dir) else {
        return false;
    };
    if git_dir.parent() != Some(&common_git_dir.join("worktrees")) {
        return false;
    }

    let Ok(gitdir) = std::fs::read_to_string(git_dir.join("gitdir")) else {
        return false;
    };
    let Ok(gitdir) =
        canonicalize_git_path(&git_dir, gitdir.trim_end_matches(['\r', '\n']).to_owned())
    else {
        return false;
    };
    std::fs::canonicalize(path.join(".git")).is_ok_and(|worktree_gitdir| gitdir == worktree_gitdir)
}

fn canonicalize_git_path(dir: &Path, path: String) -> Result<PathBuf, GitError> {
    let path = PathBuf::from(path);
    std::fs::canonicalize(if path.is_absolute() {
        path
    } else {
        dir.join(path)
    })
    .map_err(|_| GitError::GitFailed)
}

fn parse_nul_worktrees(bytes: Vec<u8>) -> Result<Vec<Worktree>, GitError> {
    let fields = bytes.split(|byte| *byte == b'\0').collect::<Vec<_>>();
    Ok(fields
        .split(|field| field.is_empty())
        .filter_map(parse_worktree_fields)
        .collect())
}

fn parse_newline_worktrees(bytes: Vec<u8>) -> Result<Vec<Worktree>, GitError> {
    let fields = bytes.split(|byte| *byte == b'\n').collect::<Vec<_>>();
    Ok(fields
        .split(|line| line.is_empty())
        .filter_map(parse_worktree_fields)
        .collect())
}

fn parse_worktree_fields(fields: &[&[u8]]) -> Option<Worktree> {
    let path = std::str::from_utf8(fields.first()?)
        .ok()?
        .strip_prefix("worktree ")?;
    let mut item = Worktree {
        path: PathBuf::from(path),
        head: String::new(),
        branch: None,
        locked: false,
        prunable: false,
    };
    for field in &fields[1..] {
        let text = std::str::from_utf8(field).ok()?;
        if let Some(head) = text.strip_prefix("HEAD ") {
            item.head = head.to_owned();
        } else if let Some(branch) = text.strip_prefix("branch ") {
            item.branch = Some(branch.to_owned());
        } else if text == "detached" {
        } else if text.starts_with("locked") {
            item.locked = true;
        } else if text.starts_with("prunable") {
            item.prunable = true;
        } else {
            return None;
        }
    }
    Some(item)
}

fn is_managed_worktree_path(root: &Path, path: &Path) -> bool {
    !path
        .as_os_str()
        .to_string_lossy()
        .chars()
        .any(char::is_control)
        && path.parent() == Some(root)
        && path
            .file_name()
            .and_then(OsStr::to_str)
            .is_some_and(valid_id)
}

fn git_output<I, S>(dir: &Path, args: I) -> Result<Output, GitError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    git_output_limited(dir, args, MAX_GIT_OUTPUT_BYTES)
}

fn git_output_limited<I, S>(dir: &Path, args: I, limit: usize) -> Result<Output, GitError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new("git");
    command
        .current_dir(dir)
        .env_clear()
        .envs(git_environment())
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.useBuiltinFSMonitor=false",
            "-c",
            "diff.external=",
        ])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|_| GitError::GitFailed)?;
    let stdout = child.stdout.take().ok_or(GitError::GitFailed)?;
    let stderr = child.stderr.take().ok_or(GitError::GitFailed)?;
    let (sender, receiver) = mpsc::channel();
    let stdout_reader = read_limited(stdout, limit, true, sender.clone());
    let stderr_reader = read_limited(stderr, limit, false, sender);
    let mut too_large = false;
    for _ in 0..2 {
        let (_, _, exceeded) = match receiver.recv() {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(GitError::GitFailed);
            }
        };
        if exceeded && !too_large {
            too_large = true;
            let _ = child.kill();
        }
    }
    let status = child.wait().map_err(|_| GitError::GitFailed)?;
    let stdout = stdout_reader
        .join()
        .map_err(|_| GitError::GitFailed)??
        .unwrap_or_default();
    let stderr = stderr_reader
        .join()
        .map_err(|_| GitError::GitFailed)??
        .unwrap_or_default();
    if too_large {
        return Err(GitError::OutputTooLarge);
    }
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn git_environment() -> Vec<(String, String)> {
    ["PATH", "HOME"]
        .into_iter()
        .chain(if cfg!(windows) {
            vec![
                "SystemRoot",
                "TEMP",
                "TMP",
                "USERPROFILE",
                "HOMEDRIVE",
                "HOMEPATH",
            ]
        } else {
            Vec::new()
        })
        .filter_map(|key| std::env::var(key).ok().map(|value| (key.to_owned(), value)))
        .collect()
}

fn read_limited<R: Read + Send + 'static>(
    mut reader: R,
    limit: usize,
    is_stdout: bool,
    sender: mpsc::Sender<ReadResult>,
) -> ReadHandle {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let read = reader.read(&mut buffer).map_err(|_| GitError::GitFailed)?;
            if read == 0 {
                break;
            }
            let remaining = limit.saturating_sub(bytes.len());
            let copied = read.min(remaining);
            bytes.extend_from_slice(&buffer[..copied]);
            if copied != read {
                sender
                    .send(Ok((is_stdout, bytes, true)))
                    .map_err(|_| GitError::GitFailed)?;
                return Ok(None);
            }
        }
        sender
            .send(Ok((is_stdout, bytes.clone(), false)))
            .map_err(|_| GitError::GitFailed)?;
        Ok(Some(bytes))
    })
}

fn git_bytes<I, S>(dir: &Path, args: I) -> Result<Vec<u8>, GitError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    git_bytes_limited(dir, args, MAX_GIT_OUTPUT_BYTES)
}

fn git_bytes_limited<I, S>(dir: &Path, args: I, limit: usize) -> Result<Vec<u8>, GitError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = git_output_limited(dir, args, limit)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(GitError::GitFailed)
    }
}

fn git_text<I, S>(dir: &Path, args: I) -> Result<String, GitError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let value = git_bytes(dir, args)?;
    let text = std::str::from_utf8(&value).map_err(|_| GitError::GitFailed)?;
    Ok(text.trim_end_matches(['\r', '\n']).to_owned())
}

fn git_status<I, S>(dir: &Path, args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    git_output(dir, args).is_ok_and(|output| output.status.success())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRepo {
        path: PathBuf,
    }

    impl TestRepo {
        fn new() -> Self {
            static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "gajae core git 한글 test-{}-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir(&path).unwrap();
            // Canonicalize so expected paths match git's canonical worktree
            // output (macOS resolves /var -> /private/var).
            let path = std::fs::canonicalize(&path).unwrap();
            assert!(
                Command::new("git")
                    .args(["init", "--quiet"])
                    .current_dir(&path)
                    .status()
                    .unwrap()
                    .success()
            );
            std::fs::write(path.join("tracked.txt"), "before\n").unwrap();
            assert!(
                Command::new("git")
                    .args(["add", "tracked.txt"])
                    .current_dir(&path)
                    .status()
                    .unwrap()
                    .success()
            );
            assert!(
                Command::new("git")
                    .args([
                        "-c",
                        "user.name=Gajae Test",
                        "-c",
                        "user.email=gajae@example.test",
                        "commit",
                        "--quiet",
                        "-m",
                        "initial",
                    ])
                    .current_dir(&path)
                    .status()
                    .unwrap()
                    .success()
            );
            Self { path }
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn request_frame(length: usize) -> Vec<u8> {
        let mut request = json!({
            "protocolVersion": 1,
            "kind": "request",
            "id": "frame-test",
            "method": "unknown",
            "params": {"padding": ""},
        });
        let empty_length = serde_json::to_vec(&request).unwrap().len();
        request["params"]["padding"] = Value::String("x".repeat(length - empty_length));
        let frame = serde_json::to_vec(&request).unwrap();
        assert_eq!(frame.len(), length);
        frame
    }

    #[test]
    fn starts_git_protocol_from_repository_root_but_rejects_subdirectories() {
        let repo = TestRepo::new();
        let mut output = Vec::new();
        assert!(run(&repo.path, Cursor::new(Vec::new()), &mut output));
        assert_eq!(
            serde_json::from_slice::<Value>(&output).unwrap(),
            json!({"protocolVersion": 1, "kind": "ready"})
        );
        let nested = repo.path.join("nested");
        std::fs::create_dir(&nested).unwrap();
        assert!(matches!(
            validate_workdir(&nested),
            Err(GitError::InvalidPath)
        ));
    }

    #[test]
    fn missing_registered_worktrees_remain_listed_and_unmanaged_paths_are_rejected() {
        let repo = TestRepo::new();
        let path = repo.path.join(".gjc-worktrees/missing");
        create(
            &repo.path,
            &json!({"jobId": "missing", "branch": "job/missing", "path": path}),
        )
        .unwrap();
        std::fs::remove_dir_all(&path).unwrap();
        let entries = worktrees(&repo.path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, path);
        assert!(entries[0].prunable);

        let root = managed_root(&repo.path).unwrap();
        for invalid in [repo.path.join("unmanaged"), root.join("..\\outside")] {
            let item = Worktree {
                path: invalid,
                head: String::new(),
                branch: None,
                locked: false,
                prunable: true,
            };
            assert!(canonical_managed_worktree(&root, item).is_none());
        }
    }

    #[cfg(unix)]
    #[test]
    fn resolved_worktree_paths_cannot_escape_through_symlinks() {
        let repo = TestRepo::new();
        let root = managed_root(&repo.path).unwrap();
        std::fs::create_dir(&root).unwrap();
        let outside = repo.path.join("outside");
        std::fs::create_dir(&outside).unwrap();
        let linked = root.join("linked");
        std::os::unix::fs::symlink(outside, &linked).unwrap();
        let item = Worktree {
            path: linked,
            head: String::new(),
            branch: None,
            locked: false,
            prunable: false,
        };
        assert!(canonical_managed_worktree(&root, item).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn windows_git_paths_resolve_to_verbatim_worktree_identity() {
        let repo = TestRepo::new();
        let git_root = git_text(&repo.path, ["rev-parse", "--show-toplevel"]).unwrap();
        assert_ne!(PathBuf::from(&git_root), repo.path);
        assert_eq!(validate_workdir(Path::new(&git_root)).unwrap(), repo.path);
        let requested = PathBuf::from(git_root).join(".gjc-worktrees/job-1");
        let params = json!({"jobId": "job-1", "branch": "job/job-1", "path": requested});
        let first = create(&repo.path, &params).unwrap();
        assert_eq!(first["created"], true);
        assert_eq!(create(&repo.path, &params).unwrap()["created"], false);
        assert_eq!(
            registered(&repo.path, "job-1", "job/job-1", &requested).unwrap(),
            std::fs::canonicalize(&requested).unwrap()
        );
        let fallback = parse_registered_newline_worktrees(
            &repo.path,
            git_bytes(&repo.path, ["worktree", "list", "--porcelain"]).unwrap(),
        )
        .unwrap();
        assert_eq!(fallback.len(), 1);
        assert_eq!(fallback[0].path, std::fs::canonicalize(requested).unwrap());
        let mut prune_params = params;
        prune_params["confirmed"] = json!(true);
        assert_eq!(prune(&repo.path, &prune_params).unwrap()["pruned"], true);
    }

    #[test]
    fn diff_returns_patch_chunks_for_a_managed_worktree() {
        let repo = TestRepo::new();
        let path = repo.path.join(".gjc-worktrees/job-1");
        let params = json!({
            "jobId": "job-1",
            "branch": "job/job-1",
            "path": path,
        });
        let created = create(&repo.path, &params).unwrap();
        let mut list_stream = Vec::new();
        let list_result = list(&repo.path, "list-test", &json!({}), &mut list_stream).unwrap();
        assert_eq!(list_result["count"], 1);
        assert_eq!(list_stream[0]["item"]["jobId"], "job-1");
        assert_eq!(list_stream[0]["item"]["path"], path.to_str().unwrap());
        std::fs::write(path.join("tracked.txt"), "after\n").unwrap();

        let mut stream = Vec::new();
        let result = diff(
            &repo.path,
            "diff-test",
            &json!({
                "jobId": "job-1",
                "branch": "job/job-1",
                "path": path,
                "mode": "base",
                "baseCommit": created["worktree"]["head"],
            }),
            &mut stream,
        )
        .unwrap();

        assert_eq!(result["chunks"], 1);
        let patch = STANDARD
            .decode(stream[0]["data"].as_str().unwrap())
            .unwrap();
        assert!(patch.starts_with(b"diff --git "));
        assert!(
            patch
                .windows(b"-before".len())
                .any(|part| part == b"-before")
        );
        assert!(patch.windows(b"+after".len()).any(|part| part == b"+after"));
    }

    #[test]
    fn newline_porcelain_rejects_an_injected_managed_entry() {
        let root = PathBuf::from("/repo/.gjc-worktrees");
        let output = b"worktree /repo/.gjc-worktrees/unsafe\nworktree /repo/.gjc-worktrees/job-1\nHEAD deadbeef\nbranch refs/heads/job/job-1\n\n";
        let entries = parse_newline_worktrees(output.to_vec()).unwrap();
        assert!(entries.is_empty());
        assert!(is_managed_worktree_path(
            &root,
            Path::new("/repo/.gjc-worktrees/job-1")
        ));
    }
    #[test]
    fn newline_porcelain_rejects_double_newline_injected_managed_entry() {
        let repo = TestRepo::new();
        let injected_path = repo.path.join(".gjc-worktrees/job-1");
        std::fs::create_dir_all(&injected_path).unwrap();
        let output = format!(
            "worktree /unsafe\n\nworktree {}\nHEAD deadbeef\nbranch refs/heads/job/job-1\n\n",
            injected_path.display()
        );
        let entries = parse_newline_worktrees(output.as_bytes().to_vec()).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].path, injected_path);
        assert!(
            parse_registered_newline_worktrees(&repo.path, output.into_bytes())
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn newline_porcelain_rejects_forged_registered_worktree_pointer() {
        let repo = TestRepo::new();
        let registered_path = repo.path.join(".gjc-worktrees/registered");
        create(
            &repo.path,
            &json!({
                "jobId": "registered",
                "branch": "job/registered",
                "path": registered_path,
            }),
        )
        .unwrap();

        let forged_path = repo.path.join(".gjc-worktrees/job-1");
        std::fs::create_dir_all(&forged_path).unwrap();
        std::fs::copy(registered_path.join(".git"), forged_path.join(".git")).unwrap();
        let output = format!(
            "worktree /unsafe\n\nworktree {}\nHEAD deadbeef\nbranch refs/heads/job/job-1\n\n",
            forged_path.display()
        );

        assert!(
            parse_registered_newline_worktrees(&repo.path, output.into_bytes())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn newline_porcelain_accepts_registered_managed_worktree() {
        let repo = TestRepo::new();
        let path = repo.path.join(".gjc-worktrees/job-1");
        create(
            &repo.path,
            &json!({
                "jobId": "job-1",
                "branch": "job/job-1",
                "path": path,
            }),
        )
        .unwrap();
        let output = format!(
            "worktree {}\nHEAD deadbeef\nbranch refs/heads/job/job-1\n\n",
            path.display()
        );
        let entries = parse_registered_newline_worktrees(&repo.path, output.into_bytes()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, path);
    }

    #[test]
    fn git_environment_is_an_allowlist() {
        let environment = git_environment();
        assert!(environment.iter().all(|(key, _)| matches!(
            key.as_str(),
            "PATH"
                | "HOME"
                | "SystemRoot"
                | "TEMP"
                | "TMP"
                | "USERPROFILE"
                | "HOMEDRIVE"
                | "HOMEPATH"
        )));
    }

    #[test]
    fn frame_at_64_kib_is_accepted() {
        let repo = TestRepo::new();
        let mut input = request_frame(MAX_FRAME_BYTES);
        input.push(b'\n');
        assert!(run(&repo.path, Cursor::new(input), Vec::new()));
    }

    #[test]
    fn frame_over_64_kib_is_rejected() {
        let repo = TestRepo::new();
        let mut input = request_frame(MAX_FRAME_BYTES + 1);
        input.push(b'\n');
        assert!(!run(&repo.path, Cursor::new(input), Vec::new()));
    }

    #[test]
    fn unterminated_frame_is_rejected() {
        let repo = TestRepo::new();
        assert!(!run(&repo.path, Cursor::new(b"{".to_vec()), Vec::new()));
    }

    #[test]
    fn read_limit_reports_overflow_without_returning_truncated_output() {
        let (sender, receiver) = mpsc::channel();
        let reader = read_limited(Cursor::new(b"12345".to_vec()), 4, true, sender);
        assert_eq!(
            receiver.recv().unwrap().unwrap(),
            (true, b"1234".to_vec(), true)
        );
        assert_eq!(reader.join().unwrap().unwrap(), None);
    }
}
