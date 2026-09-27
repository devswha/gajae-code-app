#!/usr/bin/env bash
# Runs a command in a macOS build checkout over SSH, at a commit already on
# origin. For working from a Linux machine: the desktop shell (Tauri, the
# server payload, `src-tauri` cargo tests) only builds on macOS.
#
#   scripts/macos-remote.sh [--ref <git ref>] -- '<command>'
#
#   GAJAE_MAC_HOST      ssh destination of the Mac (required)
#   GAJAE_MAC_CHECKOUT  build checkout on the Mac, relative to its home or
#                       absolute (default: workspace/gajae-code-app/.gjc-worktrees/mac-build)
#
# The ref (default HEAD) is resolved here and must already be on an origin
# branch. The checkout is disposable: it is force-checked-out to that commit
# and cleaned of untracked files (ignored build outputs are kept, so builds
# stay incremental), and `npm ci` runs again whenever package-lock.json
# differs from its last install.
# The command runs in a zsh login shell from the checkout root, e.g.
#   scripts/macos-remote.sh -- 'npm run server:payload:macos && cargo test --locked --manifest-path src-tauri/Cargo.toml'
set -euo pipefail

ref=HEAD
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) ref="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "usage: $0 [--ref <git ref>] -- '<command>'" >&2; exit 64 ;;
  esac
done
command="$*"
if [ -z "$command" ]; then echo "usage: $0 [--ref <git ref>] -- '<command>'" >&2; exit 64; fi
host="${GAJAE_MAC_HOST:?set GAJAE_MAC_HOST to the ssh destination of the Mac}"
checkout="${GAJAE_MAC_CHECKOUT:-workspace/gajae-code-app/.gjc-worktrees/mac-build}"
sha="$(git rev-parse --verify "$ref^{commit}")"

remote_script=$(cat <<'REMOTE'
set -e
cd "$HOME"
cd "$GAJAE_CHECKOUT"
git fetch --quiet --prune origin
# Reachable from a remote-tracking branch, not merely present in the Mac's
# object store, which also holds the Mac's own unpushed work.
if [ -z "$(git branch -r --contains "$GAJAE_SHA" 2>/dev/null)" ]; then
  print -u2 "macos-remote: $GAJAE_SHA is not on origin; push it first."
  exit 65
fi
git checkout --quiet --force --detach "$GAJAE_SHA"
# Untracked leftovers go; ignored build outputs (node_modules, cargo target,
# the server payload) stay so builds remain incremental.
git clean -fdq
lock="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"
if [ "$(cat node_modules/.macos-remote-lock 2>/dev/null)" != "$lock" ]; then
  npm ci --no-audit --no-fund
  print -r -- "$lock" > node_modules/.macos-remote-lock
fi
print -r -- "macos-remote: $(git log --oneline -1) on $(hostname -s)"
eval "$GAJAE_COMMAND"
REMOTE
)

ssh -o BatchMode=yes "$host" /bin/zsh -l -s <<EOF
GAJAE_CHECKOUT=$(printf %q "$checkout")
GAJAE_SHA=$sha
GAJAE_COMMAND=$(printf %q "$command")
$remote_script
EOF
