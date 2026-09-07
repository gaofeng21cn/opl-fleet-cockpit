# Synology Deployment Reference

This page owns DSM and restricted deployment-command behavior. Follow
[installation](installation.md) for initial configuration and routine acceptance,
and [host migration](host-migration.md) when replacing an existing writer.

## DSM project

`compose.yaml` is self-contained: one `gateway` service, host networking,
discovery enabled, read-only root filesystem, UID/GID 1000, dropped capabilities,
and `restart: unless-stopped`. Container Manager loads this file alone.
`compose.local-build.yaml` is for development and must not be selected on the NAS.

Before startup, validate without printing environment values:

```bash
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml config --format json |
  jq -e '.services.gateway.network_mode == "host" and
    .services.gateway.environment.DISCOVERY_ENABLED == "true" and
    (.services.gateway.ports == null) and
    (.services.gateway.build == null)'
```

Allow trusted LAN clients to TCP/8787 and UDP/5353 multicast. Only SNMP
installations require NAS-to-router IPv4/UDP 161. Discovery currently uses
`_ambient-ops._tcp.local`; this is the implemented wire type, not an instruction
to create a second project. Keep `INSTANCE_ID` independent of the host address.

The volume name comes from `OPL_FLEET_COCKPIT_DATA_VOLUME`, defaulting to
`opl-fleet-cockpit_data`. Read the actual `/data` mount before recreation.
A configured existing volume must not be silently replaced with the default.

If DSM says it cannot build the project, inspect its selected definition and
logs. A production project pulls a reviewed versioned image. Remove an
accidentally selected local-build override after confirming the project;
neither a GHCR token nor a DSM scheduled task fixes the wrong definition.

## Restricted SSH deployment

The repository provides an owner-specific root installer and constrained
deployer. Review their source before installation: paths and `DEPLOY_USER=gaofeng`
are deployment policy, not portable defaults for an arbitrary NAS.
Docker-socket membership grants much broader authority.

Stage the reviewed matching files together:

```text
opl-fleet-cockpit-deploy
install-cockpit-deploy-command.sh
compose.yaml
```

The installer verifies the staged deployer and Compose against embedded hashes.
Run from that staging directory as the authorized administrator:

```bash
sudo /bin/sh ./install-cockpit-deploy-command.sh
```

It installs the root-owned command under `/usr/local/sbin`, a narrow sudoers
entry under `/etc/sudoers.d`, and the runtime in
`/volume1/.opl-fleet-cockpit-deploy`. Root must not consume privileged Compose
or environment files from a user-writable parent directory.

The installer takes configuration from `/volume1/docker/opl-fleet-cockpit`.
Its source still handles an existing Ambient Ops installation, including a
previous managed directory and named volume. Inspect that selection before
running it; it does not establish which path owns a live NAS today.
Existing configuration, credentials, instance identity and volume are preserved.
Do not create the former project for a new deployment.

Verify from the configured ordinary SSH account:

```bash
sudo -n /usr/local/sbin/opl-fleet-cockpit-deploy --check
sudo -n /usr/local/sbin/opl-fleet-cockpit-deploy status | jq .
```

Use reviewed values from the intended release, not an example's old digest:

```text
sudo -n /usr/local/sbin/opl-fleet-cockpit-deploy deploy <version> <sha256:index-digest>
```

The deployer validates repository/version/digest, serializes with `flock`,
verifies the pulled tag and digest, atomically updates only the image setting,
checks Compose, and recreates without deleting volumes. It requires live
health and versioned status and restores the previous configuration/service on
failure. A same-host identity transition verifies the existing volume before
stopping the prior container and restores that container if acceptance fails.

The command accepts neither arbitrary Docker operations nor `down -v`.
Image-only releases use this deploy path; Compose changes require reviewing
the installer and its artifact hashes again.

## Status evidence

`status` returns sanitized `opl_fleet_cockpit_gateway_status.v1`: configured
digest, image identity, restart policy, named data volume, public health,
boot time and reboot recovery. It omits environment values, secrets, volume
source paths, machine details and raw logs. `compatibilityId` is an output field
defined by the deployer, not an additional owner.

Reboot recovery is verified only when the release was deployed before the most
recent host boot and the current container started afterward. A healthy release
deployed after boot remains unverified. The read-only status command never reboots.

Source health, unique Agent machines and in-scope displays still require
[installation acceptance](installation.md). Optional Hyper Backup evidence
belongs to [NAS backup audit](nas-backup-audit.md), independently of Gateway deployment.
