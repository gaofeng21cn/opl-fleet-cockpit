#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h:h}"
MACOS_OPS_DIR="$ROOT_DIR/ops/macos"
APP_SUPPORT_ROOT="${AMBIENT_OPS_APP_SUPPORT_ROOT:-$HOME/Library/Application Support/Ambient Ops}"
RUNTIME_ROOT="${AMBIENT_OPS_RUNTIME_ROOT:-$APP_SUPPORT_ROOT/runtime}"
DATA_DIR="${AMBIENT_OPS_DATA_DIR:-$APP_SUPPORT_ROOT/data}"
LOG_DIR="${AMBIENT_OPS_LOG_DIR:-$APP_SUPPORT_ROOT/logs}"
LAUNCH_AGENTS_DIR="${AMBIENT_OPS_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
RELEASES_DIR="$RUNTIME_ROOT/releases"
CURRENT_LINK="$RUNTIME_ROOT/current"
LAUNCH_LABEL="cn.gaofeng.ambient-ops.server"
HEALTH_URL="${AMBIENT_OPS_HEALTH_URL:-http://127.0.0.1:8791/healthz}"
EXECUTABLE_PATH="${AMBIENT_OPS_EXECUTABLE_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
NODE_PATH="${AMBIENT_OPS_NODE_PATH:-$(command -v node 2>/dev/null || true)}"
ADB_PATH="${ADB_PATH:-$(command -v adb 2>/dev/null || true)}"
OPL_FLEET_AGENT_HEADLESS_PATH="${OPL_FLEET_AGENT_HEADLESS_PATH:-$(command -v opl-fleet-agent-headless 2>/dev/null || true)}"
KEYCHAIN_ACCOUNT="${KEYCHAIN_ACCOUNT:-${USER:-$(id -un)}}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SITE_NAME="${SITE_NAME:-Ambient Ops}"
DISPLAY_TIME_ZONE="${DISPLAY_TIME_ZONE:-$(readlink /etc/localtime 2>/dev/null | sed 's#^.*/zoneinfo/##')}"
DISPLAY_TIME_ZONE="${DISPLAY_TIME_ZONE:-UTC}"
DISCOVERY_ENABLED="${DISCOVERY_ENABLED:-true}"
INSTANCE_ID="${INSTANCE_ID:-}"
UNIFI_SNMP_HOST="${UNIFI_SNMP_HOST:-}"
UNIFI_SNMP_PORT="${UNIFI_SNMP_PORT:-161}"
UNIFI_SNMP_USER="${UNIFI_SNMP_USER:-}"
UNIFI_SNMP_PASSWORD_KEYCHAIN_SERVICE="${UNIFI_SNMP_PASSWORD_KEYCHAIN_SERVICE:-cn.gaofeng.ambient-ops.unifi-snmp-v3}"
UNIFI_SNMP_AUTH_PROTOCOL="${UNIFI_SNMP_AUTH_PROTOCOL:-sha}"
UNIFI_SNMP_PRIV_PROTOCOL="${UNIFI_SNMP_PRIV_PROTOCOL:-aes}"
UNIFI_SNMP_INTERFACES="${UNIFI_SNMP_INTERFACES:-}"
UNIFI_SNMP_CLIENT_INTERFACES="${UNIFI_SNMP_CLIENT_INTERFACES:-}"
UNIFI_SNMP_TIMEOUT_MS="${UNIFI_SNMP_TIMEOUT_MS:-3000}"
UNIFI_POLL_MS="${UNIFI_POLL_MS:-250}"
UNIFI_RATE_WINDOW_MS="${UNIFI_RATE_WINDOW_MS:-2000}"
NETWORK_LATENCY_HOST="${NETWORK_LATENCY_HOST:-}"
NETWORK_LATENCY_PORT="${NETWORK_LATENCY_PORT:-443}"
NETWORK_LATENCY_TIMEOUT_MS="${NETWORK_LATENCY_TIMEOUT_MS:-1500}"
NETWORK_AUXILIARY_POLL_MS="${NETWORK_AUXILIARY_POLL_MS:-5000}"
AGENT_PUSH_TOKEN_KEYCHAIN_SERVICE="${AGENT_PUSH_TOKEN_KEYCHAIN_SERVICE:-cn.gaofeng.ambient-ops.agent-push}"
OPL_FLEET_AGENT_AMBIENT_URL="${OPL_FLEET_AGENT_AMBIENT_URL:-http://127.0.0.1:8791}"
OPL_FLEET_AGENT_MACHINE_ID="${OPL_FLEET_AGENT_MACHINE_ID:-$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')}"
OPL_FLEET_AGENT_MACHINE_ID="${OPL_FLEET_AGENT_MACHINE_ID%-}"
OPL_FLEET_AGENT_MACHINE_NAME="${OPL_FLEET_AGENT_MACHINE_NAME:-$(scutil --get ComputerName 2>/dev/null || hostname -s)}"
ANDROID_SERIAL="${ANDROID_SERIAL:-}"

render_plist() {
  local template="$1"
  local target="$2"
  shift 2
  local staging
  staging="$(mktemp "$LAUNCH_AGENTS_DIR/.ambient-ops-plist.XXXXXX")"
  cp "$template" "$staging"
  while (( $# )); do
    if [[ "$1" == ProgramArguments.* ]]; then
      # Swift plutil inserts at the array index even for -replace.
      /usr/bin/plutil -remove "$1" "$staging"
      /usr/bin/plutil -insert "$1" -string "$2" "$staging"
    else
      /usr/bin/plutil -replace "$1" -string "$2" "$staging"
    fi
    shift 2
  done
  /usr/bin/plutil -lint "$staging" >/dev/null
  chmod 0644 "$staging"
  mv -f "$staging" "$target"
}

render_launch_agents() {
  local target_dir="${1:-$LAUNCH_AGENTS_DIR}"
  LAUNCH_AGENTS_DIR="$target_dir"
  mkdir -p "$target_dir" "$LOG_DIR"

  render_plist \
    "$MACOS_OPS_DIR/cn.gaofeng.ambient-ops.server.plist" \
    "$target_dir/cn.gaofeng.ambient-ops.server.plist" \
    "ProgramArguments.0" "$NODE_PATH" \
    "ProgramArguments.1" "$CURRENT_LINK/server/server.mjs" \
    "WorkingDirectory" "$CURRENT_LINK" \
    "EnvironmentVariables.PATH" "$EXECUTABLE_PATH" \
    "EnvironmentVariables.PORT" "${PORT:-8791}" \
    "EnvironmentVariables.DATA_DIR" "$DATA_DIR" \
    "EnvironmentVariables.DEMO_MODE" "${DEMO_MODE:-false}" \
    "EnvironmentVariables.SITE_NAME" "$SITE_NAME" \
    "EnvironmentVariables.DISPLAY_TIME_ZONE" "$DISPLAY_TIME_ZONE" \
    "EnvironmentVariables.DISCOVERY_ENABLED" "$DISCOVERY_ENABLED" \
    "EnvironmentVariables.INSTANCE_ID" "$INSTANCE_ID" \
    "EnvironmentVariables.AGENT_PUSH_TOKEN_KEYCHAIN_SERVICE" "$AGENT_PUSH_TOKEN_KEYCHAIN_SERVICE" \
    "EnvironmentVariables.KEYCHAIN_ACCOUNT" "$KEYCHAIN_ACCOUNT" \
    "EnvironmentVariables.UNIFI_SNMP_HOST" "$UNIFI_SNMP_HOST" \
    "EnvironmentVariables.UNIFI_SNMP_PORT" "$UNIFI_SNMP_PORT" \
    "EnvironmentVariables.UNIFI_SNMP_USER" "$UNIFI_SNMP_USER" \
    "EnvironmentVariables.UNIFI_SNMP_PASSWORD_KEYCHAIN_SERVICE" "$UNIFI_SNMP_PASSWORD_KEYCHAIN_SERVICE" \
    "EnvironmentVariables.UNIFI_SNMP_AUTH_PROTOCOL" "$UNIFI_SNMP_AUTH_PROTOCOL" \
    "EnvironmentVariables.UNIFI_SNMP_PRIV_PROTOCOL" "$UNIFI_SNMP_PRIV_PROTOCOL" \
    "EnvironmentVariables.UNIFI_SNMP_INTERFACES" "$UNIFI_SNMP_INTERFACES" \
    "EnvironmentVariables.UNIFI_SNMP_CLIENT_INTERFACES" "$UNIFI_SNMP_CLIENT_INTERFACES" \
    "EnvironmentVariables.UNIFI_SNMP_TIMEOUT_MS" "$UNIFI_SNMP_TIMEOUT_MS" \
    "EnvironmentVariables.UNIFI_POLL_MS" "$UNIFI_POLL_MS" \
    "EnvironmentVariables.UNIFI_RATE_WINDOW_MS" "$UNIFI_RATE_WINDOW_MS" \
    "EnvironmentVariables.NETWORK_LATENCY_HOST" "$NETWORK_LATENCY_HOST" \
    "EnvironmentVariables.NETWORK_LATENCY_PORT" "$NETWORK_LATENCY_PORT" \
    "EnvironmentVariables.NETWORK_LATENCY_TIMEOUT_MS" "$NETWORK_LATENCY_TIMEOUT_MS" \
    "EnvironmentVariables.NETWORK_AUXILIARY_POLL_MS" "$NETWORK_AUXILIARY_POLL_MS" \
    "StandardOutPath" "$LOG_DIR/server.out.log" \
    "StandardErrorPath" "$LOG_DIR/server.err.log"

  render_plist \
    "$MACOS_OPS_DIR/cn.gaofeng.opl-fleet-agent-headless.plist" \
    "$target_dir/cn.gaofeng.opl-fleet-agent-headless.plist" \
    "ProgramArguments.0" "${OPL_FLEET_AGENT_HEADLESS_PATH:-/usr/bin/false}" \
    "EnvironmentVariables.PATH" "$EXECUTABLE_PATH" \
    "EnvironmentVariables.CODEX_HOME" "$CODEX_HOME" \
    "EnvironmentVariables.OPL_FLEET_AGENT_AMBIENT_URL" "$OPL_FLEET_AGENT_AMBIENT_URL" \
    "EnvironmentVariables.OPL_FLEET_AGENT_AMBIENT_TOKEN_KEYCHAIN_SERVICE" "$AGENT_PUSH_TOKEN_KEYCHAIN_SERVICE" \
    "EnvironmentVariables.OPL_FLEET_AGENT_KEYCHAIN_ACCOUNT" "$KEYCHAIN_ACCOUNT" \
    "EnvironmentVariables.OPL_FLEET_AGENT_MACHINE_ID" "$OPL_FLEET_AGENT_MACHINE_ID" \
    "EnvironmentVariables.OPL_FLEET_AGENT_MACHINE_NAME" "$OPL_FLEET_AGENT_MACHINE_NAME" \
    "StandardOutPath" "$LOG_DIR/opl-fleet-agent-headless.out.log" \
    "StandardErrorPath" "$LOG_DIR/opl-fleet-agent-headless.err.log"

  render_plist \
    "$MACOS_OPS_DIR/cn.gaofeng.ambient-ops.adb-kiosk.plist" \
    "$target_dir/cn.gaofeng.ambient-ops.adb-kiosk.plist" \
    "ProgramArguments.0" "$CURRENT_LINK/bin/adb-kiosk-watch.sh" \
    "EnvironmentVariables.PATH" "$EXECUTABLE_PATH" \
    "EnvironmentVariables.ADB_PATH" "${ADB_PATH:-/usr/bin/false}" \
    "EnvironmentVariables.ANDROID_SERIAL" "$ANDROID_SERIAL" \
    "StandardOutPath" "$LOG_DIR/adb-kiosk.out.log" \
    "StandardErrorPath" "$LOG_DIR/adb-kiosk.err.log"
}

if [[ "${1:-}" == "--render-launchagents" ]]; then
  if [[ $# -ne 2 || -z "$2" ]]; then
    print -u2 "Usage: $0 --render-launchagents <output-directory>"
    exit 64
  fi
  render_launch_agents "$2"
  print -r -- "$2"
  exit 0
fi

RELEASE_ID="${1:-$(date -u +%Y%m%d-%H%M%S)}"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
STAGING_DIR="$RELEASES_DIR/.staging-$RELEASE_ID"

if [[ ! "$RELEASE_ID" =~ '^[A-Za-z0-9._-]{1,80}$' ]]; then
  echo "Release ID must contain only letters, numbers, dots, underscores, or hyphens." >&2
  exit 1
fi
if [[ -e "$RELEASE_DIR" || -L "$RELEASE_DIR" ]]; then
  echo "Release already exists: $RELEASE_DIR" >&2
  exit 1
fi

mkdir -p "$RELEASES_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

if [[ -z "$NODE_PATH" || ! -x "$NODE_PATH" ]]; then
  print -u2 "node is unavailable; set AMBIENT_OPS_NODE_PATH to the Node.js executable."
  exit 69
fi

cd "$ROOT_DIR"
npm ci
npm test
npm run build

ditto "$ROOT_DIR/dist" "$STAGING_DIR/dist"
ditto "$ROOT_DIR/server" "$STAGING_DIR/server"
ditto "$ROOT_DIR/package.json" "$STAGING_DIR/package.json"
ditto "$ROOT_DIR/package-lock.json" "$STAGING_DIR/package-lock.json"
mkdir -p "$STAGING_DIR/bin"
ditto "$MACOS_OPS_DIR/adb-kiosk-watch.sh" "$STAGING_DIR/bin/adb-kiosk-watch.sh"

cd "$STAGING_DIR"
npm ci --omit=dev --ignore-scripts
test -f "$STAGING_DIR/dist/pets/ledger-owl/spritesheet.webp"

mv "$STAGING_DIR" "$RELEASE_DIR"
PREVIOUS_TARGET="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
render_launch_agents

if launchctl print "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LAUNCH_LABEL"
fi

if ! launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS_DIR/$LAUNCH_LABEL.plist"; then
  if [[ -n "$PREVIOUS_TARGET" ]]; then
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS_DIR/$LAUNCH_LABEL.plist" || true
  fi
  exit 1
fi

for attempt in {1..20}; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "$RELEASE_DIR"
    exit 0
  fi
  sleep 1
done

if [[ -n "$PREVIOUS_TARGET" ]]; then
  ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
  launchctl bootout "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS_DIR/$LAUNCH_LABEL.plist" || true
fi
echo "Health check failed after switching to $RELEASE_ID; previous runtime restored." >&2
exit 1
