# OPL Fleet Cockpit Security and Privacy

OPL Fleet Cockpit · Ambient Ops is designed for a trusted LAN. Its compatibility
container acts as OPL Fleet Telemetry Gateway: it collects operational aggregates,
not conversation content, and separates collector credentials from display clients.

## Trust boundary

- OPL Fleet Agent reads local Codex token records on each host and sends only the
  allowlisted aggregate snapshot documented in
  [`agent-push-api.md`](agent-push-api.md).
- The server reads UniFi through SNMPv3 `authPriv` or an optional read-only
  Network API key.
- The HTC kiosk and browsers receive normalized status only. They contain no
  agent token, SNMP credential, UniFi key, or Home Assistant token.
- Home Assistant is an optional downstream write target, never an authority for
  collection or display.

The Cockpit and Gateway are telemetry surfaces only. They do not own Fleet
registry, policy, admission, leases, work dispatch, or execution control. An
`oplFleet` envelope with `authority=node_agent` describes the sending node; it
does not promote the Agent or Gateway into OPL Fleet Controller. Unknown fields
in this versioned envelope are rejected before persistence.

The display, status, and one-time device approval pages intentionally have no
browser login. Bind them only to the trusted LAN or a private VPN. Approve a
device only when its six-digit code matches OPL Fleet Agent. Add an authenticated TLS
reverse proxy before exposing them outside that boundary.

## Secret handling

The production Compose service reads ignored files mounted read-only at
`/run/secrets`:

```text
agent_push_token
unifi_snmp_auth_password
unifi_snmp_priv_password
unifi_api_key
ha_token
```

Only the first three are required for the preferred live configuration. The
last two are optional fallbacks/integrations. Protect the local `secrets`
directory with owner-only permissions and never commit `.env`, secret files,
certificates, logs, screenshots, or data exports.

On native Linux/Synology the image runs as UID/GID 1000. The bind-mounted
`secrets` directory and files should therefore be owned by 1000 with modes 700
and 600 respectively. Docker Desktop may translate ownership. Do not make
secret files world-readable to work around a host/container UID mismatch.

The macOS runtime stores credentials in Keychain and puts only Keychain service
names in its LaunchAgent plist. Do not replace this with raw plist environment
values.

OPL Fleet Agent `v0.2.11+` on macOS and `v0.2.9+` on Windows generate a P-256 device
key locally. The Mac stores its private key in the login Keychain; Windows
stores the private PKCS#8 bytes only as current-user DPAPI ciphertext. Ambient
Ops stores the corresponding public key in `/data/device-pairings.json`; that
file contains no bearer token or device private key.

## Agent authentication

Headless and legacy agents for one installation share a long random bearer
token. Preserve it during a host migration, or rotate it deliberately and
update every bearer agent. Current macOS and Windows desktop apps use an
individually approved public key and signed, timestamped, nonce-protected
snapshots and pet uploads instead.
An authentication mismatch returns HTTP 401 and eventually makes that machine
stale; it must not be worked around by disabling authentication.

Pairing and agent requests use plain HTTP on the current trusted LAN. Signatures
protect integrity and device identity but do not encrypt metadata or payloads.
Use an HTTPS reverse proxy or private VPN if traffic crosses an untrusted
network.

## Persistent data

`/data/state.json` contains:

- normalized machine names, platform, rates, counts, and pet state
- last UniFi rates and selected interface metadata
- short network history

It does not contain prompts, responses, file contents, session identifiers, or
repository paths. The optional generated `instance-id` file is a public,
non-secret discovery identity.

## Single-instance rule

Exactly one canonical OPL Fleet Telemetry Gateway should publish the compatibility
`_ambient-ops._tcp.local` and accept agent snapshots for a site. Parallel Mac
and NAS owners can split clients, duplicate machine state, and make rollback
ambiguous. Stage candidates with discovery disabled, stop the old owner before
starting the new LAN owner, and reverse that order during rollback.
