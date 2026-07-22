# gajae-app v2 — Session Handoff (resume state)

Last updated: 2026-07-20. Supersedes the 2026-07-18 handoff.

## TL;DR

- **v2 is complete.** Server/backend/web MVP (Slices 0–4 + 6), the Tauri
  desktop shell (Slice 5 C1–C6), **and the C7 interactive GUI smoke** are all
  done and verified. Electron is removed (C9/wave1); the C8 rollback drill is
  void (no rollback target; its data-survival axis is covered by the automated
  two-boot smoke, re-proven on the final build).
- **Only remaining item: notarization (human-gated).** Developer ID
  certificate + notarization credentials on the Mac, then
  `docs/DESKTOP-TAURI-VERIFICATION.md` § "Remaining human gate".
- v1 users are served by the frozen snapshot repo **`devswha/gajae-app-v1`**
  (cut at v1.0.0, release assets mirrored). Maintenance flows one way:
  this repo → cherry-pick to the snapshot.

## Working environment

- **This Mac is now the primary tree**: `~/workspace/gajae-app`. Node via nvm
  (`. "$HOME/.nvm/nvm.sh" && nvm use 22`
  → 22.23.1 — `npm test` refuses other majors), cargo 1.85.1
  (`. "$HOME/.cargo/env"`). `env -u CI npm run tauri -- build` (the wrapper
  chokes on `CI=1`).
- Origin: `https://github.com/devswha/gajae-code-app`. The independent public
  history begins from the verified `2.0.0-beta.1` baseline.
- Commits use the repository hooks and must also pass `npm run verify`.

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

### Known non-blocking follow-ups (recorded advisories)

- `/resume` HTTP route lacks the `resolveBinding` 409 ownership guard `/turns`
  has (defense-in-depth only; the UI cannot trigger the asymmetry).
- Sidebar job badge can stay stale after an in-view resume until the next
  route-change refresh (bounded-polling tradeoff).
- Unrouted `StandaloneShell`/`shell` components remain after the 2026-07-11
  tab removal — dead-code cleanup candidate.
- gjc CLI v0.11.3 `computer` tool: top-level `keys: string[]` is mangled by
  the tool bridge (batch-nested keypress works) and the key map has no
  modifier names, so Cmd-Q-style combos cannot be synthesized. Upstream gjc
  issue; the quit contract was verified via the equivalent AppleEvent path.

## How to resume (next session)

1. `gjc ultragoal status` in this checkout — the 2026-07-19/20 run is
   terminal; start a fresh plan for new work.
2. **Notarization (only remaining v2 item, needs the user):** install the
   Developer ID cert + notarytool credentials, then follow
   `docs/DESKTOP-TAURI-VERIFICATION.md` § "Remaining human gate", rebuild,
   and re-run the packaged smokes + `spctl` (should flip to accepted).
3. Push `checkpoint-c` to origin if not already pushed; the control tower
   cuts releases from report collection.
4. The Linux x64 lane of the both-OS gate has not run for this session's
   commits — run `npm run verify` on the Linux tree before the next
   main-branch promotion.

## Key gotchas

- `dist-native/`, `src-tauri/{target,binaries,resources/server-payload}`,
  `.gjc-worktrees/` are gitignored platform/runtime artifacts — never commit.
- Tauri cleans the bundled `.app` after building the DMG; install from the DMG
  (or use `npm run desktop:dmg:macos` for the headless variant).
- The packaged smoke isolates HOME/DB; it is safe to run while the installed
  app is running.
- `test:e2e:gjc` (7 wire tests) is a separate script from `npm test`.
