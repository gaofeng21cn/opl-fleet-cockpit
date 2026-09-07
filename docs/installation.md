# OPL Fleet Cockpit Installation

[简体中文](installation.zh-CN.md) | **English**

This tutorial owns Docker installation, routine upgrades and rollback.
[Synology deployment](deployment-synology.md) adds DSM-specific administration;
[host migration](host-migration.md) owns moving an existing writer.

## Requirements

Use a Linux Docker host with Compose v2, Git, curl and OpenSSL. Production
serves trusted LAN clients on TCP/8787 and publishes mDNS over UDP/5353.
The service has no browser login: apply the [security boundary](security.md).
SNMPv3 additionally needs IPv4/UDP 161 to a qualified router.

The release workflow builds public `linux/amd64` and `linux/arm64` images.
Choose a reviewed release and verify its artifacts. `.env.example` owns the
default image reference; this guide does not track the latest published version.
No GitHub credential is needed for a public pull. The NAS does not build source.

## 1. Initialize

Choose a persistent directory, for example `/volume1/docker/opl-fleet-cockpit`
on Synology:

```bash
git clone https://github.com/gaofeng21cn/opl-fleet-cockpit.git
cd opl-fleet-cockpit
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh init
```

The default is `codex-only`. Before `.env` exists, choose
`init --profile snmpv3` or `init --profile unifi-api` when needed.
`init` refuses to overwrite an existing configuration. It creates a stable
`INSTANCE_ID`, a random 256-bit `secrets/agent_push_token` and empty optional
secret files without printing credentials. Never run it to upgrade an instance.

## 2. Configure

Edit non-secret `.env` fields:

```dotenv
SITE_NAME=Home OPL Fleet Cockpit
DISPLAY_TIME_ZONE=Asia/Shanghai
```

Keep the generated `INSTANCE_ID` stable. Keep `OPL_FLEET_COCKPIT_IMAGE` pinned
to the reviewed release, never `latest`. Preserve the actual
`OPL_FLEET_COCKPIT_DATA_VOLUME` value on existing deployments.

| Profile | Additional configuration |
| --- | --- |
| `codex-only` | No router credentials |
| `snmpv3` | Qualified router address, read-only user, exact WAN selector, authentication and privacy secret files |
| `unifi-api` | Controller URL, site and read-only API-key file |

[Router configuration](unifi.md) owns selectors, protocols, optional client count,
latency and source verification. SNMP compatibility requires real IF-MIB
Counter64 evidence, not a vendor name. [Home Assistant](home-assistant.md) is optional.

Enter required secrets interactively:

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_auth_password
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_priv_password
```

Those two commands apply to SNMPv3. Use `set-secret unifi_api_key` for the API
profile and `set-secret ha_token` for Home Assistant. Never put credentials in
`.env`, shell arguments, chat, logs or Git.

On native Linux/Synology the container runs as UID/GID 1000:

```bash
sudo chown -R 1000:1000 secrets
sudo chmod 700 secrets
sudo chmod 600 secrets/*
```

Docker Desktop may translate ownership; do not use mode 644 as a workaround.

## 3. Start and connect

```bash
./scripts/opl-fleet-cockpit.sh validate
./scripts/opl-fleet-cockpit.sh up
./scripts/opl-fleet-cockpit.sh status
```

The helper validates configuration, pulls the pinned image and starts the
production Compose service with `restart: unless-stopped`. It does not use
`compose.local-build.yaml`. Inspect failures with the helper's `logs` command.

Install the reviewed [OPL Fleet Agent release](https://github.com/gaofeng21cn/opl-fleet-agent/releases)
on each computer and follow its Gateway pairing flow. Compare the six-digit code
before approval. Signed devices keep their private keys locally; preserve
Gateway approvals during host moves. Headless bearer senders use the existing
token through protected local storage, never chat.

Use the [Android kiosk guide](../android-kiosk/README.md) for signed APK selection,
installation and device acceptance, and the [iOS guide](ios-app.md) for native
clients. Direct mode connects to one Agent and does not verify Gateway collection.

## 4. Accept

Read `/healthz` and `/api/status` from the intended host. HTTP 200 proves
liveness only. Require non-demo mode, each expected machine once with fresh
data, one mDNS instance, and live metrics for every configured collector.
In `codex-only`, WAN readiness is intentionally not required.

Verify the effective versioned image, host networking, discovery, no `build:`
or port mapping, restart policy and persistent `/data` volume. For an in-scope
kiosk, verify Wi-Fi operation with no `adb reverse` and the device acceptance
in its guide. A Docker-host reboot is a separate authorized operation; do not
claim reboot recovery from restart policy alone.

## Upgrade and rollback

Record the deployment commit, effective image/digest, `INSTANCE_ID`, actual
data volume and source health:

```bash
git rev-parse HEAD
docker compose --env-file .env -p opl-fleet-cockpit -f compose.yaml config --images
./scripts/opl-fleet-cockpit.sh status
```

Update deployment files only as required by the reviewed release, set its exact
`OPL_FLEET_COCKPIT_IMAGE`, then run `validate` and `up` and repeat acceptance.
For rollback restore the recorded image and deployment revision, then use the
same commands. Preserve `.env`, `secrets/`, `INSTANCE_ID` and the actual volume.
Never use `docker compose down -v`. DSM build errors belong to the
[Synology reference](deployment-synology.md).
