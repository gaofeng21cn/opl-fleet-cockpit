#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { NetSnmpClient, calculateThroughput, resolveWanInterfaces } from "../server/unifi-snmp.mjs";

// Read-only: use the same environment and secret files as the Gateway.
const env = process.env;
function secret(name) {
  return env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`], "utf8").trim() : env[name];
}
const selectors = (env.UNIFI_SNMP_INTERFACES || "").split(",").map((value) => value.trim()).filter(Boolean);
if (!env.UNIFI_SNMP_HOST || !env.UNIFI_SNMP_USER) throw new Error("Set UNIFI_SNMP_HOST and UNIFI_SNMP_USER using the Gateway configuration");
const client = new NetSnmpClient({
  host: env.UNIFI_SNMP_HOST,
  port: Number(env.UNIFI_SNMP_PORT || 161),
  user: env.UNIFI_SNMP_USER,
  authPassword: secret("UNIFI_SNMP_AUTH_PASSWORD"),
  privPassword: secret("UNIFI_SNMP_PRIV_PASSWORD"),
  authProtocol: env.UNIFI_SNMP_AUTH_PROTOCOL || "sha",
  privProtocol: env.UNIFI_SNMP_PRIV_PROTOCOL || "aes",
  timeoutMs: Number(env.UNIFI_SNMP_TIMEOUT_MS || 3000),
  discoverAddresses: true,
});
try {
  const before = await client.readInterfaces();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const after = await client.readInterfaces();
  let selected = [], selectionError = null;
  try { selected = resolveWanInterfaces(after, selectors).map(({ index }) => index); }
  catch (error) { selectionError = error.message; }
  const interfaces = after.interfaces.map((entry) => {
    let rates = null, counterError = null;
    try { rates = calculateThroughput(before, after, [entry.index]).interfaces[0]; }
    catch (error) { counterError = error.message; }
    return {
      index: entry.index, name: entry.name, alias: entry.alias, addresses: entry.addresses,
      counterBits: entry.counterBits, selected: selected.includes(entry.index),
      downloadMbps: rates?.downloadMbps ?? null, uploadMbps: rates?.uploadMbps ?? null,
      counterAdvanced: rates ? rates.downloadMbps > 0 || rates.uploadMbps > 0 : null,
      counterError,
    };
  });
  console.log(JSON.stringify({
    sampledAt: after.sampledAt, selectors, selectionError, interfaces,
    note: "Counter activity alone does not identify a WAN. Confirm uplink roles before using interface names or cidr:<approved-WAN-network>/<prefix> selectors. Idle backup WANs may have no traffic.",
  }, null, 2));
  if (selectionError && selectors.length) process.exitCode = 1;
} finally {
  client.close();
}
