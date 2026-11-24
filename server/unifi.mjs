import http from "node:http";
import https from "node:https";

const httpsAgents = new Map();
const caAgentIds = new WeakMap();
let nextCaId = 1;

function getHttpsAgent({ allowSelfSigned = false, ca } = {}) {
  let caKey = "";
  if (typeof ca === "string") {
    caKey = `s:${ca}`;
  } else if (ca && typeof ca === "object") {
    let id = caAgentIds.get(ca);
    if (!id) {
      id = nextCaId++;
      caAgentIds.set(ca, id);
    }
    caKey = `o:${id}`;
  }
  const key = `${allowSelfSigned ? "1" : "0"}:${caKey}`;
  let agent = httpsAgents.get(key);
  if (!agent) {
    agent = new https.Agent({
      ...tlsAgentOptions({ allowSelfSigned, ca }),
      keepAlive: true,
      maxSockets: 2,
    });
    httpsAgents.set(key, agent);
  }
  return agent;
}

function getJson(url, apiKey, allowSelfSigned, ca) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const request = client.get(target, {
      headers: { "X-API-KEY": apiKey, Accept: "application/json" },
      agent: target.protocol === "https:" ? getHttpsAgent({ allowSelfSigned, ca }) : undefined,
      timeout: 5000,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`UniFi returned HTTP ${response.statusCode || "unknown"}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch { reject(new Error("UniFi returned invalid JSON")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("UniFi request timed out")));
    request.on("error", reject);
  });
}

export async function pollUnifi({ baseUrl, site, apiKey, allowSelfSigned, ca }) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/proxy/network/api/s/${encodeURIComponent(site)}/stat/health`;
  const payload = await getJson(endpoint, apiKey, allowSelfSigned, ca);
  const entries = Array.isArray(payload) ? payload : payload.data;
  const wan = entries?.find((entry) => entry.subsystem === "wan") || entries?.[0];
  if (!wan) throw new Error("UniFi response has no WAN health entry");
  return {
    status: "live",
    source: "unifi",
    downloadMbps: bytesPerSecondToMbps(wan["rx_bytes-r"]),
    uploadMbps: bytesPerSecondToMbps(wan["tx_bytes-r"]),
    clients: Number(wan.num_user || wan.num_users || 0),
    latencyMs: Number(wan.wan_ip ? wan.latency || 0 : 0),
    updatedAt: new Date().toISOString(),
    error: null,
  };
}

export function tlsAgentOptions({ allowSelfSigned = false, ca } = {}) {
  return {
    rejectUnauthorized: !allowSelfSigned,
    ...(ca ? { ca } : {}),
  };
}

export function bytesPerSecondToMbps(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 8 / 1_000_000 : 0;
}
