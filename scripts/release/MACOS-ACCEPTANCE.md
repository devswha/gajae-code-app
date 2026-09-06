# Final macOS candidate acceptance

These are commands for the parent after final integration and `npm run verify`.
They build an unpublished candidate from an exact Git commit in a fresh source
snapshot, with private dependencies and Cargo output. They do not create a tag,
draft, public release, workflow run, or export signing credentials. Run the
blocks in order in the same **Bash** shell on the existing arm64 Mac. Keep the
output directory until the acceptance record and artifacts are handed off.

The candidate below requires SDK **0.16.4** in
the selected source, installed dependencies, and packaged copy. A future SDK
upgrade requires reviewing that expectation before using these commands.

## Pin and isolate the source

Replace the two explicit inputs. Use the final integrated 40-character commit,
including the release fixes, and its reviewed release version. A clean checkout
and matching HEAD are required so the parent's acceptance evidence identifies
the same source. The source verification gate and browser/live E2E belong to
the parent; an archive build cannot substitute for them.

```bash
. "$HOME/.nvm/nvm.sh"
nvm use 22
. "$HOME/.cargo/env"
set -euo pipefail

REVIEWED_CHECKOUT=/Users/devswha/workspace/gajae-code-app
RELEASE_COMMIT=REPLACE_WITH_FINAL_FULL_40_CHARACTER_COMMIT
EXPECTED_VERSION=REPLACE_WITH_REVIEWED_PACKAGE_VERSION
[[ "$RELEASE_COMMIT" =~ ^[a-f0-9]{40}$ ]]
test "$(git -C "$REVIEWED_CHECKOUT" rev-parse HEAD)" = "$RELEASE_COMMIT"
test -z "$(git -C "$REVIEWED_CHECKOUT" status --porcelain)"
test "$(uname -m)" = arm64

RELEASE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/gajae-macos-acceptance.XXXXXX")"
RELEASE_ROOT="$(cd "$RELEASE_ROOT" && pwd -P)"
RELEASE_SOURCE="$RELEASE_ROOT/source"
mkdir "$RELEASE_SOURCE" "$RELEASE_ROOT/artifacts" "$RELEASE_ROOT/acceptance"
git -C "$REVIEWED_CHECKOUT" archive --format=tar "$RELEASE_COMMIT" |
  tar -xf - -C "$RELEASE_SOURCE"
cd "$RELEASE_SOURCE"
VERSION="$(node -p "require('./package.json').version")"
DESKTOP_VERSION="$(node -p "require('./package.json').desktopVersion")"
test "$VERSION" = "$EXPECTED_VERSION"
node --input-type=module - "$RELEASE_SOURCE" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertOutOfTree } from './scripts/release/out-of-tree.mjs';
await assertOutOfTree(process.argv[2], 'Candidate source');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(pkg.dependencies['@gajae-code/coding-agent'], '0.16.4');
assert.equal(lock.packages['node_modules/@gajae-code/coding-agent'].version, '0.16.4');
NODE
printf '%s\n' "$RELEASE_COMMIT" > "$RELEASE_ROOT/source-commit.txt"
printf '%s\n' "$VERSION" > "$RELEASE_ROOT/package-version.txt"
shasum -a 256 package-lock.json > "$RELEASE_ROOT/source-lock.sha256"

export APPLE_SIGNING_IDENTITY='Developer ID Application: sangwoo ha (5987KT43TJ)'
node scripts/release/check-signing-readiness.mjs --mode local \
  --keychain "$HOME/Library/Keychains/login.keychain-db" --profile gajae-notary \
  > "$RELEASE_ROOT/signing-readiness.json"
node scripts/release/prime-ripgrep-cache.mjs
HUSKY=0 npm ci
test "$(node -p "require('./node_modules/@gajae-code/coding-agent/package.json').version")" = 0.16.4
node scripts/fetch-bun.mjs
test "$(dist-native/bun --version)" = 1.4.0
shasum -a 256 --check "$RELEASE_ROOT/source-lock.sha256"
```

The verified ripgrep cache avoids the old workaround of exporting a GitHub
token for its installer. Do not copy another checkout's `node_modules` or
pre-upgrade payload into the snapshot. `npm ci` and payload packaging can
download dependencies; keep their logs without printing environment variables.

## Build, sign, and notarize

The explicit `--app` and `--out` paths are necessary here: the signing and DMG
scripts' defaults still use `src-tauri/target`, while this build deliberately
uses a fresh `CARGO_TARGET_DIR`. Preserve the signing identity through both app
and DMG creation. No signing runs after app stapling.

```bash
export CARGO_TARGET_DIR="$RELEASE_ROOT/cargo-target"
npm run server:payload:macos 2>&1 | tee "$RELEASE_ROOT/payload-build.log"
env -u CI npm run tauri -- build --bundles app 2>&1 | tee "$RELEASE_ROOT/tauri-build.log"
APP="$CARGO_TARGET_DIR/aarch64-apple-darwin/release/bundle/macos/Gajae Code App.app"
test -d "$APP"
npm run desktop:sign:macos -- --app "$APP" 2>&1 | tee "$RELEASE_ROOT/sign-app.log"
codesign --verify --deep --strict "$APP"

ditto -c -k --keepParent "$APP" "$RELEASE_ROOT/app-notary.zip"
xcrun notarytool submit "$RELEASE_ROOT/app-notary.zip" \
  --keychain-profile gajae-notary --wait --timeout 60m --output-format json \
  > "$RELEASE_ROOT/app-notary.json"
node -e 'const r=require(process.argv[1]); if(r.status!=="Accepted") throw new Error("App notarization is not Accepted; inspect the recorded submission ID.");' \
  "$RELEASE_ROOT/app-notary.json"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type exec --verbose=2 "$APP"

npm run desktop:dmg:macos -- --app "$APP" --out "$RELEASE_ROOT/artifacts" \
  --artifact-version "$VERSION" 2>&1 | tee "$RELEASE_ROOT/dmg-build.log"
DMG="$RELEASE_ROOT/artifacts/gajae-app-desktop-$VERSION-macos-arm64.dmg"
xcrun notarytool submit "$DMG" \
  --keychain-profile gajae-notary --wait --timeout 60m --output-format json \
  > "$RELEASE_ROOT/dmg-notary.json"
node -e 'const r=require(process.argv[1]); if(r.status!=="Accepted") throw new Error("DMG notarization is not Accepted; inspect the recorded submission ID.");' \
  "$RELEASE_ROOT/dmg-notary.json"
xcrun stapler staple "$DMG"
(
  cd "$RELEASE_ROOT/artifacts"
  shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256"
  shasum -a 256 --check "$(basename "$DMG").sha256"
)
```

If a submission times out, stops, or is not `Accepted`, stop this sequence.
Inspect the ID from that submission with
`xcrun notarytool info SUBMISSION_ID --keychain-profile gajae-notary`.
Do not resubmit the same artifact while its outcome is unknown. Resume at
stapling only after that exact submission is accepted. A busy mount failure
retains and reports its temporary directory; detach the reported mount before
removing it. Do not use an unconditional recursive cleanup trap.

## Verify the distributed bytes and run both packaged smokes

This invokes the same macOS checker as the draft verifier, without a GitHub
request. It verifies the DMG and mounted/copy signatures, expected Developer ID
team, hardened app runtime, both staples, Gatekeeper, package/desktop versions,
and arm64 desktop/sidecar binaries. It detaches its image and leaves the
quarantined writable copy for the remaining acceptance.

```bash
node --input-type=module - "$DMG" "$RELEASE_ROOT/acceptance" "$VERSION" "$DESKTOP_VERSION" <<'NODE'
import { verifyMacosRelease } from './scripts/release/local-release-macos.mjs';
import { assertOutOfTree } from './scripts/release/out-of-tree.mjs';
const [dmg, root, version, desktopVersion] = process.argv.slice(2);
await assertOutOfTree(root, 'Installed candidate');
await verifyMacosRelease({ dmg, root, version, desktopVersion, teamId: '5987KT43TJ' });
console.log('Local DMG and quarantined-copy verification passed.');
NODE
COPIED_APP="$RELEASE_ROOT/acceptance/copy/Gajae Code App.app"
PAYLOAD="$COPIED_APP/Contents/Resources/resources/server-payload"
node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(p.version!=="0.16.4") throw new Error("Copied payload SDK is not 0.16.4");' \
  "$PAYLOAD/node_modules/@gajae-code/coding-agent/package.json"
test "$("$COPIED_APP/Contents/MacOS/gajae-app-server" --version)" = v22.22.2
test "$("$PAYLOAD/dist-native/bun" --version)" = 1.4.0
(
  cd "$RELEASE_ROOT"
  node "$RELEASE_SOURCE/scripts/release/smoke-packaged-server.mjs" \
    --tauri-app "$COPIED_APP" 2>&1 | tee packaged-server.log
  node "$RELEASE_SOURCE/scripts/release/smoke-packaged-server.mjs" \
    --tauri-app "$COPIED_APP" --data-survival 2>&1 | tee data-survival.log
)
codesign --verify --deep --strict "$COPIED_APP"
shasum -a 256 --check "$RELEASE_ROOT/source-lock.sha256"
(
  cd "$RELEASE_ROOT/artifacts"
  shasum -a 256 --check "$(basename "$DMG").sha256"
)
printf 'Acceptance directory: %s\nCopied app: %s\n' "$RELEASE_ROOT" "$COPIED_APP"
```

Use separate smoke invocations as shown. The integrated smoke runner creates
isolated home/project data and removes inherited provider credentials. Leave
`--project-dir` unset so it cannot register or mutate the working checkout.
These startup, admission/abort, replay and persistence checks do not establish
a successful live model response.

The parent must finish GUI acceptance from this exact copied app using a
disposable macOS account or, on macOS 14+, the explicit `--qa-profile` mode in
`docs/DESKTOP-QA-PROFILE.md`: sign-in link, launch/quit/relaunch, persistence,
profile separation and confirmation that the child server exits with the app.
The QA mode uses the public Webview builder setter because the pinned runtime
does not carry the data-store UUID through its configuration conversion. An
environment-only HOME override is insufficient. Record the GUI result
separately from build, notarization, and packaged-server results. Any authorized
live provider test must use only `openai/gpt-6-astra` with effort `xhigh` and
retain the app permission guard; do not enable raw SDK child delegation. OMG
skill testing is excluded by the current user instruction. Profile-based GUI
acceptance does not establish fresh OS permissions or clean-machine behavior.

Record the full commit, package/desktop/SDK and bundled runtime versions, DMG
hash, both notarization submission IDs, and each acceptance result. Linux
server/desktop acceptance remains separate and must use the same source commit.
Hosted CI signing is still blocked by its five missing Apple secret inputs;
local acceptance does not populate or validate those hosted secrets. Only
after all acceptance should the parent consider `LOCAL-RELEASE.md`; this
procedure itself performs no GitHub publication action.
