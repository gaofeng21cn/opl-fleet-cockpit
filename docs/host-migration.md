# Gateway Host Migration

This procedure moves an existing logical Gateway to another host.
[Installation](installation.md) owns configuration, startup and source acceptance.
This page owns cutover ordering and data continuity, not a site's live owner status.

## Prepare without starting a second writer

Record the source service manager, deployment revision, exact image or runtime
release, `INSTANCE_ID`, data location, collectors and expected machines.
Record commands to stop and restore that exact service.

Prepare a reviewed target revision, validate Compose and pull the pinned image.
Production `compose.yaml` enables host networking and discovery: do not run
`up`, `exec`, persistence probes or live checks before target cutover.
An isolated development smoke test is a separate environment.

Preserve `INSTANCE_ID`, configuration and credentials through a private channel.
For same-host container replacement, keep the actual named volume through
`OPL_FLEET_COCKPIT_DATA_VOLUME`; do not substitute a guessed default.

## Cut over

1. Stop the source and prevent its supervisor from restarting it.
2. Take a consistent copy of its data. Preserve `device-pairings.json` and
   `pets/` as well as `state.json`: approved public keys and uploaded artwork
   cannot be recovered merely by waiting for metrics. Preserve protected credentials.
3. Restore target data with its runtime's required ownership. Never merge live
   stores. Keep the source copy for bounded rollback.
4. Start the target through its documented helper. Confirm exactly one Gateway
   publishes the logical instance and receives snapshots.
5. Apply installation acceptance to configured collectors, machines and displays.
   Direct-mode displays connect independently to Agents and do not prove Gateway cutover.
6. Verify persistence after controlled container replacement: read back the same
   volume, machines, approvals and pet state. Never use `docker compose down -v`.

No configured router means live WAN is not an acceptance requirement; an
unconfigured pet is not a migration failure. Do not import an old site's topology.

## Rollback and retirement

On failure stop the target first, restore the source's recorded configuration and
consistent data, then restart the source. Verify its instance, collectors,
machines and displays. Never run both writers to mask a failed rollback.

After acceptance remove obsolete startup ownership and deployment instructions
from the site's operations. Retain only an owner-approved recovery backup;
a legacy server is not a permanent compatibility requirement.

A real host reboot is a separate authorized operation. Restart policy and a
healthy container do not prove reboot recovery.
