# OPL Fleet Agent Push API

`OPL Fleet Agent` pushes aggregate metrics to the API owned by
`OPL Fleet Cockpit Gateway`. The Gateway never
requests local session files and retains only the allowlist below.

## Request

```http
POST /api/v1/agents/{machineId}/snapshot
Authorization: Bearer <AGENT_PUSH_TOKEN>
Content-Type: application/json
```

Current desktop OPL Fleet Agents normally use an approved P-256 device key:

```http
POST /api/v1/agents/{machineId}/snapshot
Authorization: AmbientKey {machineId}
X-Ambient-Timestamp: <unix-seconds>
X-Ambient-Nonce: <random-base64url>
X-Ambient-Signature: <ECDSA-P256-DER-base64>
Content-Type: application/json
```

The signature covers the method, path, timestamp, nonce, and SHA-256 of the
exact JSON bytes. The server rejects stale timestamps and repeated nonces.

```json
{
  "schemaVersion": 3,
  "machineName": "Primary Laptop",
  "platform": "macOS",
  "generatedAt": "2026-07-25T12:00:00.000Z",
  "status": "live",
  "oneMinute": {
    "tps": 124.5,
    "inputTokens": 8100,
    "outputTokens": 1300,
    "cachedInputTokens": 6200,
    "reasoningOutputTokens": 400,
    "requests": 5
  },
  "fiveMinutes": {
    "tps": 98.2,
    "inputTokens": 30200,
    "outputTokens": 4700,
    "cachedInputTokens": 22100,
    "reasoningOutputTokens": 1600,
    "requests": 19
  },
  "activeSessions": 2,
  "oplFleet": {
    "schema": "opl_fleet_agent_telemetry.v1",
    "product": "OPL Fleet Agent",
    "stableNodeID": "primary-laptop",
    "agentVersion": "0.2.27",
    "modes": ["local", "direct", "fleet"],
    "capabilities": [
      "node_local_observation",
      "node_local_doctor",
      "node_local_execution_constraints",
      "sanitized_execution_receipts",
      "local_codex_telemetry",
      "host_dashboard"
    ],
    "authority": "node_agent"
  },
  "pet": {
    "id": "ledger-owl",
    "displayName": "Ledger Owl",
    "spriteVersionNumber": 1,
    "assetHash": "783854af87d6ee8639843ca7812917e062345b0095d43f9be5ea2374a41ada6c",
    "state": "running",
    "stateSince": "2026-07-25T11:59:55.000Z"
  }
}
```

`oplFleet` is optional in `server/status-model.mjs`. When present, the
Gateway requires snapshot `schemaVersion` 3, exact product/schema/authority
values, a `stableNodeID` matching the URL `machineId`, a bounded semantic agent
version, known modes and capabilities, and no unknown envelope or top-level
fields. Snapshots without `oplFleet` discard unknown top-level fields.
There is no time-based migration switch in the normalizer. In both paths,
only the normalized allowlist is persisted or projected.

The envelope is descriptive telemetry, not a control grant. The Agent may
observe and constrain its own node and report sanitized receipts. The Gateway
may receive, aggregate, retain, and project that telemetry. Registry, policy,
admission, lease, and dispatch remain outside both components and belong to OPL
Flow, the private Instance, and `OPL Fleet Controller`.

`machineId` is a stable, non-secret identifier containing only letters,
numbers, dots, underscores, and hyphens. It should not be regenerated on every
start. The route accepts 1 to 80 characters.

The endpoint returns `202 Accepted` after the normalized snapshot has been
persisted. Payloads are limited to 64 KiB. The response contains
`missingPetAssets`, which is either empty or contains the snapshot pet's
content hash:

```json
{
  "accepted": true,
  "machineId": "primary-laptop",
  "generatedAt": "2026-07-25T12:00:00.000Z",
  "missingPetAssets": []
}
```

The bundled pet in the example needs no upload. For an absent custom pet,
`missingPetAssets` contains exactly its declared `assetHash`.

`inputTokens` includes the cached-input subset and `outputTokens` includes the
reasoning-output subset. Therefore:

```text
total TPS = inputTokens / windowSeconds + outputTokens / windowSeconds
```

Do not add `cachedInputTokens` or `reasoningOutputTokens` again. They are
breakdowns, not extra usage.

Agents may also include optional host telemetry for the Fleet Cockpit Load view:

```json
{
  "cpuPercent": 67.4,
  "memoryPercent": 54.1
}
```

Both values are percentages in the inclusive range `0..100`. They are
aggregated only from live machines; when a client does not report them, the
display shows `N/A` rather than treating the host as idle.

Agents may also include current aggregate host network throughput. The values
cover the host, not the Gateway WAN, and contain no interface names, addresses,
or connection identifiers:

```json
{
  "network": {
    "downloadMbps": 123.4,
    "uploadMbps": 12.3,
    "sampledAt": "2026-07-25T12:00:00.000Z"
  }
}
```

The Gateway keeps a bounded per-machine history from these samples. Missing
host network telemetry remains `N/A`; the display never substitutes WAN values
for a host.

`pet` is optional. Accepted states are `idle`, `running`, `waiting`, `review`,
and `failed`. The server retains only the fields shown above, validates the pet
ID and asset hash, and projects a stale/error machine to `waiting`/`failed`
without altering the agent's last stored state.

## Pet Asset Upload

After a snapshot reports a hash in `missingPetAssets`, upload that exact local
spritesheet:

```http
PUT /api/v1/agents/{machineId}/pets/{lowercaseSha256}
Authorization: Bearer <AGENT_PUSH_TOKEN>
Content-Type: image/webp

<raw spritesheet.webp bytes>
```

Paired agents use the same `AmbientKey`, timestamp, nonce, and
signature headers as snapshot requests. The signature covers the `PUT` method,
the full request path, and the SHA-256 of the exact WebP bytes.

The server accepts the upload only when the current normalized snapshot for
`machineId` declares the same hash. It rejects compressed transfer content,
non-WebP media types, malformed RIFF/WebP containers, a mismatched SHA-256,
files larger than 8 MiB, and spritesheets whose dimensions do not match the
manifest version: v1 is 1536 by 1872 pixels and v2 is 1536 by 2288 pixels.

- `201 Created`: new bytes were atomically persisted. The JSON body contains
  `stored`, `assetHash`, and the content-addressed `assetUrl`.
- `204 No Content`: the same content hash is already present. This is the normal
  idempotent retry result.
- `401 Unauthorized`: bearer token or paired-device signature is missing or
  incorrect.
- `409 Conflict`: the machine's current pet manifest does not declare this hash,
  or persisted bytes conflict with their hash.
- `413 Payload Too Large`: declared or streamed content exceeds 8 MiB.
- `415 Unsupported Media Type`: media type or content encoding is unsupported.
- `422 Unprocessable Content`: hash, WebP structure, or dimensions do not match.

Uploaded bytes are stored at `/data/pets/{sha256}.webp` and served publicly at
`GET /api/v1/pets/{sha256}.webp`. The read URL is immutable and carries a
one-year cache policy; a pet update changes the SHA-256 and therefore changes
the URL. Agents should upload a hash only after the server asks for it and
should not resend bytes after `201` or `204`.

The bundled Ledger Owl remains available to old snapshots that omit
`assetHash`, and to snapshots using its original
`783854af87d6ee8639843ca7812917e062345b0095d43f9be5ea2374a41ada6c`
hash. No migration or upload is required for those snapshots.

For Compose, the shared bearer value lives in
`secrets/agent_push_token`. Headless and legacy bearer agents store the same
value in Keychain or their protected credential store. Current macOS and
Windows desktop apps automatically request pairing after mDNS discovery, open
`/pair/{requestId}`, and begin signed pushes after the user confirms the
matching six-digit code. The server persists only the approved public key; the
private key never leaves the device.

## Freshness

- `LIVE`: generated within `LIVE_AFTER_SECONDS`
- `STALE`: older than live but within `STALE_AFTER_SECONDS`
- `ERROR`: older than the stale window, or explicitly reported as an error

Stale machines retain their last values instead of becoming zero. Once a
machine exceeds `STALE_AFTER_SECONDS`, it is retired from the dashboard and
persistent state.

## Privacy Contract

Agents must not send prompts, responses, session identifiers, repository paths,
or other conversation content. The only accepted file content is the validated
pet `spritesheet.webp` whose hash is declared by the pet manifest. The server
stores only its explicit normalized snapshot allowlist and that content-addressed
image. New `oplFleet` snapshots reject unknown top-level or envelope fields;
legacy snapshots continue to discard unknown fields.
