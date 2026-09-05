# Remaining-work integration and acceptance

This follows PRs #30, #35 and #38, all merged after their required checks.
All implementation/review agents and actual model requests used Astra with
xhigh reasoning. Offline tests use controlled transports rather than another
model. This is a living qualification record until final promotion.

## Changes and reproduced defects

| Area | Result |
| --- | --- |
| SDK identity | Pin 0.16.4, preserve the original regression input, update both native platform closures and generated command/notices data. Issue #18 closed through #30. |
| Provider variants | Keep provider-qualified choices and test canonical collapse, account routing, cache migration and restart. #35 merged. |
| Linux | #38 adds native deb/AppImage builds, Ubuntu 22.04/24.04 package/GUI/install checks, terminal ownership and AppImage environment fixes. Review additionally fixed stale socket reclamation and symlinked packaging entrypoints. |
| Delegation | Replace unsafe SDK task/subagent executors with app-owned sessions; preserve actual AUTO account selection, model/effort, permissions, tools, native workflow guards, owned resume and retryable cancellation. Raw SDK bypass coverage remains. |
| Goals | Project persisted SDK goal state; enforce owner/run/goal identity; show status, objective, usage and controls. Disk failures fence continuation. Stop remains retryable. Worktree controls use worker IDs while native job tickets own cancellation. |
| Worktrees | Create an owned native job for a new isolated session; preserve parent project permissions/grouping and actual cwd through later turns, restart, files, skills, exports and Git views. Reject changed/foreign worktrees and conflicting transcript identities. |
| Search | Search decoded GJC transcripts with bounded lines, identity/root checks and project filtering before result limits. Search concise skill requests, not expanded prompts. |
| Replay | Scope cursors to run generations; reject obsolete/repeated frames; preserve navigation-time deltas; reconcile persisted answers/thinking even when reasoning separates them or the user anchor is outside the window. |
| UI | Stabilized picker remains from #37. Goal controls survive view/StrictMode lifecycle changes. Settings uses the owned dialog with named dismissal, focus restoration and Escape ownership. Live message counts do not claim stale totals. |
| Release | Check signing prerequisites before publication, verify exact local draft assets and signatures, and retain mount directories if detachment cannot be confirmed. No signing private key is exported. |

Root goals have a cumulative **200 model-step / 120-minute** run lease.
Tool-calling SDK turns count as steps. Explicit user resume starts a new run;
model pause/resume does not reset that run's lease. Delegation retains four
active children, depth two, 32 launches per run and a five-minute child limit.
Observed Ralplan children completed within that child limit; the restrictive
root 20-step limit, rather than a child timeout, interrupted the initial goal
drills. Limits do not waive permissions or native completion evidence.

## Live skill outcomes

Tests use disposable Git projects, an isolated app database and session roots.
The ordinary catalog consists of four bundled skills and five user skills.
The QA OAuth connection was renewed through the existing browser sign-in flow.
Sign-in values stayed outside application conversation transcripts and model
prompts; credentials were not copied back into the normal app store.

| Skill | Evidence and disposition |
| --- | --- |
| deep-interview | Structured questions and approval UI worked; a short specification was saved pending approval with 1.6% final ambiguity. No implementation/handoff. `--quick` still yields the native pre-resolved 5% threshold. |
| ralplan | Actual Planner, resumed Planner, independent Architect and Critic produced native validated artifacts. The operator selected Stop at the requested approval boundary. Source remained unchanged. |
| autoresearch | Existing benchmark yielded baseline 11.5, candidate 8.5 and 26.09% reduction. Native verdict, matching goal completion and mission cleanup were observed. Small-sample limitations were retained. Initial unsupported CLI flags were corrected during the run. |
| ultragoal | File creation was observed. Final native review/QA/goal acceptance remains in progress; file existence or a turn's zero exit status is not completion evidence. |
| no-english (user) | Korean rewriting preserved paths, identifiers and executable commands. Passed. |
| insane-search (user) | Public Example Domain read succeeded through the normal reader; no fallback engine was needed. Earlier private-target refusal was a separate negative test. |
| gpt-image (user) | Image-generation lane cannot establish Astra-only generation. Initial isolated binding absence was also recorded; no image success is claimed. |
| insane-review (user) | Required Sol Pro lane conflicts with Astra-only execution. Refusal was verified; local checks are not an external review result. |
| extragoal (user) | Correctly refused missing feature-branch/diff evidence and the unavailable cross-family reviewer. No fabricated approval or remote publication. |

Actual parent/child assistant records inspected so far contain only
`openai-codex/gpt-6-astra` and `xhigh` thinking changes. Generic live Planner
delegation returned the fixture heading through task/subagent.

## Verification and external prerequisites

- SDK update passed full `npm run verify`, eight GJC E2Es, credentialed response/
  abort smoke, and Node 22/24 CI before #30 merged.
- Latest #38 source passed Node 22/24 CI, Linux package build and package/GUI
  checks on both Ubuntu versions before merge.
- Integrated `npm run verify` passed at `a69facd`. Later corrections must pass
  affected checks and the final promotion gate before merge.
- Final post-review E2E, packaging and final-head CI results will be recorded
  here and in the pull request. Unconfirmed cleanup must not be reported as a
  completed or safely aborted run.
- GitHub-hosted signing still needs `APPLE_CERTIFICATE_P12`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID` and
  `APPLE_APP_PASSWORD`. Local identity/profile readiness does not configure CI.
- Windows execution and full interactive GNOME/KDE sessions are not claimed.
  Conversation forks and split panes remain separately deferred product scope.

Local evidence during this run is under `/tmp/gajae-followups-e2e/`; the final
report records results so it does not depend on temporary credentials or live
test processes remaining on disk.
