# Gajae Code App 2.0.0-beta.18

Product: `2.0.0-beta.18`; desktop: `0.2.12`; SDK: `0.16.4`.
macOS Apple Silicon desktop and Linux x64 self-hosted server.

## Changes

- Docks the macOS built-in browser beside chat (#111): resizable and
  full-window layouts, theme-aware browser chrome, and preserved drafts.
- Routes built-in GJC model presets through configured proxy providers while
  preserving fallback and always modes (#105).
- Keeps long mobile approval questions scrollable with pinned actions (#95).
- Replaces the persistent history controls row with a contextual
  "Get all messages" pill (#89).
- Keeps website download links and release dates synchronized with the newest
  published release (#108).
- Fixes updater browser-owner staleness: browser state is refreshed before
  prepare and restart reads stay pure (#109).
- Records the beta.17 acceptance and publication notes (183842f).

## Published release

Published `2026-09-14T08:06:04Z`. Release ID `388226403`.
The tag, source, and main-at-tag all resolve to exactly
`48a62125c0d5380a475075a24d1be6db5a6d10e5`.

The public updater manifest reports version `0.2.12`, targets the
`v2.0.0-beta.18` release URL, and includes a signature.

| Payload | SHA-256 |
| --- | --- |
| macOS DMG | `9563141677e3d41188436190798021b4c2c6c4ec461eda514710a79c40213b4b` |
| Signed updater archive | `147b09b90029c981d9240a65b000add0c0529ebe1e4db13bb152cec94e58aa5e` |
| Linux server archive | `d929363f5ff529445a85074d55b7a6437fb4a688d74b25ac3e31807a1c214028` |

## Release boundary

Any updater-enabled macOS build must be production-bound at compile time with
`GJC_UPDATE_MODE=production`, its production feed origin and updater public key,
then Developer ID signed, notarized and stapled before publication.

This post-hoc record documents the tag contents and the published bytes. The
candidate CI run ids, notarization receipts, packaged-smoke results and any
A-to-B update transition for this release were not recorded here; do not cite
this file as evidence of them.
