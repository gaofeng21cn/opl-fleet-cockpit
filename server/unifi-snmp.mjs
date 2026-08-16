import snmp from "net-snmp";
import { measureTcpLatency } from "./latency-probe.mjs";

const IF_X_TABLE = "1.3.6.1.2.1.31.1.1";
const IF_X_COLUMNS = [1, 6, 10, 15, 18];
const IF_TABLE_ENTRY = "1.3.6.1.2.1.2.2.1";
const IP_NET_TO_MEDIA_TABLE = "1.3.6.1.2.1.4.22";
const IP_NET_TO_MEDIA_COLUMNS = [1, 2, 4];

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

  return async function poll() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await readInterfaces();
      const selected = selectInterfaces(current, config.interfaces);
      if (!selected.length) {
        throw new Error(`SNMP found no matching WAN interfaces: ${config.interfaces.join(", ")}`);
      }

      if (!samples.length) {
        samples.push(current);
        await delay(Math.min(config.pollMs, 1000));
      }

      const next = samples.at(-1) === current ? await readInterfaces() : current;
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
  };
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
    if (session) {
      this.session = session;
      return;
    }
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

  async readInterfaces() {
    const table = await new Promise((resolve, reject) => {
      this.session.tableColumns(IF_X_TABLE, IF_X_COLUMNS, 20, (error, table) => {
        if (error) return reject(error);
        resolve(table);
      });
    });
    let interfaces = parseInterfaceTable(table);
    const selected = selectInterfaces({ interfaces }, this.interfaceSelectors);
    const counter32Fallback = selected.filter((entry) => entry.counterBits === null);
    if (counter32Fallback.length) {
      const counters = await this.readCounter32(counter32Fallback);
      interfaces = interfaces.map((entry) => {
        const fallback = counters.get(entry.index);
        return fallback ? { ...entry, ...fallback } : entry;
      });
    }
    return { sampledAt: new Date(), interfaces };
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
    this.session.close();
  }
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
