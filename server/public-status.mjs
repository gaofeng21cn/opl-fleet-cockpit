import {
  LOAD_VISUAL_MODEL_VERSION,
  fleetLoadPresentation,
  loadSceneProfile,
  loadState,
  singleMachineLoad,
} from "../src/load-model.mjs";

export const PUBLIC_STATUS_SCHEMA_VERSION = 1;
export const PUBLIC_STATUS_PATH = "/api/v1/status";
export const FLEET_COCKPIT_PRODUCT = "OPL Fleet Cockpit · Ambient Ops";
export const FLEET_GATEWAY_PRODUCT = "OPL Fleet Telemetry Gateway";

export function buildPublicStatus(dashboard, {
  instanceId,
  serverVersion,
} = {}) {
  const providerId = String(instanceId || "");
  return {
    schemaVersion: PUBLIC_STATUS_SCHEMA_VERSION,
    productName: FLEET_COCKPIT_PRODUCT,
    serverVersion: String(serverVersion || "unknown"),
    instanceId: providerId,
    generatedAt: dashboard.generatedAt,
    demo: Boolean(dashboard.demo),
    site: dashboard.site,
    overallStatus: dashboard.overallStatus,
    provider: {
      kind: "gateway",
      scope: "fleet",
      id: providerId,
      name: dashboard.site.name,
      productName: FLEET_GATEWAY_PRODUCT,
    },
    capabilities: {
      loadVisualState: true,
      network: true,
      networkHistory: true,
      machineHistory: true,
      persistentHistory: true,
      fleetHistory: true,
      hostNetwork: true,
      pets: true,
      webDisplay: true,
      liveActivityPush: false,
    },
    network: dashboard.network,
    codex: dashboard.codex,
    fleet: projectFleet(dashboard.fleet),
    machines: dashboard.machines.map(projectMachine),
  };
}

// A compact projection of the same public status read by native clients.
// It deliberately keeps source times separate from response generation time.
export function buildStatusSummary(status) {
  return {
    schemaVersion: status.schemaVersion,
    view: "summary",
    access: "read_only",
    authority: "observation_only",
    productName: status.productName,
    instanceId: status.instanceId,
    serverVersion: status.serverVersion,
    generatedAt: status.generatedAt,
    demo: status.demo,
    provider: status.provider,
    overallStatus: status.overallStatus,
    network: {
      status: status.network.status,
      source: status.network.source || null,
      observedAt: status.network.updatedAt || null,
      freshness: observationFreshness(status.network, status.network.updatedAt),
      downloadMbps: status.network.downloadMbps ?? null,
      uploadMbps: status.network.uploadMbps ?? null,
    },
    fleet: {
      status: status.fleet.status,
      machineCount: status.fleet.machineCount,
      liveMachineCount: status.fleet.liveMachineCount,
      staleMachineCount: status.fleet.staleMachineCount,
      oneMinuteTps: status.fleet.oneMinuteTps,
      fiveMinuteTps: status.fleet.fiveMinuteTps,
      activeSessions: status.fleet.activeSessions,
    },
    machines: status.machines.map((machine) => ({
      machineId: machine.machineId,
      machineName: machine.machineName,
      platform: machine.platform,
      status: machine.status,
      observedAt: machine.generatedAt || null,
      receivedAt: machine.receivedAt || null,
      freshness: observationFreshness(machine, machine.generatedAt),
      source: machine.oplFleet || null,
      oneMinuteTps: machine.oneMinute?.tps ?? null,
      fiveMinuteTps: machine.fiveMinutes?.tps ?? null,
      activeSessions: machine.activeSessions ?? null,
      cpuPercent: machine.cpuPercent ?? null,
      memoryPercent: machine.memoryPercent ?? null,
    })),
  };
}

function observationFreshness(observation, observedAt) {
  const hasObservation = typeof observedAt === "string" && Number.isFinite(Date.parse(observedAt));
  const state = !hasObservation || observation.status === "unavailable"
    ? "unavailable"
    : observation.status === "live" ? "fresh"
      : observation.status === "stale" ? "stale" : "error";
  return {
    state,
    ageSeconds: hasObservation ? observation.ageSeconds ?? null : null,
    lastKnown: hasObservation && state !== "fresh",
  };
}

function projectFleet(fleet) {
  const load = fleetLoadPresentation(fleet);
  return {
    ...fleet,
    loadVisualState: visualState(load),
  };
}

function projectMachine(machine) {
  const load = singleMachineLoad(machine);
  const state = loadState(load.score, load).definition;
  return {
    ...machine,
    loadVisualState: visualState({ ...load, state, sceneProfile: loadSceneProfile(load) }),
  };
}

function visualState(load) {
  const state = load.state?.id ? load.state : loadState(load.score, load).definition;
  const profile = load.sceneProfile || loadSceneProfile(load);
  return {
    modelVersion: LOAD_VISUAL_MODEL_VERSION,
    state: state.id,
    label: state.label,
    score: load.score,
    constrained: load.constrained,
    ...profile,
  };
}
