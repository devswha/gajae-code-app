# Gajae Code App 2.0.0-beta.16

Product: `2.0.0-beta.16`; desktop: `0.2.10`; SDK: `0.16.4`.
macOS Apple Silicon desktop and Linux x64 self-hosted server.

## Changes

- Corrects a reproduced macOS restart veto caused by an unrelated signed
  process whose executable was deleted by an external upgrade. Positive kernel
  signing and stable process-birth evidence distinguish that foreign role;
  required/owned/ambiguous processes still block installation.
- Preserves restart failure reasons across window reloads and records bounded,
  private diagnostic stages. Runtime busy, unknown and timeout are distinct.
- Downloads stop at ready. Installation requires a separate **Restart to
  install** click; download completion and status polling cannot restart work.
- The precommit screen says **Preparing to restart**, without claiming that
  installation has started or showing premature authorization guidance.
- Adds read-only update evidence capture and a release version preparation
  command that synchronizes package/Cargo versions without changing dependencies.
- Includes the merged provider quota rings, model YAML profile fixes and
  experimental ego lite backend from the preceding main changes.

## Installation and test boundary

Download the official macOS DMG, save work and quit the old app before replacing
it. Existing application data should be retained; do not delete the data root
or edit update journals. The owner will test beta.16 → beta.17 when that version
is available. No beta.17 artifact or completed transition is claimed here.

The installed beta.14 click had no preserved native logs. The deleted-image
census failure was reproduced on the same Mac and corrected; this does not
prove that every historical failed click had that sole cause.

After a browser terminal has been used, its arbitrary descendants cannot yet
be fully accounted for from the PTY leader exit alone. That safety guard remains;
the app now explains this refusal and recommends saving work, quitting/reopening
and explicitly retrying, or using the manual installer. It does not clear the
uncertainty or force-stop work merely to make an update pass.

The release retains the existing production updater key/feed contract, signed
archive validation, draft and backend admission gates, process ownership checks
and successor-health journal. Automatic checks remain checks-only.
