# Gajae App sandboxes

Gajae App sandbox templates are built and used locally. The application template tags are:

| Agent | Local template |
| --- | --- |
| Gajae Code (GJC) | `gajae-app-sandbox:gjc` |

The local lifecycle never pulls or publishes an application image and never installs Gajae App from a package registry. Build the template from a prepared repository runtime before invoking `sbx`.

## Prerequisites

- Docker and the `sbx` CLI. See the [Docker Sandboxes guide](https://docs.docker.com/ai/sandboxes/get-started/).
- A local Gajae App repository runtime for Linux x64 and Node 22. It must contain the built client and server plus its local dependencies.
- Gajae Code credentials stored with `sbx`, for example `sbx secret set -g gajae`.

From the repository root, confirm the required local source exists:

```bash
test -f package.json
test -f dist/index.html
test -f dist-server/server/cli.js
test -d node_modules
```

The Dockerfiles validate these inputs, Node 22, Linux x64, and the required native modules. A missing input stops the build with a `Gajae App sandbox build failed` message; obtain or build the prepared repository runtime locally rather than falling back to an external application image or package installation.

## Build local templates

Run these commands from the repository root. The build context must be the repository root, not `docker/`.

```bash
docker build --file docker/gjc/Dockerfile --tag gajae-app-sandbox:gjc .
```

The image installs the prepared repository runtime at `/opt/gajae-app` and exposes its canonical CLI as `gajae-app`. Sandbox data and logs remain under `/home/agent/.gajae-app`; the server log is `/home/agent/.gajae-app/logs/sandbox.log`.

Before starting a sandbox, verify that the exact local template exists. Do not substitute a different image when this check fails.

```bash
AGENT=gjc
docker image inspect "gajae-app-sandbox:${AGENT}" >/dev/null 2>&1 || {
  printf 'Missing local template gajae-app-sandbox:%s. Build it from this repository first.\n' "$AGENT" >&2
  exit 1
}
```

## Launch and manage

The installed CLI selects the local template automatically:

```bash
gajae-app sandbox ~/my-project
gajae-app sandbox ~/my-project --port 8080
gajae-app sandbox ls
gajae-app sandbox logs my-project
```

Use `sbx` directly for branch mode, multiple workspaces, prompts, and other generic agent workflows. Supply the local Gajae App template explicitly:

```bash
sbx run --template gajae-app-sandbox:gjc gjc ~/my-project --branch my-feature
sbx run --template gajae-app-sandbox:gjc gjc ~/my-project -- "Fix the auth bug"
sbx ports my-project --publish 3001:3001
```

Generic agents remain usable through `sbx` with a user-provided local template. Only `gajae-app-sandbox:gjc` includes Gajae App.

Manage sandbox lifecycle with `sbx`:

```bash
sbx ls
sbx stop my-project
sbx start my-project
sbx rm my-project
sbx exec my-project bash
```

## Logs and configuration

The sandbox startup script runs from the agent shell and starts Gajae App on port `3001` unless `SERVER_PORT` is set. It binds to `0.0.0.0` so `sbx ports` can publish it.

Read the canonical server log with:

```bash
sbx exec my-project bash -c 'cat ~/.gajae-app/logs/sandbox.log'
```

`/tmp/gajae-app-ui.log` is an internal compatibility symlink to that canonical log. Do not use it as a data location.

Use `--env SERVER_PORT=<port>` with `gajae-app sandbox` when creating a sandbox, then publish the matching port with `sbx ports`.
