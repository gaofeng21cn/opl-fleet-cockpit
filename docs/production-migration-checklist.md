# Production Migration Checklist

This checklist moves an accepted legacy runtime, either the macOS LaunchAgent
or the Synology `ambient-ops` Compose identity, to the canonical OPL Fleet
Cockpit Gateway host-network container. It preserves the logical installation,
including the existing Synology data volume, and provides a bounded rollback.

Home Assistant is optional and excluded from the completion gate.

## Acceptance contract

Migration is complete only when all of these are true:

- Exactly one `_ambient-ops._tcp.local` owner exists on the LAN.
- The Synology container uses the prior stable `INSTANCE_ID`.
- The exact agent push token and required SNMPv3 secrets are present.
- `/data` survives forced container replacement.
- The Compose project is `opl-fleet-cockpit`, the service is `gateway`, and the
  container is `opl-fleet-cockpit-gateway-1`.
- An existing Synology installation keeps its original named data volume.
- Health and API readback show live UniFi and Codex state with the expected
  machine set.
- OPL Fleet Agent discovers and pushes to the NAS.
- The HTC kiosk discovers the NAS and renders all four dynamic pages without
  USB or `adb reverse`.
- The Mac server LaunchAgent is unloaded but remains recoverable.

An image build, green test, healthy Docker badge, HTTP 200, or mDNS announcement
alone is only a checkpoint.

## 1. Record the current owner

On the Mac:

```bash
launchctl print gui/$(id -u)/cn.gaofeng.ambient-ops.server
readlink "$HOME/Library/Application Support/Ambient Ops/runtime/current"
cat "$HOME/Library/Application Support/Ambient Ops/data/instance-id"
curl -fsS http://127.0.0.1:8791/healthz | jq
curl -fsS http://127.0.0.1:8791/api/status | jq
```

Record, without exposing secrets:

- current release path
- stable `INSTANCE_ID`
- site name and port
- expected machine IDs/count
- selected UniFi interface indexes/names
- whether the current pet is present

Require current `mode=live`, network live, Codex live, and the expected
machines before migrating. Fix source errors first.

## 2. Prepare the NAS candidate

Use one reviewed Git commit. In the NAS project directory:

```bash
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
```

Set `DEMO_MODE=false`, copy the recorded `INSTANCE_ID`, and configure the same
site name, time zone, SNMP host, user, protocols, interface selectors, 250 ms
poll interval, and 2000 ms rate window.

Securely transfer the exact existing agent token to
`secrets/agent_push_token`. Transfer the SNMP authentication and privacy
passwords into their corresponding secret files. Use an encrypted local
channel such as SSH and owner-only file permissions. Never paste the values
into chat, Git, a Compose file, or terminal output.

Optional state continuity:

- preserving `INSTANCE_ID` is mandatory
- preserving `state.json` is optional because agents and SNMP repopulate it
- if imported, copy it while the Mac service is stopped or from a consistent
  backup; do not merge two live stores

## 3. Stage without taking the LAN owner

Keep the Mac as canonical owner. Do not start a second discovery owner on the NAS.
Validate the single-file production definition without starting it:

```bash
docker compose -p opl-fleet-cockpit -f compose.yaml config --quiet
docker compose -p opl-fleet-cockpit -f compose.yaml config --format json | \
  jq -e '.services.gateway.network_mode == "host" and
    .services.gateway.environment.DISCOVERY_ENABLED == "true" and
    (.services.gateway.ports == null)'
```

Validate live SNMP without expecting Codex to move yet:

```bash
curl -fsS http://127.0.0.1:8787/healthz |
  jq -e '.ok == true and .mode == "live" and .network == "live"'

curl -fsS http://127.0.0.1:8787/api/status |
  jq -e '.demo == false
    and .network.status == "live"
    and .network.source == "unifi-snmp-v3"
    and (.network.interfaces | length) > 0'
```

Do not run `up` until the Mac owner has been stopped in the cutover step below.

## 4. Prove volume persistence

On the staged NAS candidate:

```bash
docker compose -p opl-fleet-cockpit -f compose.yaml \
  exec gateway sh -c 'printf persisted > /data/.persistence-probe'

docker compose -p opl-fleet-cockpit -f compose.yaml up -d --force-recreate

docker compose -p opl-fleet-cockpit -f compose.yaml \
  exec gateway test -f /data/.persistence-probe

docker compose -p opl-fleet-cockpit -f compose.yaml \
  exec gateway rm /data/.persistence-probe
```

Also confirm `/data/state.json` exists after live SNMP sampling. Never use
`docker compose down -v`.

## 5. Cut over one owner

Stop the Mac owner:

```bash
launchctl bootout gui/$(id -u)/cn.gaofeng.ambient-ops.server
```

Immediately start Synology from the single production file:

```bash
docker compose -p opl-fleet-cockpit -f compose.yaml pull
docker compose -p opl-fleet-cockpit -f compose.yaml up -d
```

Do not restart the Mac owner while Synology is publishing. A short collection
gap is acceptable; two simultaneous logical owners are not.

## 6. Verify end to end

From Synology:

```bash
curl -fsS http://127.0.0.1:8787/healthz |
  jq -e '.ok == true
    and .mode == "live"
    and .status == "live"
    and .network == "live"
    and .codex == "live"
    and .machines >= 1'

curl -fsS http://127.0.0.1:8787/api/status |
  jq -e '.demo == false
    and .overallStatus == "live"
    and .network.source == "unifi-snmp-v3"
    and (.machines | length) >= 1
    and any(.machines[];
      .status == "live" and .pet != null)'
```

From the Mac:

1. Confirm the OPL Fleet Agent Ambient Ops panel reports the NAS endpoint and a
   successful push.
2. Confirm the expected stable machine ID appears once in `/api/status`.
3. Browse `_ambient-ops._tcp.local` and verify only one service resolves to the
   recorded `INSTANCE_ID`.
4. Confirm the Mac LaunchAgent label is absent/unloaded.

On the HTC without a reverse tunnel or manual URL:

1. Disconnect USB if practical, or confirm `adb reverse --list` is empty.
2. Restart the kiosk and Wi-Fi once.
3. Verify Overview, Network, Machines, and Pet.
4. Confirm network animation continues, Codex rates change, the selected host
   pet animates, and no discovery/retry page remains.
5. Reboot the HTC and verify it returns to the kiosk as Home.

## Optional NAS reboot recovery

This is a separate operational check, not a completion gate for the identity
migration. Run it only after explicit owner authorization for a maintenance
window. After the host returns:

```bash
docker compose -p opl-fleet-cockpit \
  -f compose.yaml \
  -f compose.host-network.yaml \
  ps
```

Repeat the exact health/API assertions and HTC/Codex readbacks from step 6.
Confirm the expected machines return without duplicating IDs and that the
network history resumes.

The migration can complete without this optional reboot check when the live
container, restart policy, persisted data volume, API, agents, and kiosk have
all been read back successfully.

## Rollback

If a pre-cutover stage fails, leave the Mac owner running and repair the NAS
candidate.

If a post-cutover check fails:

1. Stop Synology first:

   ```bash
   docker compose -p opl-fleet-cockpit \
     -f compose.yaml \
     -f compose.host-network.yaml \
     down
   ```

2. Restore the Mac:

   ```bash
   launchctl bootstrap gui/$(id -u) \
     "$HOME/Library/LaunchAgents/cn.gaofeng.ambient-ops.server.plist"
   launchctl kickstart -k gui/$(id -u)/cn.gaofeng.ambient-ops.server
   ```

3. Require the original live health/API state, one mDNS owner, OPL Fleet Agent push,
   and automatic HTC recovery.

The Mac data, Keychain entries, plist, prior runtime releases, and legacy
Synology data volume must remain untouched until the live migration checks have
passed. Do not run both owners to mask a failed rollback.
