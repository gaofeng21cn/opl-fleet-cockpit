# SNMPv3 Router and UniFi Setup

OPL Fleet Cockpit prefers SNMPv3 because it exposes standard 64-bit interface
counters without requiring a controller API credential. The collector was
first implemented for UniFi, so its environment variables retain the
`UNIFI_SNMP_*` prefix and the API reports `source=unifi-snmp-v3`. The polling
contract itself is standard IF-MIB and can work with another router only after
the compatibility checks below pass.

## Exact compatibility contract

The current collector requires all of the following:

| Requirement | Current behavior |
| --- | --- |
| Protocol | SNMPv3 USM only |
| Security level | `authPriv` only |
| Transport | IPv4/UDP; port is configurable, default 161 |
| Authentication/privacy | Protocol names accepted by the bundled `net-snmp` library; the qualified/default pair is SHA + AES |
| MIB subtree | IF-MIB `ifXTable`, `1.3.6.1.2.1.31.1.1` |
| Queried columns | `ifName(1)`, `ifHCInOctets(6)`, `ifHCOutOctets(10)`, `ifHighSpeed(15)`, `ifAlias(18)`; name and both Counter64 columns are functionally required |
| Selector | Exact case-insensitive match on interface index, `ifName`, or `ifAlias` |
| Counter semantics | Monotonic Counter64 values that include the real WAN traffic |

Two optional capabilities are independent from the WAN counter contract:

- Client count reads IPv4 IP-MIB `ipNetToMediaTable`,
  `1.3.6.1.2.1.4.22`, only on exact configured LAN interfaces. It counts
  unique dynamic physical addresses and is an active-neighbor estimate.
- Latency opens a TCP connection to an exact configured host and port. It does
  not use SNMP, ICMP, elevated capabilities, or a router API.

The collector does not currently support:

- SNMP v1/v2c
- SNMPv3 `noAuthNoPriv` or `authNoPriv`
- IPv6-only SNMP agents
- 32-bit `ifInOctets`/`ifOutOctets` as a fallback
- vendor-specific traffic OIDs
- OpenWrt `ubus`, nftables counters, or controller-specific APIs
- reconstructing traffic omitted by hardware/software flow offload

An SNMPv3-capable router is therefore not automatically compatible. Its
IF-MIB Counter64 values must be qualified against known traffic.

## 1. Provision a read-only SNMPv3 user

Use a dedicated user with `authPriv` and a read-only view containing at least:

```text
1.3.6.1.2.1.31.1.1
```

If client counting is enabled, the same read-only view must also include:

```text
1.3.6.1.2.1.4.22
```

Record these private values outside Git:

- security name/username
- authentication protocol and password
- privacy protocol and password
- IPv4 address and UDP port

Keep UDP/161 reachable only from the Ambient Ops host or trusted monitoring
network. Do not reuse an administrator login or place passwords in `.env`.

For UniFi, enable SNMPv3 in the Network/Control Plane settings and use the
existing dedicated read-only credentials. A UniFi Network API key is not
needed for this path.

## 2. Discover and qualify interfaces

Install Net-SNMP client utilities on a trusted admin machine. The following
commands show the exact OIDs. Replace placeholders in a private shell or a
mode-0600 Net-SNMP configuration; putting real passphrases into recorded shell
history is unsafe.

```bash
snmpwalk -v3 -l authPriv \
  -u '<snmp-user>' -a SHA -A '<auth-passphrase>' \
  -x AES -X '<priv-passphrase>' \
  '<router-ipv4>' 1.3.6.1.2.1.31.1.1.1.1

snmpwalk -v3 -l authPriv \
  -u '<snmp-user>' -a SHA -A '<auth-passphrase>' \
  -x AES -X '<priv-passphrase>' \
  '<router-ipv4>' 1.3.6.1.2.1.31.1.1.1.18
```

The first walk returns `ifName`; the second returns `ifAlias`. Identify the
actual Internet-facing interface, then read its counters twice around a known
download/upload:

```bash
snmpget -v3 -l authPriv \
  -u '<snmp-user>' -a SHA -A '<auth-passphrase>' \
  -x AES -X '<priv-passphrase>' \
  '<router-ipv4>' \
  1.3.6.1.2.1.31.1.1.1.6.<if-index> \
  1.3.6.1.2.1.31.1.1.1.10.<if-index>
```

Success requires both values to be typed as `Counter64`, to increase
monotonically, and to approximately reflect the known transfer:

- WAN `ifHCInOctets` is treated as download.
- WAN `ifHCOutOctets` is treated as upload.

On a VLAN, PPPoE, VPN, or hardware-offloaded router, counters may appear at
several layers or at none. Select exactly one layer for one traffic flow. If a
physical interface, VLAN, and PPPoE interface all count the same bytes, adding
all three triples the displayed rate. For true multi-WAN, select each distinct
uplink once; Ambient Ops sums them.

Interface indexes may change after a router upgrade or reboot. Prefer a stable
`ifName` or `ifAlias`, then re-run the walk after a reboot before accepting the
configuration. The application requires exact matches and does not guess.

## 3. Configure the Gateway

Keep non-secret values in `.env`:

```dotenv
DEMO_MODE=false
UNIFI_SNMP_HOST=192.168.1.1
UNIFI_SNMP_PORT=161
UNIFI_SNMP_USER=<snmp-v3-user>
UNIFI_SNMP_AUTH_PROTOCOL=sha
UNIFI_SNMP_PRIV_PROTOCOL=aes
UNIFI_SNMP_INTERFACES=<exact-name-index-or-alias>
UNIFI_SNMP_CLIENT_INTERFACES=<exact-lan-name-index-or-alias>
UNIFI_POLL_MS=250
UNIFI_RATE_WINDOW_MS=2000
UNIFI_SNMP_TIMEOUT_MS=3000
NETWORK_LATENCY_HOST=<tcp-probe-host>
NETWORK_LATENCY_PORT=443
NETWORK_LATENCY_TIMEOUT_MS=1500
NETWORK_AUXILIARY_POLL_MS=5000
```

Both auxiliary metrics are opt-in. Leave `UNIFI_SNMP_CLIENT_INTERFACES` empty
unless the selected router exposes a qualified `ipNetToMediaTable`; leave
`NETWORK_LATENCY_HOST` empty unless a stable TCP target has been chosen.

Store the two passwords in ignored files:

```text
secrets/unifi_snmp_auth_password
secrets/unifi_snmp_priv_password
```

Validate the rendered configuration with `docker compose config` before
starting.

Direct Node deployments may instead set `UNIFI_SNMP_AUTH_PASSWORD` and
`UNIFI_SNMP_PRIV_PASSWORD`. The macOS LaunchAgent uses Keychain service names.
Do not store passwords in tracked environment files, commands, screenshots, or
logs.

## 4. Validate live collection

The collector polls at 250 ms and calculates each displayed value over a
rolling two-second real counter window. This preserves a 4 Hz display cadence
while covering devices whose counters refresh only around once per second.

```bash
curl -fsS http://<ambient-ops-host>:8787/api/status |
  jq -e '.demo == false
    and .network.status == "live"
    and .network.source == "unifi-snmp-v3"
    and (.network.interfaces | length) > 0'
```

Inspect the returned interface names, indexes, and individual rates. Generate
known traffic again and compare the API values with the raw counter delta. A
live status with near-zero values is not sufficient if the router is actively
moving traffic.

If the collector reports no matching WAN interface, repeat the walk and correct
`UNIFI_SNMP_INTERFACES`. If it times out, check IPv4 routing, UDP/161, firewall,
credentials, security protocols, and the SNMP view. A counter reset after a
router/interface restart causes Ambient Ops to discard its baseline and build a
new one.

## OpenWrt example

OpenWrt is a conditional example, not a blanket compatibility promise.
Packages, UCI schema, persistent Net-SNMP paths, driver counters, and offload
behavior vary by OpenWrt release, target, and vendor image.

### Prerequisites

Before configuring Ambient Ops, prove that the specific image has:

1. Enough flash/RAM for a Net-SNMP daemon.
2. A feed package that includes SNMPv3 USM with SHA/AES `authPriv`.
3. IF-MIB `ifXTable` with working Counter64 values for the real WAN path.
4. An IPv4 route from the Ambient Ops host to UDP/161.
5. Counter behavior that still covers traffic when flow offload is enabled.

A common official-feed starting point is:

```sh
opkg update
opkg list | awk '$1 ~ /^snmpd/ { print $1, $2 }'
opkg install snmpd
/usr/sbin/snmpd -v
```

The package name may differ or be absent on a minimal/vendor image. If no
Net-SNMP package with SNMPv3 and IF-MIB Counter64 is available, Ambient Ops
cannot collect this router without a firmware/package change.

### Create the user using that image's supported method

OpenWrt releases differ in how `/etc/config/snmpd`, `/etc/snmp/snmpd.conf`, and
the persistent USM store are generated. Some packages ship
`net-snmp-create-v3-user`; others require the release-specific UCI configuration.
Do not copy a v2c-only `community public` example.

When the helper is present, its normal flow is to stop `snmpd`, create a
read-only SHA/AES user, then restart it. Real passphrases in command arguments
may be visible in shell history and the process list, so use the image's secure
interactive/secret mechanism where available:

```sh
/etc/init.d/snmpd stop
net-snmp-create-v3-user -ro -a SHA -x AES \
  -A '<auth-passphrase>' -X '<priv-passphrase>' ambientops
/etc/init.d/snmpd enable
/etc/init.d/snmpd start
```

If the helper is absent, follow the exact package documentation for that
OpenWrt release; do not invent a persistent USM entry while the daemon is
running. Limit the resulting read view to IF-MIB when the package supports it.

Confirm the listener:

```sh
ss -lunp | grep ':161'
logread -e snmpd
```

If LAN input is restricted, add a firewall rule scoped to the fixed Ambient Ops
host rather than opening SNMP to every zone. This is an example for the common
OpenWrt firewall UCI schema; adjust zone and IP for the installation and avoid
adding a duplicate rule when LAN input already permits it:

```sh
uci add firewall rule
uci set firewall.@rule[-1].name='Allow-SNMPv3-Ambient-Ops'
uci set firewall.@rule[-1].src='lan'
uci set firewall.@rule[-1].src_ip='<ambient-ops-host-ipv4>'
uci set firewall.@rule[-1].proto='udp'
uci set firewall.@rule[-1].dest_port='161'
uci set firewall.@rule[-1].target='ACCEPT'
uci commit firewall
/etc/init.d/firewall restart
```

### Choose the OpenWrt WAN layer

Typical names include `wan`, `eth1`, `eth0.2`, and `pppoe-wan`, but they are
examples only. Map names to indexes with `ifName`, then test Counter64 before
and after a known transfer. OpenWrt flow offloading or a vendor switch/NSS
driver may keep bytes out of the Linux interface counters. Temporarily comparing
offload-on and offload-off results is a diagnostic; do not disable an important
router feature permanently merely to make the dashboard non-zero without
understanding the performance tradeoff.

After a router reboot, re-run the IF-MIB qualification. Only then put the exact
stable selector in `UNIFI_SNMP_INTERFACES`.

## UniFi Network API fallback

This path is optional and UniFi-specific. If SNMPv3 is unavailable but a
dedicated read-only Network integration key is supported, write the key to:

```text
secrets/unifi_api_key
```

Set:

```dotenv
DEMO_MODE=false
UNIFI_BASE_URL=https://gateway.example.lan
UNIFI_SITE=default
```

The implementation requests:

```text
/proxy/network/api/s/default/stat/health
```

It sends the key as `X-API-KEY` and reads WAN `rx_bytes-r` and `tx_bytes-r`.
Do not reuse an owner password or place the key in a URL. If both SNMPv3 and
the API are configured, SNMPv3 wins.

### Self-signed certificate on a trusted LAN

```dotenv
UNIFI_BASE_URL=https://<gateway-address>
UNIFI_ALLOW_SELF_SIGNED=true
UNIFI_CA_FILE=
```

This disables certificate verification only for the UniFi HTTP client. It does
not change Home Assistant or other Node connections. Use it only on a trusted
LAN or private VPN.

### Strict certificate validation

The URL hostname must appear in the certificate Subject Alternative Name.
Export and inspect the public certificate:

```bash
openssl s_client -connect <gateway-address>:443 -servername unifi.local -showcerts \
  </dev/null 2>/dev/null | openssl x509 -outform PEM > unifi-gateway.crt
openssl x509 -in unifi-gateway.crt -noout \
  -subject -issuer -dates -fingerprint -sha256 -ext subjectAltName
```

Keep it in a private NAS folder and mount it read-only:

```yaml
services:
  gateway:
    extra_hosts:
      - "unifi.local:<gateway-address>"
    volumes:
      - ./private/unifi-gateway.crt:/run/secrets/unifi-gateway.crt:ro
```

```dotenv
UNIFI_BASE_URL=https://unifi.local
UNIFI_ALLOW_SELF_SIGNED=false
UNIFI_CA_FILE=/run/secrets/unifi-gateway.crt
```

Re-check the SHA-256 fingerprint and expiry after UniFi upgrades, certificate
regeneration, or gateway replacement.
