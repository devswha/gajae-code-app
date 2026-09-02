import path from 'path';
import { promises as fs } from 'fs';

import express from 'express';
// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';

import { projectsDb } from '../modules/database/index.js';

const router = express.Router();

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

// Input validation helpers (defense-in-depth)
function validateBranchName(branch) {
  if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) {
    throw new Error('Invalid branch name');
  }
  return branch;
}

function validateRemoteName(remote) {
  if (!/^[a-zA-Z0-9._-]+$/.test(remote)) {
    throw new Error('Invalid remote name');
  }
  return remote;
}

function validateProjectPath(projectPath) {
  if (!projectPath || projectPath.includes('\0')) {
    throw new Error('Invalid project path');
  }
  const resolved = path.resolve(projectPath);
  // Must be an absolute path after resolution
  if (!path.isAbsolute(resolved)) {
    throw new Error('Invalid project path: must be absolute');
  }
  // Block obviously dangerous paths
  if (resolved === '/' || resolved === path.sep) {
    throw new Error('Invalid project path: root directory not allowed');
  }
  return resolved;
}

/**
 * Resolve the absolute project directory for a given DB `projectId`.
 *
 * After the projectName → projectId migration, every git endpoint receives
 * the DB primary key (`project` query/body param). The legacy filesystem
 * resolver that walked Claude's JSONL history is no longer used here; the
 * path comes straight from the `projects` table and is then sanity-checked
 * by `validateProjectPath` before any `git` command runs against it.
 */
async function getActualProjectPath(projectId) {
  const projectPath = await projectsDb.getProjectPathById(projectId);
  if (!projectPath) {
    throw new Error(`Unable to resolve project path for "${projectId}"`);
  }
  return validateProjectPath(projectPath);
}

// Helper function to validate git repository
async function validateGitRepository(projectPath) {
  try {
    // Check if directory exists
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  try {
    // Allow any directory that is inside a work tree (repo root or nested folder).
    const { stdout: insideWorkTreeOutput } = await spawnAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectPath });
    const isInsideWorkTree = insideWorkTreeOutput.trim() === 'true';
    if (!isInsideWorkTree) {
      throw new Error('Not inside a git work tree');
    }

    // Ensure git can resolve the repository root for this directory.
    await spawnAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectPath });
  } catch {
    throw new Error('Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.');
  }
}

function getGitErrorDetails(error) {
  return `${error?.message || ''} ${error?.stderr || ''} ${error?.stdout || ''}`;
}

function isMissingHeadRevisionError(error) {
  const errorDetails = getGitErrorDetails(error).toLowerCase();
  return errorDetails.includes('unknown revision')
    || errorDetails.includes('ambiguous argument')
    || errorDetails.includes('needed a single revision')
    || errorDetails.includes('bad revision');
}

async function getCurrentBranchName(projectPath) {
  try {
    // symbolic-ref works even when the repository has no commits.
    const { stdout } = await spawnAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: projectPath });
    const branchName = stdout.trim();
    if (branchName) {
      return branchName;
    }
  } catch (error) {
    // Fall back to rev-parse for detached HEAD and older git edge cases.
  }

  const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath });
  return stdout.trim();
}

async function repositoryHasCommits(projectPath) {
  try {
    await spawnAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
    return true;
  } catch (error) {
    if (isMissingHeadRevisionError(error)) {
      return false;
    }
    throw error;
  }
}

// Get git status for a project
/**
 * Parses `git status --porcelain=v1 -z` output into the response shape the
 * workspace Status tab consumes. NUL-separated entries carry no path quoting,
 * so names with spaces/unicode survive intact (the plain porcelain output
 * quotes and escapes them, which broke the old line-based parser).
 *
 * `staged` lists paths with index-side changes so the summary always mirrors
 * the real git index (including files staged outside the app, e.g. via
 * VSCode or the terminal).
 *
 * Exported for tests.
 */
export function parseGitStatusEntries(statusOutput) {
  const entries = [];
  const statusEntries = statusOutput.split('\0');
  for (let entryIndex = 0; entryIndex < statusEntries.length; entryIndex++) {
    const entry = statusEntries[entryIndex];
    if (!entry || entry.length < 4) continue;

    // Porcelain v1: X = index (staged) status, Y = worktree (unstaged) status.
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const path = entry.slice(3);
    let oldPath = null;

    // Renames/copies carry the original path as the following NUL entry;
    // the UI tracks the post-rename path only.
    if (indexStatus === 'R' || indexStatus === 'C') {
      oldPath = statusEntries[++entryIndex] || null;
    }

    if (indexStatus === '?') {
      entries.push({ path, oldPath: null, status: 'untracked', staged: false });
      continue;
    }
    if (indexStatus === '!') {
      continue; // ignored files are never reported
    }

    const isConflict =
      indexStatus === 'U' || worktreeStatus === 'U' ||
      (indexStatus === 'A' && worktreeStatus === 'A') ||
      (indexStatus === 'D' && worktreeStatus === 'D');
    if (isConflict) {
      // Merge conflicts must be resolved in the worktree first; surface them
      // as modified and never as staged.
      entries.push({ path, oldPath, status: 'modified', staged: false });
      continue;
    }

    const status = indexStatus === 'R' || indexStatus === 'C'
      ? 'renamed'
      : indexStatus === 'D' || worktreeStatus === 'D'
        ? 'deleted'
        : indexStatus === 'A' || worktreeStatus === 'A'
          ? 'added'
          : 'modified';
    entries.push({ path, oldPath, status, staged: indexStatus !== ' ' });
  }

  return entries;
}

export function parseGitStatusOutput(statusOutput) {
  const modified = [];
  const added = [];
  const deleted = [];
  const untracked = [];
  const staged = [];

  for (const entry of parseGitStatusEntries(statusOutput)) {
    if (entry.status === 'untracked') {
      untracked.push(entry.path);
      continue;
    }
    if (entry.staged) staged.push(entry.path);
    if (entry.status === 'deleted') {
      deleted.push(entry.path);
    } else if (entry.status === 'added') {
      added.push(entry.path);
    } else {
      modified.push(entry.path);
    }
  }

  return { modified, added, deleted, untracked, staged };
}

function statusFromNumstat(additions, deletions) {
  if (additions > 0 && deletions === 0) return 'added';
  if (additions === 0 && deletions > 0) return 'deleted';
  return 'modified';
}

/**
 * Parses NUL-delimited `git diff --numstat -z` output. Renames use an empty
 * path field followed by the old and new paths; accepting `old => new` too
 * keeps this parser useful for the human-readable numstat variant.
 */
export function parseGitNumstatOutput(numstatOutput) {
  const files = [];
  const entries = numstatOutput.split('\0');
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    const fields = entry.split('\t');
    if (fields.length < 3) continue;

    const [additionsText, deletionsText, ...pathFields] = fields;
    let filePath = pathFields.join('\t');
    let oldPath = null;
    if (!filePath) {
      oldPath = entries[++index] || null;
      filePath = entries[++index] || '';
    } else if (filePath.includes(' => ')) {
      [oldPath, filePath] = filePath.split(' => ', 2);
    }
    if (!filePath) continue;

    const binary = additionsText === '-' || deletionsText === '-';
    const additions = binary ? 0 : Number.parseInt(additionsText, 10);
    const deletions = binary ? 0 : Number.parseInt(deletionsText, 10);
    files.push({
      path: filePath,
      oldPath,
      status: oldPath ? 'renamed' : statusFromNumstat(additions, deletions),
      additions: Number.isNaN(additions) ? 0 : additions,
      deletions: Number.isNaN(deletions) ? 0 : deletions,
      binary,
    });
  }
  return files;
}

function diffPath(line, prefix) {
  if (line.startsWith(prefix)) return line.slice(prefix.length);
  const separator = prefix.indexOf(' ');
  const quotedPrefix = `${prefix.slice(0, separator + 1)}"${prefix.slice(separator + 1)}`;
  return line.startsWith(quotedPrefix) && line.endsWith('"')
    ? line.slice(quotedPrefix.length, -1)
    : null;
}

/**
 * Splits a unified git diff into its file-level segments.
 */
export function splitGitDiffPatches(diffOutput) {
  const segments = diffOutput.split(/(?=^diff --git )/m).filter(Boolean);
  return segments.map((patch) => {
    const lines = patch.split('\n');
    let filePath = null;
    for (const line of lines) {
      if (line.startsWith('rename to ')) {
        filePath = line.slice('rename to '.length);
      } else if (line.startsWith('+++ ')) {
        filePath = diffPath(line, '+++ b/') || filePath;
      } else if (!filePath && line.startsWith('--- ')) {
        filePath = diffPath(line, '--- a/');
      }
    }
    return { path: filePath, patch };
  }).filter(({ path: filePath }) => filePath);
}

/**
 * Attaches patch text while enforcing the per-file and response-wide limits.
 */
export function attachDiffPatches(files, patches, perFileLimit = 50000, totalLimit = 400000) {
  const patchesByPath = new Map(patches.map(({ path: filePath, patch }) => [filePath, patch]));
  let attachedChars = 0;
  let exhausted = false;

  return files.map((file) => {
    const patch = patchesByPath.get(file.path);
    if (file.binary || !patch) return { ...file, patch: null, tooLarge: false };
    if (exhausted || patch.length > perFileLimit || attachedChars + patch.length > totalLimit) {
      if (attachedChars + patch.length > totalLimit && patch.length <= perFileLimit) {
        exhausted = true;
      }
      return { ...file, patch: null, tooLarge: true };
    }
    attachedChars += patch.length;
    return { ...file, patch, tooLarge: false };
  });
}

export function buildNoCommitsDiffFiles(statusOutput) {
  return parseGitStatusEntries(statusOutput).map(({ path: filePath, oldPath, status, staged }) => ({
    path: filePath,
    oldPath,
    status,
    staged,
    additions: 0,
    deletions: 0,
    patch: null,
    binary: false,
    tooLarge: false,
  }));
}

router.get('/status', async (req, res) => {
  const { project } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    // Validate git repository
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);
    const hasCommits = await repositoryHasCommits(projectPath);

    const { stdout: statusOutput } = await spawnAsync('git', ['status', '--porcelain=v1', '-z'], { cwd: projectPath });
    const { modified, added, deleted, untracked, staged } = parseGitStatusOutput(statusOutput);

    res.json({
      branch,
      hasCommits,
      modified,
      added,
      deleted,
      untracked,
      staged
    });
  } catch (error) {
    console.error('Git status error:', error);
    res.json({
      error: error.message.includes('not a git repository') || error.message.includes('Project directory is not a git repository')
        ? error.message
        : 'Git operation failed',
      details: error.message.includes('not a git repository') || error.message.includes('Project directory is not a git repository')
        ? error.message
        : `Failed to get git status: ${error.message}`
    });
  }
});

router.get('/diff', async (req, res) => {
  const { project } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath);
    const hasCommits = await repositoryHasCommits(projectPath);
    // --untracked-files=all: porcelain collapses a wholly-new directory to
    // `dir/`, and the diff tab wants files, each with its own patch.
    const { stdout: statusOutput } = await spawnAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: projectPath });

    if (!hasCommits) {
      return res.json({ branch, hasCommits, files: buildNoCommitsDiffFiles(statusOutput) });
    }

    const [{ stdout: numstatOutput }, { stdout: diffOutput }] = await Promise.all([
      spawnAsync('git', [
        '-c', 'core.quotepath=false',
        '-c', 'diff.renames=true',
        'diff', 'HEAD', '--no-color', '--numstat', '-z',
      ], { cwd: projectPath }),
      spawnAsync('git', [
        '-c', 'core.quotepath=false',
        'diff', 'HEAD', '--no-color', '--find-renames',
      ], { cwd: projectPath }),
    ]);

    const statusByPath = new Map(parseGitStatusEntries(statusOutput).map((entry) => [entry.path, entry]));
    const trackedFiles = parseGitNumstatOutput(numstatOutput).map((file) => {
      const status = statusByPath.get(file.path);
      return status
        ? { ...file, oldPath: status.oldPath || file.oldPath, status: status.status, staged: status.staged }
        : { ...file, staged: false };
    });

    // An untracked file costs one git process; a generated or vendored
    // directory can list hundreds. Patches are read for the first hundred
    // only; the rest are listed with their patch omitted.
    const untrackedPatchLimit = 100;
    const untrackedEntries = parseGitStatusEntries(statusOutput)
      .filter((entry) => entry.status === 'untracked');
    const untrackedFiles = await Promise.all(untrackedEntries.slice(0, untrackedPatchLimit).map(async ({ path: filePath }) => {
      try {
        const { stdout } = await spawnAsync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', filePath], { cwd: projectPath });
        return { path: filePath, patch: stdout };
      } catch (error) {
        return { path: filePath, patch: error.stdout || '' };
      }
    }));

    const files = [
      ...trackedFiles,
      ...untrackedFiles.map(({ path: filePath }) => ({
        path: filePath,
        oldPath: null,
        status: 'untracked',
        staged: false,
        additions: 0,
        deletions: 0,
        binary: false,
        tooLarge: untrackedEntries.length > untrackedPatchLimit,
      })),
    ];
    const patches = [
      ...splitGitDiffPatches(diffOutput),
      ...untrackedFiles,
    ];

    res.json({
      branch,
      hasCommits,
      files: attachDiffPatches(files, patches),
    });
  } catch (error) {
    console.error('Git diff error:', error);
    res.json({
      error: error.message.includes('not a git repository') || error.message.includes('Project directory is not a git repository')
        ? error.message
        : 'Git operation failed',
      details: error.message.includes('not a git repository') || error.message.includes('Project directory is not a git repository')
        ? error.message
        : `Failed to get git diff: ${error.message}`,
    });
  }
});

// Get list of branches
router.get('/branches', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Get all branches
    const { stdout } = await spawnAsync('git', ['branch', '-a'], { cwd: projectPath });

    const rawLines = stdout
      .split('\n')
      .map(b => b.trim())
      .filter(b => b && !b.includes('->'));

    // Local branches (may start with '* ' for current)
    const localBranches = rawLines
      .filter(b => !b.startsWith('remotes/'))
      .map(b => (b.startsWith('* ') ? b.substring(2) : b));

    // Remote branches — strip 'remotes/<remote>/' prefix
    const remoteBranches = rawLines
      .filter(b => b.startsWith('remotes/'))
      .map(b => b.replace(/^remotes\/[^/]+\//, ''))
      .filter(name => !localBranches.includes(name)); // skip if already a local branch

    // Backward-compat flat list (local + unique remotes, deduplicated)
    const branches = [...localBranches, ...remoteBranches]
      .filter((b, i, arr) => arr.indexOf(b) === i);

    res.json({ branches, localBranches, remoteBranches });
  } catch (error) {
    console.error('Git branches error:', error);
    res.json({ error: error.message });
  }
});

// Checkout branch
router.post('/checkout', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project id and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Checkout the branch
    validateBranchName(branch);
    const { stdout } = await spawnAsync('git', ['checkout', branch], { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fields are joined with the ASCII unit separator so pipes (or anything else
// typed into a commit subject) cannot break parsing.
const GIT_LOG_FIELD_SEPARATOR = '\u001f';
const GIT_LOG_PRETTY_FORMAT = '%H%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s';

/**
 * Parses `git log --shortstat` output produced with GIT_LOG_PRETTY_FORMAT.
 *
 * Each commit is one format line (hash, parent hashes, ref decorations,
 * author, email, date, subject) optionally followed by its `--shortstat`
 * summary line ("N files changed, ..."). Parents and refs feed the commit
 * graph rendered by the History view; merge commits carry no shortstat line,
 * so their `stats` stays empty.
 *
 * Exported for tests.
 */
export function parseGitLogWithStats(stdout) {
  const commits = [];

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (line.includes(GIT_LOG_FIELD_SEPARATOR)) {
      const [hash, parents, refs, author, email, date, ...messageParts] = line.split(GIT_LOG_FIELD_SEPARATOR);
      commits.push({
        hash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        // `%D` decorations, e.g. "HEAD -> main", "origin/main", "tag: v1.0".
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        author,
        email,
        date,
        message: messageParts.join(GIT_LOG_FIELD_SEPARATOR),
        stats: ''
      });
      continue;
    }

    if (commits.length > 0 && /files? changed/.test(line)) {
      commits[commits.length - 1].stats = line.trim();
    }
  }

  return commits;
}

// Get recent commits (across all branches, in graph order)
router.get('/commits', async (req, res) => {
  const { project, limit = 10 } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    const parsedLimit = Number.parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 10;

    // Branches/remotes/tags (not --all, which would drag in refs/stash) with
    // `--topo-order` guarantee children appear before their parents across
    // every branch, which the frontend lane-assignment relies on.
    // `--shortstat` replaces the previous per-commit `git show --stat` calls.
    const { stdout } = await spawnAsync(
      'git',
      [
        'log',
        '--branches',
        '--remotes',
        '--tags',
        '--topo-order',
        '--shortstat',
        `--pretty=format:${GIT_LOG_PRETTY_FORMAT}`,
        '--date=iso-strict',
        '-n', String(safeLimit)
      ],
      { cwd: projectPath },
    );

    res.json({ commits: parseGitLogWithStats(stdout) });
  } catch (error) {
    console.error('Git commits error:', error);
    res.json({ error: error.message });
  }
});

// Fetch from remote (using smart remote detection)
router.post('/fetch', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin'; // fallback
    try {
      const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      remoteName = stdout.trim().split('/')[0]; // Extract remote name
    } catch (error) {
      // No upstream, try to fetch from origin anyway
      console.log('No upstream configured, using origin as fallback');
    }

    validateRemoteName(remoteName);
    const { stdout } = await spawnAsync('git', ['fetch', remoteName], { cwd: projectPath });

    res.json({ success: true, output: stdout || 'Fetch completed successfully', remoteName });
  } catch (error) {
    console.error('Git fetch error:', error);
    res.status(500).json({ 
      error: 'Fetch failed', 
      details: error.message.includes('Could not resolve hostname') 
        ? 'Unable to connect to remote repository. Check your internet connection.'
        : error.message.includes('fatal: \'origin\' does not appear to be a git repository')
        ? 'No remote repository configured. Add a remote with: git remote add origin <url>'
        : error.message
    });
  }
});

// Pull from remote (fetch + merge using smart remote detection)
router.post('/pull', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    validateRemoteName(remoteName);
    validateBranchName(remoteBranch);
    const { stdout } = await spawnAsync('git', ['pull', remoteName, remoteBranch], { cwd: projectPath });

    res.json({
      success: true,
      output: stdout || 'Pull completed successfully',
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git pull error:', error);

    // Enhanced error handling for common pull scenarios
    let errorMessage = 'Pull failed';
    let details = error.message;
    
    if (error.message.includes('CONFLICT')) {
      errorMessage = 'Merge conflicts detected';
      details = 'Pull created merge conflicts. Please resolve conflicts manually in the editor, then commit the changes.';
    } else if (error.message.includes('Please commit your changes or stash them')) {
      errorMessage = 'Uncommitted changes detected';  
      details = 'Please commit or stash your local changes before pulling.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (error.message.includes('diverged')) {
      errorMessage = 'Branches have diverged';
      details = 'Your local branch and remote branch have diverged. Consider fetching first to review changes.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Push commits to remote repository
router.post('/push', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project id is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentBranchName(projectPath);

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    validateRemoteName(remoteName);
    validateBranchName(remoteBranch);
    const { stdout } = await spawnAsync('git', ['push', remoteName, remoteBranch], { cwd: projectPath });

    res.json({
      success: true,
      output: stdout || 'Push completed successfully',
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git push error:', error);
    
    // Enhanced error handling for common push scenarios
    let errorMessage = 'Push failed';
    let details = error.message;
    
    if (error.message.includes('rejected')) {
      errorMessage = 'Push rejected';
      details = 'The remote has newer commits. Pull first to merge changes before pushing.';
    } else if (error.message.includes('non-fast-forward')) {
      errorMessage = 'Non-fast-forward push';
      details = 'Your branch is behind the remote. Pull the latest changes first.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (error.message.includes('Permission denied')) {
      errorMessage = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (error.message.includes('no upstream branch')) {
      errorMessage = 'No upstream branch';
      details = 'No upstream branch configured. Use: git push --set-upstream origin <branch>';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

export default router;
