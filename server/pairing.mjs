import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const MACHINE_ID = /^[a-zA-Z0-9._-]{1,80}$/;
const REQUEST_ID = /^[a-zA-Z0-9_-]{32,80}$/;
const NONCE = /^[a-zA-Z0-9_-]{16,128}$/;
const MAX_SIGNED_BODY_BYTES = 8 * 1024 * 1024;

export class DevicePairingStore {
  constructor(dataDir, {
    now = () => new Date(),
    requestTtlMs = 10 * 60 * 1000,
    signatureSkewMs = 5 * 60 * 1000,
  } = {}) {
    this.path = join(dataDir, "device-pairings.json");
    this.now = now;
    this.requestTtlMs = requestTtlMs;
    this.signatureSkewMs = signatureSkewMs;
    this.devices = new Map();
    this.requests = new Map();
    this.nonces = new Map();
    this.persistChain = Promise.resolve();
    this.persistSequence = 0;
  }

  get pairedDeviceCount() {
    return this.devices.size;
  }

  pairedIdentity(machineId) {
    const device = this.devices.get(String(machineId || ""));
    if (!device) return null;
    return {
      machineId: device.machineId,
      machineName: device.machineName,
      platform: device.platform,
    };
  }

  async load() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.path, "utf8"));
      this.devices = new Map(
        (saved.devices || [])
          .filter((device) => MACHINE_ID.test(device.machineId))
          .map((device) => [device.machineId, normalizePersistedDevice(device)])
          .filter(([, device]) => device),
      );
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Unable to load device pairings:", error.message);
    }
  }

  async request(payload, { preauthorized = false } = {}) {
    this.prune();
    const candidate = normalizePairingRequest(payload);
    const existing = this.devices.get(candidate.machineId);
    if (existing?.publicKey === candidate.publicKey) {
      return this.completedRequest(existing);
    }

    const pending = [...this.requests.values()].find(
      (request) => request.status === "pending"
        && request.machineId === candidate.machineId
        && request.publicKey === candidate.publicKey,
    );
    if (pending) return publicRequest(pending);

    const now = this.now();
    const request = {
      requestId: randomBytes(32).toString("base64url"),
      ...candidate,
      verificationCode: verificationCode(candidate.publicKey),
      status: preauthorized ? "approved" : "pending",
      replacement: Boolean(existing),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.valueOf() + this.requestTtlMs).toISOString(),
      approvedAt: preauthorized ? now.toISOString() : null,
    };
    this.requests.set(request.requestId, request);
    if (preauthorized) {
      await this.saveApprovedDevice(request);
    }
    return publicRequest(request);
  }

  get(requestId) {
    this.prune();
    const request = normalizeRequestId(requestId) && this.requests.get(requestId);
    return request ? publicRequest(request) : null;
  }

  async approve(requestId, verificationCodeValue) {
    this.prune();
    const request = normalizeRequestId(requestId) && this.requests.get(requestId);
    if (!request || request.status !== "pending") return null;
    if (request.verificationCode !== String(verificationCodeValue || "")) {
      throw pairingError(409, "Verification code does not match");
    }
    request.status = "approved";
    request.approvedAt = this.now().toISOString();
    await this.saveApprovedDevice(request);
    return publicRequest(request);
  }

  reject(requestId) {
    this.prune();
    const request = normalizeRequestId(requestId) && this.requests.get(requestId);
    if (!request || request.status !== "pending") return null;
    request.status = "rejected";
    return publicRequest(request);
  }

  authorizeRequest({
    machineId,
    method,
    pathname,
    body,
    authorization,
    timestamp,
    nonce,
    signature,
  }) {
    if (!MACHINE_ID.test(machineId) || authorization !== `AmbientKey ${machineId}`) {
      return false;
    }
    if (!Buffer.isBuffer(body) || body.length > MAX_SIGNED_BODY_BYTES || !NONCE.test(nonce || "")) {
      return false;
    }
    const timestampNumber = Number(timestamp);
    if (!Number.isInteger(timestampNumber)) return false;
    const now = this.now().valueOf();
    if (Math.abs(now - timestampNumber * 1000) > this.signatureSkewMs) return false;

    this.pruneNonces(now);
    const replayKey = `${machineId}:${nonce}`;
    if (this.nonces.has(replayKey)) return false;

    const device = this.devices.get(machineId);
    if (!device) return false;
    let signatureBytes;
    try {
      signatureBytes = Buffer.from(signature || "", "base64");
      if (!signatureBytes.length) return false;
    } catch {
      return false;
    }
    const canonical = signingInput({
      method,
      pathname,
      timestamp: String(timestampNumber),
      nonce,
      body,
    });
    let accepted = false;
    try {
      accepted = verify(
        "sha256",
        canonical,
        publicKeyObject(device.publicKey),
        signatureBytes,
      );
    } catch {
      return false;
    }
    if (accepted) {
      this.nonces.set(replayKey, now + this.signatureSkewMs);
    }
    return accepted;
  }

  flush() {
    return this.persistChain;
  }

  completedRequest(device) {
    const now = this.now();
    const request = {
      requestId: randomBytes(32).toString("base64url"),
      ...device,
      verificationCode: verificationCode(device.publicKey),
      status: "approved",
      replacement: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.valueOf() + this.requestTtlMs).toISOString(),
      approvedAt: device.approvedAt,
    };
    this.requests.set(request.requestId, request);
    return publicRequest(request);
  }

  async saveApprovedDevice(request) {
    this.devices.set(request.machineId, {
      machineId: request.machineId,
      machineName: request.machineName,
      platform: request.platform,
      publicKey: request.publicKey,
      approvedAt: request.approvedAt,
    });
    await this.persist();
  }

  persist() {
    const body = JSON.stringify({
      schemaVersion: 1,
      devices: [...this.devices.values()],
    }, null, 2);
    const sequence = ++this.persistSequence;
    this.persistChain = this.persistChain.catch(() => undefined).then(async () => {
      const temporary = `${this.path}.${process.pid}.${sequence}.tmp`;
      try {
        await writeFile(temporary, body, { mode: 0o600 });
        await rename(temporary, this.path);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    return this.persistChain;
  }

  prune() {
    const now = this.now().valueOf();
    for (const [requestId, request] of this.requests) {
      if (new Date(request.expiresAt).valueOf() <= now) {
        this.requests.delete(requestId);
      }
    }
    this.pruneNonces(now);
  }

  pruneNonces(now) {
    for (const [key, expiresAt] of this.nonces) {
      if (expiresAt <= now) this.nonces.delete(key);
    }
  }
}

export function signingInput({ method, pathname, timestamp, nonce, body }) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return Buffer.from(
    `${String(method).toUpperCase()}\n${pathname}\n${timestamp}\n${nonce}\n${bodyHash}`,
    "utf8",
  );
}

export function verificationCode(publicKey) {
  const digest = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function normalizePairingRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw pairingError(400, "Pairing request must be an object");
  }
  const machineId = String(payload.machineId || "").trim();
  if (!MACHINE_ID.test(machineId)) throw pairingError(400, "Invalid machine ID");
  const machineName = String(payload.machineName || machineId).trim().slice(0, 80);
  const platform = String(payload.platform || "unknown").trim().slice(0, 32);
  const publicKey = normalizePublicKey(payload.publicKey);
  return { machineId, machineName, platform, publicKey };
}

function normalizePublicKey(value) {
  const encoded = String(value || "").trim();
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 1024) {
    throw pairingError(400, "Invalid device public key");
  }
  let key;
  let der;
  try {
    der = Buffer.from(encoded, "base64");
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw pairingError(400, "Invalid device public key");
  }
  if (
    key.asymmetricKeyType !== "ec"
    || key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw pairingError(400, "Device public key must use P-256");
  }
  return der.toString("base64");
}

function normalizePersistedDevice(device) {
  try {
    return {
      machineId: device.machineId,
      machineName: String(device.machineName || device.machineId).slice(0, 80),
      platform: String(device.platform || "unknown").slice(0, 32),
      publicKey: normalizePublicKey(device.publicKey),
      approvedAt: String(device.approvedAt || ""),
    };
  } catch {
    return null;
  }
}

function publicKeyObject(publicKey) {
  return createPublicKey({
    key: Buffer.from(publicKey, "base64"),
    format: "der",
    type: "spki",
  });
}

function publicRequest(request) {
  return {
    requestId: request.requestId,
    machineId: request.machineId,
    machineName: request.machineName,
    platform: request.platform,
    verificationCode: request.verificationCode,
    status: request.status,
    replacement: request.replacement,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    approvedAt: request.approvedAt,
    approvalPath: `/pair/${request.requestId}`,
    pollAfterSeconds: 2,
  };
}

function normalizeRequestId(value) {
  return REQUEST_ID.test(String(value || "")) ? value : "";
}

function pairingError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
