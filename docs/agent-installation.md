# Agent Installation Guide

[简体中文](agent-installation.zh-CN.md) | **English**

This guide lets a user delegate Ambient Ops installation to Codex or another
capable local Agent without delegating credentials, destructive storage
actions, or unverified production claims. The Agent follows the same
[ordinary installation guide](installation.md); this page adds authority and
evidence boundaries.

## Information the user may give the Agent

Safe non-secret inputs:

- Docker host or Synology address and target directory
- `SITE_NAME` and IANA `DISPLAY_TIME_ZONE`
- network profile: `codex-only`, `snmpv3`, or `unifi-api`
- router IPv4 address, SNMPv3 read-only username, and WAN selector
- whether Home Assistant is enabled
- expected Codex machine names and Android device model

Do not put these values in the Agent prompt or chat:

- `agent_push_token`
- SNMPv3 authentication or privacy passwords
- UniFi API key or Home Assistant token
- GitHub credentials, NAS administrator password, or Android signing key

The public GHCR image requires no GitHub credential.

## Copyable Agent prompt

Replace only the non-secret angle-bracket values:

```text
Install or upgrade Ambient Ops from the canonical repository into
<absolute-target-directory> on <Docker-host>. Use SITE_NAME=<site-name>,
DISPLAY_TIME_ZONE=<iana-time-zone>, and AMBIENT_OPS_NETWORK_MODE=<profile>.

Follow docs/installation.md and scripts/opl-fleet-cockpit.sh. Use only the public,
versioned GHCR image. Do not use compose.local-build.yaml, do not build source
on the NAS, do not create a GHCR login or DSM scheduled task, and do not use a
moving image tag.

Never ask me to paste a token or password into chat, never print/read secret
file contents, and never put credentials in .env, Compose, commands, logs, or
the repository. Pause only for me to run the documented interactive
set-secret command. On Windows OPL Fleet Agent v0.2.9+, use the automatic device
pairing page. On macOS OPL Fleet Agent v0.2.11+, use the same automatic pairing
flow. Only headless and legacy bearer agents require the existing token to be
entered locally.

Preserve an existing .env, INSTANCE_ID, secrets directory, and
opl-fleet-cockpit_data volume. Never run docker compose down -v. Before changing a
running installation, record the exact current image, commit, health response,
and rollback command. Keep exactly one LAN discovery owner.

Finish only after: Compose contains no build directive; the pinned public
image is running; /healthz is live for every configured source; each expected
Codex host appears once; mDNS resolves the configured instance; and the Android
kiosk works over Wi-Fi with no adb reverse. A real Docker-host restart is a
separate optional, explicitly authorized operation, not part of this migration.
Report exact commands,
non-secret readbacks, changed files, image/version, and remaining limitations.
```

For a fresh SNMPv3 install, append only non-secret fields:

```text
The router address is <ipv4>, the read-only SNMPv3 username is <username>, and
the verified WAN selector is <ifName-ifAlias-or-index>. I will enter both
passwords through the interactive set-secret commands when asked.
```

## Agent execution contract

### 1. Inspect before writing

The Agent should establish:

- exact repository and default branch
- current `.env`, Compose image, `INSTANCE_ID`, and volume name if upgrading
- whether another Ambient Ops instance is publishing on the LAN
- current `/healthz` and `/api/status` without treating HTTP 200 as source
  readiness
- current APK package, version, and signing-certificate identity before an
  Android update

Secret files may be checked for existence, size, owner, and mode. Their
contents must not be opened, echoed, copied into evidence, or hashed into a
public report.

### 2. Bootstrap only when absent

For a fresh installation:

```bash
git clone https://github.com/gaofeng21cn/opl-fleet-cockpit.git <target>
cd <target>
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh init --profile <codex-only|snmpv3|unifi-api>
```

For an existing installation, `init` must not be run. The Agent edits only
documented non-secret `.env` fields and preserves identity and secret paths.

When a secret is needed, the Agent should ask the user to run one exact command
in the already-open trusted terminal:

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_auth_password
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_priv_password
```

The Agent resumes after the command exits successfully; it does not request the
entered value. On Linux/Synology, it then applies or asks the owner to apply the
documented UID 1000 ownership without weakening file modes.

### 3. Validate before mutation

```bash
./scripts/opl-fleet-cockpit.sh validate
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml -f compose.host-network.yaml config --images
```

The rendered image must be versioned and the merge must not contain `build:`.
The root production file is self-contained for DSM. The rendered service must
use host networking, enable discovery, contain no `ports:` mapping, and contain
no `build:` key. `compose.host-network.yaml` is only a compatibility override
for older CLI commands.

### 4. Start through the repository helper

```bash
./scripts/opl-fleet-cockpit.sh up
./scripts/opl-fleet-cockpit.sh status
```

The Agent may inspect `./scripts/opl-fleet-cockpit.sh logs`. It must diagnose the
first real failure rather than create a scheduled restart workaround. Normal
restart ownership is Docker Compose `restart: unless-stopped`.

### 5. Connect agents and kiosk

Windows OPL Fleet Agent v0.2.9+ and macOS OPL Fleet Agent v0.2.11+ discover Ambient Ops,
open a one-time approval page, and store a per-device private key with Windows
DPAPI or the macOS Keychain. The user compares the six-digit code and approves
the device; no shared token is copied. Only headless and legacy bearer agents
still receive the exact agent token locally. The Agent may configure non-secret
switches and verify machine state, but must not read or relay the token through
chat.

The Android APK comes only from the official release plus sibling checksum.
Before `adb install -r`, compare the installed and candidate signing
certificates. Never uninstall an already production-signed kiosk as a routine
update step. After installation, verify Home activity, Wi-Fi discovery, and an
empty `adb reverse --list`.

### 6. Terminal acceptance

Evidence should include only non-secret facts:

- repository commit and dirty/clean state
- rendered image reference and container image ID/digest
- Compose service state and restart policy
- `/healthz` mode, source statuses, and machine count
- expected machine IDs/names without session contents
- mDNS service identity and resolved LAN endpoint
- Android package/version, certificate digest, Home activity, Wi-Fi state, and
  empty reverse list
- optional restart readback only when a separate owner-authorized reboot exists

Do not call validation, pull, container creation, or HTTP liveness alone a
finished deployment.

## Upgrade and rollback boundary

Before an upgrade, record:

```bash
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml -f compose.host-network.yaml config --images
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh status
```

An upgrade changes only the reviewed deployment commit and
`OPL_FLEET_COCKPIT_IMAGE`; it preserves `.env`, `INSTANCE_ID`, `secrets/`, and the
named volume. If acceptance fails, restore the recorded image and commit and
run `validate` then `up`. Do not rotate tokens, delete state, uninstall the
Android app, or start a second discovery owner as an improvised rollback.

## DSM build-error rule

If DSM reports that it cannot **build** `opl-fleet-cockpit`, the Agent must inspect
the project definition and logs. This production project pulls a public image;
it does not build. The DSM project should contain only `compose.yaml`; remove an
accidentally selected `compose.local-build.yaml` or `build:` entry after
confirming the exact project write set. Do not solve the error with a GHCR token,
DSM scheduled task, or source compilation on the NAS.
