const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const PET_STATES = new Set(["idle", "running", "waiting", "review", "failed"]);
const OPL_FLEET_SCHEMA = "opl_fleet_agent_telemetry.v1";
const OPL_FLEET_PRODUCT = "OPL Fleet Agent";
const OPL_FLEET_AUTHORITY = "node_agent";
const OPL_FLEET_MODES = new Set(["local", "direct", "fleet"]);
const OPL_FLEET_CAPABILITIES = new Set([
  "node_local_observation",
  "node_local_doctor",
  "node_local_execution_constraints",
  "sanitized_execution_receipts",
  "local_codex_telemetry",
  "host_dashboard",
]);
const OPL_FLEET_FIELDS = new Set([
  "schema",
  "product",
  "stableNodeID",
  "agentVersion",
  "modes",
  "capabilities",
  "authority",
]);
const SNAPSHOT_V3_FIELDS = new Set([
  "schemaVersion",
  "machineName",
  "platform",
  "generatedAt",
  "status",
  "error",
  "oneMinute",
  "fiveMinutes",
  "activeSessions",
  "cpuPercent",
  "memoryPercent",
  "network",
  "pet",
  "oplFleet",
]);

export function normalizeSnapshot(machineId, payload, receivedAt = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Snapshot payload must be an object");
  }
  const oplFleet = payload.oplFleet === undefined
    ? null
    : normalizeOplFleet(machineId, payload);
  const candidateGeneratedAt = new Date(payload.generatedAt || receivedAt);
  const futureLimit = receivedAt.valueOf() + 5 * 60 * 1000;
  const safeGeneratedAt = Number.isNaN(candidateGeneratedAt.valueOf()) || candidateGeneratedAt.valueOf() > futureLimit
    ? receivedAt
    : candidateGeneratedAt;
  const oneMinute = payload.oneMinute || {};
  const fiveMinutes = payload.fiveMinutes || {};

  return {
    machineId,
    machineName: String(payload.machineName || machineId).slice(0, 80),
    platform: String(payload.platform || "unknown").slice(0, 32),
    generatedAt: safeGeneratedAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    reportedStatus: ["live", "error"].includes(payload.status) ? payload.status : "live",
    error: payload.error ? String(payload.error).slice(0, 240) : null,
    oneMinute: normalizeWindow(oneMinute),
    fiveMinutes: normalizeWindow(fiveMinutes),
    activeSessions: Math.max(0, finite(payload.activeSessions)),
    cpuPercent: optionalPercent(payload.cpuPercent),
    memoryPercent: optionalPercent(payload.memoryPercent),
    network: normalizeHostNetwork(payload.network, safeGeneratedAt),
    pet: normalizePet(payload.pet, safeGeneratedAt),
    oplFleet,
  };
}

function normalizeOplFleet(machineId, payload) {
  if (payload.schemaVersion !== 3) {
    throw new TypeError("oplFleet snapshots must use schemaVersion 3");
  }
  assertKnownFields(payload, SNAPSHOT_V3_FIELDS, "Snapshot payload");
  const envelope = payload.oplFleet;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("oplFleet must be an object");
  }
  assertKnownFields(envelope, OPL_FLEET_FIELDS, "oplFleet");
  if (envelope.schema !== OPL_FLEET_SCHEMA) {
    throw new TypeError("Unsupported oplFleet schema");
  }
  if (envelope.product !== OPL_FLEET_PRODUCT) {
    throw new TypeError("Unsupported oplFleet product");
  }
  if (envelope.stableNodeID !== machineId) {
    throw new TypeError("oplFleet stableNodeID must match the machine ID");
  }
  if (envelope.authority !== OPL_FLEET_AUTHORITY) {
    throw new TypeError("Unsupported oplFleet authority");
  }
  const agentVersion = String(envelope.agentVersion || "");
  if (agentVersion.length > 32 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(agentVersion)) {
    throw new TypeError("oplFleet agentVersion must be a semantic version");
  }
  return {
    schema: OPL_FLEET_SCHEMA,
    product: OPL_FLEET_PRODUCT,
    stableNodeID: machineId,
    agentVersion,
    modes: normalizeKnownList(envelope.modes, OPL_FLEET_MODES, "oplFleet modes"),
    capabilities: normalizeKnownList(
      envelope.capabilities,
      OPL_FLEET_CAPABILITIES,
      "oplFleet capabilities",
    ),
    authority: OPL_FLEET_AUTHORITY,
  };
}

function assertKnownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new TypeError(`${label} contains unknown fields: ${unknown.join(", ")}`);
  }
}

function normalizeKnownList(value, allowed, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  const normalized = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw new TypeError(`${label} contains an unsupported value`);
    }
    if (normalized.includes(item)) {
      throw new TypeError(`${label} must not contain duplicates`);
    }
    normalized.push(item);
  }
  return normalized;
}

export function bindPairedIdentity(snapshot, identity) {
  if (!identity?.machineName) return snapshot;
  return {
    ...snapshot,
    machineName: String(identity.machineName).slice(0, 80),
  };
}

export function reconcilePairedMachineIdentities(machines, pairedIdentityForMachine) {
  let changed = false;
  for (const [machineId, snapshot] of machines) {
    const reconciled = bindPairedIdentity(snapshot, pairedIdentityForMachine(machineId));
    if (reconciled.machineName !== snapshot.machineName) {
      machines.set(machineId, reconciled);
      changed = true;
    }
  }
  return changed;
}

function normalizeWindow(window) {
  return {
    tps: Math.max(0, finite(window.tps)),
    inputTokens: Math.max(0, finite(window.inputTokens)),
    outputTokens: Math.max(0, finite(window.outputTokens)),
    cachedInputTokens: Math.max(0, finite(window.cachedInputTokens)),
    reasoningOutputTokens: Math.max(0, finite(window.reasoningOutputTokens)),
    requests: Math.max(0, finite(window.requests)),
  };
}

function optionalPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  return Math.max(0, Math.min(100, finite(value, 0)));
}

function normalizeHostNetwork(network, generatedAt) {
  if (!network || typeof network !== "object" || Array.isArray(network)) return null;
  const downloadMbps = optionalNumber(network.downloadMbps);
  const uploadMbps = optionalNumber(network.uploadMbps);
  if (downloadMbps === null && uploadMbps === null) return null;
  const candidate = new Date(network.sampledAt || network.updatedAt || generatedAt);
  const updatedAt = Number.isNaN(candidate.valueOf()) ? generatedAt : candidate.toISOString();
  return {
    status: "live",
    source: "host",
    downloadMbps,
    uploadMbps,
    clients: null,
    latencyMs: null,
    updatedAt,
    error: null,
  };
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
}

function normalizePet(pet, generatedAt) {
  if (!pet || typeof pet !== "object" || Array.isArray(pet)) return null;
  const id = String(pet.id || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)) return null;
  const state = PET_STATES.has(pet.state) ? pet.state : "idle";
  const candidateStateSince = new Date(pet.stateSince || generatedAt);
  const stateSince = Number.isNaN(candidateStateSince.valueOf())
    ? generatedAt
    : candidateStateSince;
  const assetHash = String(pet.assetHash || "").trim().toLowerCase();
  return {
    id,
    displayName: String(pet.displayName || id).slice(0, 80),
    spriteVersionNumber: Math.max(1, Math.trunc(finite(pet.spriteVersionNumber, 1))),
    assetHash: /^[a-f0-9]{64}$/.test(assetHash) ? assetHash : null,
    state,
    stateSince: stateSince.toISOString(),
  };
}

export function freshness(snapshot, now, liveAfterSeconds, staleAfterSeconds) {
  if (snapshot.reportedStatus === "error") return { status: "error", ageSeconds: age(snapshot, now) };
  const ageSeconds = age(snapshot, now);
  if (ageSeconds <= liveAfterSeconds) return { status: "live", ageSeconds };
  if (ageSeconds <= staleAfterSeconds) return { status: "stale", ageSeconds };
  return { status: "error", ageSeconds };
}

function age(snapshot, now) {
  return Math.max(0, Math.round((now.valueOf() - new Date(snapshot.generatedAt).valueOf()) / 1000));
}

export function buildDashboard({
  machines,
  machineHistory = new Map(),
  machineNetworkHistory = new Map(),
  fleetHistory = [],
  network,
  history,
  demo,
}, options = {}) {
  const now = options.now || new Date();
  const liveAfterSeconds = options.liveAfterSeconds || 30;
  const staleAfterSeconds = options.staleAfterSeconds || 300;
  const renderedMachines = [...machines.values()].map((snapshot) => {
    const current = freshness(snapshot, now, liveAfterSeconds, staleAfterSeconds);
    const totalInput = snapshot.oneMinute.inputTokens;
    const cachePercent = totalInput > 0
      ? Math.round((snapshot.oneMinute.cachedInputTokens / totalInput) * 100)
      : 0;
    const pet = snapshot.pet
      ? {
          ...snapshot.pet,
          assetUrl: options.petAssetUrl?.(snapshot.pet) || null,
          state: current.status === "live"
            ? snapshot.pet.state
            : current.status === "stale" ? "waiting" : "failed",
        }
      : null;
    const hostNetworkHistory = historyForMachine(machineNetworkHistory, snapshot.machineId);
    const hostNetwork = snapshot.network
      ? { ...networkFreshness(snapshot.network, now, liveAfterSeconds, staleAfterSeconds), history: hostNetworkHistory }
      : { status: "unavailable", source: "host", downloadMbps: null, uploadMbps: null, history: [] };
    return {
      ...snapshot,
      ...current,
      cachePercent,
      pet,
      network: hostNetwork,
      tpsHistory: historyForMachine(machineHistory, snapshot.machineId),
    };
  })
    .filter((machine) => machine.ageSeconds <= staleAfterSeconds)
    .sort((a, b) => b.oneMinute.tps - a.oneMinute.tps);

  const aggregateMachines = renderedMachines.filter((machine) => machine.status === "live");
  let oneMinuteTps = 0;
  let fiveMinuteTps = 0;
  let activeSessions = 0;
  let weightedCache = 0;
  let cacheWeight = 0;
  let cpuTotal = 0;
  let cpuReportedMachineCount = 0;
  let memoryTotal = 0;
  let memoryReportedMachineCount = 0;
  for (const machine of aggregateMachines) {
    oneMinuteTps += machine.oneMinute.tps;
    fiveMinuteTps += machine.fiveMinutes.tps;
    activeSessions += machine.activeSessions;
    const weight = Math.max(machine.oneMinute.inputTokens, 1);
    weightedCache += machine.cachePercent * weight;
    cacheWeight += weight;
    if (machine.cpuPercent !== null) {
      cpuTotal += machine.cpuPercent;
      cpuReportedMachineCount += 1;
    }
    if (machine.memoryPercent !== null) {
      memoryTotal += machine.memoryPercent;
      memoryReportedMachineCount += 1;
    }
  }

  const liveMachines = renderedMachines.filter((machine) => machine.status === "live").length;
  const workingMachines = aggregateMachines.filter((machine) => (
    Number(machine.oneMinute?.tps || 0) > 0 || Number(machine.activeSessions || 0) > 0
  )).length;
  const staleMachines = renderedMachines.filter((machine) => machine.status === "stale").length;
  const codexStatus = liveMachines > 0 ? "live" : staleMachines > 0 ? "stale" : "error";
  const renderedNetwork = networkFreshness(network, now, liveAfterSeconds, staleAfterSeconds);
  const networkStatus = renderedNetwork.status;

  const aggregate = {
    status: codexStatus,
    oneMinuteTps,
    fiveMinuteTps,
    cachePercent: cacheWeight ? Math.round(weightedCache / cacheWeight) : 0,
    activeSessions,
    cpuPercent: cpuReportedMachineCount ? Math.round(cpuTotal / cpuReportedMachineCount) : null,
    cpuReportedMachineCount,
    memoryPercent: memoryReportedMachineCount ? Math.round(memoryTotal / memoryReportedMachineCount) : null,
    memoryReportedMachineCount,
    machineCount: renderedMachines.length,
    liveMachineCount: liveMachines,
    staleMachineCount: staleMachines,
    workingMachineCount: workingMachines,
    tpsHistory: Array.isArray(fleetHistory) ? fleetHistory : [],
  };

  return {
    generatedAt: now.toISOString(),
    demo,
    overallStatus: networkStatus === "error" || codexStatus === "error" ? "error" : networkStatus === "stale" || codexStatus === "stale" ? "stale" : "live",
    network: { ...renderedNetwork, history },
    fleet: aggregate,
    codex: { ...aggregate },
    machines: renderedMachines,
  };
}

function historyForMachine(machineHistory, machineId) {
  const history = machineHistory instanceof Map
    ? machineHistory.get(machineId)
    : machineHistory?.[machineId];
  return Array.isArray(history) ? history : [];
}

export function networkFreshness(network, now, liveAfterSeconds, staleAfterSeconds) {
  if (!network.updatedAt) return { ...network, status: network.status || "error", ageSeconds: null };
  const ageSeconds = Math.max(0, Math.round((now.valueOf() - new Date(network.updatedAt).valueOf()) / 1000));
  if (network.status === "error") return { ...network, status: "error", ageSeconds };
  if (network.status === "stale") {
    return { ...network, status: ageSeconds <= staleAfterSeconds ? "stale" : "error", ageSeconds };
  }
  const status = ageSeconds <= liveAfterSeconds ? "live" : ageSeconds <= staleAfterSeconds ? "stale" : "error";
  return { ...network, status, ageSeconds };
}
