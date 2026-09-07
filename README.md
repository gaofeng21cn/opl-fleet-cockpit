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

## About

OPL Fleet Cockpit aggregates Codex activity, host pressure, optional router WAN
metrics and pet state for a trusted LAN. Its Gateway owns telemetry aggregation,
persistence, discovery and presentation. Fleet registry, policy, admission,
leases and dispatch remain with OPL Flow, the private Instance and Fleet Controller.

[OPL Fleet Agent](https://github.com/gaofeng21cn/opl-fleet-agent) collects local
aggregates on each computer. Prompts, responses, session identifiers, repository
paths and credentials are outside the telemetry contract. Desktop senders pair
once and sign snapshots with per-device keys.

The Gateway ships the server and browser displays in one container. Android
and iOS can discover either the Gateway (Fleet) or a single LAN Agent (Direct).
Direct mode needs no Gateway. Prometheus and Home Assistant are downstream consumers.

## Install

Use the [installation guide](docs/installation.md) for configuration, startup,
source acceptance and upgrades. It supports Codex-only, SNMPv3 and UniFi API
profiles. Production uses a reviewed versioned GHCR image and one persistent
Gateway instance. The [Agent installation boundaries](docs/agent-installation.md)
apply when delegating installation.

- [Android kiosk](android-kiosk/README.md): signed installation and display acceptance.
- [Native iOS](docs/ios-app.md): app behavior, discovery and development.
- [Security](docs/security.md): trusted-LAN, authentication and credential boundaries.
- [Documentation index](docs/README.md): task-specific references and lifecycle.

## Development

```bash
npm ci
npm test
npm run build
docker compose -f compose.yaml config --quiet
python3 ops/public-readiness-check.py --current
```

The Docker smoke gate is `ops/docker/smoke-test.sh`; it qualifies an isolated
development container. Local build output does not prove a running deployment.

OPL Fleet Cockpit is available under the [Apache License 2.0](LICENSE).
