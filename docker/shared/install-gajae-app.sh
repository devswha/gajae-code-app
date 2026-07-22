#!/bin/bash
set -euo pipefail

APP_ROOT="${1:-/opt/gajae-app}"

fail() {
  printf 'Gajae Code App sandbox build failed: %s\n' "$*" >&2
  exit 1
}

for required_path in \
  package.json \
  package-lock.json \
  dist/index.html \
  dist-server/server/cli.js \
  public \
  shared \
  node_modules; do
  [ -e "$APP_ROOT/$required_path" ] || fail "prepared local source is missing $APP_ROOT/$required_path"
done

for native_module in better-sqlite3 node-pty; do
  [ -d "$APP_ROOT/node_modules/$native_module" ] || \
    fail "prepared local source is missing node_modules/$native_module"
done

command -v node >/dev/null 2>&1 || fail "the sandbox base image does not provide Node.js 22"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" = "22" ] || fail "Node.js 22 is required; found $(node --version)"

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) ;;
  *) fail "Linux x64 is required; found $(uname -s)/$(uname -m)" ;;
esac

install -d -m 0755 -o agent -g agent /home/agent/.gajae-app/logs
cat > /usr/local/bin/gajae-app <<'EOF'
#!/bin/sh
exec node /opt/gajae-app/dist-server/server/cli.js "$@"
EOF
chmod 0755 /usr/local/bin/gajae-app