#!/usr/bin/env bash
#
# Gajae App deployment script (continuous-improvement lane, 2026-07-12)
# ---------------------------------------------------------------------------
# 실배포:
#   build → (failure: stop, leave service untouched) → systemctl --user restart gajae-app
#         → 3021 헬스체크(재시도) → 정상: last-good 기록 / 실패: 직전 last-good로
#           자동 롤백(격리 워크트리 재빌드 → dist 교체 → 재시작 → 재헬스체크)
#
# --dry-run:
#   프로덕션 무접촉. build 검증 + 라이브 헬스체크 + '직전 커밋을 격리 워크트리에
#   재빌드해 대체 포트(3099)/격리 HOME으로 부팅해 200 응답까지' 롤백 경로를 실검증.
#   실서비스는 재시작하지 않는다.
#
# 환경변수(오버라이드): DEPLOY_SERVICE / DEPLOY_HEALTH_URL / DEPLOY_HEALTH_TIMEOUT
#   / DEPLOY_STATE_DIR / DEPLOY_DRILL_PORT
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE="${DEPLOY_SERVICE:-gajae-app.service}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3021/}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-60}"
HEALTH_INTERVAL="${DEPLOY_HEALTH_INTERVAL:-2}"
STATE_DIR="${DEPLOY_STATE_DIR:-$HOME/.gajae-app/deploy}"
LAST_GOOD_FILE="$STATE_DIR/last-good-commit"
DRILL_PORT="${DEPLOY_DRILL_PORT:-3099}"

log() { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[deploy %s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

cd "$REPO_DIR"
command -v git  >/dev/null || die "git not found"
command -v npm  >/dev/null || die "npm not found"
command -v curl >/dev/null || die "curl not found"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
TARGET="$(git rev-parse HEAD)"
TARGET_SHORT="$(git rev-parse --short HEAD)"
mkdir -p "$STATE_DIR"

# Poll <url> for an HTTP 200 within <timeout> seconds. 0 = healthy.
health_check() {
  local url="$1" timeout="$2" waited=0 code
  while [ "$waited" -lt "$timeout" ]; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "$url" 2>/dev/null || true)"
    if [ "$code" = "200" ]; then return 0; fi
    sleep "$HEALTH_INTERVAL"
    waited=$(( waited + HEALTH_INTERVAL ))
  done
  return 1
}

# The commit a failed deploy rolls back to: the last successfully-deployed commit,
# or (first run / no marker) the immediate parent of HEAD.
rollback_target() {
  if [ -f "$LAST_GOOD_FILE" ] && [ -s "$LAST_GOOD_FILE" ]; then
    cat "$LAST_GOOD_FILE"
  else
    git rev-parse HEAD~1
  fi
}

# Build <sha> in an isolated git worktree (main node_modules symlinked so no
# reinstall). Sets WT_ROOT/WT_PATH; caller must call remove_worktree.
WT_ROOT=""
WT_PATH=""
build_in_worktree() {
  local sha="$1"
  WT_ROOT="$(mktemp -d /tmp/gjc-deploy-wt.XXXXXX)"
  WT_PATH="$WT_ROOT/wt"
  git worktree add --detach --quiet "$WT_PATH" "$sha" || die "worktree add failed for $sha"
  ln -s "$REPO_DIR/node_modules" "$WT_PATH/node_modules"
  if ! ( cd "$WT_PATH" && npm run build ) >/tmp/deploy-wt-build.log 2>&1; then
    die "build of $sha failed (see /tmp/deploy-wt-build.log)"
  fi
  if [ ! -f "$WT_PATH/dist/index.html" ] || [ ! -f "$WT_PATH/dist-server/server/cli.js" ]; then
    die "build of $sha produced no runnable bundle"
  fi
}
remove_worktree() {
  [ -n "${WT_ROOT:-}" ] || return 0
  git worktree remove --force "$WT_PATH" 2>/dev/null || true
  rm -rf "$WT_ROOT"
  WT_ROOT=""
  WT_PATH=""
}

# ---------------------------------------------------------------------------
#  --dry-run: verify the whole pipeline without touching the live service.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--dry-run" ]; then
  PREV="$(rollback_target)"
  PREV_SHORT="$(git rev-parse --short "$PREV")"
  log "DRY-RUN (production NOT restarted) · target=$TARGET_SHORT branch=$BRANCH · rollback-target=$PREV_SHORT"

  if health_check "$HEALTH_URL" 8; then
    log "① live healthcheck OK ($HEALTH_URL)"
  else
    log "① WARN: live service not healthy at $HEALTH_URL (dry-run continues)"
  fi

  log "② building target in main tree (proves forward build)…"
  if ! npm run build >/tmp/deploy-build.log 2>&1; then
    die "target build failed (see /tmp/deploy-build.log)"
  fi
  log "② target build OK"

  log "③ rollback drill: rebuilding $PREV_SHORT in an isolated worktree…"
  DRILL_HOME=""
  DRILL_PID=""
  drill_cleanup() {
    if [ -n "$DRILL_PID" ]; then
      # Kill the node process directly (plus any transient children). No setsid,
      # so $DRILL_PID IS the node pid — a process-group kill would miss it.
      pkill -TERM -P "$DRILL_PID" 2>/dev/null || true
      kill -TERM "$DRILL_PID" 2>/dev/null || true
      sleep 1
      pkill -KILL -P "$DRILL_PID" 2>/dev/null || true
      kill -KILL "$DRILL_PID" 2>/dev/null || true
    fi
    [ -n "$DRILL_HOME" ] && rm -rf "$DRILL_HOME"
    remove_worktree
  }
  trap drill_cleanup EXIT
  build_in_worktree "$PREV"
  DRILL_HOME="$(mktemp -d /tmp/gjc-deploy-home.XXXXXX)"
  log "③ booting rolled-back bundle on :$DRILL_PORT (isolated HOME)…"
  HOME="$DRILL_HOME" SERVER_PORT="$DRILL_PORT" \
    node "$WT_PATH/dist-server/server/cli.js" start >/tmp/deploy-drill-boot.log 2>&1 &
  DRILL_PID=$!
  if health_check "http://127.0.0.1:$DRILL_PORT/" 45; then
    log "③ ROLLBACK DRILL OK — $PREV_SHORT rebuilt + booted + healthcheck 200 on :$DRILL_PORT"
  else
    die "ROLLBACK DRILL FAILED — $PREV_SHORT did not become healthy on :$DRILL_PORT (see /tmp/deploy-drill-boot.log)"
  fi
  drill_cleanup
  trap - EXIT
  log "DRY-RUN complete ✓  build ✓  live-healthcheck ✓  rollback(rebuild+boot+healthcheck) ✓  — production untouched"
  log "A real deploy would ALSO: systemctl --user restart $SERVICE → healthcheck → on failure auto-rollback."
  exit 0
fi

# ---------------------------------------------------------------------------
#  Real deploy.
# ---------------------------------------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
  log "WARN: working tree dirty — only the committed HEAD ($TARGET_SHORT) is deployed"
fi
PREV="$(rollback_target)"
PREV_SHORT="$(git rev-parse --short "$PREV")"
log "DEPLOY target=$TARGET_SHORT (branch $BRANCH) · rollback-target=$PREV_SHORT"

log "building target…"
if ! npm run build >/tmp/deploy-build.log 2>&1; then
  die "build FAILED before touching the service — service left running as-is (see /tmp/deploy-build.log)"
fi

log "build OK; restarting $SERVICE…"
systemctl --user restart "$SERVICE" || die "restart failed — MANUAL CHECK NEEDED"

if health_check "$HEALTH_URL" "$HEALTH_TIMEOUT"; then
  echo "$TARGET" > "$LAST_GOOD_FILE"
  log "DEPLOY OK ✓ $TARGET_SHORT healthy at $HEALTH_URL — recorded as last-good."
  exit 0
fi

log "HEALTHCHECK FAILED after deploy — auto-rolling back to $PREV_SHORT…"
trap remove_worktree EXIT
build_in_worktree "$PREV"
rm -rf "$REPO_DIR/dist" "$REPO_DIR/dist-server"
cp -a "$WT_PATH/dist" "$WT_PATH/dist-server" "$REPO_DIR/"
remove_worktree
trap - EXIT
systemctl --user restart "$SERVICE" || die "rollback restart failed — MANUAL INTERVENTION NEEDED"
if health_check "$HEALTH_URL" "$HEALTH_TIMEOUT"; then
  log "ROLLBACK OK ✓ reverted to last-good $PREV_SHORT; service healthy. Target $TARGET_SHORT NOT live — fix & redeploy."
  exit 3
fi
die "ROLLBACK FAILED — service unhealthy even on $PREV_SHORT. MANUAL INTERVENTION NEEDED."
