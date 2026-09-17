# Desktop server file-list OOM — 2026-09-15

## Report and reproduction

The beta.18 desktop server aborted with signal 6 after about 26 minutes.
The attached stderr ended with `Reached heap limit` / `JavaScript heap out of
memory`; V8's final collections retained roughly 4 GB. The native stack included
`StringSubstring`, `ArrayMap`, and a directory-read completion.

The project file endpoint eagerly created recursive `Promise.all` work for every
entry. Its 64-operation filesystem semaphore limited active I/O, but neither the
waiting promises nor the retained tree. Opening another session aborted the
client fetch without stopping the server's traversal. Runtime-generated
`.gjc/_session-*/runtime` directories were included in the tree.

A read-only probe of the original walker against the affected working directory
reproduced 68,794 queued filesystem operations and 163 MB of JS heap in 252 ms.
Several runtime directories contained thousands of entries (one had 20,227).
The probe deliberately stopped above 160 MB; it did not wait for another OOM.
The repeated `SESSION_PROJECT_MISMATCH` errors in the report are rejected before
file traversal and are not evidence that those rejected requests allocate trees.
No heap snapshot was available to attribute every retained byte at the crash.

## Change

- Read directories incrementally with `opendir`, traversing depth first with
  one outstanding filesystem operation per scan and a maximum depth of ten.
- Exclude `.gjc/_session-*` scratch directories and `.gjc-worktrees`; retain
  project configuration and skills under `.gjc`.
- Limit each scan to 20,000 visited entries, 8 MiB of serialized node data
  (including reserved tree punctuation), and 15 seconds between I/O completions.
  Return HTTP 413 `FILE_TREE_TOO_LARGE` or 503 `FILE_TREE_TIMEOUT` instead of a
  silently incomplete tree. Existing file-mention/search callers treat non-200
  responses as an unavailable file list; the chat remains usable.
- Admit at most four scans; excess requests receive 503 `FILE_TREE_BUSY` without
  entering a waiting queue. The old `FS_CONCURRENCY` setting no longer applies.
- Cancel on HTTP disconnect, closing directory handles before releasing the
  handler's desktop activity ownership. An already-issued disk operation must
  settle before its scan slot is released; a stuck filesystem is not certified
  idle merely because a timer elapsed.
- Filesystem suggestions read immediate directories only; previously
  `maxDepth=1` also read every child's contents. Hidden directories stay in the
  payload because the folder browser owns the show-hidden toggle.

## Verification

- Nine focused tests cover metadata/sorting, dotfiles and scratch exclusions,
  symlinks, shallow suggestions, a lazy million-entry directory, the UTF-8 byte
  budget, timeout, handle closure, concurrency saturation, and HTTP cancellation
  with desktop handler ownership retained until disk work settles.
- The fixed walker completed ten successive scans of the same affected project
  (3,016 returned nodes, 767,048 JSON bytes per scan) in 632 ms total. Peak sampled
  JS heap was 26 MB with Node's heap capped at 128 MB. The original measurement
  was a single interrupted scan, so these are bounded-workload observations,
  not a long-running desktop soak or a general memory-leak guarantee.
- Type checking and focused ESLint passed on macOS Apple Silicon, Node 22.23.1.
- An isolated production HTTP-server smoke used temporary HOME/database/session
  directories and a 128 MB heap. Three requests for a real 20,010-file directory
  each returned 413 `FILE_TREE_TOO_LARGE`; health and ordinary file-list requests
  still returned 200 afterward. The same smoke checked shallow suggestions and
  preservation of `.gjc/skills` while excluding runtime scratch. It did not start
  agent runs or modify the installed desktop app's data.
- Full `npm run verify` passed: dependency integrity/audit/licenses/notices,
  TypeScript, Rust core formatting/Clippy/tests, Node and Bun test suites,
  ESLint, identity checks, and production client/server/native builds.
