#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${OPL_FLEET_COCKPIT_ENV_FILE:-${AMBIENT_OPS_ENV_FILE:-$PROJECT_DIR/.env}}"
SECRETS_DIR="$PROJECT_DIR/secrets"
PROJECT_NAME="${OPL_FLEET_COCKPIT_PROJECT_NAME:-${AMBIENT_OPS_PROJECT_NAME:-opl-fleet-cockpit}}"

usage() {
  cat <<'USAGE'
Usage: ./scripts/opl-fleet-cockpit.sh <command>

Commands:
  init [--profile <name>]
                       Create profile-specific .env, a stable instance ID, and private secret files.
  set-secret <name>    Prompt twice for an optional secret without shell history.
  validate             Validate configuration, secrets, and the Compose merge.
  up                   Validate, pull the pinned image, start, and wait for HTTP.
  status               Show Compose state and the current health response.
  logs                 Show the last 200 OPL Fleet Cockpit Gateway log lines.
  help                 Show this help.

Allowed set-secret names:
  unifi_snmp_auth_password
  unifi_snmp_priv_password
  unifi_api_key
  ha_token

Environment overrides:
  OPL_FLEET_COCKPIT_ENV_FILE       Configuration path (default: <repo>/.env)
  OPL_FLEET_COCKPIT_PROJECT_NAME   Compose project name (default: opl-fleet-cockpit)

Legacy AMBIENT_OPS_ENV_FILE, AMBIENT_OPS_PROJECT_NAME, and AMBIENT_OPS_IMAGE
remain accepted during upgrades.

This helper never prints secret values and never uses compose.local-build.yaml.

Profiles:
  codex-only            Default. OPL Fleet Agent and display surfaces only.
  snmpv3                Adds the non-secret fields for a qualified SNMPv3 router.
  unifi-api             Adds the non-secret fields for the UniFi API fallback.
USAGE
}

log() {
  printf '[opl-fleet-cockpit] %s\n' "$*"
}

die() {
  printf '[opl-fleet-cockpit] ERROR: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

env_value() {
  local key="$1"
  awk -v wanted="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      split_at = index(line, "=")
      if (!split_at) next
      name = substr(line, 1, split_at - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name != wanted) next
      value = substr(line, split_at + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
          (substr(value, 1, 1) == "\047" && substr(value, length(value), 1) == "\047")) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      found = 1
      exit
    }
    END { if (!found) exit 1 }
  ' "$ENV_FILE"
}

value_or_empty() {
  env_value "$1" 2>/dev/null || true
}

value_or_default() {
  local value
  value="$(value_or_empty "$1")"
  printf '%s' "${value:-$2}"
}

lower_value() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

duplicate_env_keys() {
  awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      split_at = index(line, "=")
      if (!split_at) next
      name = substr(line, 1, split_at - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name != "") count[name]++
    }
    END {
      for (name in count) if (count[name] > 1) print name
    }
  ' "$ENV_FILE" | sort
}

require_value() {
  local key="$1"
  local value
  value="$(value_or_empty "$key")"
  [ -n "$value" ] || die "$key is required in $ENV_FILE"
  case "$value" in
    *'<'*|*'>'*|replace-me|CHANGE_ME|change-me)
      die "$key still contains a placeholder"
      ;;
  esac
  printf '%s' "$value"
}

require_empty() {
  local key="$1"
  [ -z "$(value_or_empty "$key")" ] ||
    die "$key must be empty for AMBIENT_OPS_NETWORK_MODE=$(value_or_empty AMBIENT_OPS_NETWORK_MODE)"
}

require_secret() {
  local name="$1"
  local path="$SECRETS_DIR/$name"
  local mode
  [ -s "$path" ] || die "Secret file is missing or empty: secrets/$name"
  case "$(uname -s)" in
    Linux)
      mode="$(stat -c '%a' "$path")"
      [ "$(stat -c '%u' "$path")" = "1000" ] ||
        die "secrets/$name must be owned by UID 1000 for the non-root container; run: sudo chown -R 1000:1000 '$SECRETS_DIR'"
      ;;
    Darwin)
      mode="$(stat -f '%Lp' "$path")"
      ;;
    *)
      die "Unsupported platform for secret permission validation: $(uname -s)"
      ;;
  esac
  [ $((8#$mode & 077)) -eq 0 ] ||
    die "secrets/$name must not be accessible by group or other users; run: chmod 600 '$path'"
}

compose() {
  docker compose \
    --project-directory "$PROJECT_DIR" \
    --env-file "$ENV_FILE" \
    -p "$PROJECT_NAME" \
    -f "$PROJECT_DIR/compose.yaml" \
    -f "$PROJECT_DIR/compose.host-network.yaml" \
    "$@"
}

init_config() {
  local profile="codex-only" template
  case "$#" in
    0) ;;
    2)
      [ "$1" = "--profile" ] || die "Usage: ./scripts/opl-fleet-cockpit.sh init [--profile <codex-only|snmpv3|unifi-api>]"
      profile="$2"
      ;;
    *) die "Usage: ./scripts/opl-fleet-cockpit.sh init [--profile <codex-only|snmpv3|unifi-api>]" ;;
  esac

  case "$profile" in
    codex-only) template="$PROJECT_DIR/.env.example" ;;
    snmpv3|unifi-api) template="$PROJECT_DIR/config/profiles/${profile}.env.example" ;;
    *) die "Unsupported profile: $profile (choose codex-only, snmpv3, or unifi-api)" ;;
  esac

  need_command openssl
  [ ! -e "$ENV_FILE" ] || die "$ENV_FILE already exists; refusing to overwrite it"
  [ -f "$template" ] || die "Missing profile template: $template"
  if [ -d "$SECRETS_DIR" ] && [ -n "$(find "$SECRETS_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    die "$SECRETS_DIR already contains files; refusing to overwrite them"
  fi

  local instance_id temporary
  instance_id="ofc-$(openssl rand -hex 8)"
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v instance_id="$instance_id" '
    /^INSTANCE_ID=replace-me$/ { print "INSTANCE_ID=" instance_id; next }
    { print }
  ' "$template" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$ENV_FILE"

  mkdir -p "$SECRETS_DIR"
  chmod 700 "$SECRETS_DIR"
  umask 077
  if [ ! -s "$SECRETS_DIR/agent_push_token" ]; then
    openssl rand -hex 32 > "$SECRETS_DIR/agent_push_token"
  fi
  touch \
    "$SECRETS_DIR/unifi_snmp_auth_password" \
    "$SECRETS_DIR/unifi_snmp_priv_password" \
    "$SECRETS_DIR/unifi_api_key" \
    "$SECRETS_DIR/ha_token"
  chmod 600 "$SECRETS_DIR"/*

  log "Created $profile configuration without printing secrets."
  if [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" != "1000" ]; then
    log "After setting optional secrets, run: sudo chown -R 1000:1000 '$SECRETS_DIR'"
  fi
  log "Next: edit $ENV_FILE, then run ./scripts/opl-fleet-cockpit.sh validate"
}

set_secret() {
  local name="${1:-}"
  [ -f "$ENV_FILE" ] || die "Missing $ENV_FILE; run ./scripts/opl-fleet-cockpit.sh init first"
  case "$name" in
    unifi_snmp_auth_password|unifi_snmp_priv_password|unifi_api_key|ha_token) ;;
    '') die "set-secret requires a secret name; run help for allowed names" ;;
    *) die "Unsupported secret name: $name" ;;
  esac
  [ -t 0 ] || die "set-secret requires an interactive terminal"

  local first second temporary
  printf 'Enter %s: ' "$name" >&2
  IFS= read -r -s first
  printf '\nRepeat %s: ' "$name" >&2
  IFS= read -r -s second
  printf '\n' >&2
  [ -n "$first" ] || die "Secret must not be empty"
  [ "$first" = "$second" ] || die "Secret values did not match"

  mkdir -p "$SECRETS_DIR"
  chmod 700 "$SECRETS_DIR"
  umask 077
  temporary="$(mktemp "$SECRETS_DIR/.${name}.tmp.XXXXXX")"
  printf '%s\n' "$first" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$SECRETS_DIR/$name"
  unset first second
  log "Updated secrets/$name without printing its value."
}

validate_config() {
  need_command docker
  [ -f "$ENV_FILE" ] || die "Missing $ENV_FILE; run ./scripts/opl-fleet-cockpit.sh init"
  [ -d "$SECRETS_DIR" ] || die "Missing $SECRETS_DIR; run ./scripts/opl-fleet-cockpit.sh init"

  local duplicates image image_key image_lower image_tail image_version
  local port demo instance_id network_mode discovery_enabled poll_ms rate_window_ms ha_enabled
  local latency_port latency_timeout_ms auxiliary_poll_ms
  duplicates="$(duplicate_env_keys)"
  [ -z "$duplicates" ] || die "Duplicate keys in $ENV_FILE: $(printf '%s' "$duplicates" | tr '\n' ' ')"
  image_key=OPL_FLEET_COCKPIT_IMAGE
  image="$(value_or_empty "$image_key")"
  if [ -z "$image" ]; then
    image_key=AMBIENT_OPS_IMAGE
    image="$(require_value "$image_key")"
  fi
  image_lower="$(lower_value "$image")"
  image_tail="${image_lower##*/}"
  port="$(value_or_default AMBIENT_OPS_PORT 8787)"
  demo="$(value_or_default DEMO_MODE false)"
  discovery_enabled="$(value_or_default DISCOVERY_ENABLED true)"
  require_value SITE_NAME >/dev/null
  require_value DISPLAY_TIME_ZONE >/dev/null
  instance_id="$(require_value INSTANCE_ID)"
  network_mode="$(require_value AMBIENT_OPS_NETWORK_MODE)"
  poll_ms="$(value_or_default UNIFI_POLL_MS 250)"
  rate_window_ms="$(value_or_default UNIFI_RATE_WINDOW_MS 2000)"
  latency_port="$(value_or_empty NETWORK_LATENCY_PORT)"
  latency_port="${latency_port:-443}"
  latency_timeout_ms="$(value_or_empty NETWORK_LATENCY_TIMEOUT_MS)"
  latency_timeout_ms="${latency_timeout_ms:-1500}"
  auxiliary_poll_ms="$(value_or_empty NETWORK_AUXILIARY_POLL_MS)"
  auxiliary_poll_ms="${auxiliary_poll_ms:-5000}"
  ha_enabled="$(value_or_default HA_ENABLED false)"

  case "$image_lower" in
    *:latest|*:main|*:edge) die "$image_key must use a reviewed version tag or digest, not a moving tag" ;;
  esac
  case "$image_tail" in
    *@sha256:*) ;;
    *:*)
      image_version="${image_tail##*:}"
      [ -n "$image_version" ] || die "$image_key has an empty tag"
      ;;
    *) die "$image_key must include a version tag or sha256 digest" ;;
  esac
  case "$port" in
    8787) ;;
    *) die "Host-network production currently listens on port 8787; keep AMBIENT_OPS_PORT=8787" ;;
  esac
  case "$(lower_value "$demo")" in
    false|0|no|off) ;;
    *) die "Production configuration requires DEMO_MODE=false" ;;
  esac
  case "$(lower_value "$discovery_enabled")" in
    true|1|yes|on) ;;
    *) die "Production configuration requires DISCOVERY_ENABLED=true" ;;
  esac
  [[ "$instance_id" =~ ^[a-z0-9][a-z0-9._-]{0,79}$ ]] ||
    die "INSTANCE_ID must match ^[a-z0-9][a-z0-9._-]{0,79}$"
  [[ "$poll_ms" =~ ^[0-9]+$ ]] && [ "$poll_ms" -ge 200 ] ||
    die "UNIFI_POLL_MS must be an integer of at least 200"
  [[ "$rate_window_ms" =~ ^[0-9]+$ ]] && [ "$rate_window_ms" -ge "$poll_ms" ] ||
    die "UNIFI_RATE_WINDOW_MS must be an integer no smaller than UNIFI_POLL_MS"
  [[ "$latency_port" =~ ^[0-9]+$ ]] && [ "$latency_port" -ge 1 ] && [ "$latency_port" -le 65535 ] ||
    die "NETWORK_LATENCY_PORT must be an integer from 1 to 65535"
  [[ "$latency_timeout_ms" =~ ^[0-9]+$ ]] && [ "$latency_timeout_ms" -ge 100 ] ||
    die "NETWORK_LATENCY_TIMEOUT_MS must be an integer of at least 100"
  [[ "$auxiliary_poll_ms" =~ ^[0-9]+$ ]] && [ "$auxiliary_poll_ms" -ge 1000 ] ||
    die "NETWORK_AUXILIARY_POLL_MS must be an integer of at least 1000"

  require_secret agent_push_token
  case "$network_mode" in
    codex-only)
      require_empty UNIFI_SNMP_HOST
      require_empty UNIFI_SNMP_USER
      require_empty UNIFI_SNMP_INTERFACES
      require_empty UNIFI_SNMP_CLIENT_INTERFACES
      require_empty NETWORK_LATENCY_HOST
      require_empty UNIFI_BASE_URL
      ;;
    snmpv3)
      require_value UNIFI_SNMP_HOST >/dev/null
      require_value UNIFI_SNMP_USER >/dev/null
      require_value UNIFI_SNMP_INTERFACES >/dev/null
      require_secret unifi_snmp_auth_password
      require_secret unifi_snmp_priv_password
      require_empty UNIFI_BASE_URL
      ;;
    unifi-api)
      require_value UNIFI_BASE_URL >/dev/null
      require_secret unifi_api_key
      require_empty UNIFI_SNMP_HOST
      require_empty UNIFI_SNMP_USER
      require_empty UNIFI_SNMP_INTERFACES
      require_empty UNIFI_SNMP_CLIENT_INTERFACES
      require_empty NETWORK_LATENCY_HOST
      ;;
    *)
      die "AMBIENT_OPS_NETWORK_MODE must be codex-only, snmpv3, or unifi-api"
      ;;
  esac

  case "$(lower_value "$ha_enabled")" in
    true|1|yes|on)
      require_value HA_BASE_URL >/dev/null
      require_secret ha_token
      ;;
    false|0|no|off) ;;
    *) die "HA_ENABLED must be true or false" ;;
  esac

  docker compose version >/dev/null
  local rendered_config
  rendered_config="$(mktemp "${TMPDIR:-/tmp}/opl-fleet-cockpit-compose.XXXXXX")"
  if ! compose config --format json > "$rendered_config"; then
    rm -f "$rendered_config"
    die "Unable to render the production Compose configuration"
  fi
  if ! node --input-type=module - "$rendered_config" <<'NODE'
import { readFileSync } from "node:fs";

const path = process.argv[2];
const config = JSON.parse(readFileSync(path, "utf8"));
const service = config.services?.gateway;
if (!service) throw new Error("gateway service is missing");
if (service.network_mode !== "host") throw new Error("production service must use network_mode=host");
if (Array.isArray(service.ports) && service.ports.length) throw new Error("host-network service must not publish ports");
if (service.build) throw new Error("production service must not contain build");
if (String(service.environment?.DISCOVERY_ENABLED).toLowerCase() !== "true") {
  throw new Error("production service must enable discovery");
}
NODE
  then
    rm -f "$rendered_config"
    die "Rendered production Compose configuration violates the host-network contract"
  fi
  rm -f "$rendered_config"
  log "Configuration valid: instance=$instance_id network=$network_mode image=$image"
}

wait_for_http() {
  need_command curl
  local remaining=60
  while [ "$remaining" -gt 0 ]; do
    if curl -fsS --max-time 2 http://127.0.0.1:8787/healthz >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    remaining=$((remaining - 1))
  done
  return 1
}

up_service() {
  validate_config
  log "Pulling the pinned public image (the NAS does not build source)."
  compose pull
  compose up -d
  if ! wait_for_http; then
    compose logs --tail=200 gateway >&2 || true
    die "HTTP health endpoint did not answer within 60 seconds"
  fi
  log "Container is answering; source readiness is shown below."
  curl -fsS http://127.0.0.1:8787/healthz
  printf '\n'
}

status_service() {
  need_command docker
  need_command curl
  [ -f "$ENV_FILE" ] || die "Missing $ENV_FILE"
  compose ps
  if curl -fsS --max-time 5 http://127.0.0.1:8787/healthz; then
    printf '\n'
  else
    die "OPL Fleet Cockpit Gateway is not answering on http://127.0.0.1:8787/healthz"
  fi
}

logs_service() {
  need_command docker
  [ -f "$ENV_FILE" ] || die "Missing $ENV_FILE"
  compose logs --tail=200 gateway
}

command_name="${1:-help}"
shift || true

case "$command_name" in
  init) init_config "$@" ;;
  set-secret) set_secret "$@" ;;
  validate) validate_config "$@" ;;
  up) up_service "$@" ;;
  status) status_service "$@" ;;
  logs) logs_service "$@" ;;
  help|-h|--help) usage ;;
  *) die "Unknown command: $command_name (run help)" ;;
esac
