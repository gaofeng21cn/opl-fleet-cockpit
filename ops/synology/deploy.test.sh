#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
DEPLOYER=$SCRIPT_DIR/opl-fleet-cockpit-deploy
INSTALLER=$SCRIPT_DIR/install-cockpit-deploy-command.sh
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

deployer_checksum=$(checksum "$DEPLOYER")
compose_checksum=$(checksum "$REPO_ROOT/compose.yaml")
grep -F -x "EXPECTED_DEPLOYER_SHA256=$deployer_checksum" "$INSTALLER" >/dev/null
grep -F -x "EXPECTED_COMPOSE_SHA256=$compose_checksum" "$INSTALLER" >/dev/null

mkdir -p "$TEST_ROOT/managed/secrets" "$TEST_ROOT/managed/state" "$TEST_ROOT/bin"
cp "$REPO_ROOT/compose.yaml" "$TEST_ROOT/managed/compose.yaml"
cat > "$TEST_ROOT/proc-stat" <<'EOF'
cpu 1 2 3 4
btime 1785500000
EOF
cat > "$TEST_ROOT/managed/.env" <<'EOF'
OPL_FLEET_COCKPIT_IMAGE=ghcr.io/gaofeng21cn/opl-fleet-cockpit:0.1.38
OPL_FLEET_COCKPIT_DATA_VOLUME=ambient-ops_ambient_ops_data
DEMO_MODE=false
SITE_NAME=Test
DISPLAY_TIME_ZONE=UTC
INSTANCE_ID=test-instance
DISCOVERY_ENABLED=true
EOF
printf 'token\n' > "$TEST_ROOT/managed/secrets/agent_push_token"
touch "$TEST_ROOT/legacy-present"

cat > "$TEST_ROOT/bin/flock" <<'EOF'
#!/bin/sh
exit 0
EOF

cat > "$TEST_ROOT/bin/sha256sum" <<'EOF'
#!/bin/sh
exec /usr/bin/shasum -a 256 "$@"
EOF

cat > "$TEST_ROOT/bin/docker" <<'EOF'
#!/bin/sh
set -eu
root=${OPL_FLEET_COCKPIT_DEPLOY_TEST_ROOT:?}
[ -z "${DOCKER_HOST:-}" ] || exit 98
[ -z "${COMPOSE_FILE:-}" ] || exit 98
command_name=${1:-}
case "$command_name" in
  pull)
    printf '%s\n' "$2" > "$root/pulled-image"
    ;;
  ps)
    if [ -f "$root/legacy-present" ]; then
      printf '%s\n' legacy-container
    fi
    ;;
  stop)
    [ "$2" = legacy-container ] || exit 95
    touch "$root/legacy-stopped"
    printf '%s\n' 'stop legacy-container' >> "$root/actions"
    ;;
  start)
    [ "$2" = legacy-container ] || exit 95
    rm -f "$root/legacy-stopped"
    printf '%s\n' 'start legacy-container' >> "$root/actions"
    printf '%s\n' legacy-container
    ;;
  rm)
    target=
    for argument in "$@"; do
      target=$argument
    done
    case "$target" in
      legacy-container)
        rm -f "$root/legacy-present" "$root/legacy-stopped"
        printf '%s\n' 'rm legacy-container' >> "$root/actions"
        ;;
      gateway-container)
        rm -f "$root/gateway-present"
        printf '%s\n' 'rm gateway-container' >> "$root/actions"
        ;;
      *) exit 95 ;;
    esac
    ;;
  image)
    format=
    previous=
    image_ref=
    for argument in "$@"; do
      if [ "$previous" = --format ]; then format=$argument; fi
      previous=$argument
      image_ref=$argument
    done
    image=$(awk -F= '$1 == "OPL_FLEET_COCKPIT_IMAGE" { sub(/^[^=]*=/, ""); print; exit }' "$root/managed/.env")
    case "$format" in
      *'json .RepoDigests'*)
        digest=${image##*@}
        printf '["ghcr.io/gaofeng21cn/ambient-ops@%s","ghcr.io/gaofeng21cn/opl-fleet-cockpit@%s"]\n' "$digest" "$digest"
        ;;
      *'range .RepoDigests'*)
        digest=${image_ref##*@}
        printf 'ghcr.io/gaofeng21cn/opl-fleet-cockpit@%s\n' "$digest"
        ;;
      *) exit 96 ;;
    esac
    ;;
  inspect)
    format=
    previous=
    target=
    for argument in "$@"; do
      if [ "$previous" = --format ]; then format=$argument; fi
      previous=$argument
      target=$argument
    done
    image=$(awk -F= '$1 == "OPL_FLEET_COCKPIT_IMAGE" { sub(/^[^=]*=/, ""); print; exit }' "$root/managed/.env")
    if [ "$target" = legacy-container ] && [ "$format" = '{{json .Mounts}}' ]; then
      printf '%s\n' '[{"Type":"volume","Name":"ambient-ops_ambient_ops_data","Destination":"/data","RW":true}]'
      exit 0
    fi
    case "$format" in
      '{{.Config.Image}}') printf '%s\n' "$image" ;;
      '{{.Image}}') printf '%s\n' 'sha256:runtime-image-id' ;;
      '{{.Name}}') printf '%s\n' '/opl-fleet-cockpit-gateway-1' ;;
      '{{.State.Status}}') printf '%s\n' 'running' ;;
      '{{.State.Running}}') printf '%s\n' 'true' ;;
      '{{.State.StartedAt}}') printf '%s\n' '2026-08-03T06:00:00.123456789Z' ;;
      '{{.State.FinishedAt}}') printf '%s\n' '0001-01-01T00:00:00Z' ;;
      '{{.RestartCount}}') printf '%s\n' '0' ;;
      '{{.State.ExitCode}}') printf '%s\n' '0' ;;
      '{{.State.OOMKilled}}') printf '%s\n' 'false' ;;
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}') printf '%s\n' 'healthy' ;;
      '{{if .State.Health}}{{.State.Health.FailingStreak}}{{else}}0{{end}}') printf '%s\n' '0' ;;
      '{{.HostConfig.RestartPolicy.Name}}') printf '%s\n' 'unless-stopped' ;;
      '{{json .Mounts}}')
        printf '%s\n' '[{"Type":"volume","Name":"ambient-ops_ambient_ops_data","Source":"/private/docker/path","Destination":"/data","RW":true}]'
        ;;
      *) exit 96 ;;
    esac
    ;;
  compose)
    action=
    format=
    for argument in "$@"; do
      case "$argument" in
        config|pull|up|ps) action=$argument ;;
        json) format=json ;;
      esac
    done
    if [ "$action" = config ] && [ "$format" = json ]; then
      image=$(awk -F= '$1 == "OPL_FLEET_COCKPIT_IMAGE" { sub(/^[^=]*=/, ""); print; exit }' "$root/managed/.env")
      volume=$(awk -F= '$1 == "OPL_FLEET_COCKPIT_DATA_VOLUME" { sub(/^[^=]*=/, ""); print; exit }' "$root/managed/.env")
      cat <<JSON
{"services":{"gateway":{"image":"$image","network_mode":"host","restart":"unless-stopped","read_only":true,"ports":null,"build":null,"environment":{"DEMO_MODE":"false","DISCOVERY_ENABLED":"true"},"volumes":[{"type":"volume","source":"cockpit_data","target":"/data"},{"type":"bind","source":"$root/managed/secrets","target":"/run/secrets","read_only":true}]}},"volumes":{"cockpit_data":{"name":"$volume"}}}
JSON
    elif [ "$action" = ps ]; then
      if [ -f "$root/gateway-present" ]; then printf '%s\n' gateway-container; fi
    elif [ "$action" = up ]; then
      if [ -f "$root/fail-up-once" ]; then
        rm -f "$root/fail-up-once"
        exit 1
      fi
      touch "$root/gateway-present"
      printf '%s\n' 'up gateway' >> "$root/actions"
    fi
    ;;
  *)
    exit 1
    ;;
esac
EOF

cat > "$TEST_ROOT/bin/curl" <<'EOF'
#!/bin/sh
set -eu
root=${OPL_FLEET_COCKPIT_DEPLOY_TEST_ROOT:?}
[ -z "${HTTP_PROXY:-}" ] || exit 98
[ -z "${http_proxy:-}" ] || exit 98
url=
for argument in "$@"; do
  case "$argument" in http://*) url=$argument ;; esac
done
if [ "${url##*/}" = healthz ]; then
  printf '%s\n' '{"ok":true,"mode":"live","network":"live","codex":"live","machines":3}'
else
  if [ -f "$root/gateway-present" ]; then
    image=$(awk -F= '$1 == "OPL_FLEET_COCKPIT_IMAGE" { sub(/^[^=]*=/, ""); print; exit }' "$root/managed/.env")
    version=${image#ghcr.io/gaofeng21cn/opl-fleet-cockpit:}
    version=${version%@*}
  else
    version=0.1.38
  fi
  printf '{"schemaVersion":1,"serverVersion":"%s","demo":false,"instanceId":"test-instance","capabilities":{"loadVisualState":true},"machines":[{}]}\n' "$version"
fi
EOF

chmod +x "$TEST_ROOT/bin/"*

export OPL_FLEET_COCKPIT_DEPLOY_TEST_ROOT="$TEST_ROOT"
export AMBIENT_OPS_DEPLOY_TEST_JQ
AMBIENT_OPS_DEPLOY_TEST_JQ=$(command -v jq)
export DOCKER_HOST=tcp://untrusted.example:2375
export COMPOSE_FILE=/tmp/untrusted-compose.yaml
export HTTP_PROXY=http://untrusted.example:8080
export http_proxy=http://untrusted.example:8080

"$DEPLOYER" --check

DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
cp "$TEST_ROOT/managed/.env" "$TEST_ROOT/legacy.env"
touch "$TEST_ROOT/fail-up-once"
if "$DEPLOYER" deploy 0.1.42 "$DIGEST"; then
  printf '%s\n' "expected first migration to fail" >&2
  exit 1
fi
cmp "$TEST_ROOT/legacy.env" "$TEST_ROOT/managed/.env"
test -f "$TEST_ROOT/legacy-present"
test ! -f "$TEST_ROOT/legacy-stopped"
grep -F -x 'stop legacy-container' "$TEST_ROOT/actions" >/dev/null
grep -F -x 'start legacy-container' "$TEST_ROOT/actions" >/dev/null

"$DEPLOYER" deploy 0.1.42 "$DIGEST"
grep -F -x "OPL_FLEET_COCKPIT_IMAGE=ghcr.io/gaofeng21cn/opl-fleet-cockpit:0.1.42@$DIGEST" "$TEST_ROOT/managed/.env"
grep -F -x 'OPL_FLEET_COCKPIT_DATA_VOLUME=ambient-ops_ambient_ops_data' "$TEST_ROOT/managed/.env"
test ! -f "$TEST_ROOT/legacy-present"
grep -F -x 'rm legacy-container' "$TEST_ROOT/actions" >/dev/null

status=$("$DEPLOYER" status)
printf '%s\n' "$status" | jq -e \
  --arg digest "$DIGEST" '
    .schema == "opl_fleet_cockpit_gateway_status.v1"
      and .product == "OPL Fleet Cockpit"
      and .service == "OPL Fleet Cockpit Gateway"
      and .runtimeId == "opl-fleet-cockpit"
      and .compatibilityId == "ambient-ops"
      and .ok == true
      and .image.indexDigest == $digest
      and .image.digestVerified == true
      and .container.name == "opl-fleet-cockpit-gateway-1"
      and .container.restartCount == 0
      and .container.exitCode == 0
      and .container.oomKilled == false
      and .container.finishedAt == null
      and .container.healthStatus == "healthy"
      and .container.failingStreak == 0
      and .container.dataMount.name == "ambient-ops_ambient_ops_data"
  ' >/dev/null

if printf '%s\n' "$status" | grep -F '/private/docker/path' >/dev/null; then
  printf '%s\n' "deployment status leaked the host volume path" >&2
  exit 1
fi

cp "$TEST_ROOT/managed/.env" "$TEST_ROOT/success.env"
touch "$TEST_ROOT/fail-up-once"
if "$DEPLOYER" deploy 0.1.43 sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; then
  printf '%s\n' "expected failed upgrade" >&2
  exit 1
fi
cmp "$TEST_ROOT/success.env" "$TEST_ROOT/managed/.env"

if "$DEPLOYER" deploy latest "$DIGEST"; then
  printf '%s\n' "expected invalid version rejection" >&2
  exit 1
fi
if "$DEPLOYER" deploy 0.1.42 'sha256:not-a-digest'; then
  printf '%s\n' "expected invalid digest rejection" >&2
  exit 1
fi

printf '%s\n' "Synology Gateway migration tests passed"
