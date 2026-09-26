# gajae-app v2 — Session Handoff (resume state)

## Why the installed beta.18 never restarts into beta.20 (2026-09-26)

The owner's Mac still runs beta.18 (desktop 0.2.12). Its updater journal
(`~/Library/Application Support/app.gajae.desktop/updater-restart.jsonl`)
shows the download side works (the 0.2.14 archive is verified in
`desktop-update-cache`, `ready.json` present) and that **every Restart to
install click since 0.2.10 aborted at `backend-prepare`**: 21 attempts across
0.2.10→0.2.11, 0.2.11→0.2.12 and 0.2.12→0.2.14, 8× `updater_runtime_unknown`
and 13× `updater_runtime_busy`. The only completed update on record is
0.2.6→0.2.8 under the old automatic policy.

The journal did not say which owner refused. A harness
(`/tmp/gjc-restart-harness/harness.mjs`, stands in for the shell's two native
sockets and drives the real server's prepare) reproduced it against the same
`~/.gajae-app`: `orchestrator owner_incomplete/owner_unknown`,
`native-jobs owner_failed`, `native-clients owner_busy`. Cause: the
long-lived `gajae-dev` stack's `gajae-core jobs` (running since 09-25 20:56)
holds the exclusive `~/.gajae-app/jobs.sqlite3.lock`, so the desktop app's
jobs authority never comes up and prepare is `unknown`; the `busy` retries
are `ingress_busy` from clicking again while the restored SPA was still
loading. With a private database copy the same server prepared 4/4.

Landed: `restartControlResult` now carries `blockers` (server → native, exact
key, ≤32 owner/code identifiers, empty on success), native journals a
`backend-refused` record with them, and the evidence collector exports them.
AGENTS.md and DESKTOP-INCIDENT-DIAGNOSTICS.md name the lock conflict. Not
changed: where the desktop app keeps its database (sharing `~/.gajae-app`
with a dev server is the actual hazard; splitting it is an owner decision).
On beta.18 the fixed-in-beta.20 session-watcher restart loop can still add
transient `watchers owner_busy`; a retry a few seconds later passes.

Same day, owner decision: the dev stack now runs on its own database
(`DATABASE_PATH=$HOME/.gajae-app-dev/auth.db`; `auth.db` copied once,
`jobs.sqlite3` fresh) so `~/.gajae-app` belongs to the desktop app alone.
`/tmp/gjc-dev/README.md` and AGENTS.md carry the new command. Verified after
the restart: dev server healthy with its jobs authority,
`~/.gajae-app/jobs.sqlite3.lock` free. Result of the next clicks (17:07 KST, 5 attempts): two `busy` right after
launch, then **`backend-prepared` passed three times** — the database-lock
cause is gone — and each aborted 30–2000 ms later as `updater_owner_unknown`
from `capture_owned_server`. The native same-user census (516–524 BSD
identities, 78 bundles here) requires two identical full scans plus a
revalidation inside a 2 s budget; on this Mac it passes 2 of 5 runs in
isolation (`read_only_real_mac_census_smoke`) and 0 of 3 inside the app,
where the app's own server also spawns `gajae-core git` children. A 10 s
`ps` diff showed about one unrelated birth/exit per second (Spotlight
`mdworker_shared`, iCloud helpers, `git`). Production journals did not
record the scanner's reason (QA-debug only); `000363d`+ adds an
`owner-refused` record with the fixed sentence as `detail`, exported by the
evidence collector.

Open owner decision for beta.21: the census-stability rule ("unrelated
PID/path churn makes the proof unknown", no retry) is documented policy in
`updater_owners.rs` and `DESKTOP-UPDATE-FAILURE-BETA14.md`, and it makes
click-update unreachable on a developer Mac. Candidates: (a) bounded retry
of the census inside a longer budget, (b) stability required only for
product-bundle and reserved-role processes, with unrelated foreign births
classified in the later pass. Until then the installed app updates by
manual DMG.

Follow-up for beta.21 (owner-approved direction, not started): move the
desktop app's database under its own data root
(`app_local_data_dir`, where the updater journals already live) with a
one-time migration from `~/.gajae-app`, so the collision cannot recur for
any user who also runs the self-hosted server.

## CLI-parity adversarial pass on SDK 0.17.6 (2026-09-25)

The same prompts ran through the app's public WebSocket (`chat.send`, the path
the browser uses) and `gjc -p` in one fixture repo, which was reset between
runs. Four defects surfaced and were fixed on
`fix/cli-parity-credential-thinking-watcher`:

- **Account selection (blocker).** With several stored rows for a provider,
  the adapter pinned the lowest row id. For Anthropic that was an account
  whose organization refuses OAuth, so every app turn failed with 403 while
  the CLI answered: the runtime's own selection honours `gjc accounts pin`,
  routing exclusions and usage-limit rotation. The app now pins only an
  explicit `credentialId` and reports the row the runtime chose.
- **Reasoning arrived only at the end of the phase.** The CLI streams
  reasoning deltas. The app now sends `thinking_delta` previews into one live
  row per session, and the `thinking` record replaces it. It is visible
  under the Detailed density. Balanced and Compact hide reasoning by design
  and show the `Thinking… Ns` indicator.
- **Native session watcher restart loop.** macOS reports a metadata change on
  the session-scope directory for every atomic transcript write. The watcher
  treated each as a new directory and rescanned 25k entries, overflowed its
  4096 bound and restarted into a full reconciliation (16 restarts in a few
  minutes of dev). It now backfills only created or renamed directories.
- **Tests wrote into the operator's crash journal.** Bun test files now get a
  throwaway `HOME`. Eight of the twelve post-0.17.6 "crash" records were
  test runs.

Parity confirmed: edit+bash result and diff, project `AGENTS.md` rules, the
skill list, user-scope MCP (none), `task`/`subagent` delegation, large bash
output (same 8 MiB spill), multi-turn memory, abort mid-bash (no orphan
process), resume, steering mid-run, three concurrent sessions (24 s wall for
3×10 s sleeps), and `/fast` `/effort` `/context` `/usage` `/tools`, which run
in the app but not under `gjc -p`. Latency for the same one-word turn: app
11.6–11.9 s, CLI 13.5–13.8 s (the CLI pays process start).

Intentional gaps (see `server/gjc-agent-tools.ts`): no `python`/`eval`,
`job`/`monitor`, `github`, `debug`, `checkpoint`/`rewind`, tool discovery or
`move_session`. Project `.gjc/mcp.json` and extension modules do not load.

Observed, not fixed:

- ~~`ChatInterface` calls `sessionStore.setActiveSession` during render~~ —
  fixed 2026-09-26: `useChatSessionState` marks the observed session from a
  layout effect (still ahead of the history fetch effect), and a DOM test
  renders the store owner above the hook and asserts no cross-component
  update warning.
- Zero-delay synthetic typing (puppeteer) after a reload trips "Maximum
  update depth" in the composer's `resize`. It does not reproduce at a 10 ms
  keystroke delay.

Issues:

- #160 is answered: the tier is the runtime's, as in the CLI. It comes from
  `serviceTier` (default `none`) or per-session `/fast`, and the app pins
  none. Checked live: no tier, then `priority` after `/fast on`, then none
  after `/fast off`.
- #158 stays open. 0.17.6 fixed denials and non-zero bash exits, but hook
  refusals and tool input errors are still recorded (upstream
  [#5938](https://github.com/Yeachan-Heo/gajae-code/issues/5938)).
- #162 stays open for usage polling only: 29 processes, 89×429 in about six
  hours (upstream [#5939](https://github.com/Yeachan-Heo/gajae-code/issues/5939)).
  MCP timeouts, `Invalid port` and the `notify` collision are gone.

**beta.20 / desktop 0.2.14 was published 2026-09-25T19:49:45Z** (release
`396880985`, source `9fc9287`). It was signed, notarized and accepted locally,
including GUI QA-profile acceptance. See [RELEASE-BETA20.md](RELEASE-BETA20.md).
Signing over SSH works once the login keychain is unlocked inside the build's
tmux server; the owner types the password there.

## Post-beta.14 checkpoint — beta.15→19 shipped, checkout isolation closed (2026-09-19)

Five releases shipped without a handoff entry; release notes and published
facts are now recorded per release:

| Release | Desktop | Published (UTC) | Release ID | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| beta.15 | 0.2.9 | 2026-09-13T07:50:45Z | 387829613 | `883ce6a` | CLA, linux-arm64 bootstrap, mobile keyboard fix, history-index caching, website macOS-only |
| beta.16 | 0.2.10 | 2026-09-13T11:20:53Z | 387875236 | `281287a` | [RELEASE-BETA16.md](RELEASE-BETA16.md) |
| beta.17 | 0.2.11 | 2026-09-14T03:28:39Z | 388130063 | `0f0b5b6` | [RELEASE-BETA17.md](RELEASE-BETA17.md) + acceptance |
| beta.18 | 0.2.12 | 2026-09-14T08:06:04Z | 388226403 | `48a6212` | [RELEASE-BETA18.md](RELEASE-BETA18.md) — docked built-in browser, proxy presets, updater staleness |
| beta.19 | 0.2.13 | 2026-09-18T13:18:04Z | 391484917 | `9f47ead` | [RELEASE-BETA19.md](RELEASE-BETA19.md) — 38 PRs: security hardening, worktree isolation, runtime policy |

Beta.18/19 release docs are post-hoc: they record tag contents, asset SHA-256s
and the updater manifest, and explicitly do not claim CI/notarization/smoke
receipts — those drills were not recorded for these two releases.

The beta.19 batch closed the checkout-isolation arc for issue #156: managed
worktrees by default with the run-location picker (#166), shared-checkout
rewrite approval (#167), branch/worktree reaping (#174), and — on 2026-09-19,
after the release — the checkout-escape guard (`0c5e6aa`): a worktree run now
owns git state only under its own checkout root; `git -C ../..`, `cd
<repo> && git push` and `--git-dir`/`GIT_DIR` redirects that leave it ask
first, with a distinct notice. #156 is closed.

2026-09-19 session also: verified #158 (crash recorder misclassification) and
#162 (boot noise) against 0.16.4, published 0.17.2 and upstream `dev` @
2026-09-19 — none of it fixed upstream — and filed
[Yeachan-Heo/gajae-code#5718](https://github.com/Yeachan-Heo/gajae-code/issues/5718)
and [#5719](https://github.com/Yeachan-Heo/gajae-code/issues/5719); both repo
issues stay open pending upstream. The superseded
`gajae-desktop-server-oom` worktree and its `codex/fix-desktop-server-oom`
branch (content landed as #113) were removed.

Still open in this repo: #160 (serviceTier Settings exposure vs documented
fixed — owner product decision) and #158/#162 (upstream). PR #44 (Windows)
was already closed on 2026-09-16; Windows desktop stays out of scope.

2026-09-25: beta.20 is being batched rather than cut for `0c5e6aa` alone.
First item: SDK 0.16.4 → 0.17.6 on `chore/gjc-sdk-0.17.6`. The lifecycle
patch is ported (32 files, 209 edits, none dropped; per-edit decisions in
`patches/gjc-sdk-lifecycle/README.md`), agent/project/settings extension
modules stay out of app sessions, and a delegated `task` with an unknown
`model` key now runs on the parent model instead of being rejected (0.17.6
strips unknown keys before the app sees them). The built-in preset copy is
regenerated from 0.17.6 (17 missing presets added) and pinned by
`server/builtin-model-profiles-contract.bun.test.ts`. Upstream fixes for
#158 (`Yeachan-Heo/gajae-code#5743`) and #162 (`#5745`) are contained in the
v0.17.4 and v0.17.6 tags; close both after the bump is observed live. Full
`npm run verify`, `server:payload:macos` and `src-tauri` cargo test
(382 + 11) pass on the branch. #175 (Windows timeline) answered and closed
as not planned. The `/Applications` copy on the primary Mac is beta.18
(0.2.12), not beta.14 as stated below.

**Published and installed: v2.0.0-beta.14 / desktop 0.2.8**, source `60c98e3`,
release `386182917`, `updateMode: production`. It supersedes beta.13, whose
binary shipped with the updater compiled out (`RELEASE-BETA13-ACCEPTANCE.md`);
the release build now fails without an explicit mode, the verifier refuses a
non-production updater binary, and a disabled successor no longer blocks
startup. beta.12 clients are offered 0.2.8 directly; beta.13 users need one
manual DMG. PR #53 is merged; PR #44 (Windows) stays open with conflicts. See
[RELEASE-BETA14-ACCEPTANCE.md](RELEASE-BETA14-ACCEPTANCE.md).

Post-beta.14 follow-ups (2026-09-10): the updater key backup is complete —
hash-verified iCloud Drive copy, a passing restore/sign/verify test from
that copy, and the password recorded independently of this Mac
(`scripts/release/UPDATER-KEY-CUSTODY.md`). The website no longer
advertises the Linux desktop app (deb/AppImage links and stale
macOS-or-Linux metadata removed; the Linux server archive stays).

Deferred by owner decision (2026-09-10): administrator cancel/recovery,
process ownership and real macOS 13 execution updater scenarios stay
disclosed known limitations, not active work — address them on a user
issue/PR. `minimumSystemVersion: 13.0` stays declared.

**Installed: v2.0.0-beta.12 / desktop 0.2.6**, source `48fffce`.
Release `385189777` contains the signed/notarized macOS DMG and click-update
archive/manifest plus same-source Linux server/desktop artifacts. The installed
Applications copy runs in production update mode at the prior local origin;
beta.11 is preserved as a local binary backup. PRs #49/#50/#51 are merged.
Extended future-version update/OS13/authority scenarios remain explicitly
disclosed beta follow-up work, per the user's publication instruction.
See [RELEASE-BETA12-ACCEPTANCE.md](RELEASE-BETA12-ACCEPTANCE.md) for exact evidence.

Latest updater policy: the user requested a bottom-left notice above Settings
and explicit Update clicks instead of automatic installation. Discovery is
checks-only; download and safe restart bind the clicked native target. Cached
bytes/automatic=true no longer authorize a next-launch install. See
[DESKTOP-CLICK-UPDATE.md](DESKTOP-CLICK-UPDATE.md). The delivered beta.11 DMG is
unchanged and does not yet contain this follow-up.

Latest user-test installer: **beta.11 / desktop 0.2.5**, built from `e28fa6d`,
signed/notarized/stapled and delivered to Downloads. Final copied-app server,
data-survival and actual isolated GUI quit/reopen/draft/image/settings checks
passed. This is a **manual-install, updater-disabled private test DMG**, not a
public updater release; the existing production installation was not changed.
Artifact hash, exact source and limits: [RELEASE-BETA11-TEST.md](RELEASE-BETA11-TEST.md).

Production updater key: local encrypted-file + login-Keychain provisioning and
sign/verify/negative checks passed on September 9. Do not regenerate it.
Independent external backup and release gates remain open. Exact local metadata
and limits: [UPDATER-KEY-CUSTODY.md](../scripts/release/UPDATER-KEY-CUSTODY.md).

Latest signed qualification: [DESKTOP-UPDATER-SIGNED-QA.md](DESKTOP-UPDATER-SIGNED-QA.md).
Same-source f69ec4f release-mode A/B are notarized and Gatekeeper-accepted. The
actual signed next-launch automatic A → B transition, Off/on behavior, byte-exact
transcript/draft/queue/image/config survival and normal B reopen passed on
September 9. QA processes are stopped and fixture/journal evidence is retained.
Public deployment and its remaining authorization/OS13/key-custody gates are
not complete; the production installation was not changed.

Post-QA security updates raise Multer/YAML floors and apply a separate
integrity-checked upstream ZIP symlink-leaf backport through installation,
audit and both packaging lanes. Clean npm ci and the full verify gate pass.
This delta is not in the frozen f69ec4f signed pair; final public artifacts
must be rebuilt. See the signed QA record for the bounded patch/audit scope.

Last updated: 2026-09-09 (same-source signed automatic A → B and data preservation passed). Supersedes the 2026-07-18 handoff; historical sections remain below.

## Scope decision — macOS first, Linux desktop excluded (2026-09-09)

The owner excluded the Linux desktop app from development until the macOS
app is complete. Consequences, all landed the same day:

- `.github/workflows/desktop-linux.yml` is `workflow_dispatch` only; it no
  longer runs on PRs or pushes and does not gate merges.
- New `.github/workflows/desktop-macos.yml` (PR/push-main, `macos-14`) is
  the desktop shell gate: `server:payload:macos`, `cargo fmt --check` +
  `cargo test --locked` for `src-tauri`, then an ad-hoc `tauri build
  --bundles app` with a bundle inspection. This replaces the `src-tauri`
  coverage the Linux lane used to provide.
- AGENTS.md carries the rule. Linux desktop items in the updater handoff
  (Ubuntu package/GUI smokes, AppImage runtime restore) are historical
  evidence, not remaining work. The Linux *server* archive (self-host) and
  its `server-linux.yml` lane stay in scope. Release assets: Linux desktop
  deb/AppImage were already optional in `updater-artifacts.mjs`; future
  releases ship macOS DMG/updater + Linux server archive only unless the
  owner asks otherwise. Website download links for Linux desktop should be
  dropped at the next release (not changed retroactively for beta.12).

## Post-beta.12 checkpoint — external PRs landed (2026-09-09 afternoon)

- **#43 merged (`f6a288a`), closes #42.** Persisted goal inspection is
  read-only: `inspectGjcGoal` uses `listForResumePickerReadOnly` +
  `captureTranscriptStrict`, validates an in-memory copy with
  `inspectSessionTailReadOnly`, projects the current branch with
  `parseSessionEntries`, and never constructs a `SessionManager`. Verified
  RED (8/9 fail on the previous adapter) → GREEN (9/9), full SDK contract
  suite 113 pass. Conflict resolution kept main's `#assertAdmission` /
  `#withOperation` admission wrapper.
- **#41 merged (`62fb413`).** Visible-row history pagination (tool results
  no longer consume offsets; deep offsets reachable; unbounded `/messages`
  reads past 5,000 visible rows are 413 `HISTORY_PAGE_TOO_LARGE`), viewport
  anchoring across prepends, ID-aware Query structural sharing, no auto-retry
  on failed pages. The maintainer follow-up `f2f4f16` closed the review
  blockers: `fetchToolResult` and export page through
  `fetchCompleteHistory` instead of the unbounded read; the provider retries
  a changed transcript 3× before 409 `HISTORY_CHANGED`; missing transcript →
  empty window; `fetchMore` returns `{ failed: true }` only for a real
  failure; "Get earlier / Get all messages" stay reachable while
  `hasMoreMessages`; pointer-down stops following only on the scrollbar
  track; scroll anchor re-observes only on row-set change; dead locale keys
  and `sliceTailPage` removed. Both known follow-ups closed 2026-09-10:
  the provider now keeps a 16-entry LRU lineage+descriptor index cache per
  (path,size,mtime) — warm page reads skip the lineage/index passes
  (measured 24 ms cold → 4-5 ms warm on a 1 MB / 2.2k-row transcript) — and
  the ~2k-row fully loaded session was measured headless (Chrome for
  Testing 152, 1440×900): 550 turns / ~2.2k visible rows / 21.7k DOM nodes
  load in ~0.6 s with two longtasks (longest 527 ms at the load-all commit),
  then scroll top→bottom (159k px) with zero frames over 50 ms (max 17 ms)
  and 64 MB JS heap. Caveat: rows were plain text; syntax-highlight-heavy
  sessions were not measured.
- **CLA gap:** `@snowykr` has six merged PRs (#25, #27, #28, #35, #41, #43)
  and no entry under `CLA.md` § Signatories; a request is on #43, and a
  reminder was posted there 2026-09-10. Waiting on the contributor.
- Still open: #44 (owner's draft Windows preview branch, 72 files,
  conflicting, 128 commits behind main, pinned at beta.9). #3 was closed
  2026-09-10 as addressed-by-design: the follow-up implementation covers the
  analyzed root causes, while live Cursor/Anthropic qualification stays
  excluded and moves to fresh user reports.

## Follow-up checkpoint — SDK32 and durable notification handoff

`4fb43c2` remote Node 22/24 and Linux server/desktop/package/GUI checks all passed.
The next work expands the exact 0.16.4 SDK patch to 32 files, physically joins
built-in provider tails and the actively enabled default WebSocket host, and
lets supported normal sessions become idle after actual cleanup. Unsupported
opaque features remain unknown; source hashes alone are never quiescence.
Clean `npm ci`, the regenerated runtime manifest, and a shared file-count policy
connect all 32 files to worker/native validation.

macOS notification links now survive startup/recovery/process replacement in a
separate bounded durable queue. Actual QA uncovered and fixed an HTTP/ws bind
failure that skipped automation-socket cleanup. The new packaged app removes
its socket on failure, preserves pending links in recovery, then delivers both
after a normal reopen without re-supplying URLs. Native tests: 318 + 10 pass;
whole verify passed. Evidence and exact remaining limits are in the top section
of [the updater handoff](MACOS-UPDATER-HANDOFF.md). This is debug/ad-hoc QA, not a
signed same-source release or production activation; the full deployment goal remains open.

## Current checkpoint — private actual restart passed, not release acceptance

About's `Update and restart` now actually upgrades the isolated A10 (beta.10 /
0.2.4) to B3 (beta.11 / 0.2.5), restarts it and commits successor health. The
automatic preference remains false. Old native/server/core identities exited;
the successor is native PID 7560/server 7766 with a schema-2 completion marker.
Installed Info.plist and strict/deep code-signature verification pass. The same
origin, Scratch project, unsent text and SVG preview remain. A read-only actual
IndexedDB check confirms schema 2, revision 51, one 172-byte attachment and its
original SHA-256 (`B3-after-update-bytes-ax.txt`).

Evidence: `/private/tmp/gajae-native-restart.wupMI0/`, especially `A10-stderr.log`,
`A10-manual-cycle.jsonl`, `B3-after-update-ax.txt` and `.png`. These are ad-hoc/debug
apps with a dedicated QA updater key. B3 predates A10's final native sequencing
change, so this is not final same-source signed/notarized qualification or a
public release. Normal Quit/reopen also preserves beta.11, origin/project/draft/
attachment preview (`B3-normal-reopen-ax.txt` and `.png`). Broader authenticated/
transcript/queue data acceptance, production activation and remaining release
gates still need work. QA fixtures/logs are retained, not installed over production.

### Earlier failure and implementation checkpoints

Parent-reported pushed HEAD is `721806d`; the native-restart transaction above it
is uncommitted WIP (about 35 files at handoff; concurrent work can change this).
The transaction now connects native challenge/draft seal, Applying/page teardown,
authenticated backend prepare/commit, owned-tree shutdown and durable manual restart intent.
Execution remains exact compile-bound **QA-only**, not production activation.
Native payload and archive checks now share the strict schema-2 runtime parser.
Source, evidence and remaining gates: [macOS updater handoff](MACOS-UPDATER-HANDOFF.md).

Evidence root: `/private/tmp/gajae-native-restart.wupMI0/`. `verify-final.log`
records full `npm run verify` (parent exit 0); `native-tests-final-rerun2.log`
has 307 desktop Rust passes / 5 ignored plus 10 binding passes.
`native-clippy-final.log` passed before later minor QA diagnostics/test-fixture
changes. These are bounded checkpoints, not validation of the evolving worktree.

Attachment-bearing GUI A4–A7 fail on File/Blob `NotFoundError` **before backend prepare**;
no successful actual manual restart is recorded. An isolated same-app quit/reopen
probe first reads both Files and ArrayBuffer at 172 bytes; rewriting the retrieved
record breaks retained and freshly loaded Files while ArrayBuffer stays readable.

For a text-only follow-up, the parent backed up isolated home/browser under the
real profile lease to `A7-profile-before-codec/` in the evidence root, then removed
only the current QA fixture attachment (source fixture/backup retained).
That home/browser backup does not include the separately UUID-isolated WebKit
store; restoring it does not restore IndexedDB attachments. Legacy migration QA
must create the fixture again through the older app.
`A7-reopen-stderr.log` reaches backend prepare → prepared → Applying → cancelled,
not commit/restart. A JS auto-cancel after fetch rejection during expected Applying
navigation is the likely self-cancel race. The new bridge/test sends no automatic
cancel after prepared ACK dispatch; the seal waits for native abort confirmation
and native owns the deadline. Subsequent A8 text-only attempts defer on owner
capture/revalidation, not a successful commit or app replacement. The byte-backed
codec is implemented; the parent's five codec/freeze/bridge suites pass 123 tests.
Native follow-up clippy/tests also pass (307 + 10, 5 ignored). These do not replace
fresh combined verification and actual A→B with attachment byte checks. Matching
private QA payloads were rebuilt; temporary version overrides are restored, not a release.
Actual A8 → A9 legacy attachment migration is verified in `A9-migrated-draft-ax.txt`:
schema 2, expected draft, one 172-byte attachment with the original SHA-256.
`verify-codec-union.log` is full verify exit 0. A9 still defers at backend commit;
A10 moves page teardown before prepare without weakening generation checks.
Its native clippy/tests pass, but A10 → B3 is incremental QA, not final same-source acceptance.

The goal remains automatic update **and public deployment**. Production
activation/owner qualification, key custody/backup, signed/notarized same-source
A→B, actual macOS 13, G0 approval/cancel/writer-exit proof, deep-link buffering,
SDK streaming/extension tails and full G3/G5 remain open. A verified SDK source
patch is not full SDK quiescence. The user-active `/Applications` app and its
data are outside this docs-only pass; no Git, runtime, build or GUI actions.

## Current task scope

PRs #30, #35, #38 and #39 are merged. The owner has excluded OMG skill testing;
do not carry cross-model or user-skill execution forward as required remaining
work. Historical issue #3 is not thereby proven resolved. App-owned tool-result
delivery, desktop persistence and release artifacts remain in scope.

**Beta.10 is published, not just a candidate:** GitHub release `383970740`,
published September 7, 2026 at 19:52 KST. Tag `v2.0.0-beta.10` points to
`4979b2c49f54f79c51bf4f72cdca59c7b98ed44f`; desktop version is `0.2.4`.
PR #45's updater preparation and PR #46's UI-inclusive manual release are
merged. The composer Project/worktree selector and new-goal creation controls
are removed; the model/reasoning picker is compact. Active goal controls and
existing worktree-session behavior remain. Earlier UI-excluded candidates were
never published. See `RELEASE-BETA10-ACCEPTANCE.md` for artifacts and acceptance.

This is a **manual-install, updater-disabled** release. Automatic installation
and restart, remaining updater G0 authority/cancellation qualification, and
actual macOS 13 execution are not completed by it. GUI testing used macOS
26.6.2 and isolated QA profiles; production app data and provider grants were
not changed. The older session records below are historical.

## TL;DR

- **Unreleased updater work** includes preparation controls, the earlier private
  next-launch A→B, and a now-passing private About-button A10 → B3 native restart
  with exact attachment-byte preservation. This is incremental debug QA, not final
  signed same-source acceptance. Production install/restart
  remains gated and no updater-enabled release is published. See the current
  [updater checkpoint](MACOS-UPDATER-HANDOFF.md), not the older progress records.

- **Unreleased follow-up: one task surface.** The right-hand Tasks tab and the
  chat column's own `ChatTasksPanel` are both retired; the agent sidebar's WORK
  rail (`AgentSidebarWork`) is the only place the session's live todo list is
  rendered, so an open rail no longer repeated the same checklist above the
  transcript. The todo projection hook stays under
  `src/components/chat/hooks/useSessionTodos.ts` and now feeds the rail. This
  source change is **not included in the published/installed beta.10** and
  requires a new build/release to reach that desktop installation.
- The same unreleased UI follow-up also hides routine `Auto-approved …`
  information notices in the chat projection. Raw records, permission policy,
  approval controls, warnings and errors are unchanged.
- Unreleased browser/runtime fixes additionally support top-level `await` in
  page scripts and pass project bypass mode to browser/computer access checks.
  Bypass does not save grants or answer real questions; Ask/auto-edits,
  first-download consent and OS restrictions remain. See
  `BROWSER-CUA-VERIFICATION.md` for the scope and regression evidence. These
  fixes likewise require a new desktop build; beta.10 has not been overwritten.
- A separate unreleased browser-panel follow-up auto-reveals newly active
  browser tabs in the selected conversation using a metadata-only observer.
  Saved widths now follow window/sidebar resizing; viewport synchronization
  survives initial status races and reconnects, and input follows the loaded
  frame. Shared browser state types/validation replace duplicated contracts.
  See `BROWSER-CUA-VERIFICATION.md` for regression and visual evidence. No new
  installer was produced and the installed beta.10 app remains unchanged.

- **The v2 baseline is complete.** Server/backend/web MVP (Slices 0–4 + 6), the Tauri
  desktop shell (Slice 5 C1–C6), **and the C7 interactive GUI smoke** are all
  done and verified. Electron is removed (C9/wave1); the C8 rollback drill is
  void (no rollback target; its data-survival axis is covered by the automated
  two-boot smoke, re-proven on the final build).
- **Post-v2 work has also landed.** Managed Chromium/CDP Development Preview
  landed in `b37bec7` (`src/components/workspace/view/BrowserPanel.tsx` and
  `server/modules/automation/browser-sidecar.ts`); context/token controls
  landed in `ac9b819`
  (`src/components/chat/view/subcomponents/ContextUsageBadge.tsx`). The
  2026-09-02 session-UI pass (tool output density, four-state session status,
  sidebar search, concise titles, per-project permissions, turn work block,
  composer Stop / Esc) is recorded below.
- **`v2.0.0-beta.8` is published (2026-09-03 23:50 KST).** Same-day
  follow-up carrying the fresh-account test fixes: desktop sign-in links
  (sidecar open-url), the damaged-image root cause, model picker
  availability/search, first-turn model pin, stream-delta merge, Tasks tab,
  Copy debug info, Chromium download card, empty-workspace sidebar, composer
  focus on New work item. Cut `5cdbfbc`+`2f58f27`; notarized DMG
  (SHA-256 `d4484b20…bad2d8`) replaced the CI asset; notes hand-written.
- **`v2.0.0-beta.7` is published (2026-09-03) as the first MIT release and
  the first notarized macOS image — and its DMG was replaced once at 19:15
  KST.** The 16:20 image said “damaged” after install: a Hangul bin link
  (`node_modules/.bin/가재씨`) came back from the HFS+ image with a
  different Unicode normalization than the code signature sealed. Fixed in
  the payload builder (drop non-ASCII bin links, refuse other non-ASCII
  paths), the DMG (APFS), and every acceptance path (verify a copy out of
  the mount, not just the mount). Current asset SHA-256
  `328db060…b1d759`, 221972348 bytes. Cut at `d84a9d3`; the
  release workflow (run 33727451679) created the tag and the Linux server
  tarball, then the locally built, Developer ID-signed, notarized and
  stapled DMG (SHA-256 `f0659df0…44c55`, 227303972 bytes) and its
  `.sha256` were uploaded over the runner's ad-hoc image; the download was
  re-verified (checksum, `stapler validate`, Gatekeeper). Release notes
  are hand-written (MIT, permissions default, removals, session UI, fixes).
  Record: `docs/DESKTOP-TAURI-VERIFICATION.md` § beta.7. Lesson recorded
  there: `APPLE_SIGNING_IDENTITY` must be in the environment of *every*
  packaging step; an ad-hoc DMG is accepted by notarytool but rejected by
  `spctl -t open`.
- v1 users are served by the frozen snapshot repo **`devswha/gajae-app-v1`**
  (cut at v1.0.0, release assets mirrored). Maintenance flows one way:
  this repo → cherry-pick to the snapshot.

## Working environment

- **This checkout is** `~/workspace/gajae-code-app` (repository guidance:
  `AGENTS.md`). Node via nvm
  (`. "$HOME/.nvm/nvm.sh" && nvm use 22`
  → 22.23.1 — `npm test` refuses other majors). Bun **exactly 1.4.0**
  (`dist-native/bun` or `node scripts/fetch-bun.mjs`). cargo 1.85.1
  (`. "$HOME/.cargo/env"`). Unset `CARGO_TARGET_DIR` if it points at a
  sandbox cache. `env -u CI npm run tauri -- build` (the wrapper chokes on
  `CI=1`).
- Server binds loopback; `SERVER_PORT` defaults to 3001, Vite to 5173.
  **Do not export `SERVER_PORT=0`.** The 2026-09-02 session used
  `SERVER_PORT=3101 VITE_PORT=5273`.
- Origin: `https://github.com/devswha/gajae-code-app`. The independent public
  history begins from the verified `2.0.0-beta.1` baseline.
- Commits use the repository hooks and must also pass `npm run verify`.
  Packaged smokes must run out of tree; an in-place smoke under
  `src-tauri/target/…` can resolve the repository's `node_modules` and lie.

## 2026-07-19/20 session record (this run)

Ultragoal `.gjc/_session-019f7b3a-ad0b-7000-ba19-06c7d84a47b8/ultragoal/`
(goals.json + ledger.jsonl; receipts for every checkpoint):

| Goal | Scope | Status | Commits |
|---|---|---|---|
| G001 | Jobs UX slice close-out: createdAt/prompt threaded authority→UI; HEAD typecheck fix | superseded by G004 (work landed) | `1c53d6f` |
| G004 | Review blockers: 48 KiB byte-budgeted `job.list` + `nextCursor`; cursor-driven notification catch-up | ✅ complete | `8649ca5`, `4cf1dfa` |
| G002 | C7 GUI smoke via gjc computer use + 4 shell defect fixes | ✅ complete | `9bdc18d`, `60b26b6`, `ef6f076`, `2e584b9`, `36d7cb2` |
| G003 | This docs alignment pass | ✅ complete | (docs) |

Every complete checkpoint passed the full gate: ai-slop-cleaner PASS →
architect APPROVE (no CRITICAL/HIGH) → executor QA/red-team PASS →
`npm run verify` green → receipt in `ledger.jsonl`.

### What the C7 smoke found and fixed (all landed + re-drilled live)

1. `9bdc18d` — second instance crashed with SIGABRT inside
   `did_finish_launching` (setup error → `expect` panic → crash-reporter
   dialog); now exits 0 cleanly.
2. `60b26b6` — macOS Quit AppleEvents (Cmd-Q, `osascript quit`) bypass a
   preventable `ExitRequested` in this Tauri version, so quit orphaned the
   whole server tree; `RunEvent::Exit` now runs a bounded synchronous
   SIGTERM+wait shutdown fence. Verified: quit during a running job →
   whole tree exits, job `interrupted`, resumes cleanly.
3. `ef6f076` — a `ready` job (e.g. after abort) had no follow-up affordance;
   the job workspace now has one composer: `ready` → `/turns`,
   `interrupted` → `/resume` (`jobFollowUpKind` locked by tests).
4. `2e584b9` + `36d7cb2` — recovery Retry was a no-op (`__TAURI__` absent
   without `withGlobalTauri`, CSP-blocked inline handler) and deep links only
   focused the window (no IPC injection on the remote loopback origin).
   Retry now works; `gajae-app://open/job/<id>` navigates the SPA via
   Rust-validated pushState eval.

Evidence: `artifacts/g002/` (drive transcript, 17 validated screenshots,
QA report, packaged smoke logs, Gatekeeper log, leader evidence log) and
`artifacts/g001/` (API drill 13/13, e2e log).

### Closed app-owned advisories and open upstream issue

The app-owned 2026-07-20 advisories are closed as of 2026-07-25:

- ~~`/resume` HTTP route lacks the `resolveBinding` 409 ownership guard
  `/turns` has~~ — fixed; the guard and its test landed with the chat-parity
  commit.
- ~~Sidebar job badge can stay stale after an in-view resume~~ — moot. The
  jobs UI was removed (`src/components/jobs/` is empty; see
  `MainContentJobRemoval.test.tsx`), so there is no badge to go stale.
- ~~Unrouted `StandaloneShell`/`shell` components remain~~ — already deleted
  along with the xterm dependencies.

The remaining item is upstream, not an outstanding app advisory:

- gjc CLI `computer` tool: top-level `keys: string[]` is mangled by the tool
  bridge (batch-nested keypress works) and the key map has no modifier names,
  so Cmd-Q-style combos cannot be synthesized. Upstream gjc issue, still open;
  the quit contract was verified via the equivalent AppleEvent path.

## Release state (2026-09-01)

`v2.0.0-beta.6` is published at `205a226`; `main` has continued beyond that
tag. `v2.0.0-beta.4`
carried the 188 commits that had accumulated since beta.3 (React 19 + Compiler,
Tailwind 4, TanStack Query/Zustand split, GJC SDK 0.15.0 on Bun 1.4.0, in-app
OAuth login, the composer/model-picker overhaul, shared browser/CUA automation);
beta.5 followed the same day with the native-watcher fix below. Beta.6 followed
with the cross-origin transport protection. Post-beta.6 `main` includes the GJC
engine boundary and bundled-notice release work, the queued-message quota fix
(`8380a39`), and transcript-derived turn metadata (`bc1555f`, `1c13f69`).

Two things had quietly broken the release lane and were fixed as part of the
cut:

- `scripts/release/build-server-bundle.js` asserted an exact SDK version from a
  literal last touched at 0.11.8, so every dispatch after the runtime moved had
  failed. The pin now comes from `server/gjc-runtime-manifest.json`.
- The recursive native watcher missed transcripts a directory already held when
  it appeared (inotify emits the folder's creation before it registers the
  watch; a populated directory moved into a root is reported as one path). CI
  had been failing on it intermittently since 2026-08-27. Fixed in
  `native/gajae-core/src/watcher.rs` with a deterministic regression test.

The website (`https://devswha.github.io/gajae-code-app/`) deploys from `main`
and its advertised version is now asserted against the app's own, so a release
bump that forgets it fails the gate.

## 2026-09-02 dead-code and relicensing follow-up

A dead-code pass landed on `main`, then two fixes, then an unused-export
sweep. Net: ~7,760 lines removed, 4 dependencies dropped, `npm run verify`
green throughout.

- `7389741` — client: modules nothing imported after the workspace retirement
  and the wizard clone-flow removal (`SettingsMainTabs`, the GitHub-token hook
  with its clone API/types/url helpers, `HomeDirInput`, the empty-shell project
  constant, the time-ago formatter, legacy `useLocalStorage`), plus 407 locale
  keys per language no `t()` call could reach.
- `3663296` — server: `commandParser.js`, `frontmatter.ts`,
  `websocket-writer.service.ts`, `scripts/audit-policy.mjs`, a dead Playwright
  config entry.
- `c87a875` — server: the git endpoints orphaned by the git panel retirement.
- `8a23d70` — dependencies: `jszip`, `auto-changelog`, `autoprefixer`,
  `node-gyp` removed. `f71ed5b` — `browserslist` moved past two fresh high
  advisories.
- Browser smoke after the pass: the app came up clean; the one finding was the
  sidebar still polling a stale release repository for its version badge,
  fixed in `5de6248` (badge now reads `package.json` directly).
- `48ec3b6` — docs: `docs/UPSTREAM.md` names the upstream correctly
  ("Claude Code UI"); `docs/LICENSING.md` package count corrected to the
  measured 550. That rename tripped `check:identity`, which pinned the old
  provenance string — `36e1230` repoints the pin.
- `bb880e2` — unused-export sweep from knip (`npx knip --include exports,types`),
  every finding cross-checked with ripgrep across `src/`, `server/`,
  `shared/`, `scripts/`, `website/` and the bun test files: 59 files, ~80
  exports; locally-used symbols lost the `export` keyword, fully unreferenced
  symbols were deleted. Left alone on purpose: the `server/gjc-engine.ts`
  published surface, the `server/modules/*/index.ts` barrels (the boundary
  rule routes cross-module imports through them), `shared/productIdentity.js`
  (asserted by `check:identity`), exports referenced only by tests, and
  `DialogTrigger` (owns the Dialog focus-return plumbing).
- Residual overlap: `node scripts/measure-upstream-derivation.mjs` → 84 of
  91,711 lines (0.1%), `package.json` only. Unchanged by this work.

### 2026-09-02 afternoon: session UI and permissions

Prioritized from a comparison of session UIs (Cursor 3.x, Codex, Claude Code
and others) kept in the Cursor canvas `session-ui-comparison.canvas.tsx`,
outside the repo. Ten commits, `1825fb2`..`a4773ff`, all on `main`.

- `1825fb2` — chat: one three-level tool output density preference
  (compact / balanced / detailed, `toolOutputDensity.ts`) replaces the
  "Display reasoning" and "raw parameters" switches, which never reached the
  folds that decide a card's height. Compact folds every call into a row,
  detailed opens everything and never groups. Settings radio group, a header
  icon button that cycles it (⌘⇧D), three palette actions. `useUiPreferences`
  migrates v2→v3 once (either old switch on → detailed, else balanced; old
  keys kept for a release). Also fixed the bash group row showing "+N more"
  instead of the commands.
- `f7d2f3e` — found by browser smoke: a group containing a failed call
  unfolded itself at every level, so a session with many non-zero exits
  rendered the same wall of tracebacks in compact as in balanced. New
  `failureOpens` rule in the density table: only balanced/detailed unfold
  failures; compact keeps the error label/badge on the row and waits for a
  click.
- `ea285ba` — sidebar: four-state session status (running / needs_input /
  ready / blocked) derived by a pure function (`sessionStatusModel.ts`) from
  the run registry, open approval requests and the held last-run outcome;
  outcomes and last-viewed times persist in localStorage
  (`useSessionAttentionStore.ts`, `useSessionAttentionSync.ts` tracks
  approvals for every session, not just the visible one). Server:
  `/api/providers/sessions/running` gains `awaitingInput`, tracked by the run
  registry from the approval frames it already decorates. Work aggregates
  non-idle sessions needs_input > blocked > ready > running with per-state
  counts in the heading.
- `2f00b40` — sidebar: inline session search beneath New task, by title,
  project and message body (`useConversationMessageSearch`, the palette's
  server-side body search made callable across projects). 150 ms debounce,
  matching projects force-expanded while a query is active, `/` focuses the
  field from anywhere that is not a text field.
- `6340490` — sessions: `deriveSessionTitle` (`server/shared/utils.ts`) strips
  slash commands, @mentions, code fences and markdown, keeps the first
  sentence when it stands alone, cuts at 40 chars on a word boundary; the gjc
  indexer uses it for new transcripts and still never overwrites a stored
  name. "Regenerate title" (`POST /sessions/:id/regenerate-title`) is the one
  place a hand-written name is replaced. Finding: the runtime's
  `generateSessionTitle` (`utils/title-generator`, writes `header_patch
  {title, titleSource:'auto'}`) is wired only into the TUI input controller;
  the SDK session the worker drives never calls it. LLM titling would need a
  Protocol v1 event to carry the title back plus a title-source column in the
  DB. Deferred as a runtime capability to request.
- `558f05e` — an accessibility-tree smoke reported rows without a status
  attribute and a menu that did not open; neither reproduces (the tree cannot
  see `data-*`, an idle row has no indicator by design). Locked in
  `SidebarSessionItem.menu.dom.bun.test.tsx`: status marker, ActionMenu on
  click, keyboard and coordinate click.
- `858f1a3`, `a74dedf`, `aab0dd0` — permissions: per-project mode
  (ask / auto_edits / bypass) plus an "always allow" tool list in SQLite
  (`project_permissions`, `/api/projects/:id/permissions`), sent with every
  run inside the existing worker `run` payload (no new frames, see
  `GJC-LIVE-SPEC.md`). The Bun adapter calls `setSdkPermissionMode('prompt')`
  and `setSdkPermissionProvider(...)`; covered calls are approved in the
  worker with one transcript notice per tool per run, everything else becomes
  a permission card whose new third action "Always allow <tool>" is persisted
  before it reaches the worker. UI: composer picker (⌘⇧P), palette actions,
  read-only Status row, Settings → Permissions tab (projects deviating from
  default, revoke/reset), bypass drawn destructive and confirmed once per
  project. The localStorage `skipPermissions` flag is migrated to bypass for
  the open project and removed.
  **Important finding — goes into the beta.7 release notes:** the runtime's
  SDK permission gate defaulted to `"allow"`, so GJC sessions had never
  prompted for bash, eval or delete; `skipPermissions` was a dead flag. The
  default `ask` now really prompts, which existing users will notice.
- `a4773ff` — gjc: `worker.initialize` was bounded at 5 s, but the Bun worker
  bootstraps the SDK inside that request (model registry + online discovery,
  measured 4–8 s here). After a server restart every reconnecting tab's
  `oauth.status` started the worker, the bound SIGKILLed it mid-bootstrap,
  and tabs saw only "GJC worker failed." with an empty worker log. Now
  `DEFAULT_INITIALIZE_TIMEOUT_MS = 60_000`, shutdown has its own 5 s bound,
  initialization failures are diagnosed in both logs, and a malformed
  `permissions` block is answered with `invalid_permissions` → "Invalid GJC
  run permissions." on the client.

### 2026-09-02 evening: run-state UI + elkjs stub

Worktree at start of the evening was dirty with two streams mixed. They were
committed separately on `main` (this file last). `npm run verify` was green
on the dirty tree before the commits; out-of-tree packaged smokes were green
on an ad-hoc `.app` built from the stubbed payload. Signed rebuild /
notarization was **not** run this evening.

**Checkout.** Branch `main`, origin `https://github.com/devswha/gajae-code-app`.
HEAD at the start of this evening was `3ce6106`. After this evening:

| Commit | Message |
|---|---|
| `279bc17` | `refactor(chat): move run state into the transcript and the stop button` |
| `bc36b20` | `fix(release): ship an elkjs stub so the packaged worker can boot without EPL code` |
| `2b47932` | `test(release): run the packaged smoke from outside the repo tree` |
| `9fa9c82` | `docs: record the 2026-09-02 evening UI and elkjs-stub state` |

No leftover dirty tree is expected after these four land. Do not commit
`dist-native/`, `src-tauri/{target,binaries,resources/server-payload}`,
`.gjc-worktrees/`, `dist/`, `dist-server/`, or `release/`.

**Run-state UI (`279bc17`).** Feedback on `c37ebc1` / `5a0d1a3`: the transcript
work block said Working while the composer strip said Thinking, and Stop
lived on that strip. Now there is one progress surface:

- Composer: no ActivityIndicator. While `isLoading`, the send button is
  Stop (`data-run-control="stop"`, Square, `bg-foreground`); a typed draft
  gets a separate queue arrow (`data-run-control="queue"`); Enter still
  queues. Escape aborts from anywhere (`useEscapeToAbort`, capture listener).
- Transcript: at compact/balanced the last turn gets a work block from the
  first send — empty `Thinking… · 3s` row (`RunningActivityRow`,
  `variant="pending-block"`) until a tool lands, then
  `<live activity>… · <elapsed>`. A finished turn with no tools
  has no block. Detailed density still has no block; it shows an inline
  running row instead (`variant="inline"`).
- Since the 2026-09-02 late-night pass a turn has **one block per run of
  consecutive calls**, not one per turn: prose the model writes between
  calls stays outside, in order (`Let me look.` / `Worked for 12s · 3 files
  read` / `Found it, fixing.` / `Worked for 5s · 2 edits` / answer), the
  Codex/Cursor layout. While running, prose after a block is followed by a
  fresh empty block until the next call fills it. `TurnWorkBlockItem` is
  `{ startedAt, endedAt, isTail }` — each block's `Worked for` is measured
  from the prose before it, and only the tail block reads the live activity.
  `updateStreaming` keeps the first delta's timestamp so that duration does
  not tick while the answer streams.
- **Status line, later the same night.** The row's label is held ≥ 900 ms
  (`useSteadyLabel`; dev builds log every requested switch as
  `[chat] status "A" -> "B"`) after a phase flashed through `Thinking…`
  too fast to read. And a tool in flight no longer swaps the row's text:
  the row is the run's *phase* (`Thinking…` / `Writing answer…` / a server
  status / awaiting approval, `phaseActivity`) with the block's latest call
  beside it, one at a time (`data-live-call`): `Thinking… · Running npm
  test… · 12s`, the ellipsis only while the call is in flight, the last call
  kept while the model decides its next move. Both halves go through
  `useSteadyLabel`. Detailed density's inline row has the same shape from
  `liveActivity`. Dark-mode `--destructive` is now the TUI's
  `dangerRed` `#ff4d5e` (`354 100% 65%`, foreground `0 0% 8%`): the shadcn
  maroon was unreadable as text on the dark surface.
- **Streaming stutter (same night).** Measured with a happy-dom bench (30
  turns / 181 messages, one delta tick): React spent ~59 ms per tick because
  `normalizedToChatMessages` rebuilt every `ChatMessage` on every store
  update, so every memoised row and every folded block re-rendered for an
  answer streaming below them; on top, deltas were painted on a fixed 100 ms
  timer (10 steps/s). Now: conversions are cached per row object (WeakMap,
  keyed on the row and the result it pairs with — `useChatMessages.test.ts`
  pins the identity contract); message keys are assigned per list
  (`assignMessageKeys`) instead of a per-render `getMessageKey` prop;
  `TurnWorkBlock` is memoised on block contents and groups its body only
  when open; deltas flush on `requestAnimationFrame`. Same bench after:
  ~7.5 ms per tick, flat in session length (the remainder is the streaming
  message's own markdown).
- `ActivityIndicator.tsx` and its CSS (`chat-activity-*`) are gone.

Tests: composer static markup (Stop / no strip),
`useEscapeToAbort.dom.bun.test.tsx`, pending/zero-tool/detailed cases in
`TurnWorkBlock.dom.bun.test.tsx` and `turnWork.test.ts`.

**elkjs stub (`bc36b20`, `2b47932`) — the DMG blocker.** `b15492a` excludes
`elkjs` (EPL-2.0) and `mupdf` (AGPL) from every distribution. That is still
the right license call. The hole: `beautiful-mermaid/src/elk-instance.ts`
has `import ELKBundled from 'elkjs/lib/elk.bundled.js'` at module scope, and
the GJC runtime loads `beautiful-mermaid` while loading itself. With the
package simply gone, `worker.initialize` dies
(`Cannot find package 'elkjs'`) and every job reports `GJC worker failed.`
Every smoke until this evening ran inside the checkout, where Bun walks up
to the repository's `node_modules/elkjs` and hides it. The 2026-09-02
notarized DMG (app zip `c923fd4d-…` Accepted, DMG `037874c4-…` Accepted,
`spctl` Notarized Developer ID) therefore **must not ship**. The
`/Applications` install from 2026-08-31 predates the exclusion and still
carries real `elkjs`.

What the stub is, exactly:

- First-party MIT package at `scripts/release/stubs/elkjs/` (`gajae.stub:
  true`, name `elkjs`). Surface: default-exported class, `worker.worker`
  with `onmessage` / `postMessage` / `dispatcher.saveDispatch`, `layout()`
  that rejects with `ElkLayoutUnavailableError` ("ELK layout is not bundled
  in this distribution"). Construction does not throw; only layout fails.
- `distribution-exclusions.mjs` sets `stub: 'elkjs'` (and `stub: null` for
  `mupdf`). `removeExcludedDistributionPackages` deletes the real package,
  copies the stub into its place, rewrites `version` to the one removed
  (payload currently `0.11.1`). Both builders call it: macOS payload
  (`build-macos-server-payload.mjs`) and Linux server bundle
  (`build-server-bundle.js`).
- `mupdf` needs no stub: `markit-ai` loads it lazily
  (`require("mupdf")` / `await import("mupdf")` inside the PDF converter).
- ASCII mermaid (`renderMermaidAsciiSafe`) never reaches ELK; SVG
  flowchart / class / ER layout is what fails, and `render_mermaid` is
  already withheld in `server/gjc-agent-tools.ts`.
- License gates still read `package-lock.json`: real `elkjs` is excluded,
  the stub is not counted as a third-party package.
  `THIRD-PARTY-NOTICES.md` says a directory named `elkjs` in a distribution
  is this project's own code.

Out-of-tree smokes (the test that would have caught this):

- `scripts/release/out-of-tree.mjs` copies an artifact under `$TMPDIR` and
  refuses to run if any ancestor has `node_modules`. Both builders smoke
  from that copy. `smoke-packaged-server.mjs` auto-copies a `.app` that
  sits below this checkout (`--from-copy` forces it); a mounted DMG or
  `/Applications` install runs in place.
- Evidence this evening, unsigned:
  - Old notarized `.app` smoked via the new auto-copy → `GJC worker failed`
    (the hole is now visible from the tree).
  - `npm run server:payload:macos` → `Excluded mupdf, elkjs; stubbed elkjs`,
    then smoked from `/var/folders/…/T/gajae-out-of-tree-…`.
  - Payload copied to `/tmp/gajae-payload-oot-*`: `worker.initialize` →
    `{"ok":true}`, `worker.shutdown` → `{"ok":true}`.
  - Ad-hoc `env -u CI npm run tauri -- build --bundles app`, then
    `smoke-packaged-server.mjs` (auto-copied) →
    `{"status":"ok","product":"gajae-app","version":"2.0.0-beta.7"}`;
    `--data-survival` → `events=1, schemas=idempotent`.
- `npm run verify` (audit, licenses, notices, typecheck, check:core, test,
  lint, identity, build) passed on this tree before the commits landed.

**Notary / signing facts (do not re-run unless cutting a shippable DMG).**

- Cert: `Developer ID Application: sangwoo ha (5987KT43TJ)`, Team ID
  `5987KT43TJ`.
- notarytool profile: `gajae-notary` (`xcrun notarytool history
  --keychain-profile gajae-notary`).
- Procedure: `docs/DESKTOP-TAURI-VERIFICATION.md` § "Signed release
  procedure". `export APPLE_SIGNING_IDENTITY="Developer ID Application:
  sangwoo ha (5987KT43TJ)"`, `env -u CI`, unset `CARGO_TARGET_DIR` if it
  points at a sandbox cache. Acceptance smokes run from the **mounted
  image**, never from `src-tauri/target/…`.
- First notarization of HEAD `a4773ff` took ~73 min (app zip) + ~3.5 min
  (DMG). A second submission is usually minutes. `03b7fbf` stopped the DMG
  packager from re-signing a stapled app (that had been changing the
  cdhash).

### 2026-09-02 night: multi-viewer streaming

Found while watching a session from two tabs at once (the desktop and the
Tailscale link). Four commits on `main`, `npm run verify` green at
`9830260`. The signed rebuild / notarization was **not** run; the
2026-09-02 evening state below still applies.

| Commit | Message |
|---|---|
| `95a1461` | `refactor(chat): drop the Working prefix from the live work block row` |
| `6abb6d2` | `fix(chat): fan a live run out to every socket viewing the session` |
| `38d2035` | `fix(chat): show the answer stream_end carries and keep the label steady to the end of a turn` |
| `9830260` | `fix(chat): close an answered permission card on every other viewer` |

- The run writer held **one** socket and every `chat.subscribe` replaced
  it. Two viewers re-subscribe on every `session_upserted` (one per
  transcript write), so the stream flipped between them; a tab could
  receive zero frames for a turn it sent, `Writing answer` flashed and the
  answer stayed on disk until a reload. `ChatSessionWriter` now keeps a
  `Set` of connections (attach adds, closed sockets drop at the next frame,
  the chat socket's close handler detaches). Same `seq` reaches every tab.
- `stream_end` carries the whole answer and now outranks the accumulated
  deltas (late joiner, or a turn the SDK did not stream).
- Landed prose at the end of a turn counts as `responding`: `complete`
  follows `stream_end` by ~100 ms and the `Thinking…` flip in between
  flickered on every turn (`toolActivity.ts`).
- A permission answered in one tab is now closed on the others
  (`permission_cancelled` sent by `permissionResponse`).
- The running row is `<activity>… · 12s`, no `Working ·` prefix;
  `workBlock.working` locale key removed from all ten languages.
- Verified live with two instrumented tabs: identical frame sequences,
  `Thinking… → Writing answer… → done` with the answer kept in both.
- GJC model credential fix (post-abort follow-up, same night): a run whose
  model lands on a provider with no stored credential row (the default role
  pointed at `glm-zcode53`, a `models.yml` `apiKeyEnv: GLM53_KEY` provider)
  failed as the sanitized "GJC worker failed." — the cause only in
  `~/.gajae-app/logs/gjc-worker.log`. Eligibility and the run now use the auth
  layer's own resolution (`peekApiKey`: models.yml `apiKey`/`apiKeyEnv`, env
  fallback; no `credentialSelector` installed for such providers, matching the
  CLI), and when nothing resolves the run answers the fixed
  `model_unresolved` code/text instead of the generic failure
  (`server/gjc-model-resolution.ts`). NOTE: the dev server's shell still needs
  `GLM53_KEY` exported for that provider to resolve there, or switch the
  default role to a signed-in provider (`glm-zcode/glm-5.3:xhigh` works — the
  built-in ZCode catalog carries glm-5.3 and its OAuth row is healthy).

Seen but left alone: a viewer that did not send the turn learns of the
run ~2 s late (from `session_upserted`, not from the sender's optimistic
state); a finished block's `Worked for Ns` can shift by a few seconds
after the reconcile fetch replaces realtime timestamps with disk ones.

## Current follow-ups (rechecked 2026-09-05)

- The subsequent adversarial pass and all nine live skill outcomes are in
  [`plans/adversarial-skills-e2e-2026-09-05.md`](plans/adversarial-skills-e2e-2026-09-05.md).
  DNS deployments now require explicit `ALLOWED_HOSTS`; see `SELF-HOST.md`.
  The app avoids the SDK workflow-ID defect by omitting the redundant explicit
  provider ID, and restores skill requests from transcript metadata. The raw
  SDK delegation path remains unsafe. The follow-up implementation replaces
  it with app-owned children that inherit permissions, account, model/effort,
  workflow guards and cancellation; see `GJC-DELEGATION-CONTRACT.md`.
- The parallel correctness pass is recorded in
  [`plans/code-review-2026-09-05.md`](plans/code-review-2026-09-05.md), including
  session/queue isolation, transcript turns and transport, scratch startup,
  CLI shims, desktop lifecycle, watcher recovery and narrow-panel controls.
- The v2 baseline, frontend refactor, Local Studio phases 1–5, scratch quick
  start, and runtime edit-result diffs have shipped. The older unchecked
  public-distribution checklist in `V2-PLAN.md` is historical; signed and
  notarized beta.7/beta.8 images were already published on September 3.
- **SDK 0.16.4 qualifies the workflow identity fix in PR #30.** The published
  runtime includes `Yeachan-Heo/gajae-code#5282`, and the app now pins 0.16.4.
  The original explicit-provider-ID reproducer passes, including the separate
  `getAsyncEndpointId()` accessor and path-safe deep-interview state. Both
  supported native platform closures, command catalog and notices are updated.
  Full `npm run verify`, eight GJC E2Es and an isolated Astra/xhigh live
  response/abort smoke passed. The existing redundant-ID mitigation stays in
  place. The real-SDK child permission-bypass regression still reproduces on
  0.16.4; the identity fix does not qualify unrestricted delegation.
- **Issue #3 has a follow-up implementation and renewed live qualification.**
  Goal state now comes from the SDK transcript, with authenticated, scoped
  pause/resume/cancel controls and app-owned delegation. The initial 20-step
  lease stopped ordinary workflow preparation; the visible limit is now 200
  model steps or 120 minutes. Model-facing goal operations do not reset that lease. The interview
  and independently reviewed Ralplan plan reached their requested approval
  stopping points; autoresearch persisted its verdict, completed the goal and
  retired the mission. Ultragoal also passed native aggregate evidence and
  completed its real goal. Final acceptance is recorded in
  `plans/followup-acceptance.md`. #3 remains open for original Cursor/Anthropic
  live qualification and upstream workflow/CLI efficiency, outside the
  requested Astra-only test lane.
- **CI signing awaits owner-provided credentials.** `gh secret list --env
  release` returned no environment secrets on September 5. The workflow
  and the five required names are documented in
  `DESKTOP-TAURI-VERIFICATION.md`; the first signed CI dispatch remains
  unverified. Local signing readiness and exact-draft asset verification are
  available in `scripts/release/SIGNING-READINESS.md` and
  `scripts/release/LOCAL-RELEASE.md`, without exporting signing credentials.
- Managed session worktree selection is implemented on the existing native job
  runtime, including persisted project/cwd identity, per-run validation and
  cancellation. It does not await a future SDK Slice 3. See
  `plans/session-worktree-goal-acceptance.md`.
  Conversation forks and split-pane workspaces remain deferred product
  decisions, not missing implementations from the completed plans.
- **Agent sidebar (production right rail, cutover complete).** The compact
  context surface in `src/components/agent-sidebar/` is the one right-hand
  experience: `MainContent` renders it directly, and the legacy
  `WorkspacePanel` right rail, the `MainContentRightRail` seam, the
  `agentSidebarV2` experimental preference (Settings → Appearance →
  Experimental is gone with it) and the persisted `workspace-panel` state were
  removed. Desktop is a fixed-width context lane (`w-64`, `lg:w-80`) with no
  header, border, background or resize handle of its own, holding one card:
  Environment (`AgentSidebarEnvironment`: working-tree change count, execution
  directory, branch via `useProjectGitSummary`), WORK (the authoritative TODO
  projection, run-state fallback) and Action Required (unanswered
  approval/question/delegation-authorization state from the attention store).
  The header's rail toggle shows and hides it. Mobile keeps the drawer with
  its titled header and close control. The persisted record is `{ open }`; a
  record from the resizable-rail era still carrying `width` is read for its
  `open` alone and rewritten clean, and stale `agentSidebarV2` preference
  values are ignored harmlessly. Shared git/change data sources stayed put
  (`useProjectGitSummary`, `useProjectChanges`, `useLastTurnChanges`,
  `utils/unifiedDiff` — the chat's edit cards and the worktree picker still
  read them). Deferred, unchanged: browser activity in WORK, agent/subagent
  lifecycle, IRC — all need their own structured contracts.

## How to resume (next session)

0. **Pre-release e2e drill done 2026-09-03 (`docs/plans/beta7-e2e-drill.md`).**
   14 chat-surface scenarios against the live dev stack; four failed and
   were fixed the same afternoon: early Stop refused and poisoned later
   aborts (adapter `#starting` + worker abort-promise reset), session delete/
   archive not leaving the sidebar (`useProjectsQuery` merge moved to
   `queryFn`), three identical `Show more conversations` under Work (one
   control), and the Changes tab buried under `.gjc/_session-*` runtime
   scratch (hidden server-side). Plus write-row line numbers in Last turn.
   The stack is clear for packaging.
   **Evening, while re-shooting the website/README media on v2.0.0-beta.7
   (the 2026-08-21 screenshots and demo video showed the retired file
   tree/editor UI and were deleted):** two more app fixes and three
   observations.
   - Fixed: the Changes tab's Last-turn scope opened before the session's
     history had loaded stayed on "No changes" until a click; the panel is
     not on the store owner's render path, so `useLastTurnChanges` now
     subscribes per session (`sessionStore.subscribeSession` +
     `useSyncExternalStore`).
   - Fixed: a model chosen on the new-session screen ran the first turn
     but was not the session's; after a reload (or a change of the global
     pick) the next turn silently ran on the app default. Seen live: a
     Terra session's second turn went to GLM and hit its rate limit. An
     explicit model on the first turn is now the session pin
     (`resolveResumeModel(..., { firstTurn })`); `default` pins nothing.
   - ~~Gap, not fixed: with ChatGPT models the runtime edits through
     `apply_patch`, which neither the Last-turn scope nor the tool card
     configs know~~ — **closed 2026-09-05 (#33)** without a patch parser:
     the runtime's edit *result* details (`{path, op, move, diff}` per file,
     `perFileResults[]` for an envelope, numbered diff `+12|text`) are the
     normalization every edit mode shares, and they already reach the client
     as `toolResult.toolUseResult` live and on reload.
     `src/components/chat/utils/editResult.ts` reads them; the edit card
     (`apply_patch` shares it) and the Last-turn scope render from the
     result, with real line numbers, and fall back to the replace-mode input
     only while a call runs or when a result carries no details.
   - Upstream: with the ChatGPT provider the model received the project
     path as `/Users/USER/…` and passed it back as the bash `cwd`, which
     does not exist; the run recovered via `pwd`. The runtime redacts the
     home directory in what it sends and does not un-redact tool inputs.
   - Upstream/behaviour: the title generator uses the `default` role model,
     not the session's; when that provider is rate-limited the session keeps
     its heuristic title even though the turn itself ran fine elsewhere.

1. ~~Rebuild a signed + notarized DMG and accept it from the mounted image~~
   — done 2026-09-03, see TL;DR.
2. ~~Cut `v2.0.0-beta.7`~~ — published 2026-09-03; **beta.8 cut the same
   evening.** ~~Next: scratch-workspace quick start~~ — **shipped 2026-09-05**:
   the empty workspace's pane has "Start in a scratch workspace" under
   "Add a project". `POST /api/projects/scratch`
   (`server/modules/projects/services/scratch-workspace.service.ts`)
   registers `<WORKSPACES_ROOT>/gajae-scratch` through the same
   `createProject` gate as the wizard (so a rejected path leaves nothing on
   disk), then `git init`s it and writes a README when it is empty;
   idempotent (existing → same project, archived reactivated, auto
   promoted; verified live against a temp root: `created` → `existing`, same
   id, README listed by `/api/git/diff` on the unborn HEAD). Client:
   `useScratchWorkspace` posts, refetches the project list so the sidebar
   has the row, then takes the ordinary `handleNewSession` path
   (`onNewSession` threaded AppContent → MainContent → MainContentStateView).
   Next: the CI signing lane.
   **Also 2026-09-05:** every dialog opened offset to the upper left for its
   150 ms entrance — Tailwind 4 centers with the `translate` property and the
   `dialog-content-show` keyframe still animated `transform: translate(-50%,
   -48%)` on top of it. Fixed in the primitive (#31, fade + scale only);
   the per-dialog `animate-none` band-aids (#25, #29) are gone and
   `Dialog.dom.bun.test.tsx` refuses new ones. #28 merged, #29 closed as
   superseded. **The release
   workflow now signs and notarizes on the runner once the `release`
   environment holds five secrets** (`APPLE_CERTIFICATE_P12`,
   `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`,
   `APPLE_APP_PASSWORD`; table in `docs/DESKTOP-TAURI-VERIFICATION.md`
   § "Signing and notarizing in CI"). The owner enters them; until then the
   workflow builds the ad-hoc image as before. The lane is untested against
   real secrets: the first dispatch after they land is the verification.
   `README.md` was written the same day.
3. **Session-UI roadmap, remaining items** (1–3.5 landed 2026-09-02):
   - (4) Changes tab — **shipped 2026-09-03** (`253cd21` server,
     `3df9ba6` tab, last-turn scope after): third workspace tab between
     Status and Browser. `GET /api/git/diff` reads the working tree vs HEAD
     (+ untracked, patches capped 50k/file, 400k/response, 100 untracked
     `--no-index` processes); the tab lists files with status/renames/+-
     counts, rows expand to unified diffs, per-row open-in-editor, and a
     scope toggle `Working tree | Last turn` (last turn = the viewed
     session's edit/write/delete/move calls after its last user row, rows
     from the chat's own line differ). No staging/revert UI — git ops stay
     the agent's. Line comments shipped too (same night): hover a diff row
     in either scope, press `+`, write, Enter — the comment lands in the
     chat composer as `comment\n\npath:line\n> <the line>` (the composer
     gained `insertAtEnd`; MainContent wires it to the tab through a ref,
     `composerInsertRef`). Comments batch as of 2026-09-03 afternoon: Enter
     adds a comment to the tab's review (a note under its line, editable and
     removable, kept across row collapse and the scope toggle), a footer
     `Send N comments` hands the whole review to the composer as one message
     (`formatDiffReview`: the per-comment blocks blank-line separated),
     Cmd/Ctrl+Enter adds and sends in one stroke. With that, item (4) is
     complete and **closed**: the tab's value is the review-to-agent loop,
     not diff viewing, so 2-pane, split view, syntax highlighting and
     Accept/Reject are rejected — an IDE does those better and git ops stay
     the agent's. A `/review` command stays rejected too (a canned prompt
     not worth the command surface).
   - (5) Worktree isolation + run-location picker — **investigated 2026-09-03:
     deferred to the runtime's Slice 3, no app-side work.** The native core
     owns worktree lifecycle end to end (`gajae-core` git.rs via
     `GjcGitClient`: create/list/status/diff/prune); background jobs already
     run exclusively in `<repo>/.gjc-worktrees/<jobId>` on `job/<jobId>`
     branches (`JobOrchestrator.start` never dispatches from the project
     root; resume reuses the worktree; prune refuses dirty ones), and the
     app DB hides managed worktree rows from listings and rejects registering
     or targeting them. Interactive chat sessions stay on the single-turn
     worker facade at the project root by design (GJC-LIVE-SPEC: branch/PR
     work from managed worktrees is Slice 3). When Slice 3 lands a
     session-worktree option, the app side is only a picker on the run.
   - Small follow-ups — 2026-09-03 status: locale key-parity test landed
     (`scripts/check-locale-parity.test.mjs`, `f2a03de`); mobile session
     rename landed (`9f6d4eb`); `reject_always` is exposed — the permission
     card offers Always deny only when the runtime's `context.options`
     include it, `always` rides a denial to the worker (no project rule
     stored; the runtime remembers for the run), and the ask controller
     answers the runtime's own `reject_always` option with a
     `reject_once` fallback; `myjob`/`shot-demo` bypass + bash
     always-allow confirmed intentional by the owner. **LLM session titles
     shipped 2026-09-03 afternoon**, app-side only (`6340490`'s "runtime
     capability to request" was over-cautious: the runtime exports
     `utils/title-generator` and the Bun adapter already imports its
     registry/settings/session-manager). First turn of a new session →
     `generateSessionTitle` → `sessionManager.setSessionName(title,'auto')`
     (transcript `header_patch`) → `{kind:'session_title'}` message →
     `ChatSessionWriter` stores it via `sessionsDb.applyGeneratedSessionName`
     and broadcasts `session_upserted`; the turn waits ≤10 s for the title
     before its terminal frame. `sessions.name_source` (`user`/`auto`/
     `derived`/NULL) decides precedence: user > auto > derived. Opt-out is
     the runtime's own `GJC_NO_TITLE`/`PI_NO_TITLE` in the server env (the
     worker inherits it); no settings toggle yet. The header now follows
     the viewed session's `session_upserted` (it used to keep the
     optimistic first-message title until reload).
   - **Fixed the same afternoon: `model_unresolved` on a warm worker.**
     Diagnosis (deterministic through `GjcWorkerHost` in a Bun probe:
     three `session.start` with `modelId: 'default'` on one adapter — the
     third fails): after the second turn the runtime's registry drops the
     model-preset provider `glm-zcode` from 10 models to the one it
     discovered (`glm-5.2`), so `configuredDefaultModelId` cannot resolve
     `modelRoles.default = glm-zcode/glm-5.3:xhigh`; `registry.refresh()`
     restores all ten. An explicit model id never hit it because
     `modelForWithRefresh` already refreshes on a miss, which is why the
     picker state decided who saw it: `gjcModel` is `'default'` until a
     viewed session's pin overwrites it. Fix: `configuredDefaultModelIdWithRefresh`
     retries once after `refresh()`; four consecutive default-model starts
     pass in the probe, contract test locks it. The catalog shrink itself is
     a runtime bug (upstream: preset-registered models lost after a turn's
     catalog refresh) and still worth reporting. Seen once, unexplained:
     `resumeManager` threw `GJC SDK configuration is invalid` (session file
     count ≠ 1) for a turn sent seconds after the same session's first
     turn completed (`~/.gajae-app/logs/gjc-worker.log`, 05:40:34Z).

## Key gotchas

- Never commit platform/runtime artifacts: `dist-native/`,
  `src-tauri/{target,binaries,resources/server-payload}`,
  `.gjc-worktrees/`, `dist/`, `dist-server/`, `release/`.
- Tauri cleans the bundled `.app` after building the DMG; install from the
  DMG (or use `npm run desktop:dmg:macos` for the headless variant).
- The packaged smoke isolates HOME/DB; it is safe to run while the installed
  app is running.
- `test:e2e:gjc` (7 wire tests) is a separate script from `npm test`.
- `check:identity` pins exact provenance strings; renaming upstream in a
  doc without updating `scripts/check-identity.mjs` fails verify
  (`36e1230`).
