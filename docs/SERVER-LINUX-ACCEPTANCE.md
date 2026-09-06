# Linux server archive acceptance

`.github/workflows/server-linux.yml` builds and checks the canonical self-hosted
server archive independently of desktop packaging and release publication.
The supported deployment contract remains [SELF-HOST.md](SELF-HOST.md).

## Source and artifacts

The workflow runs for relevant pull-request and main changes, or by manual
dispatch. A dispatch can specify `source_sha`, a full lowercase 40-character
commit ID; an empty input selects the dispatched commit. Pull requests select
their head commit. Every checkout is pinned to that SHA, including both smoke
jobs. A PR run therefore proves its head, not the eventual merge commit.

Builds run on Ubuntu 22.04, assert glibc **2.35** and Node **22.22.2**, fetch
Bun **1.4.0**, and run `npm run server:bundle`. That existing builder rebuilds
native Node dependencies and audits glibc symbol requirements. The archive's
timestamps use the source commit time through `SOURCE_DATE_EPOCH`.

The build artifact contains exactly:

- `gajae-app-server-<package.version>-linux-x64-node22.tar.gz`
- The same filename with `.sha256` appended.

A separate `build.json` records the full source SHA, filename, SHA-256, Node
and glibc versions, and source timestamp. Both validation jobs download the
same archive and provenance from the build job, verify the checksum and source
binding, and check the extracted package version against the source checkout.
They do not rebuild or install npm dependencies.

The workflow has only `contents: read`, disables persisted checkout credentials,
and uses the action revisions pinned in the repository. It does not access
release environments, provider/signing secrets, publish releases, dispatch other
workflows, or announce results. Artifact upload is build output, not publication.
Source `npm run verify` remains the separate CI gate.

## Runtime acceptance

The Ubuntu 22.04/glibc 2.35 and Ubuntu 24.04/glibc 2.39 jobs each extract under
`RUNNER_TEMP`, then invoke the existing packaged-server harness with
`--server-archive-root`. The harness makes an independent disposable copy,
rejects ancestor dependency fallback, external payload symlinks and `.env`, and
launches host Node with `scripts/gajae-app-runtime.mjs start` from the archive.

Standard smoke verifies:

- Health identity/version and real frontend HTML plus its compiled JS asset.
- Normal server owner authentication with a generated deployment API key;
  missing/invalid keys and foreign origins are rejected on HTTP and WebSocket.
- Packaged SQLite, node-pty, lightningcss, GJC native manifest hashes and version
  sentinel, pinned Bun, Rust core, and ripgrep execution.
- A real packaged Bun worker `worker.initialize`/`worker.shutdown` handshake,
  including success acknowledgements and graceful process exit, without a
  provider login or model completion.
- Authenticated GJC job admission, confirmed abort, and ordered durable terminal
  replay, plus migration of a preserved v6 jobs database to v7.
- Socket-local job subscriptions, replay and malformed-request recovery, and
  real terminal spawn/input/resize/reconnect/exit behavior.

Data survival is a **separate invocation**. It boots twice against the same
disposable data directory, preserving an auth database project row, a GJC job,
and gap-free interruption events across graceful shutdown. It checks resume
admission, abort cleanup, and idempotent SQLite schemas. Each boot receives a
new test API key, so the replaced fixture key must fail. This does not assert
that production deployment keys automatically rotate on restart.

Archive smoke never accepts `--project-dir`: it creates a private HOME and a
temporary Git project under the user's home, then removes only its own fixture
and copied payload. Provider credentials, Node loader overrides, configuration
roots and the caller's project are not inherited. No paid/provider inference
or destructive testing on a user project is part of acceptance.

## Local reproduction and release preparation

On a native Linux x64 host with Node 22.22.2 or newer within Node 22, checksum
verify the canonical archive and extract it outside any source checkout:

```sh
ASSET=gajae-app-server-<version>-linux-x64-node22.tar.gz
sha256sum --check "$ASSET.sha256"
ARCHIVE_ROOT="$(mktemp -d)"
tar -xzf "$ASSET" -C "$ARCHIVE_ROOT"
node /path/to/exact-source/scripts/release/smoke-packaged-server.mjs \
  --server-archive-root "$ARCHIVE_ROOT"
node /path/to/exact-source/scripts/release/smoke-packaged-server.mjs \
  --server-archive-root "$ARCHIVE_ROOT" --data-survival
```

Keep the canonical archive and checksum together. For release preparation,
select artifacts whose `build.json.sourceSha` equals the **final release source
commit** and whose complete workflow succeeded on both Ubuntu versions. A
build-only artifact, an earlier PR head, a locally built Ubuntu 24.04 archive,
or desktop deb/AppImage acceptance is insufficient. Record source CI results
separately. After any source change or merge, rebuild and accept the final SHA;
do not relabel an earlier archive as that commit.

Download the canonical artifact and both Ubuntu evidence artifacts while they
are retained (14 days). Each evidence artifact includes provenance, host
versions, and separate standard/data-survival logs; failed checks also upload
available diagnostics. Publishing or running the independent release workflow
is a separate parent/release-owner action.

Focused source checks:

```sh
node --test scripts/release/packaged-server-paths.test.mjs \
  scripts/release/server-archive-smoke.test.mjs
```

These regression tests cover CLI/host guards, archive containment and missing
dependencies, normal authentication, worker failure/timeout handling, and abort
replay evidence. They do not establish Linux binary compatibility; that requires
the real archive checks on both Ubuntu runners.
