# Ambient Ops Release Handoff

Updated on 2026-07-26. The Mac checkout and private GitHub repository are the
source and delivery surfaces for Ambient Ops.

## Current accepted runtime

The canonical production instance currently runs on the Mac as
`cn.gaofeng.ambient-ops.server` from the atomic runtime release
`20260726-pet-input-output-tps-v3`.

Fresh owner-side readback on 2026-07-26 confirmed:

| Surface | Result |
| --- | --- |
| LaunchAgent | Running, last exit code 0 |
| `/healthz` | `mode=live`, overall/network/Codex live |
| UniFi | SNMPv3 `authPriv`, two selected WAN interfaces, 4 Hz polling |
| Codex | One live Mac; duplicate legacy agent disabled |
| Pet | Ledger Owl state and asset identity received from OPL Fleet Agent |
| HTC 5G Hub | Native kiosk verified on physical device |
| Discovery | Wi-Fi mDNS; no USB or `adb reverse` dependency |
| Home Assistant | Disabled and non-critical |

The HTC app is the default Home activity, owns an immersive WebView, remembers
the preferred `INSTANCE_ID`, and resolves `_ambient-ops._tcp.local`. OPL Fleet Agent
also discovers Ambient Ops and pushes only normalized aggregate metrics. The
legacy standalone Codex push LaunchAgent and ADB watcher are recovery artifacts
and must remain disabled during normal operation.

## Delivered product surface

- Live Overview, Network, Machines, Pet, and e-ink views
- Smoothed 4 Hz UniFi SNMPv3 WAN rates from 64-bit interface counters
- Authenticated multi-machine OPL Fleet Agent ingestion and stale retirement
- Host pet protocol and selected-machine Pet view
- Native Android kiosk with boot, Home, immersive, retry, and LAN discovery
- Atomic macOS runtime install and previous-release rollback
- Docker/Compose packaging, persistent `/data`, health check, and host-network
  discovery override
- Optional Prometheus and Home Assistant outputs

SNMPv3 is the preferred UniFi path and does not require `UNIFI_API_KEY`.
The Network API remains a fallback only.

## Remaining production gate

The only host migration still requiring owner-authoritative execution is the
Synology cutover. Follow
[`docs/production-migration-checklist.md`](docs/production-migration-checklist.md)
and do not declare completion after only an image build, Compose expansion, or
HTTP 200 response.

The terminal state is:

1. Synology host-network container is the only canonical instance.
2. It preserves the Mac `INSTANCE_ID`, agent token, and required secrets.
3. `/data` survives replacement and the container returns after NAS reboot.
4. `/healthz` reports live network and Codex sources with the expected machines.
5. The HTC and OPL Fleet Agent apps discover and use the NAS without manual URLs,
   USB, or `adb reverse`.
6. The Mac LaunchAgent is unloaded but retained as a tested rollback.

Home Assistant is optional and must not block this gate.

## Configuration contract

Non-secret configuration:

```text
AMBIENT_OPS_PORT
PORT
DATA_DIR
DEMO_MODE
SITE_NAME
DISPLAY_TIME_ZONE
DISCOVERY_ENABLED
INSTANCE_ID
UNIFI_BASE_URL
UNIFI_SITE
UNIFI_ALLOW_SELF_SIGNED
UNIFI_CA_FILE
UNIFI_POLL_MS
UNIFI_RATE_WINDOW_MS
UNIFI_SNMP_HOST
UNIFI_SNMP_PORT
UNIFI_SNMP_USER
UNIFI_SNMP_AUTH_PROTOCOL
UNIFI_SNMP_PRIV_PROTOCOL
UNIFI_SNMP_INTERFACES
UNIFI_SNMP_TIMEOUT_MS
LIVE_AFTER_SECONDS
STALE_AFTER_SECONDS
HA_ENABLED
HA_BASE_URL
HA_ENTITY_PREFIX
HA_SYNC_MS
HA_TIMEOUT_MS
```

The production Compose deployment reads these ignored files:

```text
secrets/agent_push_token
secrets/unifi_snmp_auth_password
secrets/unifi_snmp_priv_password
secrets/unifi_api_key          # only for the API fallback
secrets/ha_token               # only when HA_ENABLED=true
```

Do not put secret values in tracked Compose files, screenshots, logs, or this
handoff. Direct Node operation also supports environment and macOS Keychain
secret sources, but mounted files are the canonical Docker path.

## Source validation

Before integrating or releasing a source commit:

```bash
npm ci
npm test
npm run build
docker compose -f compose.yaml config
docker compose -f compose.yaml -f compose.host-network.yaml config
git diff --check
```

See [`docs/security.md`](docs/security.md),
[`docs/agent-push-api.md`](docs/agent-push-api.md), and
[`docs/macos-htc-kiosk.md`](docs/macos-htc-kiosk.md) for the exact trust and
runtime contracts.
