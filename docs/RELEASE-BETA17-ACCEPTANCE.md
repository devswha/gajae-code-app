# beta.17 release acceptance

Published `2026-09-14T03:28:39Z`. Release ID `388130063`.
The tag, source, and main all resolve to exactly
`0f0b5b62929e7ef8b5aa176b323467f4509cfdc8`.
Product `2.0.0-beta.17`, desktop `0.2.11`, SDK `0.16.4`.

PR #106 contains the release change. This acceptance note is a subsequent
documentation-only change.

## Source and package validation

- Candidate CI `34800543179`: Node 22 and Node 24 succeeded.
- Candidate macOS CI `34800543165`: ad-hoc desktop build succeeded.
- Candidate Linux CI `34800543169`: Linux server build and Ubuntu acceptance
  succeeded.
- Release workflow `34801102799`: Linux build and smoke succeeded. The hosted
  macOS path was intentionally blocked by missing secrets, so the local signed
  path was used.
- The guarded local verifier verified the release, then published it. Packaged
  smoke passed 7/7, and the separate data-survival check passed.

## Signing, notarization, and distributed bytes

Developer ID team `5987KT43TJ`.

- App notarization `af29d750-ecc0-4583-8056-55e018d23ac2`: Accepted.
- DMG notarization `cd6a8807-9b4a-45bd-9911-bbd271516592`: Accepted.
- Updater binding: `updateMode=production`.
- Runtime manifest: `fd0ff62c663d26d18e0474f63ded99e4b2518525d935a8739c1de76b21906f4d`.
- Payload manifest: `09e38f6feb75d885c28af1df0351cfba6b6132f398b07aab42a60a36c4108c2c`.

| Payload | SHA-256 |
| --- | --- |
| macOS DMG | `1fb0f6fb67944a8aee823b423b17f2699a55ceda53086a14e30c201fc86933f8` |
| Signed updater archive | `0ed9337e8e5ae7627c5cfcf06599b7359d525dc4c94a7f4b6401fd9ec9e98e58` |
| Linux server archive | `fed8d175860746265ff2ec2a9d49f49c8d8123d850309a823305ad61a598ce7b` |

The public updater manifest reports version `0.2.11`, targets the
`v2.0.0-beta.17` release URL, and includes a signature.

## Explicitly unclaimed tests

The real installed beta.16 → beta.17 update click has not been claimed; it is
the user's planned test. The physical CUA drill and macOS 13 runtime
qualification were not performed.
