# beta.16 release acceptance

Published 2026-09-13 at 11:20:53 UTC. Release ID `387875236`.
Tag `v2.0.0-beta.16` points to source
`281287a7abeeec1d283de92fb4f8ff574c6d7273`.
Product `2.0.0-beta.16`, desktop `0.2.10`, SDK `0.16.4`.

PRs #83, #84, #87, #85 and #86 implement the five stabilization steps; #88
integrates the version cut. Main merge `26cc8f6819dfeb29ded80e0f83a939896e5704ed`
has exactly the release source tree. The release tag uses the candidate SHA so
its macOS build and Linux artifact share the same independently checked source.
This acceptance note is a subsequent documentation-only change.

## Corrected failure and remaining boundary

A live unrelated Codex process retained a deleted executable. The old native
owner census repeatedly rejected its missing pathname and aborted restart
before commit. The replacement uses bounded kernel signing and BSD birth
identity to prove a foreign executable role; current/required/owned/ambiguous
processes remain strict. A Developer-ID-signed test copy passed the formerly
failing census on the affected Mac. The historical beta.14 click itself had
no retained native log, so it is not attributed exclusively to this cause.
See `DESKTOP-UPDATE-FAILURE-BETA14.md`.

The separate PTY descendant uncertainty guard remains. beta.16 identifies that
refusal and provides save-work/quit/reopen/retry or manual-installer guidance;
it does not pretend leader exit proves arbitrary descendants are gone.

Downloads now stop at ready and require a separate Restart to install click.
The native precommit screen distinguishes preparation from actual installation.
Failure reasons survive renderer replacement; diagnostics are private and bounded.

## Source and package validation

- Candidate CI `34752945690`: Node 22 and Node 24 full verify passed.
- macOS desktop CI `34752945539`: native tests and ad-hoc bundle passed.
- Linux server CI `34752945495`: exact-source archive plus Ubuntu 22.04/24.04
  acceptance passed. Downloaded provenance, archive bytes and checksum agree.
- Integrated local full verify, native clippy and fmt passed. Native tests:
  366 passed / 6 existing helper ignores; build-binding tests: 11 passed.
- Final-source GJC driver/wire E2E: 8 passed (controlled runtime, not a paid
  live-provider turn or browser GUI test).
- Quarantined DMG app copy: packaged-server 7 tests passed; separate data-survival
  smoke passed with idempotent schemas. Signature remained valid afterwards.

## Signing, notarization and distributed bytes

Fresh independent dependency/payload/Cargo build with production binding.
Developer ID: `sangwoo ha (5987KT43TJ)`.

- App notarization Accepted: `fe4bdfba-76de-46c4-b29c-6378dcac8e27`.
- DMG notarization Accepted: `e396fbd7-8d9f-4330-874b-329756a4c33a`.
- Both staples validated; Gatekeeper accepted the notarized app.
- Official updater signature verified with Minisign 0.12 and the existing
  production key. No key was changed or exported. Password was supplied only
  to the official signer child, never to artifact verifier processes or logs.
- Mounted DMG, quarantined copy and updater-extracted app inventories match.
  All inspected macOS deployment stamps are at most the declared 13.0 floor.
- Final build info reports production mode, beta.16 / 0.2.10,
  source runtime manifest `fd0ff62c663d26d18e0474f63ded99e4b2518525d935a8739c1de76b21906f4d`
  and signed payload manifest `8741456653d06395bf0038ec83582fd3839b8fe59437bf7211db828a558d5606`.

| Payload | SHA-256 |
| --- | --- |
| macOS DMG | `0092fc7a3b904918fec2bb0edd1b8a6de6007b6312120112702a72497377ca70` |
| Signed updater archive | `77f6b864bb1297f51d13d6d47da0737e0563fea1d5eb441f2993efd1e5504e2b` |
| Linux server archive | `ccf27b49fdd78cf3436b39ff8c972189f47b3a15c85fc29ecaf70392f47034c8` |

The guarded local release verifier downloaded and checked the exact eight draft
assets against independent hashes, signatures, versions and complete published
history (previous desktop floor 0.2.9), then returned `status: published`.
The public release and tag target were independently read back afterwards.

## Explicitly unclaimed tests

The owner will download beta.16 manually and test beta.16 → beta.17 when that
release exists. No beta.17 or completed new A→B transition is fabricated.
The installed beta.14 app and real user data were not replaced by this task.

An isolated copied app started with a fresh QA profile and persisted its native
server port. The GUI tool could not resolve that temporary app separately from
registered copies, so visual interaction and normal GUI quit/relaunch were not
completed. Only verified fixture executables were terminated for cleanup; their
exit was checked, and the temporary app registration/copy was removed. This is
not presented as a successful GUI quit or installation test.

Actual macOS 13 runtime qualification remains unperformed; deployment-stamp
validation is not execution on macOS 13. The Linux desktop and Windows draft
are not part of this release's acceptance.

Local evidence: `/private/tmp/gajae-beta16-release.PZopbI/` (build, notarization,
manifest/inventory, smoke, provenance, publication and QA-boundary records).
