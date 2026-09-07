# Agent Installation Boundaries

[简体中文](agent-installation.zh-CN.md) | **English**

This page adds delegation rules to the [installation guide](installation.md),
which owns commands and acceptance. Do not copy another installation procedure
into prompts or task notes.

## Task input

Provide the target host and directory, site name, time zone, network profile,
expected machines and displays, and whether the task is a new install, upgrade,
host move or device update. Router addresses, read-only usernames and selectors
are non-secret. Continue within authorization already given.

Credentials never belong in chat. Inspect secret-file existence, owner and mode
without reading or publishing contents or hashes. A user enters missing secrets
through the installation guide's interactive `set-secret` command in a trusted
terminal. Existing protected credentials stay in place. Public release downloads
do not require creating GitHub credentials.

## Before applying

Read the instance identity, effective image, deployment commit and actual
`/data` volume. Preserve `.env`, `secrets/`, `INSTANCE_ID`, device approvals
and pet assets. Record the rollback image and command. Changing the writer host
follows [host migration](host-migration.md).

Use the canonical helper and versioned release. Production Compose renders one
`gateway` service with host networking, discovery enabled, no `ports:` and no
`build:`. DSM uses `compose.yaml`; source builds belong on a development host.
Diagnose build errors using [Synology deployment](deployment-synology.md).

Device approval requires the user to compare the six-digit code. Android updates
follow the [kiosk guide](../android-kiosk/README.md), verify checksum and signing
identity, and preserve app data. Host reboot and destructive storage operations
require authorization for those actions.

## Completion evidence

Report the effective image/digest, source commit, container state and restart
policy, source-specific health, expected unique machines, and resolved mDNS
instance. For an in-scope kiosk, include package/version, Home activity and Wi-Fi
operation without a reverse tunnel. Distinguish process liveness from source
readiness; do not claim reboot recovery unless a reboot occurred.

Validation, pull, container creation and HTTP 200 each prove their own step.
On failure use the recorded rollback and preserve identity, data and credentials;
do not add another writer or a scheduled restart to conceal failure.
