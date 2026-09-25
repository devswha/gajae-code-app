# v2.0.0-beta.20 (desktop 0.2.14)

Source `9fc928726ffdd4c4042f4f9e98ec0a9cdc82de50`. The release commit is
`chore(release): prepare v2.0.0-beta.20`, on top of #176 (SDK 0.17.6) and #177
(CLI parity). SDK 0.17.6, Bun 1.4.0, packaged Node v22.22.2.

## Contents

- #176: GJC SDK 0.17.6, the lifecycle patch ported to it, and regenerated
  built-in presets.
- #177: the runtime chooses the stored account, as the CLI does; reasoning
  streams live; the native watcher backfills only directories that appeared;
  the Bun tests no longer write into the operator's crash journal.

## Build and acceptance

This was a local signed build that followed `scripts/release/MACOS-ACCEPTANCE.md`
from a `git archive` snapshot. It used a fresh `npm ci`, a private
`CARGO_TARGET_DIR` and the production updater binding
(`updateMode: production`, key fingerprint `6f0054b3…a4c5`).

- CI on the release commit passed: CI, macOS desktop and Linux server archive,
  which includes acceptance on ubuntu-22.04 and 24.04.
- Developer ID signature (team `5987KT43TJ`), app and DMG notarized and
  stapled:
  - app submission `9567bdb2-1fa0-45d6-857c-b7c647cfe997`: Accepted
  - DMG submission `f31da93c-ddd1-40be-9add-d9fa6bdcbabc`: Accepted
- The updater archive was built by `make-macos-updater.mjs` with the
  production key, and its signature verified with Minisign 0.12.
- `verifyMacosRelease` checked the DMG, the quarantined copy and the updater
  archive, with minimum macOS 13.0: passed, `updateMode=production`.
- Copied payload: SDK 0.17.6, server `v22.22.2`, Bun 1.4.0.
- Packaged server smoke passed. The data-survival smoke passed (one job, one
  event, idempotent schemas).
- GUI acceptance used the copied app, which Gatekeeper translocated as it
  would a quarantined download, with `--qa-profile`:
  - launch: the window rendered v2.0.0-beta.20 on a fresh profile
  - the scratch workspace was created inside the QA root
  - after quit, no desktop or server process remained and the port was closed
  - after relaunch, the workspace was still there
  - a second fresh profile did not show it (profiles are isolated)

  The live provider and model test and the A-to-B update transition were not
  run.
- The draft `396880985` passed `local-release.mjs` (`verified-draft`), then
  `--publish` (`published`).

## Published release

Published `2026-09-25T19:49:45Z`, release ID `396880985`, prerelease, target
`9fc928726ffdd4c4042f4f9e98ec0a9cdc82de50`. The public `desktop-update.json`
reports version `0.2.14` for `darwin-aarch64`.

| Payload | SHA-256 |
| --- | --- |
| macOS DMG | `fd6584299843c81d0f5d436e3b6e5cdfba6daa9fe007e133bf4f806707cb7596` |
| Signed updater archive | `efc27955300034126617866afc6fa02e2d0193bcb74ba965ae2349be6b2a3f72` |
| Linux server archive | `21ccbf73278d52480fce8d2b237f19ecb6354f4e3bff3cdb140770f734f7d19a` |

The Linux server archive is the CI artifact from run `36177274227` for the
same commit, downloaded and checked against its `.sha256`.

## Operational note

Signing over SSH needs the login keychain unlocked in the same tmux server as
the build, because an SSH session does not share the console's unlocked
keychain. The agent staged `security unlock-keychain` in a tmux session, the
owner typed the password there, and the keychain was locked again after
publication.
