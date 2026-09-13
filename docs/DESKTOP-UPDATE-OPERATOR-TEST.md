# Operator update test: beta.16 → next release

The owner will download beta.16 manually and test its update path when beta.17
is available. No beta.17 artifact or successful transition is fabricated as
part of beta.16 acceptance. Source/control tests and signed package checks
still run before beta.16 publication.

Use a disposable QA profile or account for destructive/failure scenarios.
For the owner's normal update, save work first; do not delete update journals,
change database files or force-retry an uncertain installation.

1. Record beta.16 product/desktop versions from About and its install method.
2. When the next release appears, click **Update**. It downloads only; the app
   must stay open. At ready, verify work and unsent text are still present.
3. While an agent/command is running, restart must defer with an explanation.
   Retry explicitly after the work is complete; no delayed restart is queued.
4. Click **Restart to install**. Record whether the previous app exits and the
   successor opens with the expected About version. Verify the embedded server
   works and existing projects, sessions and drafts remain available.
5. Collect the native evidence read-only using the actual desktop versions
   shown in the two releases (do not infer them from the beta numbers):

```sh
node scripts/release/collect-update-evidence.mjs \
  --data-root '/absolute/native/application/data/root' \
  --from SOURCE_DESKTOP_VERSION --to TARGET_DESKTOP_VERSION \
  --product TARGET_PRODUCT_VERSION > /tmp/gajae-update-evidence.json
```

The native root is the app's `app_local_data_dir`; a QA profile uses
`<qa-profile>/home/.gajae-app`. The collector reads only four fixed update
files. It rejects symlinks/oversized input, strips paths/free-form fields and
exports at most 64 diagnostic stages. It never removes a journal, changes a
preference, starts/stops a process or installs anything.

`completion-record-matches` means the recorded schema-2 committed receipt
matches the requested versions and no pending journal/staging slot was seen.
It is **not** proof of live process birth identity, signing, server health or
data survival (`liveInstallationVerified` is always false). Complete step 4
separately. `pending-installation` or `no-matching-completion` must not be
reported as a successful update.

Retain each transition's output before the next update replaces the current
receipt. For A→B→C use two separate records; for A→C supply A and C explicitly.
The same procedure covers skipped versions without editing updater code.

If an old beta.14 app cannot reach installation, a compatible official DMG
transition is needed to receive the new diagnostics. A fix in beta.16 cannot
retroactively change beta.14's running restart coordinator.
