import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { hostname as systemHostname, networkInterfaces as systemNetworkInterfaces } from "node:os";
import { Bonjour } from "bonjour-service";

export const DISCOVERY_SERVICE_TYPE = "ambient-ops";
export const DISCOVERY_PROTOCOL_VERSION = "1";

export async function resolveInstanceId(dataDir, configuredId = "") {
  const explicit = normalizeInstanceId(configuredId);
  if (explicit) return explicit;

  const path = new URL("instance-id", `file://${dataDir.replace(/\/?$/, "/")}`);
  try {
    const persisted = normalizeInstanceId(await readFile(path, "utf8"));
    if (persisted) return persisted;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const generated = `ao-${createHash("sha256")
    .update(randomUUID())
    .digest("hex")
    .slice(0, 16)}`;
  await writeFile(path, `${generated}\n`, { mode: 0o600 });
  return generated;
}

export function createDiscoveryPublisher({
  enabled = true,
  instanceId,
  name,
  host,
  port,
  displayPath = "/display/overview",
  apiPath = "/api/v1/status",
  pairingEnabled = true,
  version = "0.1.5",
  interfaceAddress = "",
  bonjour = null,
}) {
  let service = null;
  let client = bonjour;

  return {
    start() {
      if (!enabled || service) return;
      const discoveryAddress = resolveDiscoveryInterface(interfaceAddress);
      if (!client) {
        // Linux must receive queries sent to the multicast group, not only
        // datagrams addressed to this interface's unicast IP.
        client = new Bonjour(discoveryAddress
          ? { bind: "0.0.0.0", interface: discoveryAddress }
          : {});
      }
      service = client.publish({
        name: String(name || "Ambient Ops").slice(0, 63),
        host: normalizeDiscoveryHost(host),
        type: DISCOVERY_SERVICE_TYPE,
        protocol: "tcp",
        port,
        txt: {
          id: instanceId,
          name: String(name || "Ambient Ops").slice(0, 80),
          path: normalizePath(displayPath, "/display/overview"),
          api: normalizePath(apiPath, "/api/v1/status"),
          protocol: DISCOVERY_PROTOCOL_VERSION,
          pairing: pairingEnabled ? "1" : "0",
          version: String(version).slice(0, 32),
        },
      });
      if (discoveryAddress) {
        restrictDiscoveryRecords(service, discoveryAddress);
      }
    },
    async stop() {
      service?.stop?.();
      service = null;
      if (!client) return;
      await new Promise((resolve) => client.unpublishAll(resolve));
      client.destroy();
      client = null;
    },
  };
}

export function normalizeDiscoveryHost(value, fallback = systemHostname()) {
  const explicitHost = validDiscoveryHost(value);
  const fallbackHost = validDiscoveryHost(fallback);
  const safeHost = explicitHost || fallbackHost || "ambient-ops";
  return safeHost.toLowerCase().endsWith(".local") ? safeHost : `${safeHost}.local`;
}

function validDiscoveryHost(value) {
  const candidate = String(value || "").trim().replace(/\.+$/, "");
  const labels = candidate.split(".");
  return labels.every(
    (label) => label.length > 0
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  ) ? candidate : "";
}

export function normalizeInstanceId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized) ? normalized : "";
}

export function resolveDiscoveryInterface(value = "", interfaces = systemNetworkInterfaces()) {
  const configured = String(value || "").trim();
  if (configured) {
    const addresses = Object.values(interfaces).flatMap((entries) => entries || []);
    return addresses.some((entry) =>
      entry.address === configured
      && !entry.internal
      && (entry.family === "IPv4" || entry.family === 4))
      ? configured
      : "";
  }

  return Object.entries(interfaces)
    .filter(([name]) => !isVirtualInterface(name))
    .flatMap(([, entries]) => entries || [])
    .find((entry) =>
      !entry.internal
      && (entry.family === "IPv4" || entry.family === 4)
      && !entry.address.startsWith("169.254."))
    ?.address || "";
}

export function restrictDiscoveryRecords(service, address) {
  if (!service || typeof service.records !== "function" || !address) return service;
  const records = service.records.bind(service);
  service.records = () => records().filter((record) =>
    record.type !== "A" && record.type !== "AAAA" || record.data === address);
  return service;
}

function normalizePath(value, fallback) {
  const path = String(value || fallback).trim();
  return path.startsWith("/") ? path.slice(0, 160) : fallback;
}

function isVirtualInterface(name) {
  return /^(?:br-|docker|veth|virbr|tailscale|tun|tap)/i.test(name);
}
