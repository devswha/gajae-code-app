# Gajae Code App 2.0.0-beta.19

Product: `2.0.0-beta.19`; desktop: `0.2.13`; SDK: `0.16.4`.
macOS Apple Silicon desktop and Linux x64 self-hosted server.

## Changes

Four days of hardening and isolation work between beta.18 (2026-09-14) and
this release (2026-09-18), 38 merged PRs.

Security and server authority:

- Stops the server leaking API credentials, same-origin file bytes,
  world-readable databases and unjailed working directories (#145).
- Takes session, tool and permission policy from the server, not the browser
  (#147), and admits a ready job only through `turn_admit` without
  broadcasting its lease (#148).
- Makes project cloning a POST and keeps the token off the git argv (#149);
  keeps the desktop shell origin and its IPC away from page-controlled links
  (#151); gates the GJC e2e lane and stops trusting version strings and
  `npm pack` (#153); binds the dev server to loopback unless a host is named
  (#154).
- Bounds project file scans so they can no longer exhaust desktop memory
  (#113).

Worktree isolation (issue #156 arc):

- Keeps the user's git config out of managed worktree checkouts (#155).
- Restores the run-location picker and isolates repository sessions in a
  managed worktree by default (#166); a shared-checkout run asks before it
  rewrites git state (#167); a job's branch is reaped with its worktree and
  refs that outlived their record are swept (#174).

Runtime policy and provider reporting:

- Turns on adaptive compaction so long sessions stop resending their prefix
  (#163); reports the service tier a run resolved to (#164); documents which
  runtime features the app withholds and why (#165); pins the user-scope MCP
  loading contract (#170); requires an explicit worker runtime and removes the
  Node CLI path (#171); withholds computer use until the user turns it on
  (#172).
- Seals the desktop shell without the sidecar's entitlements (#173).

Session UI and browser surfaces:

- Shows context usage as a ring beside the send button (#112); makes the
  sidebar WORK rail the only task surface (#114); puts pin and archive on the
  session row (#115) and makes archiving the only way to remove a project
  (#140); rebinds auto-scroll when the transcript pane mounts late (#116);
  starts a fresh chat in another project on the first click (#138); hides the
  repeated fast-mode notice and insets the chat lane (#142); fixes the
  composer forgetting model and reasoning effort (#144); makes Stop end the
  turn and lets a live turn own its window (#150); follows the session
  `/handoff` actually moved to (#152); says why an attached file was refused
  instead of dropping it (#146).
- Renders the agent's ego browser activity in WORK (#141), expands a live ego
  Space to the pages it opened (#139), and shows the page the agent's ego
  browser is on (#143), with the rendering assessment recorded first (#136).

## Published release

Published `2026-09-18T13:18:04Z`. Release ID `391484917`.
The tag and source resolve to exactly
`9f47eade57879e4e391aa33f8784a52f57afcba4` (the tip at release; `main` has
since advanced with the post-#156 checkout-escape guard, `0c5e6aa`).

The public updater manifest reports version `0.2.13`, targets the
`v2.0.0-beta.19` release URL, and includes a signature.

| Payload | SHA-256 |
| --- | --- |
| macOS DMG | `8011d2f69fd61e18232c83f2f8f2aa1c7278d7f72f1ff27b1b73426169a50cc8` |
| Signed updater archive | `267646f428c9f0cce9cc6e7f3b7d16ff9f2985f93a16201a8d8e5af466e3ba0a` |
| Linux server archive | `9b7c70eee70ab86bf580162eeaac3787558c204f6fa69f9b9d22d7467ae2c9a5` |

## Release boundary

Any updater-enabled macOS build must be production-bound at compile time with
`GJC_UPDATE_MODE=production`, its production feed origin and updater public key,
then Developer ID signed, notarized and stapled before publication.

This post-hoc record documents the tag contents and the published bytes. The
candidate CI run ids, notarization receipts, packaged-smoke results and any
A-to-B update transition for this release were not recorded here; do not cite
this file as evidence of them.
