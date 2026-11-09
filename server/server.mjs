import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { StatusStore } from "./store.mjs";
import {
  bindPairedIdentity,
  buildDashboard,
  normalizeSnapshot,
  reconcilePairedMachineIdentities,
} from "./status-model.mjs";
import { pollUnifi } from "./unifi.mjs";
import { createUnifiSnmpPoller } from "./unifi-snmp.mjs";
import { updateDemo } from "./demo.mjs";
import { HomeAssistantBridge } from "./home-assistant.mjs";
import { renderPrometheus } from "./prometheus.mjs";
import { createDiscoveryPublisher, resolveInstanceId } from "./discovery.mjs";
import {
  authorizedBearer,
  missingPetAssets,
  PetAssetStore,
  petAssetUrl,
  readPetAssetBody,
  validatePetUpload,
} from "./pet-assets.mjs";
import { DevicePairingStore } from "./pairing.mjs";
import {
  KIOSK_UPDATE_PATH,
  KioskReleaseStore,
} from "./kiosk-release.mjs";
import { sendBody } from "./http-response.mjs";
import {
  readUiRevision,
  UI_REVISION_PATH,
} from "./ui-revision.mjs";
import {
  buildPublicStatus,
  buildStatusSummary,
  PUBLIC_STATUS_PATH,
} from "./public-status.mjs";
import packageMetadata from "../package.json" with { type: "json" };

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const config = {
  port: numberEnv("PORT", 8787),
  dataDir: process.env.DATA_DIR || join(root, "data"),
  demo: booleanEnv("DEMO_MODE", !process.env.UNIFI_API_KEY && !process.env.UNIFI_SNMP_HOST),
  siteName: String(process.env.SITE_NAME || "Ambient Ops").slice(0, 80),
  displayTimeZone: String(process.env.DISPLAY_TIME_ZONE || "Asia/Shanghai").slice(0, 80),
  discoveryEnabled: booleanEnv("DISCOVERY_ENABLED", true),
  instanceId: process.env.INSTANCE_ID || "",
  pushToken: secretEnv("AGENT_PUSH_TOKEN", "AGENT_PUSH_TOKEN_KEYCHAIN_SERVICE"),
  pairingEnabled: booleanEnv("DEVICE_PAIRING_ENABLED", true),
  unifiBaseUrl: process.env.UNIFI_BASE_URL || "",
  unifiSite: process.env.UNIFI_SITE || "default",
  unifiApiKey: secretEnv("UNIFI_API_KEY"),
  allowSelfSigned: booleanEnv("UNIFI_ALLOW_SELF_SIGNED", false),
  unifiCaFile: process.env.UNIFI_CA_FILE || "",
  unifiPollMs: numberEnv("UNIFI_POLL_MS", 250),
  unifiRateWindowMs: numberEnv("UNIFI_RATE_WINDOW_MS", 2000),
  snmpHost: process.env.UNIFI_SNMP_HOST || "",
  snmpPort: numberEnv("UNIFI_SNMP_PORT", 161),
  snmpUser: process.env.UNIFI_SNMP_USER || "",
  snmpAuthPassword: secretEnv("UNIFI_SNMP_AUTH_PASSWORD", "UNIFI_SNMP_PASSWORD_KEYCHAIN_SERVICE"),
  snmpPrivPassword: secretEnv("UNIFI_SNMP_PRIV_PASSWORD", "UNIFI_SNMP_PASSWORD_KEYCHAIN_SERVICE"),
  snmpAuthProtocol: process.env.UNIFI_SNMP_AUTH_PROTOCOL || "sha",
  snmpPrivProtocol: process.env.UNIFI_SNMP_PRIV_PROTOCOL || "aes",
  snmpInterfaces: listEnv("UNIFI_SNMP_INTERFACES"),
  snmpClientInterfaces: listEnv("UNIFI_SNMP_CLIENT_INTERFACES"),
  snmpTimeoutMs: numberEnv("UNIFI_SNMP_TIMEOUT_MS", 3000),
  networkLatencyHost: process.env.NETWORK_LATENCY_HOST || "",
  networkLatencyPort: numberEnv("NETWORK_LATENCY_PORT", 443),
  networkLatencyTimeoutMs: numberEnv("NETWORK_LATENCY_TIMEOUT_MS", 1500),
  networkAuxiliaryPollMs: numberEnv("NETWORK_AUXILIARY_POLL_MS", 5000),
  liveAfterSeconds: numberEnv("LIVE_AFTER_SECONDS", 30),
  staleAfterSeconds: numberEnv("STALE_AFTER_SECONDS", 300),
  haEnabled: booleanEnv("HA_ENABLED", false),
  haBaseUrl: process.env.HA_BASE_URL || "",
  haToken: secretEnv("HA_TOKEN"),
  haEntityPrefix: process.env.HA_ENTITY_PREFIX || "ambient_ops",
  haSyncMs: numberEnv("HA_SYNC_MS", 30_000),
  haTimeoutMs: numberEnv("HA_TIMEOUT_MS", 5000),
  kioskReleaseDir: process.env.KIOSK_RELEASE_DIR || join(root, "kiosk-release"),
};

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const store = new StatusStore(config.dataDir);
await store.load();
const petAssets = new PetAssetStore(config.dataDir);
await petAssets.load();
const pairingStore = new DevicePairingStore(config.dataDir);
await pairingStore.load();
await reconcilePersistedPairedMachineIdentities();
const kioskReleases = new KioskReleaseStore(config.kioskReleaseDir);
await kioskReleases.load();
const uiRevision = await readUiRevision(dist);
await pruneStaleMachines();
const instanceId = await resolveInstanceId(config.dataDir, config.instanceId);
if (config.demo) updateDemo(store);
const unifiCa = config.unifiCaFile ? await readFile(config.unifiCaFile) : undefined;
const snmpEnabled = Boolean(
  config.snmpHost
  && config.snmpUser
  && config.snmpAuthPassword
  && config.snmpInterfaces.length
);
const pollUnifiSnmp = snmpEnabled ? createUnifiSnmpPoller({
  host: config.snmpHost,
  port: config.snmpPort,
  user: config.snmpUser,
  authPassword: config.snmpAuthPassword,
  privPassword: config.snmpPrivPassword,
  authProtocol: config.snmpAuthProtocol,
  privProtocol: config.snmpPrivProtocol,
  interfaces: config.snmpInterfaces,
  clientInterfaces: config.snmpClientInterfaces,
  timeoutMs: config.snmpTimeoutMs,
  pollMs: config.unifiPollMs,
  rateWindowMs: config.unifiRateWindowMs,
  latencyHost: config.networkLatencyHost,
  latencyPort: config.networkLatencyPort,
  latencyTimeoutMs: config.networkLatencyTimeoutMs,
  auxiliaryPollMs: config.networkAuxiliaryPollMs,
}) : null;
const haBridge = new HomeAssistantBridge({
  enabled: config.haEnabled,
  baseUrl: config.haBaseUrl,
  token: config.haToken,
  entityPrefix: config.haEntityPrefix,
  timeoutMs: config.haTimeoutMs,
});

function dashboard() {
  return {
    site: { name: config.siteName, timeZone: config.displayTimeZone },
    ...buildDashboard({
      machines: store.machines,
      machineHistory: store.machineHistory,
      machineNetworkHistory: store.machineNetworkHistory,
      fleetHistory: store.fleetHistory,
      network: store.network,
      history: store.networkHistory,
      demo: config.demo,
    }, {
      ...config,
      petAssetUrl: (pet) => petAssetUrl(pet, petAssets),
    }),
  };
}

let polling = false;
async function updateSources() {
  if (config.demo) {
    updateDemo(store);
    return;
  }
  if ((!pollUnifiSnmp && !config.unifiApiKey) || polling) return;
  polling = true;
  try {
    const network = pollUnifiSnmp
      ? await pollUnifiSnmp()
      : await pollUnifi({
        baseUrl: config.unifiBaseUrl,
        site: config.unifiSite,
        apiKey: config.unifiApiKey,
        allowSelfSigned: config.allowSelfSigned,
        ca: unifiCa,
      });
    await store.setNetwork(network);
  } catch (error) {
    await store.setNetwork({
      ...store.network,
      status: store.network.updatedAt ? "stale" : "error",
      source: pollUnifiSnmp ? "unifi-snmp-v3" : "unifi",
      error: error.message,
    }, { recordHistory: false });
  } finally {
    polling = false;
  }
}
const sourceIntervalMs = pollUnifiSnmp
  ? Math.max(200, config.unifiPollMs)
  : Math.max(1000, config.unifiPollMs);
const sourceTimer = setInterval(updateSources, sourceIntervalMs);
sourceTimer.unref();
updateSources();

const machinePruneTimer = setInterval(pruneStaleMachines, Math.min(30_000, config.staleAfterSeconds * 1000));
machinePruneTimer.unref();

const fleetHistoryTimer = setInterval(scheduleFleetHistorySample, 10_000);
fleetHistoryTimer.unref();
scheduleFleetHistorySample();

async function syncHomeAssistant() {
  await haBridge.sync(dashboard());
}
const haTimer = setInterval(syncHomeAssistant, Math.max(5000, config.haSyncMs));
haTimer.unref();
syncHomeAssistant();

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      const current = dashboard();
      return await json(response, 200, {
        ok: true,
        mode: config.demo ? "demo" : "live",
        status: current.overallStatus,
        network: current.network.status,
        codex: current.codex.status,
        machines: current.codex.machineCount,
        devicePairing: config.pairingEnabled,
        pairedDevices: pairingStore.pairedDeviceCount,
        homeAssistant: haBridge.health(),
        uiRevision,
        kioskUpdate: kioskReleases.manifest
          ? {
              versionCode: kioskReleases.manifest.versionCode,
              versionName: kioskReleases.manifest.versionName,
            }
          : null,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      return await json(response, 200, dashboard());
    }
    if (request.method === "GET" && url.pathname === PUBLIC_STATUS_PATH) {
      const status = buildPublicStatus(dashboard(), {
        instanceId,
        serverVersion: packageMetadata.version,
      });
      return await json(response, 200, url.searchParams.get("view") === "summary"
        ? buildStatusSummary(status)
        : status);
    }
    if (["GET", "HEAD"].includes(request.method) && url.pathname === UI_REVISION_PATH) {
      const body = Buffer.from(JSON.stringify({ revision: uiRevision }));
      return await sendBody(response, 200, body, {
        headers: responseHeaders("application/json; charset=utf-8"),
        headOnly: request.method === "HEAD",
      });
    }
    if (request.method === "GET" && url.pathname === "/metrics") {
      return await text(
        response,
        200,
        renderPrometheus(dashboard()),
        "text/plain; version=0.0.4; charset=utf-8",
      );
    }
    if (["GET", "HEAD"].includes(request.method) && url.pathname === KIOSK_UPDATE_PATH) {
      if (!kioskReleases.manifest) {
        return await json(response, 404, { error: "Kiosk update is not available" });
      }
      const body = Buffer.from(JSON.stringify(kioskReleases.manifest));
      return await sendBody(response, 200, body, {
        headers: responseHeaders("application/json; charset=utf-8"),
        headOnly: request.method === "HEAD",
      });
    }
    if (["GET", "HEAD"].includes(request.method) && kioskReleases.matchesArtifact(url.pathname)) {
      const body = await kioskReleases.readArtifact();
      return await sendBody(response, 200, body, {
        headers: {
          "content-type": "application/vnd.android.package-archive",
          "cache-control": "public, max-age=31536000, immutable",
          etag: `"${kioskReleases.manifest.sha256}"`,
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-frame-options": "SAMEORIGIN",
        },
        headOnly: request.method === "HEAD",
      });
    }
    if (config.pairingEnabled && request.method === "POST" && url.pathname === "/api/v1/pairings") {
      const body = await readJson(request, 16 * 1024);
      const paired = await pairingStore.request(body, {
        preauthorized: authorizedBearer(request.headers.authorization, config.pushToken),
      });
      return await json(response, 202, paired);
    }
    const pairingMatch = config.pairingEnabled
      && url.pathname.match(/^\/api\/v1\/pairings\/([a-zA-Z0-9_-]{32,80})$/);
    if (pairingMatch && request.method === "GET") {
      const pairing = pairingStore.get(pairingMatch[1]);
      return pairing
        ? await json(response, 200, pairing)
        : await json(response, 404, { error: "Pairing request not found or expired" });
    }
    if (pairingMatch && request.method === "POST") {
      if (!sameOriginApproval(request)) {
        return await json(response, 403, { error: "Pairing approval must come from this Ambient Ops page" });
      }
      const body = await readJson(request, 4 * 1024);
      if (!["approve", "reject"].includes(body.action)) {
        return await json(response, 400, { error: "Pairing action must be approve or reject" });
      }
      const pairing = body.action === "reject"
        ? pairingStore.reject(pairingMatch[1])
        : await pairingStore.approve(pairingMatch[1], body.verificationCode);
      return pairing
        ? await json(response, 200, pairing)
        : await json(response, 404, { error: "Pairing request not found or expired" });
    }
    const petReadMatch = ["GET", "HEAD"].includes(request.method)
      && url.pathname.match(/^\/api\/v1\/pets\/([a-f0-9]{64})\.webp$/);
    if (petReadMatch) {
      const hash = petReadMatch[1];
      const body = await petAssets.read(hash);
      const headers = {
        "content-type": "image/webp",
        "content-length": body.length,
        "cache-control": "public, max-age=31536000, immutable",
        etag: `"${hash}"`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "SAMEORIGIN",
      };
      if (request.headers["if-none-match"] === headers.etag) {
        response.writeHead(304, headers);
        return response.end();
      }
      return await sendBody(response, 200, body, {
        headers,
        headOnly: request.method === "HEAD",
      });
    }
    const pushMatch = request.method === "POST" && url.pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9._-]{1,80})\/snapshot$/);
    if (pushMatch) {
      const body = await readJsonBody(request, 64 * 1024);
      if (!authorizedAgentRequest(request, pushMatch[1], url.pathname, body.raw)) {
        return await json(response, 401, { error: "Unauthorized" });
      }
      let snapshot;
      try {
        snapshot = bindPairedIdentity(
          normalizeSnapshot(pushMatch[1], body.value),
          pairingStore.pairedIdentity(pushMatch[1]),
        );
      } catch (error) {
        if (error instanceof TypeError) throw httpError(400, error.message);
        throw error;
      }
      await store.setMachine(snapshot);
      return await json(response, 202, {
        accepted: true,
        machineId: snapshot.machineId,
        generatedAt: snapshot.generatedAt,
        missingPetAssets: missingPetAssets(snapshot, petAssets),
      });
    }
    const petUploadMatch = request.method === "PUT"
      && url.pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9._-]{1,80})\/pets\/([a-f0-9]{64})$/);
    if (petUploadMatch) {
      const [machineId, hash] = petUploadMatch.slice(1);
      const body = await readPetAssetBody(request);
      if (!authorizedAgentRequest(request, machineId, url.pathname, body)) {
        return await json(response, 401, { error: "Unauthorized" });
      }
      validatePetUpload({
        machine: store.machines.get(machineId),
        machineId,
        hash,
        contentType: request.headers["content-type"],
        contentEncoding: request.headers["content-encoding"],
      });
      const stored = await petAssets.put(hash, body, {
        spriteVersionNumber: store.machines.get(machineId).pet.spriteVersionNumber,
      });
      const location = `/api/v1/pets/${hash}.webp`;
      if (!stored.created) {
        response.writeHead(204, { ...responseHeaders("image/webp"), location, etag: `"${hash}"` });
        return response.end();
      }
      return await json(response, 201, {
        stored: true,
        assetHash: hash,
        assetUrl: location,
      }, { location, etag: `"${hash}"` });
    }
    if (url.pathname.startsWith("/api/")) return await json(response, 404, { error: "Not found" });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return await json(response, 405, { error: "Method not allowed" });
    }
    return await serveApp(url.pathname, response, request.method === "HEAD");
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error);
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    try {
      await json(response, statusCode, {
        error: statusCode >= 500 ? "Internal server error" : error.message,
      });
    } catch (writeError) {
      console.error(writeError);
      response.destroy(writeError);
    }
  }
});

const discovery = createDiscoveryPublisher({
  enabled: config.discoveryEnabled,
  instanceId,
  name: config.siteName,
  host: process.env.DISCOVERY_HOST || "",
  port: config.port,
  pairingEnabled: config.pairingEnabled,
  version: packageMetadata.version,
});
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Ambient Ops listening on http://0.0.0.0:${config.port}`);
  console.log(`Mode: ${config.demo ? "demo" : "live"}`);
  discovery.start();
  if (config.discoveryEnabled) {
    console.log(`Discovery: ${instanceId}._ambient-ops._tcp.local`);
  }
});

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  clearInterval(sourceTimer);
  clearInterval(machinePruneTimer);
  clearInterval(fleetHistoryTimer);
  clearInterval(haTimer);
  server.close();
  try {
    await Promise.all([store.flush(), pairingStore.flush(), discovery.stop()]);
  } finally {
    process.exit(0);
  }
}

async function recordFleetHistory() {
  const current = dashboard();
  await store.recordFleetHistory({
    at: current.generatedAt,
    tps: current.fleet.oneMinuteTps,
  });
}

function scheduleFleetHistorySample() {
  recordFleetHistory().catch((error) => {
    console.error("Failed to record fleet history", error);
  });
}

async function pruneStaleMachines() {
  const cutoff = new Date(Date.now() - config.staleAfterSeconds * 1000);
  const removed = await store.pruneMachines(cutoff);
  if (removed.length) console.log(`Retired inactive machines: ${removed.join(", ")}`);
}

async function reconcilePersistedPairedMachineIdentities() {
  const changed = reconcilePairedMachineIdentities(
    store.machines,
    (machineId) => pairingStore.pairedIdentity(machineId),
  );
  if (changed) await store.persist();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

async function readJson(request, limit) {
  return (await readJsonBody(request, limit)).value;
}

async function readJsonBody(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw httpError(413, "Payload too large");
    chunks.push(bytes);
  }
  const raw = Buffer.concat(chunks);
  let parsed;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw httpError(400, "Invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw httpError(400, "JSON body must be an object");
  return { raw, value: parsed };
}

async function serveApp(pathname, response, headOnly) {
  const requested = pathname === "/" || pathname.startsWith("/display/") ? "index.html" : pathname.slice(1);
  const relative = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  let path = join(dist, relative);
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    path = join(dist, "index.html");
  }
  const body = await readFile(path);
  return sendBody(response, 200, body, {
    headers: {
      "content-type": contentTypes.get(extname(path)) || "application/octet-stream",
      "cache-control": extname(path) === ".html" ? "no-store" : "public, max-age=31536000, immutable",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
    },
    headOnly,
  });
}

function json(response, statusCode, payload, extraHeaders = {}) {
  return sendBody(response, statusCode, JSON.stringify(payload), {
    headers: { ...responseHeaders("application/json; charset=utf-8"), ...extraHeaders },
  });
}

function text(response, statusCode, body, contentType) {
  return sendBody(response, statusCode, body, {
    headers: responseHeaders(contentType),
  });
}

function responseHeaders(contentType) {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
  };
}

function sameOriginApproval(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  const fetchSite = request.headers["sec-fetch-site"];
  if (!origin || !host || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function authorizedAgentRequest(request, machineId, pathname, body) {
  if (authorizedBearer(request.headers.authorization, config.pushToken)) {
    return true;
  }
  return config.pairingEnabled && pairingStore.authorizeRequest({
    machineId,
    method: request.method,
    pathname,
    body,
    authorization: request.headers.authorization || "",
    timestamp: request.headers["x-ambient-timestamp"],
    nonce: request.headers["x-ambient-nonce"],
    signature: request.headers["x-ambient-signature"],
  });
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanEnv(name, fallback) {
  const value = process.env[name];
  return value == null ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function listEnv(name) {
  return String(process.env[name] || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function secretEnv(name, keychainServiceName) {
  const value = process.env[name];
  if (value) return value;
  const secretFile = process.env[`${name}_FILE`];
  if (secretFile) {
    try {
      return readFileSync(secretFile, "utf8").trim();
    } catch {
      return "";
    }
  }
  const service = process.env[keychainServiceName];
  if (!service || process.platform !== "darwin") return "";
  const account = process.env.KEYCHAIN_ACCOUNT || process.env.USER;
  if (!account) return "";
  try {
    return execFileSync("/usr/bin/security", [
      "find-generic-password", "-a", account, "-s", service, "-w",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
