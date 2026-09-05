# Self-hosting Gajae Code App

Gajae Code App is self-hosted from the **GitHub Releases** server artifact only:

<https://github.com/devswha/gajae-code-app/releases>

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

Gajae Code App runs as the per-user `gajae-app.service`; root privileges and a
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

## DNS host admission and reverse-proxy migration

The server now rejects unlisted DNS names before serving HTTP routes or
accepting WebSocket upgrades. With `ALLOWED_HOSTS` unset, `localhost` and
literal IPv4/IPv6 addresses continue to work. Matching `Host` and `Origin`
headers, an omitted `Origin`, or `X-Forwarded-Proto: https` do not admit a DNS
name. This prevents an attacker-controlled DNS name from reaching a loopback
server after rebinding.

**Compatibility change:** older releases accepted arbitrary matching DNS
Host/Origin pairs. Existing HTTPS reverse proxies, custom local DNS aliases
and tailnet DNS names must now be listed in the **app server's environment**.
Changing only Nginx's `server_name` is insufficient. Direct loopback/IP access
and SSH tunnels using `localhost` need no migration.

Before upgrading a DNS-based deployment, create a service drop-in:

```sh
systemctl --user edit gajae-app.service
```

Add a setting such as:

```ini
[Service]
Environment="ALLOWED_HOSTS=gjc.example.com,macbook.tailnet.example"
```

Replace these examples with names you control. Entries are comma-separated
hostnames without schemes, ports or paths. A leading dot such as
`.internal.example` admits that domain and all its subdomains; use an exact
name when only one host should be trusted. Source-development deployments
can put the same setting in `.env`; both Vite and the API server use it.

Keep the proxy forwarding the public Host (`proxy_set_header Host $host;` in
the [Nginx example](nginx-subpath-template.conf)). A proxy that uses a DNS
upstream name as Host must also list that name, or forward a loopback/IP Host;
the public browser origin still needs its own entry. HTTPS remains supported
with this explicit configuration. Forwarded headers do not replace admission.

After the upgrade, reload the service configuration and restart the app:

```sh
systemctl --user daemon-reload
systemctl --user restart gajae-app.service
curl --fail http://127.0.0.1:3001/health
```

Check the published page and its WebSocket connection. HTTP requests with an
unlisted Host return 403; WebSocket upgrades are rejected with 401. Configure
health checks using a permitted Host.

`ALLOWED_HOSTS=*` retains an explicit compatibility escape hatch, but disables
this DNS host protection. Host admission does not authenticate remote clients;
keep the existing loopback/VPN/tunnel or authenticated-proxy access boundary.

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
