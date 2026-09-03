# beta.7 pre-release e2e drill and bug-fix plan

Status: complete - every scenario passed or was fixed (see Findings); packaging is next
Saved: 2026-09-03 15:20 KST
Scope: what has to be true before the signed DMG rebuild and the `v2.0.0-beta.7`
cut. Nothing here touches packaging; that is the next step and stays gated on
this drill being green.

## Why

The automated gate (`npm run verify`) is unit/contract only. The repository's
e2e (`npm run test:e2e:gjc`, `test:e2e:browser`) covers background jobs, the
websocket projection matrix and the Chromium sidecar - none of it drives the
chat surface a user actually lives in. The last two days changed exactly that
surface (permissions default `ask`, four-state status, Changes tab + review,
generated titles, default-model refresh) and today's session already found two
bugs by clicking around (`model_unresolved` on a warm worker, the header not
following its own `session_upserted`). One more pass, scripted and recorded,
before anything gets notarized.

## Method

- Stack: dev server on :3101 (`SERVER_PORT=3101 npm run server:dev`, current
  HEAD) + Vite on :5273. Real GJC worker, real model (`glm-zcode/glm-5.3`);
  prompts are tiny and tool-free unless the scenario needs a tool.
- Driver: headless Chromium through the `browser` tool, one scenario at a time,
  state observed through the DOM plus the sqlite row and the worker log
  (`~/.gajae-app/logs/gjc-worker.log`), not screenshots alone.
- Scratch project: `~/workspace/testsproject` (empty dir, already registered).
- Every failure gets: a reproduction line in this file, a fix at the source, a
  regression test at the lowest level that can see it (unit/DOM/contract), and
  `npm run verify`. No fix ships on a screenshot.
- Order is by blast radius: the runtime boundary first (worker, permissions),
  then session state, then UI chrome.

## Scenarios

| # | Scenario | Pass condition |
|---|----------|----------------|
| S1 | Existing e2e | `npm run test:e2e:gjc` green on HEAD |
| S2 | New session, default model, warm worker x3 | three consecutive new sessions from `/` with the picker untouched all answer; no `model_unresolved` in the worker log |
| S3 | Generated title | sidebar row and header retitle mid-turn; `name_source=auto`; second turn does not retitle |
| S4 | Rename precedence | rename in sidebar -> `name_source=user`; a later turn/sync never overwrites; Regenerate title -> `derived` and replaces |
| S5 | Permission `ask` | a bash tool call raises the card; Deny -> tool not run, turn continues; Allow -> runs; Always allow bash -> next bash call in the project runs unprompted; Always deny (when offered) -> denied without a card for the run |
| S6 | Abort | Stop button during a streaming turn -> status returns to idle within 5 s, transcript keeps the partial text; Esc in the composer does the same |
| S7 | Second turn timing | send a second turn within 2 s of the first completing -> resumes (no `configuration is invalid` in the worker log; see the 05:40Z one-off) |
| S8 | Changes tab | working tree lists this repo's dirty files; expand -> unified diff; two comments -> one composer message; Last turn scope after an edit turn in testsproject shows the file |
| S9 | Sidebar | filter narrows rows; star pins; archive removes/restores; delete removes the row and the DB row |
| S10 | Work section | the "Show more conversations" row rendered three times under Work (seen 14:37 KST screenshot) - reproduce, fix |
| S11 | Multi-viewer | a second tab on the same session receives the live stream and the title |
| S12 | Reload mid-turn | reload while streaming -> the page reattaches, the turn finishes, no duplicate messages |
| S13 | Mobile 390x844 | sidebar drawer opens/closes, session opens, composer sends, workspace drawer opens Changes |
| S14 | Project permissions setting | switching a project to allow/deny in Settings persists across reload and changes S5 behaviour |

## Findings

- S1 pass (7/7). S2 pass (3 default-model sessions on one warm worker).
  S3 pass (auto titles landed mid-turn in sidebar and header, `name_source=auto`,
  second turn did not retitle). S4 pass (rename -> `user`, survived a turn;
  Regenerate -> `derived`, header followed). S5 pass (Deny refused the tool and
  the turn finished; Allow ran it; Always allow bash wrote the project rule and
  the next bash call ran unprompted). S7 pass. S14 pass (Reset to Ask cleared
  the rule, persisted across reload).
- **S6 FAIL -> fixed.** Stop ~1 s after send answered
  `Session "…" could not be aborted.` and the turn ran to completion; a second
  Stop and Esc failed the same way. Root cause, two layers: the adapter's
  `abortGjcSession` looked the run up in `#runs`, which is only populated
  after `createAgentSession` (1-4 s), so an early Stop found nothing and
  returned false; and `gjc-worker.ts` cached that first `abortPromise`
  (`??=`), so every later Stop on the run replayed `aborted: false`. Fix:
  runs are tracked from acceptance in `#starting`; an abort that arrives
  before the session exists is recorded and honoured the moment the run is
  registered (no prompt, no `session.created`, no terminal frame - the app
  already completed the run as aborted); a refused abort clears the cached
  promise. Contract tests: early abort, refused-then-retried abort. Live:
  immediate Stop, mid-stream Stop (partial text kept), Esc all idle within
  1.5 s. The 05:40Z `resumeManager` one-off fits this too: an early-aborted
  run had announced a session id whose transcript was never written, and
  the next turn tried to resume it - the fix withholds the id in that case.
- S8 pass, with two small fixes: a written file's rows now carry line
  numbers (a comment lands as `path:line`) and a trailing newline no longer
  shows a phantom empty added line. Observed while there: testsproject's
  working tree listed 569 rows, all `.gjc/_session-*/` runtime scratch, which
  buried the one real file. `readProjectDiff`/status now hide
  `.gjc/_session-<id>/`; `.gjc/skills` and the rest of `.gjc` still show.
- **S9 FAIL -> fixed.** Delete (and archive, same path) removed the row
  server-side but the sidebar kept it until reload. Root cause:
  `useProjectsQuery`'s `structuralSharing` merged the previous session list
  into every cache write, so `withoutSession` (n -> n-1) was undone by the
  union with the previous n. The merge exists to keep expanded pages across
  a refetch; it now runs in `queryFn` only. DOM test: delete removes the
  row and it stays removed. Filter, pin and Regenerate pass.
- **S10 FAIL -> fixed.** One anonymous `Show more conversations` per project
  with more pages under Work (three identical buttons). Now one control that
  pages every such project; static test locks one control.
- S11 pass (second tab streamed, Stop offered). S12 pass (reload mid-stream
  reattached, turn finished, no duplicate rows). S13 pass (390x844: sidebar
  drawer, new session, send, workspace drawer -> Changes).
- Not a finding, noted: the headless drill shared one localStorage across
  desktop and mobile, so the mobile tab opened with the workspace drawer
  already open over an empty page. A real phone would only see that if it
  had opened it itself.
- Test debris cleaned: nine probe sessions the Bun reproduction wrote into
  testsproject were deleted through the API.

## Exit

All scenarios pass or have a fix commit; `npm run verify` green; handoff doc
updated; then packaging (`docs/DESKTOP-TAURI-VERIFICATION.md` § Signed release
procedure) and the beta.7 cut.
