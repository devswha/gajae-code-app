#!/usr/bin/env bash
# Repository-owned lifecycle manager for a local Gajae Code App deployment.
set -euo pipefail

readonly DEFAULT_REPOSITORY="https://github.com/devswha/gajae-code-app.git"
readonly DEFAULT_REF="main"
readonly SERVICE_NAME="gajae-app.service"

usage() {
  printf '%s\n' "Usage: $0 install|update|status [--json] [--ref <branch|tag|sha>] [--port <1-65535>] [--install-dir <absolute-path>]" >&2
}

die() {
  printf 'gajae-app: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'gajae-app: warning: %s\n' "$*" >&2
}

COMMAND="${1:-}"
case "$COMMAND" in
  install|update|status) shift ;;
  *) usage; exit 1 ;;
esac

JSON=false
REF="${GAJAE_APP_REF:-$DEFAULT_REF}"
PORT=""
INSTALL_DIR="${GAJAE_APP_INSTALL_DIR:-$HOME/.local/share/gajae-app}"
REPOSITORY="${GAJAE_APP_REPOSITORY:-$DEFAULT_REPOSITORY}"
SYSTEMCTL="${GAJAE_APP_SYSTEMCTL:-systemctl}"

while (($#)); do
  case "$1" in
    --json)
      JSON=true
      ;;
    --ref)
      (($# >= 2)) || die "--ref requires a value"
      REF="$2"
      shift
      ;;
    --port)
      (($# >= 2)) || die "--port requires a value"
      PORT="$2"
      shift
      ;;
    --install-dir)
      (($# >= 2)) || die "--install-dir requires a value"
      INSTALL_DIR="$2"
      shift
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

case "$INSTALL_DIR" in
  *$'\n'*) die "--install-dir cannot contain a newline" ;;
  /*) ;;
  *) die "--install-dir must be an absolute path" ;;
esac

validate_ref() {
  case "$REF" in
    ""|-*|*".."*|*"//"*|/*|*" "*|*"~"*|*"^"*|*":"*|*"?"*|*"["*|*"\\"*)
      die "invalid ref: $REF"
      ;;
  esac
  if [[ ! "$REF" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    die "invalid ref: $REF"
  fi
}

validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] || die "port must be an integer between 1 and 65535"
  ((10#$1 >= 1 && 10#$1 <= 65535)) || die "port must be between 1 and 65535"
}

normalize_remote() {
  local value="$1"
  value="${value%/}"
  value="${value%.git}"
  printf '%s' "$value"
}

require_prerequisites() {
  command -v git >/dev/null 2>&1 || die "git is required"
  NODE_BIN="$(command -v node || true)"
  [[ -n "$NODE_BIN" ]] || die "Node.js 22 is required"
  local version
  version="$($NODE_BIN --version 2>/dev/null || true)"
  [[ "$version" =~ ^v22\. ]] || die "Node.js 22 is required (found ${version:-missing})"
}

NODE_BIN=""
UNIT_DIR="${GAJAE_APP_SYSTEMD_USER_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}"
UNIT_FILE="$UNIT_DIR/$SERVICE_NAME"
STATE_DIR="$HOME/.gajae-app/deployment"
STATE_FILE="$STATE_DIR/deployment.env"
LOCK_DIR="$STATE_DIR/lock"

state_value() {
  local wanted="$1" key value
  [[ -f "$STATE_FILE" ]] || return 1
  while IFS='=' read -r key value; do
    if [[ "$key" == "$wanted" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done < "$STATE_FILE"
  return 1
}

write_state() {
  local update_state="$1" active_root="$2" sha="$3" previous_root="$4" previous_sha="$5" failure="${6:-}"
  mkdir -p "$STATE_DIR"
  local temporary="$STATE_FILE.$$.tmp"
  {
    printf 'ref=%s\n' "$REF"
    printf 'active_root=%s\n' "$active_root"
    printf 'sha=%s\n' "$sha"
    printf 'previous_root=%s\n' "$previous_root"
    printf 'previous_sha=%s\n' "$previous_sha"
    printf 'update_state=%s\n' "$update_state"
    printf 'failure=%s\n' "$failure"
    printf 'updated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$temporary"
  mv "$temporary" "$STATE_FILE"
}


is_git_checkout() {
  local root="$1"
  [[ -d "$root" ]] && [[ "$(git -C "$root" rev-parse --is-inside-work-tree 2>/dev/null || true)" == true ]]
}

assert_clean_checkout() {
  local root="$1"
  is_git_checkout "$root" || die "install directory is not a git checkout: $root"
  [[ -z "$(git -C "$root" status --porcelain)" ]] || die "refusing dirty checkout: $root"
}

assert_expected_remote() {
  local root="$1" actual
  actual="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
  [[ -n "$actual" ]] || die "checkout has no origin remote: $root"
  [[ "$(normalize_remote "$actual")" == "$(normalize_remote "$REPOSITORY")" ]] || die "refusing checkout with unexpected origin remote: $actual"
}

fetch_candidate() {
  local root="$1" candidate
  if [[ "$REF" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
    git -C "$root" fetch --quiet --no-tags origin "$REF" || die "ref is not fetchable from origin: $REF"
  else
    git -C "$root" ls-remote --exit-code origin "refs/heads/$REF" "refs/tags/$REF" >/dev/null \
      || die "ref is not present on origin: $REF"
    git -C "$root" fetch --quiet --no-tags origin "$REF" || die "could not fetch ref: $REF"
  fi
  candidate="$(git -C "$root" rev-parse --verify FETCH_HEAD^{commit} 2>/dev/null)" \
    || die "ref does not resolve to a commit: $REF"
  printf '%s' "$candidate"
}

assert_fast_forward() {
  local source_root="$1" current="$2" candidate="$3"
  git -C "$source_root" cat-file -e "$current^{commit}" \
    || die "recorded deployment commit is unavailable from persistent checkout: $current"
  [[ "$current" == "$candidate" ]] && return 0
  git -C "$source_root" merge-base --is-ancestor "$current" "$candidate" \
    || die "refusing non-fast-forward deployment (${current} is not an ancestor of ${candidate})"
}

read_env_value() {
  local root="$1" wanted="$2" line key value
  [[ -f "$root/.env" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" == "$wanted"=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" == "$wanted" ]] || continue
    printf '%s' "$value"
    return 0
  done < "$root/.env"
  return 1
}

configured_host() {
  local root="$1" value
  value="$(read_env_value "$root" HOST || true)"
  [[ -n "$value" ]] || value="127.0.0.1"
  [[ "$value" =~ ^[A-Za-z0-9._:-]+$ ]] || die "HOST contains characters unsafe for a systemd unit"
  printf '%s' "$value"
}

configured_port() {
  local root="$1" value
  if [[ -n "$PORT" ]]; then
    validate_port "$PORT"
    printf '%s' "$PORT"
    return
  fi
  value="$(read_env_value "$root" SERVER_PORT || true)"
  [[ -n "$value" ]] || value="$(read_env_value "$root" PORT || true)"
  [[ -n "$value" ]] || value=3001
  validate_port "$value"
  printf '%s' "$value"
}

is_loopback_host() {
  case "$1" in
    127.0.0.1|::1|localhost) return 0 ;;
    *) return 1 ;;
  esac
}

unit_quote() {
  local value="$1"
  [[ "$value" != *$'\n'* && "$value" != *'"'* && "$value" != *'\\'* ]] \
    || die "path or environment value cannot be safely rendered into a systemd unit"
  value="${value//%/%%}"
  printf '"%s"' "$value"
}

render_unit() {
  local app_root="$1" destination="$2" template content host port
  template="$app_root/packaging/systemd/gajae-app.service"
  [[ -f "$template" ]] || die "unit template is missing from deployment: $template"
  host="$(configured_host "$app_root")"
  port="$(configured_port "$app_root")"
  if ! is_loopback_host "$host"; then
    warn "preserving explicit non-loopback HOST=$host; prefer Tailscale or SSH instead of public port forwarding"
  fi
  content="$(<"$template")"
  local placeholder
  for placeholder in @APP_ROOT@ @NODE_BIN@ @HOST@ @PORT@; do
    [[ "$content" == *"$placeholder"* ]] || die "unit template is missing required placeholder: $placeholder"
  done
  content="${content//@APP_ROOT@/$(unit_quote "$app_root")}"
  content="${content//@NODE_BIN@/$(unit_quote "$NODE_BIN")}"
  content="${content//@HOST@/$(unit_quote "$host")}"
  content="${content//@PORT@/$(unit_quote "$port")}"
  [[ "$content" != *'@'* ]] || die "rendered unit contains an unresolved placeholder"
  printf '%s\n' "$content" > "$destination"
}

install_unit() {
  local app_root="$1" rendered changed=false backup
  mkdir -p "$UNIT_DIR" "$STATE_DIR"
  rendered="$STATE_DIR/$SERVICE_NAME.$$.new"
  render_unit "$app_root" "$rendered"
  if [[ -f "$UNIT_FILE" ]] && cmp -s "$rendered" "$UNIT_FILE"; then
    rm -f "$rendered"
  else
    if [[ -f "$UNIT_FILE" ]]; then
      backup="$UNIT_FILE.bak.$(date -u +%Y%m%dT%H%M%SZ).$$"
      cp -p "$UNIT_FILE" "$backup"
      printf 'unit_backup=%s\n' "$backup" > "$STATE_DIR/unit-backup.env"
    fi
    mv "$rendered" "$UNIT_FILE"
    chmod 0644 "$UNIT_FILE"
    changed=true
  fi
  "$changed" && printf '%s' changed || printf '%s' unchanged
}

require_systemctl() {
  command -v "$SYSTEMCTL" >/dev/null 2>&1 || die "systemctl is required to manage $SERVICE_NAME"
}

service_active() {
  "$SYSTEMCTL" --user is-active --quiet "$SERVICE_NAME" >/dev/null 2>&1
}

ensure_service() {
  local unit_changed="$1"
  require_systemctl
  if [[ "$unit_changed" == changed ]]; then
    "$SYSTEMCTL" --user daemon-reload
  fi
  "$SYSTEMCTL" --user enable "$SERVICE_NAME"
  if service_active; then
    if [[ "$unit_changed" == changed ]]; then
      "$SYSTEMCTL" --user restart "$SERVICE_NAME"
    fi
  else
    "$SYSTEMCTL" --user start "$SERVICE_NAME"
  fi
}

restart_service() {
  require_systemctl
  "$SYSTEMCTL" --user daemon-reload
  "$SYSTEMCTL" --user enable "$SERVICE_NAME"
  if service_active; then
    "$SYSTEMCTL" --user restart "$SERVICE_NAME"
  else
    "$SYSTEMCTL" --user start "$SERVICE_NAME"
  fi
}

health_state() {
  local host="$1" port="$2" url_host
  url_host="$host"
  [[ "$host" == *:* ]] && url_host="[$host]"
  if ! command -v curl >/dev/null 2>&1; then
    printf '%s' unknown
    return
  fi
  if curl --fail --silent --show-error --max-time 3 "http://$url_host:$port/health" >/dev/null 2>&1; then
    printf '%s' healthy
  else
    printf '%s' unhealthy
  fi
}

wait_for_health() {
  local app_root="$1" host port attempt health
  host="$(configured_host "$app_root")"
  port="$(configured_port "$app_root")"
  for attempt in 1 2 3 4 5; do
    health="$(health_state "$host" "$port")"
    [[ "$health" == healthy ]] && return 0
    sleep 1
  done
  return 1
}

warn_missing_bun() {
  local app_root="$1"
  if [[ ! -x "$app_root/dist-native/bun" ]]; then
    warn "Bun 1.3.14 is missing from this source checkout; run node scripts/fetch-bun.mjs before using the GJC SDK worker"
  fi
}

build_deployment() {
  local app_root="$1"
  warn_missing_bun "$app_root"
  (
    cd "$app_root"
    npm ci >&2
    npm run build >&2
  ) || return 1
  [[ -f "$app_root/dist-server/server/index.js" ]] || return 1
}

prepare_candidate() {
  local source_root="$1" candidate_sha="$2" candidate_root config_file
  candidate_root="$STATE_DIR/releases/${candidate_sha}-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$STATE_DIR/releases"
  git clone --quiet --no-checkout "$source_root" "$candidate_root" || die "could not stage candidate deployment"
  git -C "$candidate_root" remote set-url origin "$REPOSITORY"
  git -C "$candidate_root" checkout --quiet --detach "$candidate_sha" || die "could not check out candidate deployment"
  config_file="$INSTALL_DIR/.env"
  if [[ -f "$config_file" ]]; then
    ln -s "$config_file" "$candidate_root/.env"
  elif [[ -f "$source_root/.env" ]]; then
    ln -s "$source_root/.env" "$candidate_root/.env"
  fi
  if ! build_deployment "$candidate_root"; then
    rm -rf "$candidate_root"
    return 1
  fi
  printf '%s' "$candidate_root"
}

save_rollback_unit() {
  local destination="$1"
  if [[ -f "$UNIT_FILE" ]]; then
    cp -p "$UNIT_FILE" "$destination"
  else
    : > "$destination"
  fi
}

record_rollback_metadata() {
  local previous_root="$1" previous_sha="$2" rollback_unit="$3"
  {
    printf 'ref=%s\n' "$REF"
    printf 'previous_root=%s\n' "$previous_root"
    printf 'previous_sha=%s\n' "$previous_sha"
    printf 'unit=%s\n' "$rollback_unit"
    printf 'recorded_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$STATE_DIR/rollback.env"
}

restore_rollback_unit() {
  local source="$1"
  if [[ -s "$source" ]]; then
    cp -p "$source" "$UNIT_FILE"
  else
    rm -f "$UNIT_FILE"
  fi
  "$SYSTEMCTL" --user daemon-reload
  "$SYSTEMCTL" --user restart "$SERVICE_NAME" || "$SYSTEMCTL" --user start "$SERVICE_NAME"
}

activate_candidate() {
  local previous_root="$1" previous_sha="$2" candidate_root="$3" candidate_sha="$4" rollback_unit
  rollback_unit="$STATE_DIR/rollback-unit-$(date -u +%Y%m%dT%H%M%SZ).$$"
  save_rollback_unit "$rollback_unit"
  record_rollback_metadata "$previous_root" "$previous_sha" "$rollback_unit"
  write_state preparing "$previous_root" "$previous_sha" "$previous_root" "$previous_sha" ""
  install_unit "$candidate_root" >/dev/null
  restart_service
  if ! wait_for_health "$candidate_root"; then
    warn "candidate health check failed; restoring the prior service unit and deployment"
    restore_rollback_unit "$rollback_unit"
    write_state rolled_back "$previous_root" "$previous_sha" "$previous_root" "$previous_sha" health_check_failed
    die "candidate did not become healthy; prior deployment was restored"
  fi
  write_state current "$candidate_root" "$candidate_sha" "$previous_root" "$previous_sha" ""
}

acquire_lock() {
  mkdir -p "$(dirname "$LOCK_DIR")"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    die "another install or update is already running: $LOCK_DIR"
  fi
  trap 'rm -rf "$LOCK_DIR"' EXIT HUP INT TERM
}

active_root() {
  local stored
  stored="$(state_value active_root || true)"
  if [[ -n "$stored" ]] && is_git_checkout "$stored"; then
    printf '%s' "$stored"
  else
    printf '%s' "$INSTALL_DIR"
  fi
}

install_command() {
  local created=false candidate_sha current_root current_sha unit_changed managed_root
  acquire_lock
  if [[ ! -e "$INSTALL_DIR" ]]; then
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --quiet --origin origin "$REPOSITORY" "$INSTALL_DIR" || die "could not clone $REPOSITORY"
    created=true
  fi
  assert_clean_checkout "$INSTALL_DIR"
  assert_expected_remote "$INSTALL_DIR"
  candidate_sha="$(fetch_candidate "$INSTALL_DIR")"

  if "$created"; then
    git -C "$INSTALL_DIR" checkout --quiet --detach "$candidate_sha"
    if ! build_deployment "$INSTALL_DIR"; then
      die "build failed; no service was started"
    fi
    unit_changed="$(install_unit "$INSTALL_DIR")"
    ensure_service "$unit_changed"
    if ! wait_for_health "$INSTALL_DIR"; then
      die "service started but health check failed; inspect journalctl --user-unit $SERVICE_NAME"
    fi
    write_state current "$INSTALL_DIR" "$candidate_sha" "" "" ""
    printf 'Installed %s at %s (%s)\n' "$REF" "$INSTALL_DIR" "$candidate_sha"
    return
  fi

  current_root="$(active_root)"
  is_git_checkout "$current_root" || die "recorded deployment is unavailable: $current_root"
  current_sha="$(git -C "$current_root" rev-parse --verify HEAD^{commit})"
  assert_fast_forward "$INSTALL_DIR" "$current_sha" "$candidate_sha"
  managed_root="$(state_value active_root || true)"
  if [[ -n "$managed_root" && "$current_sha" == "$candidate_sha" && -f "$current_root/dist-server/server/index.js" ]]; then
    unit_changed="$(install_unit "$current_root")"
    ensure_service "$unit_changed"
    write_state current "$current_root" "$current_sha" "$(state_value previous_root || true)" "$(state_value previous_sha || true)" ""
    printf 'Deployment is already current at %s\n' "$current_sha"
    return
  fi

  local staged_root
  if ! staged_root="$(prepare_candidate "$INSTALL_DIR" "$candidate_sha")"; then
    write_state failed "$current_root" "$current_sha" "$(state_value previous_root || true)" "$(state_value previous_sha || true)" build_failed
    die "candidate build failed; the existing service was not restarted"
  fi
  activate_candidate "$current_root" "$current_sha" "$staged_root" "$candidate_sha"
  printf 'Installed %s at %s (%s)\n' "$REF" "$staged_root" "$candidate_sha"
}

update_command() {
  local current_root candidate_sha current_sha staged_root
  acquire_lock
  is_git_checkout "$INSTALL_DIR" || die "no checkout found at $INSTALL_DIR; run install first"
  assert_clean_checkout "$INSTALL_DIR"
  assert_expected_remote "$INSTALL_DIR"
  candidate_sha="$(fetch_candidate "$INSTALL_DIR")"
  current_root="$(active_root)"
  is_git_checkout "$current_root" || die "recorded deployment is unavailable: $current_root"
  current_sha="$(git -C "$current_root" rev-parse --verify HEAD^{commit})"
  assert_fast_forward "$INSTALL_DIR" "$current_sha" "$candidate_sha"
  if [[ "$current_sha" == "$candidate_sha" ]]; then
    write_state current "$current_root" "$current_sha" "$(state_value previous_root || true)" "$(state_value previous_sha || true)" ""
    printf 'Deployment is already current at %s\n' "$current_sha"
    return
  fi
  if ! staged_root="$(prepare_candidate "$INSTALL_DIR" "$candidate_sha")"; then
    write_state failed "$current_root" "$current_sha" "$(state_value previous_root || true)" "$(state_value previous_sha || true)" build_failed
    die "candidate build failed; the existing service was not restarted"
  fi
  activate_candidate "$current_root" "$current_sha" "$staged_root" "$candidate_sha"
  printf 'Updated %s to %s\n' "$REF" "$candidate_sha"
}

json_value() {
  "$NODE_BIN" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

status_command() {
  local root sha version bind port service health update_state ref exit_code=0
  is_git_checkout "$INSTALL_DIR" || die "no checkout found at $INSTALL_DIR; run install first"
  root="$(active_root)"
  if ! is_git_checkout "$root"; then
    die "recorded deployment is unavailable: $root"
  fi
  sha="$(git -C "$root" rev-parse --verify HEAD^{commit} 2>/dev/null || printf unknown)"
  version="$("$NODE_BIN" -p "require(process.argv[1]).version" "$root/package.json" 2>/dev/null || printf unknown)"
  bind="$(configured_host "$root")"
  port="$(configured_port "$root")"
  ref="$(state_value ref || printf '%s' "$REF")"
  update_state="$(state_value update_state || printf unknown)"
  if command -v "$SYSTEMCTL" >/dev/null 2>&1; then
    if service_active; then service=active; else service=inactive; fi
  else
    service=unknown
  fi
  if [[ "$service" == active ]]; then
    health="$(health_state "$bind" "$port")"
  else
    health=unknown
  fi
  if ! is_loopback_host "$bind"; then
    exit_code=3
  elif [[ "$service" != active || "$health" != healthy ]]; then
    exit_code=2
  fi
  if "$JSON"; then
    printf '{"service":%s,"health":%s,"version":%s,"sha":%s,"ref":%s,"updateState":%s,"bind":%s,"port":%s}\n' \
      "$(json_value "$service")" "$(json_value "$health")" "$(json_value "$version")" \
      "$(json_value "$sha")" "$(json_value "$ref")" "$(json_value "$update_state")" \
      "$(json_value "$bind")" "$port"
  else
    printf 'service: %s\nhealth: %s\nversion: %s\nsha: %s\nref: %s\nupdate: %s\nbind: %s\nport: %s\n' \
      "$service" "$health" "$version" "$sha" "$ref" "$update_state" "$bind" "$port"
    if ((exit_code != 0)); then
      printf 'diagnostic: journalctl --user-unit %s\n' "$SERVICE_NAME"
    fi
  fi
  return "$exit_code"
}

require_prerequisites
validate_ref
[[ -z "$PORT" ]] || validate_port "$PORT"

case "$COMMAND" in
  install) install_command ;;
  update) update_command ;;
  status) status_command ;;
esac
