# Synology Deployment

OPL Fleet Cockpit runs as the `opl-fleet-cockpit` Compose project with one
`gateway` service. The container is the OPL Fleet Cockpit Gateway: the NAS owns
aggregation, persistence, LAN discovery, and the web app; display clients only
discover and open it. New installations use the branded project, service,
container, image, volume, and deploy-command identities. The old `ambient-ops`
image, command, environment variable, mDNS type, and data volume remain bounded
compatibility aliases for in-place upgrades.

Use [`production-migration-checklist.md`](production-migration-checklist.md) for
an existing Mac-to-NAS cutover. This page describes the target installation.
For the shorter ordinary-user path, start with the
[installation guide](installation.md) or its
[Chinese edition](installation.zh-CN.md).

## Requirements

- Synology Container Manager or Docker Compose over SSH
- A persistent project directory, for example
  `/volume1/docker/opl-fleet-cockpit`
- UDP/161 access from the NAS to the qualified SNMPv3 router
- TCP/8787 access from trusted LAN clients to the NAS
- UDP/5353 multicast on the client LAN
- Host networking for Bonjour/mDNS publication to the physical LAN

Tagged releases publish one GHCR manifest containing both `linux/amd64` and
`linux/arm64` images. Intel and ARM Synology models pull the native image; the
NAS does not build Node or frontend assets locally.

The production `compose.yaml` is intentionally self-contained. DSM Container
Manager projects commonly load only that root file; discovery must therefore not
depend on an override being selected in the UI. Check the rendered contract before
copying any secrets:

```bash
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml config --format json | \
  jq -e '.services.gateway.network_mode == "host" and
    .services.gateway.environment.DISCOVERY_ENABLED == "true" and
    (.services.gateway.ports == null) and
    (.services.gateway.build == null)'
```

The compatibility override is still accepted by the repository helper, but it is
not required by DSM. Container Manager may be used to observe and recreate the
single-file project after the reviewed files are copied into the project directory.

## Prepare configuration

Clone or copy a reviewed source commit into the persistent project directory:

```bash
cd /volume1/docker/opl-fleet-cockpit
./scripts/opl-fleet-cockpit.sh init --profile snmpv3
```

The helper refuses to overwrite an existing installation, generates a stable
`INSTANCE_ID` and agent token without printing them, and creates the optional
secret files. Edit only `.env`; enter SNMPv3 passwords with the documented
interactive `set-secret` commands. A manual `cp .env.example .env` path remains
valid for operators who deliberately manage identity and secret generation
themselves.

Set `OPL_FLEET_COCKPIT_IMAGE` in `.env` to the reviewed release, for example
`ghcr.io/gaofeng21cn/opl-fleet-cockpit:0.1.22`. The GitHub Container Registry package
is public, so Synology can pull the image without a GitHub token:

```bash
docker compose -p opl-fleet-cockpit -f compose.yaml pull
```

Do not add GitHub credentials to `.env`, Compose, or the repository for normal
pulls.

For a fresh installation, generate a new **agent push token** as above. For a
migration, copy the existing agent push token instead; changing it makes every
OPL Fleet Agent fail with HTTP 401 until its Keychain item is updated.

Set at least:

```dotenv
DEMO_MODE=false
SITE_NAME=OPL Fleet Cockpit
DISPLAY_TIME_ZONE=Asia/Shanghai
INSTANCE_ID=<stable-existing-or-new-id>
UNIFI_SNMP_HOST=<gateway-address>
UNIFI_SNMP_USER=<snmp-v3-user>
UNIFI_SNMP_INTERFACES=<wan-interface-or-index>,<second-wan-if-used>
UNIFI_SNMP_CLIENT_INTERFACES=<lan-interface-or-index>,<second-lan-if-used>
UNIFI_POLL_MS=250
UNIFI_RATE_WINDOW_MS=2000
NETWORK_LATENCY_HOST=<tcp-probe-host>
NETWORK_LATENCY_PORT=443
NETWORK_LATENCY_TIMEOUT_MS=1500
NETWORK_AUXILIARY_POLL_MS=5000
```

Write SNMPv3 credentials to:

```text
secrets/unifi_snmp_auth_password
secrets/unifi_snmp_priv_password
```

If the same password is configured for authentication and privacy, both files
may contain the same value. The application trims surrounding whitespace when
reading secret files.

The container runs as UID/GID 1000. After writing every secret, make that user
the bind-directory owner while retaining owner-only modes:

```bash
sudo chown -R 1000:1000 secrets
sudo chmod 700 secrets
sudo chmod 600 secrets/*
```

Do not solve a permission failure with mode 644. Readability must be granted to
the container user without making credentials available to unrelated host
users.

`INSTANCE_ID` identifies the logical installation, not the host. Keep it stable
when the service moves to another address or port. The Android kiosk remembers
this ID and can follow its new mDNS endpoint.

Before copying the reviewed commit to production, run the repository-owned
isolated gate on a Docker development/build host:

```bash
./ops/docker/smoke-test.sh
```

## Validate the single-file LAN instance

The production file uses host networking and publishes mDNS. Do not start a
second candidate on the same NAS while another Gateway owner is active. Pull
and validate the exact image and rendered service in place:

```bash
docker compose -p opl-fleet-cockpit -f compose.yaml config --quiet
docker compose -p opl-fleet-cockpit -f compose.yaml pull
docker compose -p opl-fleet-cockpit -f compose.yaml up -d
docker compose -p opl-fleet-cockpit -f compose.yaml ps
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8787/api/status
```

For a live SNMP configuration, require `mode=live`, `network=live`, and
`network.source=unifi-snmp-v3`.

Do not infer source readiness from HTTP 200 or `ok=true` alone. `/healthz`
separately reports the normalized source state.

## Recreate from DSM or SSH

The same single-file project can be recreated from DSM Container Manager or SSH:

```bash
docker compose -p opl-fleet-cockpit -f compose.yaml pull
docker compose -p opl-fleet-cockpit -f compose.yaml up -d
```

The named `opl-fleet-cockpit_data` volume is preserved by `down`; never add `-v`
during an upgrade. A migrated installation explicitly sets
`OPL_FLEET_COCKPIT_DATA_VOLUME=ambient-ops_ambient_ops_data`, so the branded
container mounts the original data in place instead of creating an empty copy.
The volume retains normalized machine snapshots, device approvals, network
state, and short history across container replacement.

Host networking removes the published-port mapping and publishes
`_ambient-ops._tcp.local` directly to the LAN. The Compose service listens on
TCP/8787 in this mode. Allow TCP/8787 and LAN mDNS in DSM Firewall without
exposing them to WAN interfaces.

## Validate persistence

Run the persistence probe while the service is still being qualified:

```bash
docker compose -p opl-fleet-cockpit \
  -f compose.yaml \
  -f compose.host-network.yaml \
  exec gateway sh -c 'printf persisted > /data/.persistence-probe'

docker compose -p opl-fleet-cockpit \
  -f compose.yaml \
  -f compose.host-network.yaml \
  up -d --force-recreate

docker compose -p opl-fleet-cockpit \
  -f compose.yaml \
  -f compose.host-network.yaml \
  exec gateway test -f /data/.persistence-probe

docker compose -p opl-fleet-cockpit \
  -f compose.yaml \
  -f compose.host-network.yaml \
  exec gateway rm /data/.persistence-probe
```

This identity migration does not require or authorize a NAS reboot. The status
receipt continues to report reboot recovery as unverified until a separately
authorized real reboot occurs; that evidence is not a gate for this migration.

OPL Fleet Agent needs the exact `secrets/agent_push_token` value in each host's
credential store: Keychain service `cn.gaofeng.ambient-ops.agent-push` on macOS
or DPAPI-backed settings on Windows. Enable aggregate sending and auto-discovery
in the app. The Android kiosk must load through Wi-Fi discovery with
`adb reverse --list` empty. The root [`README`](../README.md) contains the
complete agent and APK installation commands.

## Upgrade and rollback

### Restricted SSH deployment

For a NAS that is administered repeatedly, install the repository-owned
restricted deploy command once. It is safer than granting a user access to the
Docker socket: Docker access is effectively root access, while this command is
limited to the OPL Fleet Cockpit project, image repository, and validation contract.

The one-time installer creates:

- `/usr/local/sbin/opl-fleet-cockpit-deploy`, owned by root and not writable by the
  SSH user;
- `/etc/sudoers.d/opl-fleet-cockpit-deploy`, allowing `gaofeng` to run only that
  command without a password;
- `/volume1/.opl-fleet-cockpit-deploy`, a root-controlled runtime directory copied
  from the existing `/volume1/docker/ambient-ops` configuration.

The root-controlled directory is intentional. A privileged deployer must not
read Compose or environment files from a user-writable parent directory. During
an existing installation migration, the installer preserves `.env`, secrets,
`INSTANCE_ID`, and the agent token; switches the runtime project/service/image
to the branded identity; and explicitly binds the original
`ambient-ops_ambient_ops_data` volume.

Stage the three reviewed files together:

```text
opl-fleet-cockpit-deploy
install-cockpit-deploy-command.sh
compose.yaml
```

From that staging directory, run the installer once as root:

```bash
sudo /bin/sh ./install-cockpit-deploy-command.sh
```

Then verify from the ordinary SSH account:

```bash
sudo -n /usr/local/sbin/opl-fleet-cockpit-deploy --check
sudo -n /usr/local/sbin/opl-fleet-cockpit-deploy status | jq .
```

`status` is a read-only deployment attestation. It returns a sanitized
`opl_fleet_cockpit_gateway_status.v1` document containing the configured index
digest, runtime image ID and repository digests, container state, restart
policy, `/data` named volume, public health summary, host boot time, and reboot
recovery evidence. It never returns environment variables, secret values,
volume source paths, machine details, or raw logs. The output uses the OPL Fleet
Cockpit and Gateway product names while retaining `compatibilityId=ambient-ops`.

Reboot recovery is true only when the current release was already deployed
before the latest host boot and the current container started after that boot.
A healthy release deployed after the latest boot remains explicitly unverified
until a later owner-approved reboot; the status command never initiates one.

Ordinary upgrades then need no DSM browser session and no password. Supply both
the semantic version and the reviewed multi-architecture OCI index digest:

```bash
sudo -n /usr/local/sbin/opl-fleet-cockpit-deploy deploy \
  0.1.26 \
  sha256:a3a34a6ebb43ea94e3498c22f87e5c876f62093cc14859984135ab8cf9c67453
```

The command:

1. rejects other image repositories, malformed versions, and malformed digests;
2. serializes deployments with `flock`;
3. pulls and verifies the exact `tag@digest`;
4. atomically updates only `OPL_FLEET_COCKPIT_IMAGE`;
5. validates the rendered Compose security and networking contract;
6. recreates the service without deleting volumes;
7. requires live `/healthz` plus the versioned `/api/v1/status`;
8. restores the previous `.env` and service automatically on failure.

It never calls `docker compose down` and has no path that accepts `-v`. During
the one-time identity migration it stops the verified legacy container, starts
`opl-fleet-cockpit-gateway-1` on the same volume, and restarts the legacy
container automatically if health or version verification fails.
Arbitrary Docker commands remain password-protected. A release that changes the
Compose structure requires reviewing and rerunning the one-time installer; an
ordinary image-only release does not.

### Optional host backup readback

Hyper Backup belongs to NAS operations, not to the Telemetry Gateway deployment
contract. Install the separate restricted command only when an operator wants
passwordless, read-only host evidence:

```text
opl-nas-audit
install-nas-audit-command.sh
```

Review and stage both files together, then run the installer once as root:

```bash
sudo /bin/sh ./install-nas-audit-command.sh
```

Subsequent readback is non-interactive:

```bash
sudo -n /usr/local/sbin/opl-nas-audit status | jq .
```

The command calls only the read-only Hyper Backup task APIs and returns task
counts, result counts, the latest recorded success time, and the NAS boot time.
It omits task names, users, destinations, paths, log messages, and credentials.
No configured task or no successful run is reported as
`attentionRequired=true` with a null success time; it is not rewritten into a
successful backup and does not trigger, configure, suspend, or delete a task.

### Manual path

Pin and record source commits. Qualify the new commit with
`./ops/docker/smoke-test.sh`, then recreate the service:

```bash
docker compose -p opl-fleet-cockpit \
  -f compose.yaml \
  pull
docker compose -p opl-fleet-cockpit \
  -f compose.yaml \
  up -d
```

Repeat live network/Codex, mDNS, and HTC readbacks. A reboot readback is optional
and separately authorized; it is not part of this migration. To roll back, set
`OPL_FLEET_COCKPIT_IMAGE` to the recorded prior release and run the same commands. Keep
`.env`, `secrets`, `INSTANCE_ID`, and the named volume unchanged. Never use
`down -v` during an upgrade or rollback.

Inspect failures with:

```bash
docker compose -p opl-fleet-cockpit \
  -f compose.yaml \
  -f compose.host-network.yaml \
  logs --tail=200 gateway
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8787/api/status
```

If DSM reports **Unable to build project opl-fleet-cockpit**, treat that as a project
definition error. Production uses the public versioned image and must not
build. Confirm that the project uses only `compose.yaml`, does not include
`compose.local-build.yaml`, and renders `network_mode: host`, discovery enabled,
no ports, and no `build:` key. A GHCR login or DSM scheduled task is not a fix: the
package is public and `restart: unless-stopped` owns normal container startup.

## URLs

- `http://<nas-address>:8787/display/overview`
- `http://<nas-address>:8787/display/network`
- `http://<nas-address>:8787/display/machines`
- `http://<nas-address>:8787/display/pet`
- `http://<nas-address>:8787/display/eink`
- `http://<nas-address>:8787/api/status`
- `http://<nas-address>:8787/healthz`

The display endpoints and `/api/status` intentionally have no browser
authentication. Restrict them to the trusted LAN or a private VPN. See
[`security.md`](security.md).
