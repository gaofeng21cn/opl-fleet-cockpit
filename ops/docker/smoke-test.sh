#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$script_dir/../.." && pwd)
temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/ambient-ops-smoke.XXXXXX")
project_name="opl-fleet-cockpit-smoke-$$"
image_name="${OPL_FLEET_COCKPIT_SMOKE_IMAGE:-opl-fleet-cockpit:smoke}"
package_version=$(CDPATH='' cd -- "$repo_root" && node -p "require('./package.json').version")
host_uid=$(id -u)
host_gid=$(id -g)
secret_owner_changed=false

cleanup() {
  AMBIENT_OPS_SMOKE_SECRETS_DIR="$temporary_dir/secrets" \
  OPL_FLEET_COCKPIT_SMOKE_IMAGE="$image_name" \
    docker compose \
      -f "$repo_root/compose.yaml" \
      -f "$repo_root/compose.local-build.yaml" \
      -f "$repo_root/ops/docker/compose.smoke.yaml" \
      -p "$project_name" \
      down --volumes --remove-orphans >/dev/null 2>&1 || true
  if [ "$secret_owner_changed" = true ]; then
    sudo -n chown -R "$host_uid:$host_gid" "$temporary_dir" 2>/dev/null || true
  fi
  case "$temporary_dir" in
    "${TMPDIR:-/tmp}"/ambient-ops-smoke.*)
      find "$temporary_dir" -depth -delete 2>/dev/null || true
      ;;
  esac
}
trap cleanup EXIT INT TERM

mkdir -p "$temporary_dir/secrets"
printf '%s\n' "ambient-ops-smoke-token" > "$temporary_dir/secrets/agent_push_token"
chmod 600 "$temporary_dir/secrets/agent_push_token"
if [ "$(uname -s)" = Linux ] && [ "$host_uid" -ne 1000 ]; then
  command -v sudo >/dev/null 2>&1 || {
    echo "Linux smoke test requires UID 1000 or non-interactive sudo for secret ownership." >&2
    exit 1
  }
  sudo -n chown -R 1000:1000 "$temporary_dir/secrets"
  secret_owner_changed=true
fi

compose() {
  AMBIENT_OPS_SMOKE_SECRETS_DIR="$temporary_dir/secrets" \
  OPL_FLEET_COCKPIT_SMOKE_IMAGE="$image_name" \
    docker compose \
      -f "$repo_root/compose.yaml" \
      -f "$repo_root/compose.local-build.yaml" \
      -f "$repo_root/ops/docker/compose.smoke.yaml" \
      -p "$project_name" \
      "$@"
}

wait_for_http() {
  url=$1
  attempts=0
  until curl --fail --silent "$url" >/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 40 ]; then
      compose logs --no-color
      return 1
    fi
    sleep 1
  done
}

compose config --quiet
compose build \
  --build-arg "BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg "VCS_REF=$(git -C "$repo_root" rev-parse HEAD)" \
  --build-arg "VERSION=$package_version"
compose up --detach --wait --no-build

mapped_port=$(compose port gateway 8787 | tail -n 1)
port=${mapped_port##*:}
base_url="http://127.0.0.1:$port"
wait_for_http "$base_url/healthz"

health_file="$temporary_dir/health.json"
revision_file="$temporary_dir/ui-revision.json"
revision_headers="$temporary_dir/ui-revision.headers"
status_file="$temporary_dir/status.json"
persisted_file="$temporary_dir/persisted.json"
served_sprite="$temporary_dir/spritesheet.webp"
ui_file="$temporary_dir/ui.html"
ui_asset_file="$temporary_dir/ui-asset.js"
ui_asset_headers="$temporary_dir/ui-asset.headers"

curl --fail --silent --show-error "$base_url/healthz" > "$health_file"
curl --fail --silent --show-error \
  --dump-header "$revision_headers" \
  "$base_url/api/v1/ui/revision" > "$revision_file"
container_id=$(compose ps --quiet gateway)
node -e '
  const health = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const revision = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  if (!health.ok || health.mode !== "live" || !/^[a-f0-9]{64}$/.test(health.uiRevision)) {
    throw new Error("unexpected health payload: " + JSON.stringify(health));
  }
  if (revision.revision !== health.uiRevision) {
    throw new Error("UI revision endpoint does not match health");
  }
  if (health.kioskUpdate !== null) {
    throw new Error("source smoke image unexpectedly contains a kiosk release");
  }
' "$health_file" "$revision_file"
grep -qi '^cache-control: no-store' "$revision_headers"
expected_revision=$(docker exec "$container_id" sha256sum /app/dist/index.html | cut -d' ' -f1)
docker exec "$container_id" test -f scripts/discover-unifi.mjs ||
  { echo "image is missing scripts/discover-unifi.mjs" >&2; exit 1; }
actual_revision=$(node -p \
  "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).revision" \
  "$revision_file")
if [ "$actual_revision" != "$expected_revision" ]; then
  echo "UI revision does not identify the built index" >&2
  exit 1
fi
update_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "$base_url/api/v1/kiosk/update")
if [ "$update_status" != 404 ]; then
  echo "empty source smoke image exposed kiosk update HTTP $update_status" >&2
  exit 1
fi

generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer ambient-ops-smoke-token" \
  --header "Content-Type: application/json" \
  --data-binary "{
    \"machineName\": \"Docker Smoke\",
    \"platform\": \"linux\",
    \"generatedAt\": \"$generated_at\",
    \"oneMinute\": {
      \"tps\": 12.5,
      \"inputTokens\": 540,
      \"cachedInputTokens\": 420,
      \"outputTokens\": 210,
      \"reasoningOutputTokens\": 55
    },
    \"fiveMinutes\": { \"tps\": 8.4 },
    \"activeSessions\": 2,
    \"pet\": {
      \"id\": \"ledger-owl\",
      \"displayName\": \"Ledger Owl\",
      \"spriteVersionNumber\": 1,
      \"state\": \"running\",
      \"stateSince\": \"$generated_at\"
    }
  }" \
  "$base_url/api/v1/agents/docker-smoke/snapshot" >/dev/null

curl --fail --silent --show-error "$base_url/api/status" > "$status_file"
node -e '
  const status = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const machine = status.machines.find(({ machineId }) => machineId === "docker-smoke");
  if (!machine || machine.oneMinute.tps !== 12.5 || machine.pet?.id !== "ledger-owl") {
    throw new Error("agent snapshot missing from status: " + JSON.stringify(status));
  }
' "$status_file"

curl --fail --silent --show-error "$base_url/display/pet" > "$ui_file"
grep -q '<div id="root"></div>' "$ui_file"
ui_asset_path=$(node -e '
  const html = require("fs").readFileSync(process.argv[1], "utf8");
  const match = html.match(/<script[^>]+src="([^"]+\.js)"/);
  if (!match) throw new Error("built UI did not reference a JavaScript asset");
  process.stdout.write(match[1]);
' "$ui_file")
curl --fail --silent --show-error \
  --dump-header "$ui_asset_headers" \
  "$base_url$ui_asset_path" > "$ui_asset_file"
node -e '
  const fs = require("fs");
  const headers = fs.readFileSync(process.argv[1], "utf8").toLowerCase();
  const size = fs.statSync(process.argv[2]).size;
  const declared = headers.match(/^content-length:\s*(\d+)\s*$/m);
  if (!declared || Number(declared[1]) !== size) {
    throw new Error(`UI asset length mismatch: declared=${declared?.[1]} actual=${size}`);
  }
  if (/^transfer-encoding:/m.test(headers)) {
    throw new Error("UI asset unexpectedly used transfer encoding");
  }
  if (size <= 65536) {
    throw new Error(`UI asset is too small to exercise large response delivery: ${size}`);
  }
' "$ui_asset_headers" "$ui_asset_file"
curl --fail --silent --show-error "$base_url/pets/ledger-owl/spritesheet.webp" > "$served_sprite"
cmp "$repo_root/public/pets/ledger-owl/spritesheet.webp" "$served_sprite"

docker exec "$container_id" test -s /data/state.json
if docker exec "$container_id" touch /app/should-not-be-writable 2>/dev/null; then
  echo "container root filesystem is unexpectedly writable" >&2
  exit 1
fi

compose restart gateway
mapped_port=$(compose port gateway 8787 | tail -n 1)
port=${mapped_port##*:}
base_url="http://127.0.0.1:$port"
wait_for_http "$base_url/healthz"
curl --fail --silent --show-error "$base_url/api/status" > "$persisted_file"
node -e '
  const status = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const machine = status.machines.find(({ machineId }) => machineId === "docker-smoke");
  if (!machine || machine.pet?.state !== "running") {
    throw new Error("snapshot did not survive restart: " + JSON.stringify(status));
  }
' "$persisted_file"

echo "OPL Fleet Cockpit Gateway Docker smoke test passed at $base_url"
