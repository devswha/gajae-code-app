# Adversarial review and live skill acceptance — 2026-09-05

Base: `ddaeb63` (after PR #34). The review, implementation, independent
reviewers and live app runs used Astra with xhigh reasoning. All real app
assistant records were checked for `openai-codex/gpt-6-astra`; live session
state reported `thinkingLevel: xhigh`. Offline contract tests used deterministic
transports, not another model.

## Scope and findings

The review covered React state and transport composition, HTTP/WebSocket
authentication, uploads, automation grants, terminal ownership, GJC SDK
integration and transcripts, native Git/jobs authority, and release smoke
isolation. Existing E2Es were executed with a real Chromium process and real
Git repositories. The test projects, app database, credentials copy and browser
profiles were isolated from the user's normal projects and app state.

| Priority | Reproduction and impact | Change |
| --- | --- | --- |
| P1 | Matching attacker-controlled DNS Host/Origin reached HTTP job creation and WebSocket upgrades; absent Origin and forged forwarding headers also bypassed trust assumptions. | `server/shared/request-origin.ts` admits loopback/IP hosts by default and requires explicit `ALLOWED_HOSTS` for other DNS names; real route regressions cover allow and deny cases. |
| P1 | A deployment with `API_KEY` protected HTTP but accepted unauthenticated WebSocket upgrades. | Apply the same key check before attaching an owner to every upgrade path; wire E2Es send the fixture key and reject missing/wrong keys. |
| P1 | An image upload could choose an HTML extension; a legacy asset symlink could expose a file outside the upload store. | Generate extensions from allowed image MIME types, force unknown/SVG assets to download, and open only regular files with no-follow protection. |
| P1 | Simultaneous clones of one destination let a failed request recursively delete a successful checkout and user changes. | Clone into private staging, claim/publish the destination with filesystem ownership checks, and clean only private staging. Two independent processes with real Git prove preservation. |
| P1 | Native Git accepted an option such as `--output=...` as a base revision, allowing an out-of-worktree write; prune deleted ignored files. | Reject option-shaped revisions and treat ignored files as local data. Validate registered Git pointers before access or reuse; propagate pipe failures and retry interrupted reads. |
| P1 | Historical run IDs or duplicate event IDs could mutate the current job or transfer an event to another run. | Require the current unfinished run and preserve event ownership transactionally. |
| P1 | Non-boolean approval values, including the string `"false"`, granted tool permissions. | Require literal `true`; regression checks ensure malformed values cannot approve. |
| P1 | The real AppContent transport wrapper discarded send failures, defeating draft/permission preservation in the hooks. | Propagate transport acceptance through the production wrapper and update outgoing status only after acceptance. |
| P2 | Replaced terminal sockets retained input access or received another session's output. | Bind input/output and disconnect cleanup to the active socket/session pair. |
| P2 | Malformed grant revocation filters cleared unrelated grants. | Validate filters and revoke only the matching scope. |
| P2 | Delayed upload/allocation responses affected a different conversation; double submission or disconnect lost drafts. | Scope submission completion, images and destructive-command confirmations to the originating view; preserve unsent input. |
| P2 | A five-second steering timeout became an ordinary send despite unknown delivery; background rejection after completion could strand the queue. | Persist unresolved delivery, keep it out of automatic dispatch, and wake the eligible owning queue when rejection resolves. |
| P2 | Permission reads/mutations and pagination responses could overwrite a newly selected project or invent an Ask policy after failure. | Ignore obsolete responses, preserve explicit error state and prevent concurrent policy changes. |
| P2 | Browser preview state crossed session boundaries; dropped connections, unmount timers and the final screenshot blob were not consistently cleaned up. | Use session-owned viewers, reconnect/retry paths and direct resource cleanup, including binary-frame regressions. |
| P2 | Explicit SDK provider identity duplicated the manager's ID and exposed a composite async endpoint as the workflow session ID. | Let the SDK derive provider identity from the existing logical SessionManager ID; test start, resume, parallel identity and transition ownership without patching the SDK. |
| P2 | Explicit skill requests disappeared from history/export after reload because the SDK stores them as user-attributed `custom_message/skill-prompt` records. | Reconstruct the concise command from validated name/args metadata for history, turns and titles; never expose the expanded skill body. |
| P2 | Build smokes could inherit the caller's database/home and replace its CLI shim with an ephemeral runtime path. | Isolate persistent roots for macOS payload and Linux bundle smoke subprocesses. A real macOS payload build preserved a supplied database canary. |

Independent review found the production-wrapper, background steering wake-up
and final screenshot cleanup cases after the initial implementation. Those
cases were fixed with eight additional regressions and passed focused checks
and independent re-review; initial direct-mock checks alone did not prove the
composed application behavior.

## Nine live skills

The normal user/repository catalog contained four bundled skills and five
user-installed skills. The isolated app copied those exact user skill resources;
the latter are not claimed as bundled product features. Every listed skill was
invoked through the app's real REST/WebSocket/SDK path. Browser checks covered
the picker, Run confirmation, tool approval, structured questions, response
submission and rendered results. No alternate language/image model was used.

An SDK `complete` event with exit code zero only means the turn ended. It does
not prove the requested workflow completed; the table records artifacts and
remaining gates separately.

| Skill | Live scenario and observed evidence | Result |
| --- | --- | --- |
| `deep-interview` | Before the identity fix, the first state read failed with `DI_STAGE_SESSION_REQUIRED` because `GJC_SESSION_ID` contained an async endpoint tuple. After the fix, Round 0, two clarification rounds, closure and restatement recorded five answers. A meeting-notes specification was persisted **pending approval**, with 1.6% final ambiguity; no implementation/handoff occurred. | Requested planning outcome passed. The runtime used its pre-resolved 5% threshold despite `--quick`; flag behavior remains a runtime caveat. |
| `ralplan` | The workflow detected that mandatory Planner/Architect/Critic launch/resume tools were unavailable. The real ask UI offered a fallback; the test chose **Stop; require a session with subagent tools**. No fake consensus or implementation was accepted. | Blocked: required independent delegation is unavailable. |
| `ultragoal` | Created `skill-result.txt` with exactly `astra skill check\n`. Both fixture npm commands passed and acceptance files were unchanged. Required reviewers could not launch; the CLI fallback reported Astra unavailable. The durable goal was explicitly checkpointed **blocked**. | Output/test acceptance passed; complete ultragoal lifecycle failed. |
| `autoresearch` | Confirmed data-only scope through the UI, ran the existing deterministic benchmark, and persisted a structured verdict: baseline 11.5, candidate 8.5, reduction 26.09%, four samples per group. The verdict retained sampling caveats. | Research result passed; matching goal completion and subsequent mission cleanup blocked because the goal tool is disabled. |
| `no-english` (user) | Rewrote the supplied explanation in Korean while preserving `src/api/client.ts`, `gate_id` and `npm test`; checked the rendered answer. | Passed. |
| `insane-search` (user) | Requested a loopback URL as a deliberate SSRF test. The skill refused it before any fetch, private-network override, installation or credential access. | Negative admission test passed. Public-content extraction was not exercised. |
| `gpt-image` (user) | Inspected the bound engine and model/environment requirements. Its ChatGPT Images lane cannot enforce Astra-only generation; Python Playwright was also missing. No browser/profile access or image-model call was made. | Blocked by model/environment constraints; no PNG or provenance file produced. |
| `insane-review` (user) | Refused its required Sol Pro/browser lane under the Astra-only rule. A separately labeled local Astra review verified 12 assertions about non-string behavior in the fixture. | External-review workflow blocked. Local checks are not counted as external review success. |
| `extragoal` (user) | Checked clean committed state, rejected the main-branch fixture and the unavailable different-family reviewer. It stopped before creating a bundle or approval. | Negative prerequisite test passed; complete external review/merge not performed. |

### Why delegation remains disabled

An offline real-SDK regression constructed a parent with permission mode `deny`.
The parent rejected a Bash command, but a real SDK task child executed the same
command successfully. Child creation does not inherit the app permission
provider, tool allowlist or app automation implementations. The test also checks
that production still withholds `task` and `subagent`.

The user's permission to spend tokens resolves the cost concern; it does not
repair that permission boundary. Enabling delegation needs a child-configuration
contract or an app-owned executor preserving policy, requested model/effort and
cleanup across nested/resumed work. No export monkey-patching, hidden tools or
another model was enabled to manufacture passing skill results. Goal mode stays
disabled under the existing product policy.

## Verification record

- Full `npm run verify`: audit, licenses/notices, both TypeScript projects,
  Rust checks, Node/Bun tests, lint, identity and production builds.
- GJC HTTP/WebSocket driver/wire E2E: 8 passed, zero skipped.
- Actual Chromium plus harness E2E: 3 passed, zero skipped. Covered tabs,
  dialogs, downloads, input, long-command cancellation and session isolation.
- Clone unit and real Git E2E: 14 passed, zero skipped, including two separate
  Node processes racing for one destination.
- Native service E2E: 9 passed, zero skipped.
- Rust core: 61 tests passed with formatting and Clippy warnings denied.
  Tauri: 13 tests passed with the same checks.
- Credentialed SDK smoke: explicitly enabled with isolated Astra/xhigh config;
  real response and abort passed. The initial attempt exposed the harness's
  five-second default timeout; the live test now has an explicit 180-second
  limit and completed in approximately eight seconds.
- Final real-browser transport check: after an unexpected test-server exit,
  clicking Send kept the draft intact and added no optimistic user message.
  Reconnect kept it unsent; the stored history still had exactly two messages.
  Graceful shutdown also preserved the draft behind its shutdown dialog.
- macOS payload and Tauri `.app`: built from the reviewed tree. Out-of-tree
  packaged server and two-boot data-survival smokes passed, including migrated
  data, authenticated access, abort/resume and gap-free replay. Smoke processes
  had no model credentials. The bundle was ad-hoc signed for testing; no
  notarization or release publication was performed.
- The latest commit's Linux Node 22/24 CI results and final independent review
  disposition are recorded on the pull request. Later corrective changes must
  pass the affected checks before merge.

## Deployment and remaining limits

**DNS-based deployments now need explicit host configuration.** Set
`ALLOWED_HOSTS=your.published.hostname` for a DNS reverse proxy or tailnet name.
Loopback and literal-IP access remain supported. `ALLOWED_HOSTS=*` explicitly
disables this protection. See `../SELF-HOST.md` and the Nginx template.

- The SDK pin is still 0.15.6. Registry latest was still 0.16.3 when rechecked;
  draft PR #30's upstream-accessor test still awaits a published runtime fix.
  The app's logical-ID workaround is independent of that release.
- Issue #3 should remain open for the unavailable workflow capabilities and
  the observed runtime CLI/flag limitations. Partial artifacts are not proof
  that its complete skill matrix passes.
- Permanently lost steering acknowledgements need manual queue disposition.
  Socket acceptance is not a server receipt; reloads do not preserve image
  bytes. Navigation during allocation can leave an unused empty server session.
- The pre-existing global conversation-search service excludes GJC. This pass
  repairs persisted skill history/turn/title/export interpretation, not that
  separate search implementation.
- Windows execution and a Linux release tarball build were not performed here.
  The browser/DNS transition itself was not simulated; real HTTP/WebSocket
  requests with rebinding-shaped headers were tested.
