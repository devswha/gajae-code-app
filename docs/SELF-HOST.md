# Self-hosting Gajae App

Gajae App is self-hosted from the **GitHub Releases** server artifact only:

<https://github.com/devswha/Gajae-code-app/releases>

The canonical artifact is
`gajae-app-server-<version>-linux-x64-node22.tar.gz`, accompanied by an
artifact with the same name plus `.sha256`. Do not substitute a package
registry, container image, desktop delivery, or an unverified source build.

## Supported target and filesystem layout

The first supported artifact target is Linux on x86_64 with glibc 2.35 or
newer and a Node.js 22 runtime. It is a server artifact only.

| Path | Purpose |
|---|---|
| `~/.local/share/gajae-app` | Canonical Git checkout for source review and manual upstream intake. It is not a release payload. |
| `~/.gajae-app/releases/<version>` | Immutable unpacked server artifacts. |
| `~/.gajae-app/current` | Symlink to the release used by the service. |
| `~/.gajae-app/data` | Persistent application data, including user-managed database, assets, and cache paths. |
| `~/.config/systemd/user/gajae-app.service` | Per-user systemd service. |

A release deployment must never create, replace, or delete the checkout.
Likewise, replacing a release must not delete `~/.gajae-app/data`.

Before the first deployment, confirm the host contract:

```sh
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
getconf GNU_LIBC_VERSION    # requires glibc 2.35 or newer
node --version              # requires v22
```

Use the release-install procedure in [INSTALL.md](INSTALL.md) to verify the
checksum, unpack a versioned release, install `gajae-app.service`, and activate
the initial `current` link.

## Service operations

Gajae App runs as the per-user `gajae-app.service`; root privileges and a
system-wide unit are not required.

```sh
systemctl --user status gajae-app.service
systemctl --user restart gajae-app.service
journalctl --user -u gajae-app.service -f
curl --fail http://127.0.0.1:3001/health
```

Use `loginctl enable-linger "$USER"` only when the host policy permits the
service to continue after logout.

Keep the service on loopback unless remote access is deliberately required.
Prefer a trusted VPN or an SSH tunnel; do not expose the server by raw public
port forwarding.

```sh
ssh -N -L 3001:127.0.0.1:3001 user@server
```

## Cutover to a verified release

A cutover changes only the `current` symlink and then restarts the service.
Download and checksum-verify the next artifact exactly as described in
[INSTALL.md](INSTALL.md); do not use a moving `latest` URL.

1. Record the active release before touching `current`.
2. Unpack the verified artifact into its new
   `~/.gajae-app/releases/<version>` directory.
3. Confirm that the expected server entry point is present.
4. Atomically replace `current`, restart the service, and check both systemd
   state and the health endpoint.
5. Keep the prior release directory until the new release is accepted.

```sh
RUNTIME="$HOME/.gajae-app"
VERSION=<approved-version>
RELEASE_DIR="$RUNTIME/releases/$VERSION"
PREVIOUS="$(readlink -f "$RUNTIME/current")"

test -f "$RELEASE_DIR/dist-server/server/index.js"
printf '%s\n' "$PREVIOUS" > "$RUNTIME/previous-release"
ln -s "$RELEASE_DIR" "$RUNTIME/current.next"
mv -Tf "$RUNTIME/current.next" "$RUNTIME/current"

systemctl --user restart gajae-app.service
systemctl --user --no-pager --full status gajae-app.service
curl --fail http://127.0.0.1:3001/health
```

If the service or health check fails, perform the rollback immediately rather
than troubleshooting against a partially accepted release.

## Rollback

`previous-release` contains the release path captured by the cutover commands.
Validate it is an installed release before atomically restoring it.

```sh
RUNTIME="$HOME/.gajae-app"
PREVIOUS="$(<"$RUNTIME/previous-release")"

case "$PREVIOUS" in
  "$RUNTIME"/releases/*) ;;
  *) printf '%s\n' "Refusing an unsafe rollback target: $PREVIOUS" >&2; exit 1 ;;
esac
test -f "$PREVIOUS/dist-server/server/index.js"

ln -s "$PREVIOUS" "$RUNTIME/current.rollback"
mv -Tf "$RUNTIME/current.rollback" "$RUNTIME/current"
systemctl --user restart gajae-app.service
systemctl --user --no-pager --full status gajae-app.service
curl --fail http://127.0.0.1:3001/health
```

Record the failed version and the rollback result in the deployment record.
Do not remove either release until the rollback health check succeeds.

## Removal boundary

To remove the service and release payload while preserving user data:

```sh
systemctl --user disable --now gajae-app.service
rm -f "$HOME/.config/systemd/user/gajae-app.service"
systemctl --user daemon-reload
rm -rf "$HOME/.gajae-app/releases"
rm -f "$HOME/.gajae-app/current" "$HOME/.gajae-app/previous-release"
```

This intentionally leaves `~/.gajae-app/data` and
`~/.local/share/gajae-app` untouched. Back up or remove either path only
through an explicit, separately reviewed data-retention decision.

## Source and upstream boundaries

The checkout at `~/.local/share/gajae-app` is for source review and deliberate
maintenance work. It is never the service working directory and is never
updated as part of a release cutover. Follow [UPSTREAM.md](UPSTREAM.md) for
manual, selective upstream intake; automated mirroring or synchronization is
not permitted.
