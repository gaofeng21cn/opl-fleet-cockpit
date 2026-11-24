import snmp from "net-snmp";
import { measureTcpLatency } from "./latency-probe.mjs";

const IF_X_TABLE = "1.3.6.1.2.1.31.1.1";
const IF_X_ENTRY = "1.3.6.1.2.1.31.1.1.1";
const IF_X_COLUMNS = [1, 6, 10, 15, 18];
const IF_TABLE_ENTRY = "1.3.6.1.2.1.2.2.1";
const IP_NET_TO_MEDIA_TABLE = "1.3.6.1.2.1.4.22";
const IP_NET_TO_MEDIA_COLUMNS = [1, 2, 4];
const IP_ADDRESS_TABLE = "1.3.6.1.2.1.4.20";

export function createUnifiSnmpPoller(config, initialClient) {
  let client = initialClient || new NetSnmpClient(config);
  let samples = [];
  const rateWindowMs = Math.max(1000, config.rateWindowMs || config.pollMs * 8);
  const auxiliaryPollMs = Math.max(1000, config.auxiliaryPollMs || 5000);
  const auxiliary = {
    clients: null,
    latencyMs: null,
    refreshedAt: 0,
    inFlight: null,
  };

  async function readInterfaces() {
    try {
      return await client.readInterfaces();
    } catch (error) {
      samples = [];
      client.close?.();
      if (!initialClient) client = new NetSnmpClient(config);
      throw error;
    }
  }

  async function refreshAuxiliary(interfaceSample, waitForResult = false) {
    const clientSelectors = config.clientInterfaces || [];
    const clientIndexes = selectInterfaces(interfaceSample, clientSelectors)
      .map((entry) => entry.index);
    const hasClientProbe = clientIndexes.length > 0 && typeof client.readClientCount === "function";
    const hasLatencyProbe = Boolean(config.latencyHost);
    if (!hasClientProbe && !hasLatencyProbe) return;

    if (auxiliary.inFlight) {
      if (waitForResult) await auxiliary.inFlight;
      return;
    }
    if (auxiliary.refreshedAt && Date.now() - auxiliary.refreshedAt < auxiliaryPollMs) return;

    const request = Promise.allSettled([
      hasClientProbe ? client.readClientCount(clientIndexes) : Promise.resolve(null),
      hasLatencyProbe
        ? measureTcpLatency({
            host: config.latencyHost,
            port: config.latencyPort,
            timeoutMs: config.latencyTimeoutMs,
          })
        : Promise.resolve(null),
    ]).then(([clients, latency]) => {
      if (clients.status === "fulfilled" && Number.isInteger(clients.value)) {
        auxiliary.clients = clients.value;
      }
      if (latency.status === "fulfilled" && Number.isFinite(latency.value)) {
        auxiliary.latencyMs = latency.value;
      }
      auxiliary.refreshedAt = Date.now();
    }).finally(() => {
      auxiliary.inFlight = null;
    });
    auxiliary.inFlight = request;
    if (waitForResult) await request;
  }

  async function poll() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await readInterfaces();
      const selected = resolveWanInterfaces(current, config.interfaces);
      if (samples.length && interfaceIdentity(resolveWanInterfaces(samples[0], config.interfaces)) !== interfaceIdentity(selected)) samples = [];

      if (!samples.length) {
        samples.push(current);
        await delay(Math.min(config.pollMs, 1000));
      }

      const next = samples.at(-1) === current ? await readInterfaces() : current;
      const nextSelected = resolveWanInterfaces(next, config.interfaces);
      if (interfaceIdentity(selected) !== interfaceIdentity(nextSelected)) {
        samples = [];
        continue;
      }
      samples.push(next);
      trimRateWindow(samples, next.sampledAt.valueOf() - rateWindowMs);
      await refreshAuxiliary(next, auxiliary.refreshedAt === 0);

      try {
        const measurement = calculateThroughput(
          samples[0],
          next,
          selected.map((entry) => entry.index),
        );
        return {
          status: "live",
          source: "unifi-snmp-v3",
          downloadMbps: measurement.downloadMbps,
          uploadMbps: measurement.uploadMbps,
          clients: auxiliary.clients,
          latencyMs: auxiliary.latencyMs,
          interfaces: measurement.interfaces,
          updatedAt: next.sampledAt.toISOString(),
          error: null,
        };
      } catch (error) {
        samples = [];
        if (error.code !== "SNMP_COUNTER_RESET" || attempt > 0) throw error;
      }
    }
    throw new Error("SNMP failed to establish a stable counter baseline");
  }

  poll.close = () => {
    client.close?.();
  };
  return poll;
}

function trimRateWindow(samples, cutoffMs) {
  while (
    samples.length > 2
    && samples[1].sampledAt.valueOf() <= cutoffMs
  ) {
    samples.shift();
  }
}

export function selectInterfaces(sample, selectors) {
  const normalized = selectors.map((selector) => String(selector).trim().toLowerCase()).filter(Boolean);
  return sample.interfaces.filter((entry) => {
    const candidates = [entry.index, entry.name, entry.alias].map((value) => String(value ?? "").toLowerCase());
    return normalized.some((selector) => candidates.includes(selector));
  });
}

function interfaceIdentity(interfaces) {
  return JSON.stringify(interfaces.map(({ index, name, alias, counterBits }) => [index, name, alias, counterBits]));
}

function ipv4Number(value) {
  const parts = String(value).split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    throw new Error(`Invalid IPv4 address: ${value}`);
  }
  return parts.reduce((total, part) => total * 256 + Number(part), 0) >>> 0;
}

function matchesNetwork(address, selector) {
  const match = /^cidr:([^/]+)\/(\d{1,2})$/.exec(selector);
  if (!match || Number(match[2]) > 32) throw new Error(`Invalid WAN network selector: ${selector}`);
  const prefix = Number(match[2]);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(match[1]) & mask);
}

// WAN selection must resolve every configured uplink. Partial matches can silently
// turn a replaced router's unrelated interface into a healthy zero-rate source.
export function resolveWanInterfaces(sample, selectors) {
  if (!selectors?.length) throw new Error("SNMP has no configured WAN interfaces");
  const indexes = new Set();
  for (const raw of selectors) {
    const selector = String(raw).trim().toLowerCase();
    const matches = selector.startsWith("cidr:")
      ? sample.interfaces.filter((entry) => (entry.addresses || []).some((address) => matchesNetwork(address, selector)))
      : selectInterfaces(sample, [selector]);
    if (matches.length !== 1) {
      throw new Error(`SNMP WAN selector ${selector} matched ${matches.length} interfaces; rediscover and confirm WAN selection`);
    }
    indexes.add(matches[0].index);
  }
  return sample.interfaces.filter((entry) => indexes.has(entry.index));
}

export function parseInterfaceTable(table) {
  return Object.entries(table || {}).map(([index, row]) => {
    const inOctets = optionalCounter64(row?.[6]);
    const outOctets = optionalCounter64(row?.[10]);
    const hasCounter64 = inOctets !== null && outOctets !== null;
    return {
      index: Number(index),
      name: text(row?.[1]),
      inOctets: hasCounter64 ? inOctets : null,
      outOctets: hasCounter64 ? outOctets : null,
      counterBits: hasCounter64 ? 64 : null,
      speedMbps: Number(row?.[15] ?? 0),
      alias: text(row?.[18]),
    };
  });
}

export function calculateThroughput(previous, current, indexes) {
  const elapsedSeconds = (current.sampledAt.valueOf() - previous.sampledAt.valueOf()) / 1000;
  if (!(elapsedSeconds > 0)) throw new Error("SNMP samples have no elapsed time");

  let inboundBytes = 0n;
  let outboundBytes = 0n;
  const interfaces = [];
  for (const index of indexes) {
    const before = previous.interfaces.find((entry) => entry.index === index);
    const after = current.interfaces.find((entry) => entry.index === index);
    if (!before || !after) throw new Error(`SNMP interface ${index} disappeared between samples`);

    const inboundDelta = counterDelta(
      before.inOctets,
      after.inOctets,
      before.counterBits || 64,
      after.counterBits || 64,
      Math.max(Number(before.speedMbps) || 0, Number(after.speedMbps) || 0),
      elapsedSeconds,
    );
    const outboundDelta = counterDelta(
      before.outOctets,
      after.outOctets,
      before.counterBits || 64,
      after.counterBits || 64,
      Math.max(Number(before.speedMbps) || 0, Number(after.speedMbps) || 0),
      elapsedSeconds,
    );
    inboundBytes += inboundDelta;
    outboundBytes += outboundDelta;
    interfaces.push({
      index,
      name: after.name,
      alias: after.alias,
      downloadMbps: bitsPerSecond(inboundDelta, elapsedSeconds),
      uploadMbps: bitsPerSecond(outboundDelta, elapsedSeconds),
    });
  }

  return {
    downloadMbps: bitsPerSecond(inboundBytes, elapsedSeconds),
    uploadMbps: bitsPerSecond(outboundBytes, elapsedSeconds),
    interfaces,
  };
}

export function countDynamicClients(table, indexes) {
  const selected = new Set(indexes.map(Number));
  const clients = new Set();
  for (const row of Object.values(table || {})) {
    if (!selected.has(Number(row[1])) || Number(row[4]) !== 3) continue;
    const mac = Buffer.isBuffer(row[2]) ? row[2] : Buffer.from(row[2] || []);
    if (mac.length < 6 || mac.every((byte) => byte === 0) || mac.every((byte) => byte === 0xff)) continue;
    clients.add(mac.toString("hex"));
  }
  return clients.size;
}

export function counter64(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  if (!Buffer.isBuffer(value)) throw new TypeError("SNMP Counter64 must be a buffer or integer");
  let result = 0n;
  for (const byte of value) result = (result << 8n) | BigInt(byte);
  return result;
}

function optionalCounter64(value) {
  try {
    return counter64(value);
  } catch {
    return null;
  }
}

function counterDelta(before, after, beforeBits, afterBits, speedMbps, elapsedSeconds) {
  if (beforeBits !== afterBits) {
    const error = new Error("SNMP counter width changed; rebuilding baseline");
    error.code = "SNMP_COUNTER_RESET";
    throw error;
  }
  const start = counter64(before);
  const end = counter64(after);
  if (end < start) {
    if (afterBits === 32) {
      const wrapped = (1n << 32n) - start + end;
      const maximumBytes = speedMbps > 0
        ? speedMbps * 1_000_000 / 8 * elapsedSeconds * 1.25
        : Infinity;
      if (Number(wrapped) <= maximumBytes) return wrapped;
    }
    const error = new Error(`SNMP Counter${afterBits} decreased; interface likely restarted`);
    error.code = "SNMP_COUNTER_RESET";
    throw error;
  }
  return end - start;
}

function bitsPerSecond(bytes, elapsedSeconds) {
  return Number(bytes) * 8 / elapsedSeconds / 1_000_000;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class NetSnmpClient {
  constructor(config, session) {
    this.interfaceSelectors = config.interfaces || [];
    this.discoverAddresses = config.discoverAddresses || this.interfaceSelectors.some((selector) => String(selector).trim().toLowerCase().startsWith("cidr:"));
    this.topologyRefreshMs = Math.max(1000, Number(config.topologyRefreshMs) || 60_000);
    this.cachedTopology = null;
    this.sessionErrored = false;
    if (session) {
      this.session = session;
    } else {
      const authProtocol = protocol(snmp.AuthProtocols, config.authProtocol, "authentication");
      const privProtocol = protocol(snmp.PrivProtocols, config.privProtocol, "privacy");
      this.session = snmp.createV3Session(config.host, {
        name: config.user,
        level: snmp.SecurityLevel.authPriv,
        authProtocol,
        authKey: config.authPassword,
        privProtocol,
        privKey: config.privPassword || config.authPassword,
      }, {
        port: config.port,
        retries: 1,
        timeout: config.timeoutMs,
        transport: "udp4",
      });
    }
    if (typeof this.session?.on === "function") {
      this.session.on("error", (error) => {
        this.sessionErrored = true;
        this.cachedTopology = null;
        console.warn("SNMP session error:", error?.message || error);
      });
    }
  }

  async readInterfaces() {
    if (
      this.interfaceSelectors.length > 0
      && typeof this.session?.get === "function"
      && this.cachedTopology
      && !this.sessionErrored
      && Date.now() - this.cachedTopology.refreshedAt < this.topologyRefreshMs
    ) {
      try {
        return await this.readTargetedInterfaces();
      } catch (error) {
        this.cachedTopology = null;
        if (error?.code !== "SNMP_TOPOLOGY_STALE") throw error;
      }
    }
    return this.readFullInterfaceTable();
  }

  async readFullInterfaceTable() {
    const table = await new Promise((resolve, reject) => {
      this.session.tableColumns(IF_X_TABLE, IF_X_COLUMNS, 20, (error, table) => {
        if (error) return reject(error);
        resolve(table);
      });
    });
    let interfaces = parseInterfaceTable(table);
    if (this.discoverAddresses) {
      const addresses = await new Promise((resolve, reject) => {
        this.session.tableColumns(IP_ADDRESS_TABLE, [1, 2], 20, (error, rows) => error ? reject(error) : resolve(rows));
      });
      interfaces = interfaces.map((entry) => ({
        ...entry,
        addresses: Object.values(addresses || {}).filter((row) => Number(row[2]) === entry.index).map((row) => text(row[1])),
      }));
    }
    const selected = this.interfaceSelectors.length ? resolveWanInterfaces({ interfaces }, this.interfaceSelectors) : [];
    const counter32Fallback = selected.filter((entry) => entry.counterBits === null);
    if (counter32Fallback.length) {
      const counters = await this.readCounter32(counter32Fallback);
      interfaces = interfaces.map((entry) => {
        const fallback = counters.get(entry.index);
        return fallback ? { ...entry, ...fallback } : entry;
      });
    }
    const resolvedSelected = this.interfaceSelectors.length
      ? resolveWanInterfaces({ interfaces }, this.interfaceSelectors)
      : [];
    if (
      resolvedSelected.length > 0
      && typeof this.session?.get === "function"
      && resolvedSelected.every((entry) => entry.counterBits === 64 || entry.counterBits === 32)
    ) {
      const selectedIndexes = new Set(resolvedSelected.map((entry) => entry.index));
      this.cachedTopology = {
        refreshedAt: Date.now(),
        selected: resolvedSelected.map((entry) => ({
          index: entry.index,
          name: entry.name,
          alias: entry.alias,
          speedMbps: entry.speedMbps,
          counterBits: entry.counterBits,
          ...(entry.addresses ? { addresses: entry.addresses } : {}),
        })),
        otherInterfaces: interfaces
          .filter((entry) => !selectedIndexes.has(entry.index))
          .map(({ index, name, alias, speedMbps, addresses }) => ({
            index,
            name,
            alias,
            inOctets: null,
            outOctets: null,
            counterBits: null,
            speedMbps,
            ...(addresses ? { addresses } : {}),
          })),
      };
      this.sessionErrored = false;
    } else {
      this.cachedTopology = null;
    }
    return { sampledAt: new Date(), interfaces };
  }

  readTargetedInterfaces() {
    const topology = this.cachedTopology;
    const oids = topology.selected.flatMap((entry) => (
      entry.counterBits === 64
        ? [
            `${IF_X_ENTRY}.1.${entry.index}`,
            `${IF_X_ENTRY}.6.${entry.index}`,
            `${IF_X_ENTRY}.10.${entry.index}`,
          ]
        : [
            `${IF_X_ENTRY}.1.${entry.index}`,
            `${IF_TABLE_ENTRY}.10.${entry.index}`,
            `${IF_TABLE_ENTRY}.16.${entry.index}`,
          ]
    ));
    return new Promise((resolve, reject) => {
      this.session.get(oids, (error, varbinds) => {
        if (error) return reject(error);
        try {
          if (!Array.isArray(varbinds) || varbinds.length < topology.selected.length * 3) {
            throw topologyStaleError("SNMP targeted response was incomplete");
          }
          const updatedSelected = topology.selected.map((entry, position) => {
            const nameVarbind = varbinds[position * 3];
            const inboundVarbind = varbinds[position * 3 + 1];
            const outboundVarbind = varbinds[position * 3 + 2];
            for (const varbind of [nameVarbind, inboundVarbind, outboundVarbind]) {
              if (!varbind || snmp.isVarbindError(varbind)) {
                throw topologyStaleError(`SNMP targeted varbind error for interface ${entry.index}`);
              }
            }
            const currentName = text(nameVarbind.value);
            if (currentName !== entry.name) {
              throw topologyStaleError(`SNMP interface ${entry.index} changed from ${entry.name} to ${currentName}`);
            }
            const parseCounter = entry.counterBits === 64 ? counter64 : counter32;
            let inOctets;
            let outOctets;
            try {
              inOctets = parseCounter(inboundVarbind.value);
              outOctets = parseCounter(outboundVarbind.value);
            } catch (parseError) {
              throw topologyStaleError(parseError.message);
            }
            return {
              ...entry,
              inOctets,
              outOctets,
            };
          });
          resolve({
            sampledAt: new Date(),
            interfaces: [...updatedSelected, ...topology.otherInterfaces],
          });
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  readCounter32(interfaces) {
    const oids = interfaces.flatMap((entry) => [
      `${IF_TABLE_ENTRY}.10.${entry.index}`,
      `${IF_TABLE_ENTRY}.16.${entry.index}`,
    ]);
    return new Promise((resolve, reject) => {
      this.session.get(oids, (error, varbinds) => {
        if (error) return reject(error);
        try {
          const counters = new Map();
          interfaces.forEach((entry, position) => {
            const inbound = varbinds[position * 2];
            const outbound = varbinds[position * 2 + 1];
            for (const varbind of [inbound, outbound]) {
              if (!varbind || snmp.isVarbindError(varbind)) {
                throw new Error(
                  `SNMP Counter32 unavailable for interface ${entry.name || entry.index}`,
                );
              }
            }
            counters.set(entry.index, {
              inOctets: counter32(inbound.value),
              outOctets: counter32(outbound.value),
              counterBits: 32,
            });
          });
          resolve(counters);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  readClientCount(indexes) {
    return new Promise((resolve, reject) => {
      this.session.tableColumns(
        IP_NET_TO_MEDIA_TABLE,
        IP_NET_TO_MEDIA_COLUMNS,
        20,
        (error, table) => {
          if (error) return reject(error);
          try {
            resolve(countDynamicClients(table, indexes));
          } catch (parseError) {
            reject(parseError);
          }
        },
      );
    });
  }

  close() {
    this.cachedTopology = null;
    try {
      this.session?.close?.();
    } catch {
      // ignore close errors on already-closed sessions
    }
  }
}

function topologyStaleError(message) {
  const error = new Error(message);
  error.code = "SNMP_TOPOLOGY_STALE";
  return error;
}

function counter32(value) {
  const result = counter64(value);
  if (result < 0n || result > 0xffff_ffffn) {
    throw new TypeError("SNMP Counter32 must be an unsigned 32-bit integer");
  }
  return result;
}

function text(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8").replace(/\0+$/, "") : String(value ?? "");
}

function protocol(protocols, requested, kind) {
  const value = protocols[String(requested).toLowerCase()];
  if (value == null) throw new Error(`Unsupported SNMPv3 ${kind} protocol: ${requested}`);
  return value;
}
