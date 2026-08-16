# OPL Fleet Cockpit Installation Guide

[简体中文](installation.zh-CN.md) | **English**

This is the ordinary-user path for a Linux Docker host or Synology NAS. It
uses one non-secret `.env` file, private files under `secrets/`, the public
multi-platform image, and the signed Android APK. The NAS never builds the
application from source.

The user-facing product is `OPL Fleet Cockpit`; its container is
`OPL Fleet Cockpit Gateway`. New installations use the branded repository,
image, Compose project, paths, and volume. Existing `ambient-ops` image,
environment, data-volume, and `_ambient-ops._tcp.local` identities remain
compatibility aliases during in-place migration.

## What you need

- A Linux host or Synology NAS with Docker Engine and Docker Compose v2
- `git`, `curl`, and `openssl` on the Docker host
- TCP/8787 reachable only from the trusted LAN or private VPN
- UDP/5353 multicast between the server, OPL Fleet Agent computers, and Android kiosk
- Optional: IPv4/UDP 161 from the Docker host to a qualified SNMPv3 router
- Optional for initial Android installation: a computer with `adb`

The current published server image is
`ghcr.io/gaofeng21cn/opl-fleet-cockpit:0.1.42` for both `linux/amd64` and
`linux/arm64`. The package is public. Do not create or configure a GitHub token
for a normal pull.

## 1. Create the installation

Choose a persistent directory. On Synology, a typical location is
`/volume1/docker/opl-fleet-cockpit`.

```bash
git clone https://github.com/gaofeng21cn/opl-fleet-cockpit.git
cd opl-fleet-cockpit
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh init
```

`init` creates the minimal `codex-only` configuration by default. For a new
installation that needs router telemetry immediately, run this before `.env`
exists instead:

```bash
./scripts/opl-fleet-cockpit.sh init --profile snmpv3
# or: ./scripts/opl-fleet-cockpit.sh init --profile unifi-api
```

`init` refuses to overwrite an existing `.env`. It creates:

- a profile-specific `.env` with a stable generated `INSTANCE_ID`
- `secrets/agent_push_token` with a random 256-bit token
- empty optional secret files for SNMPv3, UniFi API, and Home Assistant

No secret is printed. Keep `.env`, `secrets/`, and the Docker volume when
upgrading or moving the service.

## 2. Edit one configuration file

Open `.env` in a local text editor. For a Codex-only screen, most users edit only:

```dotenv
SITE_NAME=Home Ambient Ops
DISPLAY_TIME_ZONE=Asia/Shanghai
```

The template already pins a reviewed, versioned image. Change `OPL_FLEET_COCKPIT_IMAGE`
only as part of a reviewed upgrade and never use a moving tag. Use an IANA time-zone
name such as `Asia/Shanghai`, `Europe/London`, or `America/Los_Angeles`. Preserve
`INSTANCE_ID` exactly after the first start.

Choose one network profile:

| Profile | Use it when | Required additions |
| --- | --- | --- |
| `codex-only` | Only Codex and pet pages are required | Default `init` profile |
| `snmpv3` | SNMPv3 router | New installs use `init --profile snmpv3`; address, user, WAN selector, two passwords |
| `unifi-api` | UniFi API fallback | New installs use `init --profile unifi-api`; controller URL and API key file |

### SNMPv3 profile

For a new installation, start with `./scripts/opl-fleet-cockpit.sh init --profile snmpv3`.
Then set the non-secret values in `.env`. An existing `codex-only` installation may
add the same fields manually:

```dotenv
UNIFI_SNMP_HOST=192.168.1.1
UNIFI_SNMP_USER=ambient-ops
UNIFI_SNMP_INTERFACES=WAN
UNIFI_SNMP_CLIENT_INTERFACES=LAN
UNIFI_SNMP_PORT=161
UNIFI_SNMP_AUTH_PROTOCOL=sha
UNIFI_SNMP_PRIV_PROTOCOL=aes
UNIFI_POLL_MS=250
UNIFI_RATE_WINDOW_MS=2000
NETWORK_LATENCY_HOST=1.1.1.1
NETWORK_LATENCY_PORT=443
NETWORK_LATENCY_TIMEOUT_MS=1500
NETWORK_AUXILIARY_POLL_MS=5000
```

`UNIFI_SNMP_INTERFACES` is an exact case-insensitive IF-MIB index, `ifName`, or
`ifAlias`. Separate distinct WAN uplinks with commas. Do not count VLAN,
PPPoE, tunnel, and physical layers carrying the same traffic more than once.

`UNIFI_SNMP_CLIENT_INTERFACES` is optional and selects exact LAN interfaces
from the standard IPv4 neighbor table. The displayed client count deduplicates
dynamic entries by MAC address, so it is an active-neighbor estimate rather
than a controller inventory. Leave it empty when the router does not expose
`ipNetToMediaTable`. The optional TCP latency target must be a stable endpoint
you intentionally want to measure; it does not require raw-socket privileges.

Enter the two passwords without putting them in shell history:

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_auth_password
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_priv_password
```

The historical `UNIFI_` prefix does not bind the collector to UniFi. A router
is compatible only after its `ifHCInOctets` and `ifHCOutOctets` counters are
verified under real traffic. Follow [Router and SNMP qualification](unifi.md).

### UniFi API fallback

For a new installation, start with `./scripts/opl-fleet-cockpit.sh init --profile unifi-api`.
Then set:

```dotenv
UNIFI_BASE_URL=https://192.168.1.1
UNIFI_SITE=default
```

Then run:

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_api_key
```

An API key is not needed when the SNMPv3 profile is live.

## 3. Protect secrets on Linux and Synology

The container runs as UID/GID 1000. After all optional secrets have been
entered, make them private and readable by that non-root user:

```bash
sudo chown -R 1000:1000 secrets
sudo chmod 700 secrets
sudo chmod 600 secrets/*
```

Docker Desktop on macOS normally translates bind-mount ownership and does not
need this step. Do not use mode 644 as a permission workaround.

## 4. Validate and start

```bash
./scripts/opl-fleet-cockpit.sh validate
./scripts/opl-fleet-cockpit.sh up
```

The helper validates required fields and secret files, renders the production
Compose merge, pulls the pinned public image, and starts it with
`restart: unless-stopped`. It never selects `compose.local-build.yaml`.

Check at any time:

```bash
./scripts/opl-fleet-cockpit.sh status
./scripts/opl-fleet-cockpit.sh logs
curl -fsS http://<server-ip>:8787/api/status
```

`/healthz` returning HTTP 200 proves process liveness. Read its `network`,
`codex`, and `machines` fields separately. In `codex-only` mode, network
readiness is intentionally not an acceptance condition.

## 5. Connect every OPL Fleet Agent computer

Install OPL Fleet Agent `v0.2.11` or later on macOS, or `v0.2.9` or later on Windows, from its
[Releases page](https://github.com/gaofeng21cn/opl-fleet-agent/releases). Each
computer keeps its own raw Codex sessions and sends only aggregate snapshots.

Enable Ambient Ops and Auto-discover. The desktop app creates a per-device
P-256 key, opens the local approval page, and shows the same six-digit code.
Confirm the code and select **Allow device**. macOS stores the private key in
the login Keychain; Windows stores it as current-user DPAPI ciphertext. No
shared token is copied.

`secrets/agent_push_token` remains only for headless and legacy bearer agents.
Enter it locally when one of those agents is intentionally retained; never
paste it into chat, screenshots, tickets, or documentation.

After each host pushes, require one stable machine entry with a live timestamp.
If the same host appears twice, stop the legacy sender rather than deleting
live state repeatedly.

## 6. Install the Android kiosk

Download these assets from
[Ambient Ops v0.1.22](https://github.com/gaofeng21cn/opl-fleet-cockpit/releases/tag/v0.1.22):

- `Ambient-Ops-Kiosk-1.2.7.apk`
- `Ambient-Ops-Kiosk-1.2.7.apk.sha256`

Verify and install:

```bash
shasum -a 256 -c Ambient-Ops-Kiosk-1.2.7.apk.sha256
adb install -r Ambient-Ops-Kiosk-1.2.7.apk
adb shell cmd package set-home-activity \
  cn.gaofeng.ambientops.kiosk/.MainActivity
adb shell am start -n cn.gaofeng.ambientops.kiosk/.MainActivity
```

The production APK is owner-signed. Do not uninstall it during an update:
uninstalling clears the remembered server identity. Version `1.2.1` and later check the
selected Ambient Ops server ten seconds after a healthy page load and every six
hours afterwards. While on external power and connected over Wi-Fi, it accepts only the
fixed package ID, owner certificate, higher `versionCode`, and exact manifest
SHA-256. Each versioned server image embeds the same signed APK published in
its GitHub Release.

Unattended installation requires Magisk root and a one-time permanent `su`
grant to the kiosk. Without root, verify the published checksum and continue to
install later releases with `adb install -r`. Neither path requires a GitHub
credential.

Once installed, USB is not part of normal operation. The kiosk uses Wi-Fi mDNS,
remembers the logical instance, stays immersive, and retries after network
changes.

Kiosk `1.2.7` checks the selected server's content-derived UI revision every
15 seconds while visible. Two stable observations of a changed revision reload
the WebView once. Network failures preserve the current page, so replacing the
versioned Docker image propagates a new dashboard without USB or blind periodic
reloads.

## 7. Accept the installation

Require all applicable checks:

- Compose resolves to a versioned GHCR image and contains no `build:`.
- `/healthz` reports `mode=live`.
- Every expected OPL Fleet Agent host appears once and is live.
- With `snmpv3`, `network=live` and WAN rates change under known traffic.
- The Android kiosk loads every page over Wi-Fi with `adb reverse --list` empty.
- The kiosk returns as Android Home after a cold reboot without USB.
- A reboot recovery check is optional and requires separate owner authorization;
  it is not a gate for this identity migration.

`restart: unless-stopped` is the container restart policy. A DSM Task Scheduler
job is neither required nor recommended.

## Upgrade and rollback

Before an upgrade, record the current image and repository commit:

```bash
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml -f compose.host-network.yaml config --images
git rev-parse HEAD
```

Change only `OPL_FLEET_COCKPIT_IMAGE` to the reviewed new version, update the checked
out deployment files when required by that release, then run:

```bash
./scripts/opl-fleet-cockpit.sh validate
./scripts/opl-fleet-cockpit.sh up
```

Repeat the acceptance checks. To roll back, restore the recorded image and
deployment commit and run the same two commands. Keep `.env`, `secrets/`,
`INSTANCE_ID`, and the named `opl-fleet-cockpit_data` volume. Never use
`docker compose down -v` during upgrade or rollback.

## Synology build-error recovery

Production does not build a project. If DSM reports **Unable to build project
opl-fleet-cockpit**, inspect Container Manager logs and the project Compose file.
The DSM project must use only:

```text
compose.yaml
```

It must not include `compose.local-build.yaml`, and rendered Compose must contain
`network_mode: host`, `DISCOVERY_ENABLED=true`, no `ports`, and no `build:`. Verify over SSH:

```bash
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml config --quiet
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml config --images
```

The image should be `ghcr.io/gaofeng21cn/opl-fleet-cockpit:<version>`. It is public,
so GHCR login and DSM scheduled tasks are not needed. See the detailed
[Synology deployment reference](deployment-synology.md) for migration,
persistence, firewall, and reboot checks.

## Current product boundary

This path is designed for self-service by a Docker-capable user or an Agent
working under the companion guide. It still requires local decisions about
LAN/firewall policy, a stable installation identity, and optional router
credentials and WAN selection. Router compatibility is evidence-based, not a
brand-wide guarantee.

Advanced API, security, Home Assistant, migration, local development, and
Android signing material remains documented in the existing repository
references; this quick path does not replace those documents.
