# Home Assistant Bridge

Home Assistant is an optional downstream consumer. OPL Fleet Cockpit collection,
discovery, APIs, and displays remain operational when Home Assistant is
disabled, stopped, or upgraded. Its availability is required only when accepting
the bridge itself.

## Enable with Compose

Create a Home Assistant Long-Lived Access Token and enter it with
`./scripts/opl-fleet-cockpit.sh set-secret ha_token`.
Keep non-secret settings in `.env`:

```dotenv
HA_ENABLED=true
HA_BASE_URL=http://home-assistant.example.lan:8123
HA_ENTITY_PREFIX=ambient_ops
HA_SYNC_MS=30000
HA_TIMEOUT_MS=5000
```

Compose mounts the token at `/run/secrets/ha_token`. A direct Node deployment
may instead set `HA_TOKEN`; do not commit or log either form.

Restart Ambient Ops and inspect `/healthz`. The `homeAssistant` object records
whether sync was requested, enabled, last attempted, last successful, or
failed. An unreachable Home Assistant instance does not stop collection or the
dashboard.

## Entities

Ambient Ops writes these REST state entities:

- `sensor.ambient_ops_network_download_mbps`
- `sensor.ambient_ops_network_upload_mbps`
- `sensor.ambient_ops_opl_fleet_agent_1m`
- `sensor.ambient_ops_opl_fleet_agent_5m`
- `sensor.ambient_ops_active_sessions`
- `sensor.ambient_ops_machine_count`
- `sensor.ambient_ops_status`

They may be used in HA history, automations, and dashboards. No HACS component,
MQTT broker, or HA restart is required. REST-created states are transient HA
runtime entities; Ambient Ops remains their source of truth and refreshes them
on its configured interval.
