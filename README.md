<p align="center">
  <strong>English</strong> | <a href="./README.zh-CN.md">中文</a>
</p>

<h1 align="center">OPL Fleet Cockpit</h1>

<p align="center"><strong>A quiet, always-on, self-hosted cockpit for OPL Fleet telemetry</strong></p>
<p align="center">OPL Fleet Agents · Telemetry Gateway · Browser, Android, and native iOS displays</p>

<p align="center">
  <a href="https://github.com/gaofeng21cn/opl-fleet-cockpit/releases/latest"><img src="https://img.shields.io/github/v/release/gaofeng21cn/opl-fleet-cockpit" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0 License"></a>
  <img src="https://img.shields.io/badge/deployment-Docker-blue.svg" alt="Docker deployment">
</p>

<p align="center">
  <img src="./docs/assets/readme-gallery/htc-load.png" alt="Single-machine Codex load view running on an HTC 5G Hub" width="100%">
</p>

<p align="center"><sub>Real 1280×720 capture from the deployed HTC 5G Hub kiosk</sub></p>

<table>
  <tr>
    <td width="50%"><img src="./docs/assets/readme-gallery/htc-overview.png" alt="Overview display"></td>
    <td width="50%"><img src="./docs/assets/readme-gallery/htc-network.png" alt="Network display"></td>
  </tr>
  <tr>
    <td align="center"><sub>Overview</sub></td>
    <td align="center"><sub>Network</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/assets/readme-gallery/htc-machines.png" alt="Machines display"></td>
    <td width="50%"><img src="./docs/assets/readme-gallery/htc-pet.png" alt="Codex pet display"></td>
  </tr>
  <tr>
    <td align="center"><sub>Machines</sub></td>
    <td align="center"><sub>Pet</sub></td>
  </tr>
</table>

<p align="center"><strong>Native iPhone companion</strong></p>

<table>
  <tr>
    <td width="25%"><img src="./docs/assets/readme-gallery/ios-home.png" alt="OPL Fleet Cockpit native iPhone Home"></td>
    <td width="25%"><img src="./docs/assets/readme-gallery/ios-load.png" alt="Uncropped portrait Load animation on iPhone"></td>
    <td width="25%"><img src="./docs/assets/readme-gallery/ios-pet.png" alt="Codex Pet display on iPhone"></td>
    <td width="25%"><img src="./docs/assets/readme-gallery/ios-live-activity.jpg" alt="OPL Fleet Cockpit Load Live Activity on the iPhone Lock Screen"></td>
  </tr>
  <tr>
    <td align="center"><sub>Home</sub></td>
    <td align="center"><sub>Load</sub></td>
    <td align="center"><sub>Pet</sub></td>
    <td align="center"><sub>Live Activity</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="33%" valign="top">
      <strong>Primary Use</strong><br/>
      See Codex activity, network throughput, device freshness, and pet state in one trusted-LAN dashboard
    </td>
    <td width="33%" valign="top">
      <strong>Interfaces</strong><br/>
      Browsers, a five-inch Android kiosk, Prometheus, and optional Home Assistant synchronization
    </td>
    <td width="33%" valign="top">
      <strong>Privacy Boundary</strong><br/>
      Raw Codex sessions remain on each computer; the server accepts only allowlisted aggregate metrics
    </td>
  </tr>
</table>

> OPL Fleet Cockpit is designed for a trusted local network, not as an internet-facing monitoring service. Display, status, and device-approval pages have no browser login by default. Add HTTPS and access control or use a private VPN before crossing an untrusted network.

## For Users

### What it is

OPL Fleet Cockpit is a self-hosted status aggregator for a local network. It combines
aggregate Codex activity from multiple computers with optional live WAN counters
from a compatible router, then presents the normalized state through browser and
dedicated Android displays.

The container is the OPL Fleet Cockpit Gateway, while the desktop client is
OPL Fleet Agent. These are telemetry-only roles: registry, policy,
admission, leases, and dispatch remain with OPL Flow, the private Instance, and
OPL Fleet Controller. New installations use the `opl-fleet-cockpit` project and
image identities. The Gateway retains its bounded `ambient-ops` implementation
alias for in-place upgrades; the Agent uses only its canonical `opl-fleet-agent` identity.

It is intentionally narrower than a general observability platform. It helps when
you want to:

- glance at recent Codex activity across several machines;
- keep download, upload, and latency visible on an ambient screen;
- give browsers and a dedicated display one canonical status source; and
- keep the deployment self-hosted without sending conversation content to a third party.

### How OPL Fleet Agent fits

[OPL Fleet Agent](https://github.com/gaofeng21cn/opl-fleet-agent) runs on each macOS or Windows
computer and reads usage events already written by the local Codex client. It sends
only machine identity, platform, collection time, aggregate `1m` and `5m` token
counters, active-session count, and optional pet state.

Session identifiers, local paths, prompts, responses, tool content, and repository
files are never transmitted.

Current desktop clients use one-time device approval. OPL Fleet Agent creates a local
per-device key, the user verifies a six-digit pairing code, and subsequent snapshots
are signed. Shared bearer tokens remain only for legacy and headless agents.

### Architecture

```text
OPL Fleet Agent on each computer -- authenticated aggregates ------+
                                                                  |
SNMPv3 router -------------- standard IF-MIB counters ------------+--> OPL Fleet
                                                                  |    Telemetry Gateway
/data ---------------------- state and short history -------------+       |
                                                                         +--> browsers
                                                                  +--> Android kiosk (Fleet)
                                                                         +--> native iOS app
                                                                         +--> Prometheus
                                                                         +--> Home Assistant
                                                                              (optional)
```

The server, API, SNMP collector, LAN discovery publisher, and frontend ship in one
container. The Android kiosk can display this canonical Fleet source, or use its
bundled frontend to connect directly to one LAN OPL Fleet Agent instance. Direct mode
needs no Gateway and still receives only aggregate machine status.

### What you get

- Overview, Network, Machines, single-machine Load, Pet, and e-ink display surfaces
- Native iOS Home, Machines, Display, Widgets, Live Activities, Dynamic Island,
  and StandBy surfaces with a complete offline Demo Mode
- Aggregate Codex throughput, active-session, and freshness state across machines
- Standard IF-MIB `Counter64` download/upload metrics and optional latency
- Prometheus text metrics and optional Home Assistant synchronization
- Dual Gateway/Direct LAN discovery for the dedicated Android kiosk
- Versioned Docker images, health checks, persistent state, and rollbackable upgrades

### Quick start

Requirements: Docker Engine, Docker Compose v2, `curl`, and `openssl`.

```bash
git clone https://github.com/gaofeng21cn/opl-fleet-cockpit.git
cd opl-fleet-cockpit
./scripts/opl-fleet-cockpit.sh init
```

This creates the minimal `codex-only` configuration. Most users edit only the
site name and time zone in `.env`:

```dotenv
SITE_NAME=Home OPL Fleet Cockpit
DISPLAY_TIME_ZONE=Asia/Shanghai
```

The template pins a reviewed release image. Change `OPL_FLEET_COCKPIT_IMAGE` only when
deliberately moving to a newer reviewed
[release](https://github.com/gaofeng21cn/opl-fleet-cockpit/releases/latest); never use `latest`.

If router telemetry is needed from the beginning, select the profile during
initialization:

```bash
./scripts/opl-fleet-cockpit.sh init --profile snmpv3
# or: ./scripts/opl-fleet-cockpit.sh init --profile unifi-api
```

The SNMPv3 profile also requires both passwords through the interactive helpers:

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_auth_password
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_priv_password
./scripts/opl-fleet-cockpit.sh validate
./scripts/opl-fleet-cockpit.sh up
./scripts/opl-fleet-cockpit.sh status
```

`init` refuses to overwrite an existing configuration. It creates a stable instance
ID and shared agent token without printing secret material. Tokens and passwords live
under the ignored `secrets/` directory and must not be copied into `.env`, commands,
logs, screenshots, or Git.

See the [installation guide](docs/installation.md) for the complete Docker, Synology,
upgrade, rollback, and Android kiosk path.

### Network modes

| Mode | Use case | Additional configuration |
| --- | --- | --- |
| `codex-only` | Codex and pet state only | Created by default with `init`; no router configuration |
| `snmpv3` | Preferred generic router path | `init --profile snmpv3`; router address, read-only user, selectors, and two passwords |
| `unifi-api` | UniFi Network API fallback | `init --profile unifi-api`; controller URL, site, and API-key file |

The SNMP path uses standard IF-MIB rather than a private UniFi MIB. A router must still
support SNMPv3 `authPriv` and expose `ifHCInOctets` and `ifHCOutOctets` for the real WAN
interfaces. “SNMP enabled” is not sufficient; qualify the device with
[`docs/unifi.md`](docs/unifi.md).

### Important boundaries

- Run exactly one Ambient Ops instance that publishes discovery and accepts snapshots for a site.
- Production `compose.yaml` is self-contained and uses host networking so DSM
  Container Manager can load it as a single project file. `compose.host-network.yaml`
  remains a compatibility override for older operator commands; `compose.local-build.yaml`
  is for local development only.
- Do not expose the service directly to the internet.
- Preserve `.env`, `INSTANCE_ID`, `secrets/`, and the `OPL_FLEET_COCKPIT_DATA_VOLUME` during upgrades.
- Do not run `docker compose down -v` unless permanent data deletion is intentional.

## For Agents

### Recommended task prompt

Replace only the non-sensitive placeholders:

```text
Install or upgrade OPL Fleet Cockpit Gateway on <Docker host> under <absolute target directory>.
Use SITE_NAME=<site name>, DISPLAY_TIME_ZONE=<IANA time zone>, and
AMBIENT_OPS_NETWORK_MODE=<codex-only|snmpv3|unifi-api>.

Follow docs/installation.md, docs/agent-installation.md, and
scripts/opl-fleet-cockpit.sh. Use only a reviewed versioned GHCR image in production.
Do not build source on the NAS, use a moving image tag, create unnecessary GitHub
credentials, or add a scheduler that duplicates the container restart policy.

Do not request, read, print, or copy tokens and passwords. When a secret is needed,
ask me to run the documented interactive set-secret command in a trusted terminal.
An existing installation must preserve .env, INSTANCE_ID, secrets/, and
`OPL_FLEET_COCKPIT_DATA_VOLUME`. Never run docker compose down -v. Existing migrations
may set it to `ambient-ops_ambient_ops_data` to keep the original data.

Before completion, read back the rendered image, /healthz, /api/status, mDNS
discovery, expected machine list, and Android kiosk connection. A successful build,
HTTP 200 response, or running container is not complete acceptance.
```

### Agent installation sequence

For a new installation:

```bash
git clone https://github.com/gaofeng21cn/opl-fleet-cockpit.git <target>
cd <target>
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh init --profile <codex-only|snmpv3|unifi-api>
```

Modify only documented non-secret `.env` fields. The user enters real tokens and
passwords in a trusted terminal.

```bash
./scripts/opl-fleet-cockpit.sh validate
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml -f compose.host-network.yaml config --images
./scripts/opl-fleet-cockpit.sh up
./scripts/opl-fleet-cockpit.sh status
```

Do not run `init` for an existing installation. Before upgrading, record the current
source commit, effective image, health readback, and exact rollback command. Change
`OPL_FLEET_COCKPIT_IMAGE` only to a reviewed version and repeat validation and acceptance.

### Agent authority and evidence boundaries

- Inspect secret-file existence, ownership, and mode without opening the content.
- Configure router addresses, read-only usernames, and selectors without asking the user to paste passwords into chat.
- Distinguish process health from configured-source readiness.
- Treat device approval, signing identity, and real host restarts as explicit user actions.
- Preserve the single-instance rule during migration: stop the old writer before starting the new LAN authority.

The full contract is in the [Agent installation guide](docs/agent-installation.md).

## Documentation

- [Installation guide](docs/installation.md)
- [Agent installation guide](docs/agent-installation.md)
- [Security and privacy](docs/security.md)
- [Native iOS app](docs/ios-app.md)
- [iOS privacy policy](docs/privacy-policy.md)
- [Agent push API](docs/agent-push-api.md)
- [Router and SNMPv3](docs/unifi.md)
- [Synology deployment](docs/deployment-synology.md)
- [Android kiosk](docs/macos-htc-kiosk.md)
- [Migration acceptance checklist](docs/production-migration-checklist.md)

## Technical Validation

```bash
npm ci
npm test
npm run build
docker compose -f compose.yaml config
docker compose -f compose.yaml -f compose.host-network.yaml config
python3 ops/public-readiness-check.py
```

OPL Fleet Cockpit is available under the [Apache License 2.0](LICENSE).
