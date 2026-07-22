# Install the Gajae App server release

Gajae App is installed from a verified GitHub Release artifact. The only
supported artifact source is:

<https://github.com/devswha/gajae-code-app/releases>

The first supported target is the Linux x86_64 server artifact for Node.js 22
and glibc 2.35 or newer. Do not use a package registry, container image,
desktop delivery, source build, or a mutable download URL for a production
installation.

## Paths and prerequisites

```sh
CHECKOUT="$HOME/.local/share/gajae-app"
RUNTIME="$HOME/.gajae-app"
REPOSITORY="https://github.com/devswha/gajae-code-app"
RELEASES="https://github.com/devswha/gajae-code-app/releases"

# Required platform contract:
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
getconf GNU_LIBC_VERSION    # requires glibc 2.35 or newer
node --version              # requires v22
```

`$CHECKOUT` is the canonical Git checkout for source review and selective
upstream intake. It is separate from release payloads and must not be created,
replaced, or deleted by a release deployment. Create it only when the source
review or [upstream intake](UPSTREAM.md) process needs it:

```sh
git clone "$REPOSITORY" "$CHECKOUT"
```

Release state belongs below `$RUNTIME`:

- `$RUNTIME/releases/<version>` holds one unpacked, immutable release.
- `$RUNTIME/current` is the symlink selected by `gajae-app.service`.
- `$RUNTIME/data` holds persistent user data and must survive cutovers.

## Install a pinned release

Set `VERSION` to the reviewed release version without a leading `v`. The
commands fetch the archive and checksum from the same immutable release tag,
verify the checksum before extraction, then install the new version without
activating an unverified payload.

```sh
set -eu

VERSION=<approved-version>
TAG="v$VERSION"
ARTIFACT="gajae-app-server-$VERSION-linux-x64-node22.tar.gz"
CHECKSUM="$ARTIFACT.sha256"
RELEASE_DIR="$RUNTIME/releases/$VERSION"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$RUNTIME/releases" "$RUNTIME/data"
test ! -e "$RELEASE_DIR"

curl --fail --location --output "$TEMP_DIR/$ARTIFACT" \
  "$RELEASES/download/$TAG/$ARTIFACT"
curl --fail --location --output "$TEMP_DIR/$CHECKSUM" \
  "$RELEASES/download/$TAG/$CHECKSUM"
(
  cd "$TEMP_DIR"
  sha256sum --check "$CHECKSUM"
)

mkdir "$RELEASE_DIR"
tar --extract --gzip --file "$TEMP_DIR/$ARTIFACT" --directory "$RELEASE_DIR"
test -f "$RELEASE_DIR/dist-server/server/index.js"
```

Do not use a `latest` asset. A checksum mismatch, an existing version
directory, or a missing server entry point is a failed install; remove only the
newly created release directory after inspecting the failure.

## Install and start the per-user service

The service unit is `gajae-app.service` and runs the guarded entry point under
the `current` symlink. Render every placeholder before installing the unit,
then atomically select the verified first release.
```sh
UNIT_SOURCE="$RELEASE_DIR/packaging/systemd/gajae-app.service"
UNIT_DEST="$HOME/.config/systemd/user/gajae-app.service"
NODE_BIN="$(command -v node)"
mkdir -p "$(dirname "$UNIT_DEST")"
sed \
  -e "s|@APP_ROOT@|$RUNTIME/current|g" \
  -e "s|@NODE_BIN@|$NODE_BIN|g" \
  -e "s|@HOST@|127.0.0.1|g" \
  -e "s|@PORT@|3001|g" \
  "$UNIT_SOURCE" > "$UNIT_DEST"
chmod 0644 "$UNIT_DEST"
if grep -q '@[A-Z_][A-Z_]*@' "$UNIT_DEST"; then
  echo "Unresolved systemd placeholder" >&2
  exit 1
fi
ln -s "$RELEASE_DIR" "$RUNTIME/current.next"
mv -Tf "$RUNTIME/current.next" "$RUNTIME/current"

systemctl --user daemon-reload
systemctl --user enable --now gajae-app.service
systemctl --user --no-pager --full status gajae-app.service
curl --fail http://127.0.0.1:3001/health
```

If systemd reports an error or the health request fails, stop the service,
remove the new `current` link, and inspect `journalctl --user -u
gajae-app.service`. Do not delete `$RUNTIME/data` while recovering.

For release cutover and rollback after the first install, use
[SELF-HOST.md](SELF-HOST.md).
