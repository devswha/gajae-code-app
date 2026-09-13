# beta.14 restart failure: reproduced owner-census veto

2026-09-13, macOS arm64. The installed app is desktop 0.2.8 (beta.14).
Its stdout/stderr are connected to `/dev/null`; the original failed click has
no recoverable native stage trace. Do not call the following a historical
trace of that click.

## Reproduced failure and correction

The original read-only native same-user census failed four times on this Mac
with `executable path missing, denied or truncated`. A still-running Codex CLI
had an executable under a removed npm upgrade directory. `proc_pidpath`
returned `ENOENT` although its BSD process identity was live. Kernel code
signing still reported a valid signed `codex` image belonging to a different
Developer ID team from this app.

The restart coordinator first presents the bundled screen, then prepares the
backend, then captures owned processes. A census error there calls the
precommit abort path, restores the SPA and never commits, stops the server,
records manual install intent or installs. This reproduces a concrete cause
of the reported “flash and return” behavior on the affected machine.

The owner scanner now distinguishes exactly `ENOENT` from denied/truncated
paths. For an unrequired missing-path PID only, it can establish positive
foreign identity with:

- stable full BSD birth/UID/parent identity;
- kernel `CS_VALID | CS_SIGNED`, without ad-hoc/debugged flags;
- a valid signing identifier outside the product/native/sidecar/Node/Bun/core
  reserved roles;
- a nonempty kernel signing team different from the running app's validated
  signing team, derived at runtime rather than hard-coded.

The signature and birth evidence participate in all repeated census checks.
Current and explicitly required PIDs remain strict. A missing-path child of
our server still fails complete child enumeration; it cannot disappear from
an owned tree through this exclusion. Same-team, unsigned, ad-hoc, debugged,
reserved-role, inaccessible and changing identities remain unknown.

The kernel operations and framing were checked against Apple's XNU
[`codesign.h`](https://github.com/apple/darwin-xnu/blob/main/bsd/sys/codesign.h)
and [`kern_proc.c`](https://github.com/apple/darwin-xnu/blob/main/bsd/kern/kern_proc.c).
Production code does not invoke `lsof`, read process arguments, or terminate
an unrelated process.

A Developer-ID-signed COPY of the test runner passed the real read-only
census on this Mac: 651 BSD identities, one positive foreign exclusion and
92 bundle identities. This verifies the previously failing census, not a
completed installed A→B update. The installed beta.14 app was not changed.

## Restart coordination

The same target/manifest/archive recheck helper is now used on both sides of
the presentation boundary. Both checks, their cancellation conditions, the
backend prepare/commit protocol, and the owned shutdown path remain present.
The manual precommit screen now says **Preparing to restart** and explicitly
states that installation has not started; OS authorization guidance stays on
the actual installation screen. The official updater still owns installation; no new installer, automatic
retry, or general state-machine framework is introduced.

## Separate shell limitation

An isolated real PTY/backend fixture also reproduced a process-lifetime
`pty_descendants_unverified` shell blocker after the PTY leader exited.
Leader exit cannot establish that arbitrary descendants are gone. No safe
minimal containment substitution exists: browser shells do not currently use
the native core PTY owner, and native server-tree capture happens after
backend preparation.

This release preserves that guard and exposes `updater_shell_unverified`
with actionable save-work/quit/reopen/retry or manual-installer guidance.
It is a diagnostic improvement, **not a fix of the shell ownership gap**.
Do not automatically clear the latch or kill work to make an update pass.

## Acceptance and operator follow-up

Synthetic native tests cover the exclusion and every refusal listed above,
including missing-path owned children. Native owner tests, full native tests,
clippy and fmt pass. Backend, shell and DOM tests cover the distinct shell
refusal without adding restart authority.

The owner will download beta.16 manually and test beta.16 → beta.17 when the
next version is available. See `DESKTOP-UPDATE-OPERATOR-TEST.md`. beta.16's
source/package/signing gates remain required; no beta.17 release or signed
transition result is fabricated. An already blocked beta.14 cannot receive a
new restart coordinator without completing an update or manual installation.
