# Publish a locally signed release through an existing draft

This route works with empty hosted signing secrets. Build and notarize on the
existing Mac using its Developer ID identity and `gajae-notary` profile, create
one **draft** with the finished assets, then run the explicit local verifier.
Only its `--publish` invocation makes that exact draft public. The hosted
workflow's unsigned-publication guard remains in force; do not dispatch it for
this local route.

The tool never creates a release, uploads/replaces/deletes an asset, changes a
tag, signs an artifact, reads a signing private key, or exports credentials.
It needs the existing authenticated `gh` session and macOS arm64 verification
tools. A publish request can cause GitHub to create the draft's still-absent
tag at its pinned target commit. Existing tags must already resolve to that
same commit, including annotated tags.

## Prepare the final candidate

The parent owns the final integrated commit/version and all build, Linux,
runtime, data-survival and GUI acceptance. Complete those gates before this
procedure. Build the Mac app at that exact commit, sign with the existing
identity, notarize/staple the app, build/sign/notarize/staple the DMG, and
regenerate its checksum **after** stapling. Keep `APPLE_SIGNING_IDENTITY`
exported throughout that build. No credential or PKCS#12 export is needed.
The existing signed-build instructions remain in
`docs/DESKTOP-TAURI-VERIFICATION.md`.

For the final SDK 0.16.4 candidate, `scripts/release/MACOS-ACCEPTANCE.md`
provides the pinned source snapshot, isolated build paths, bounded local
notarization, quarantined copy verification, and separate packaged smokes.

Use the exact same source commit for the Linux server archive and any optional
Linux desktop artifacts. Keep independent SHA-256 values from the accepted
local builds; do not take the expected hashes from the remote draft being
verified. The tool checks source/package versions and those independently
supplied byte hashes. It cannot prove which source produced a binary with the
same version, and does not claim reproducible-build provenance.

In a shell at the reviewed checkout, set these values explicitly:

```sh
. "$HOME/.nvm/nvm.sh"
nvm use 22
REPO=devswha/gajae-code-app
RELEASE_COMMIT=REPLACE_WITH_REVIEWED_FULL_40_CHARACTER_COMMIT
test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"
git diff --quiet
git diff --cached --quiet
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
TEAM_ID=5987KT43TJ
DMG=/absolute/path/to/accepted/macos.dmg
SERVER=/absolute/path/to/accepted/server.tar.gz
NOTES=/absolute/path/to/reviewed-release-notes.md
test "$(basename "$DMG")" = "gajae-app-desktop-$VERSION-macos-arm64.dmg"
test "$(basename "$SERVER")" = "gajae-app-server-$VERSION-linux-x64-node22.tar.gz"
test -f "$DMG.sha256"
test -f "$SERVER.sha256"
DMG_SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
SERVER_SHA="$(shasum -a 256 "$SERVER" | awk '{print $1}')"
```

The displayed file paths are placeholders: use the canonical filenames tested
above. Each `.sha256` file must contain one line, `HASH  BASENAME`, without an
absolute/relative directory path or extra entries. Existing publication files
are never rewritten by this tool. Fix malformed sidecars only in the new local
candidate's staging directory before draft creation.

## Create an unpublished draft, then verify it

A draft is unpublished; do not treat draft assets as secret storage. Never
include signing material. The commands below are for the parent to invoke
after acceptance, not a workflow to dispatch. `gh release create` must fail
if a release already exists for the tag; do not delete/recreate it or use an
asset upload with `--clobber` to get past that failure.

```sh
prerelease_args=()
if [[ "$VERSION" == *-* ]]; then prerelease_args+=(--prerelease); fi
gh release create "$TAG" \
  "$DMG" "$DMG.sha256" "$SERVER" "$SERVER.sha256" \
  --repo "$REPO" --target "$RELEASE_COMMIT" --draft \
  --title "Gajae Code App $TAG" --notes-file "$NOTES" \
  "${prerelease_args[@]}"

gh release view "$TAG" --repo "$REPO" \
  --json databaseId,tagName,targetCommitish,isDraft,isPrerelease,assets
DRAFT_ID="$(gh release view "$TAG" --repo "$REPO" --json databaseId --jq .databaseId)"

verify_args=(
  --repo "$REPO" --draft-id "$DRAFT_ID" --tag "$TAG" --commit "$RELEASE_COMMIT"
  --team-id "$TEAM_ID"
  --asset "$(basename "$DMG")=$DMG_SHA"
  --asset "$(basename "$SERVER")=$SERVER_SHA"
)
node scripts/release/local-release.mjs "${verify_args[@]}"
```

Successful output has `status: "verified-draft"`, the exact repo, numeric draft
ID, tag, commit, team and computed hashes for all assets. Default invocation
performs no GitHub write. Missing arguments exit 2; any validation failure
exits 1 and leaves the draft and its assets intact. An already-public release
is refused before downloads or publication.

For additional Linux desktop payloads, include each artifact and sidecar in
the initial draft creation and append one `--asset "BASENAME=SHA256"` entry per
payload to `verify_args`. Unknown or missing assets block publication rather
than being ignored or removed. The canonical Mac DMG and Linux server archive
remain mandatory. Optional payloads receive hash/sidecar validation here;
their platform/installer acceptance remains with their packaging owner.

## Explicit publication, after reviewing the verification result

Stop other publishers and edits to this draft/tag for the final invocation:

```sh
node scripts/release/local-release.mjs "${verify_args[@]}" --publish
```

This re-downloads and re-verifies everything; a previous report is not a bypass.
After validation it changes only `draft` to `false` on the specified numeric
release ID using `gh api ... --method PATCH --field draft=false`. This has the
publication effect of `gh release edit "$TAG" --draft=false`, but binds the
write to the verified ID rather than looking up the tag again. It preserves
notes, title, prerelease status and every existing asset. Do not run an
unguarded `gh release edit --draft=false` after an old verification report.

Each invocation requires:

- An unpublished draft with the exact tag and full `target_commitish`; branch
  targets such as `main` are rejected. The remote commit must exist and its
  `package.json` must match the app name and tag version.
- An exact asset set matching the caller's independent hashes and sidecars,
  including uploaded state, IDs, lengths and any supplied GitHub digests.
  Downloads use asset IDs and exclusively created temporary files.
- The Linux archive's root package name/version and the copied Mac payload's
  package name/version. `CFBundleIdentifier` and desktop version are checked
  independently against product identity and the pinned source commit.
- Developer ID signatures from the explicitly named team, hardened app
  runtime, valid DMG/app staples, Gatekeeper acceptance, and arm64 desktop and
  sidecar binaries. The app is checked both on the read-only mount and after
  copying to a quarantined writable location outside a checkout.
- Unchanged draft metadata/assets and tag after downloads and verification,
  immediately before the optional publication request.

The last recheck and publication request are separate operations. They are
**not atomic**; the single-publisher/no-concurrent-edits requirement is part of
this procedure. Drafts remain mutable, and repository release immutability is
not enabled or changed by this tool. A publication transport error can have an
unknown outcome: inspect the exact release ID before any retry. The tool never
automatically retries, deletes assets, or moves a public release back to draft.
Errors after requesting publication report `status: "publication-outcome-unknown"`
and exit 1; they do not claim that the release stayed unpublished.

Command waits are bounded: 2 minutes for metadata/local verification commands,
10 minutes per download, at most 16 payloads plus their checksum sidecars. All
temporary downloads and copies are removed normally. If image detachment
cannot be confirmed, the tool retains and reports its temporary directory;
inspect/detach that mount before deleting it. It never recursively removes a
directory that may still be mounted.

Implementation validation on September 6, 2026 (KST) included a fresh download
of the already-published beta.8 DMG (asset ID `542909888`). Its recorded SHA-256
`d4484b203846ffac92dd870c63aa0c7d7124c1130ac10499b8eb9730bcbad2d8`
matched; the real macOS checker passed signatures, expected team, staples,
Gatekeeper, mounted/quarantined-copy verification, package/desktop versions
and arm64 binaries. The temporary image/copy were removed after detachment.
This historical fixture validates the tooling, not the upcoming candidate.

No new candidate was built, draft created, release published or signing
credential exported while implementing this route. The parent must run it
against the final integrated, accepted artifacts.
