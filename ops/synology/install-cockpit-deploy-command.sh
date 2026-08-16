#!/bin/sh

set -eu

umask 077
PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/packages/ContainerManager/target/usr/bin
export PATH

PROGRAM=install-cockpit-deploy-command.sh
DEPLOY_USER=gaofeng
SOURCE_PROJECT=/volume1/docker/opl-fleet-cockpit
LEGACY_SOURCE_PROJECT=/volume1/docker/ambient-ops
MANAGED_DIR=/volume1/.opl-fleet-cockpit-deploy
LEGACY_MANAGED_DIR=/volume1/.ambient-ops-deploy
STATE_DIR=$MANAGED_DIR/state
INSTALL_PATH=/usr/local/sbin/opl-fleet-cockpit-deploy
LEGACY_INSTALL_PATH=/usr/local/sbin/ambient-ops-deploy
SUDOERS_PATH=/etc/sudoers.d/opl-fleet-cockpit-deploy
LEGACY_SUDOERS_PATH=/etc/sudoers.d/ambient-ops-deploy
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
DEPLOYER_SOURCE=$SCRIPT_DIR/opl-fleet-cockpit-deploy
COMPOSE_SOURCE=$SCRIPT_DIR/compose.yaml
EXPECTED_DEPLOYER_SHA256=5434c4ea68e787f52495e5ddb830077c197af2a89a71ffa275b36f4ee29ac549
EXPECTED_COMPOSE_SHA256=c13dd3d8669063babc4dbd90b8d34fcf22a758da46637ee4717552baf59809e3

log() {
  printf '%s\n' "$PROGRAM: $*"
}

fail() {
  printf '%s\n' "$PROGRAM: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "must be run once as root"
[ -f "$DEPLOYER_SOURCE" ] && [ ! -L "$DEPLOYER_SOURCE" ] || fail "staged deployer is missing"
[ -f "$COMPOSE_SOURCE" ] && [ ! -L "$COMPOSE_SOURCE" ] || fail "staged compose.yaml is missing"
[ -d /etc/sudoers.d ] || fail "/etc/sudoers.d is unavailable"

if [ ! -d "$SOURCE_PROJECT" ]; then
  SOURCE_PROJECT=$LEGACY_SOURCE_PROJECT
fi

CONFIG_SOURCE=$SOURCE_PROJECT/.env
SECRETS_SOURCE=$SOURCE_PROJECT/secrets
MIGRATING_LEGACY=false
if [ -f "$LEGACY_MANAGED_DIR/.env" ] && [ ! -L "$LEGACY_MANAGED_DIR/.env" ]; then
  CONFIG_SOURCE=$LEGACY_MANAGED_DIR/.env
  SECRETS_SOURCE=$LEGACY_MANAGED_DIR/secrets
  MIGRATING_LEGACY=true
elif [ "$SOURCE_PROJECT" = "$LEGACY_SOURCE_PROJECT" ]; then
  MIGRATING_LEGACY=true
fi

[ -f "$CONFIG_SOURCE" ] && [ ! -L "$CONFIG_SOURCE" ] || fail "source .env is missing"
[ -d "$SECRETS_SOURCE" ] && [ ! -L "$SECRETS_SOURCE" ] || fail "source secrets directory is missing"

for managed_path in "$MANAGED_DIR" "$MANAGED_DIR/.env" "$MANAGED_DIR/compose.yaml" "$MANAGED_DIR/secrets" "$STATE_DIR"; do
  [ ! -L "$managed_path" ] || fail "managed paths must not be symbolic links: $managed_path"
done

/usr/bin/install -d -o root -g root -m 0700 "$MANAGED_DIR"
/usr/bin/install -d -o root -g root -m 0700 "$STATE_DIR"

deployer_stage=$STATE_DIR/deployer.install.$$
compose_stage=$STATE_DIR/compose.install.$$
env_stage=$STATE_DIR/env.install.$$
/usr/bin/install -o root -g root -m 0700 "$DEPLOYER_SOURCE" "$deployer_stage"
/usr/bin/install -o root -g root -m 0600 "$COMPOSE_SOURCE" "$compose_stage"

printf '%s  %s\n' "$EXPECTED_DEPLOYER_SHA256" "$deployer_stage" | /usr/bin/sha256sum -c - >/dev/null ||
  fail "staged deployer checksum does not match the reviewed artifact"
printf '%s  %s\n' "$EXPECTED_COMPOSE_SHA256" "$compose_stage" | /usr/bin/sha256sum -c - >/dev/null ||
  fail "staged compose.yaml checksum does not match the reviewed artifact"

if [ ! -e "$MANAGED_DIR/.env" ]; then
  image=$(
    awk -F= '
      $1 == "OPL_FLEET_COCKPIT_IMAGE" { preferred=$0; sub(/^[^=]*=/, "", preferred) }
      $1 == "AMBIENT_OPS_IMAGE" { legacy=$0; sub(/^[^=]*=/, "", legacy) }
      END { if (preferred != "") print preferred; else print legacy }
    ' "$CONFIG_SOURCE"
  )
  [ -n "$image" ] || fail "source .env does not contain a Gateway image"
  case "$image" in
    ghcr.io/gaofeng21cn/ambient-ops:*)
      image=ghcr.io/gaofeng21cn/opl-fleet-cockpit:${image#ghcr.io/gaofeng21cn/ambient-ops:}
      ;;
    ghcr.io/gaofeng21cn/opl-fleet-cockpit:*) ;;
    *) fail "source image is outside the approved OPL Fleet Cockpit repositories" ;;
  esac

  data_volume=$(awk -F= '$1 == "OPL_FLEET_COCKPIT_DATA_VOLUME" { sub(/^[^=]*=/, ""); print; exit }' "$CONFIG_SOURCE")
  if [ -z "$data_volume" ]; then
    if [ "$MIGRATING_LEGACY" = true ]; then
      data_volume=ambient-ops_ambient_ops_data
    else
      data_volume=opl-fleet-cockpit_data
    fi
  fi
  printf '%s\n' "$data_volume" | grep -E '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$' >/dev/null ||
    fail "source data volume name is invalid"

  awk '
    $0 ~ /^OPL_FLEET_COCKPIT_IMAGE=/ { next }
    $0 ~ /^OPL_FLEET_COCKPIT_DATA_VOLUME=/ { next }
    { print }
  ' "$CONFIG_SOURCE" > "$env_stage"
  {
    printf '\nOPL_FLEET_COCKPIT_IMAGE=%s\n' "$image"
    printf 'OPL_FLEET_COCKPIT_DATA_VOLUME=%s\n' "$data_volume"
  } >> "$env_stage"
  /usr/bin/install -o root -g root -m 0600 "$env_stage" "$MANAGED_DIR/.env"
  rm -f "$env_stage"
fi

/usr/bin/install -o root -g root -m 0644 "$compose_stage" "$MANAGED_DIR/compose.yaml"

if [ ! -e "$MANAGED_DIR/secrets" ]; then
  /usr/bin/install -d -o 1000 -g 1000 -m 0700 "$MANAGED_DIR/secrets"
fi

secret_path=
for secret_path in "$SECRETS_SOURCE"/*; do
  [ -e "$secret_path" ] || continue
  [ -f "$secret_path" ] && [ ! -L "$secret_path" ] || fail "source secret entries must be regular files"
  managed_secret=$MANAGED_DIR/secrets/$(basename "$secret_path")
  if [ ! -e "$managed_secret" ]; then
    /usr/bin/install -o 1000 -g 1000 -m 0600 "$secret_path" "$managed_secret"
  fi
done
chown 1000:1000 "$MANAGED_DIR/secrets"
chmod 0700 "$MANAGED_DIR/secrets"
for secret_path in "$MANAGED_DIR/secrets"/*; do
  [ -e "$secret_path" ] || continue
  [ -f "$secret_path" ] && [ ! -L "$secret_path" ] || fail "managed secret entries must be regular files"
  chown 1000:1000 "$secret_path"
  chmod 0600 "$secret_path"
done

/usr/bin/install -d -o root -g root -m 0755 /usr/local/sbin
/usr/bin/install -o root -g root -m 0755 "$deployer_stage" "$INSTALL_PATH"
/usr/bin/install -o root -g root -m 0755 "$deployer_stage" "$LEGACY_INSTALL_PATH"
rm -f "$deployer_stage" "$compose_stage"

sudoers_temp=/etc/sudoers.d/.opl-fleet-cockpit-deploy.$$
printf '%s ALL=(root) NOPASSWD: %s, %s\n' \
  "$DEPLOY_USER" "$INSTALL_PATH" "$LEGACY_INSTALL_PATH" > "$sudoers_temp"
chown root:root "$sudoers_temp"
chmod 0440 "$sudoers_temp"
mv -f "$sudoers_temp" "$SUDOERS_PATH"

if ! /usr/bin/sudo -n -l -U "$DEPLOY_USER" 2>&1 | grep -F "$INSTALL_PATH" >/dev/null; then
  rm -f "$SUDOERS_PATH"
  fail "sudo did not accept the restricted OPL Fleet Cockpit rule"
fi
rm -f "$LEGACY_SUDOERS_PATH"

"$INSTALL_PATH" --check

log "installed the restricted OPL Fleet Cockpit Gateway deploy command for $DEPLOY_USER"
log "compatibility alias retained at $LEGACY_INSTALL_PATH"
log "next: sudo -n $INSTALL_PATH --check"
