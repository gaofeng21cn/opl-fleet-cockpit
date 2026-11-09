import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicStatus,
  buildStatusSummary,
  PUBLIC_STATUS_PATH,
  PUBLIC_STATUS_SCHEMA_VERSION,
} from "./public-status.mjs";
import { buildDashboard, normalizeSnapshot } from "./status-model.mjs";

test("projects the dashboard into a versioned mobile contract", () => {
  const status = buildPublicStatus({
    generatedAt: "2026-07-31T00:00:00.000Z",
    demo: false,
    site: { name: "Home", timeZone: "Asia/Shanghai" },
    overallStatus: "live",
    network: { status: "live", history: [] },
    codex: { status: "live", oneMinuteTps: 60000 },
    fleet: {
      status: "live",
      oneMinuteTps: 60000,
      activeSessions: 10,
      cpuPercent: 97,
      liveMachineCount: 1,
      workingMachineCount: 1,
      tpsHistory: [{ at: "2026-07-30T23:59:55.000Z", tps: 58000 }],
    },
    machines: [{
      machineId: "studio",
      machineName: "Studio",
      status: "live",
      oneMinute: { tps: 60000 },
      fiveMinutes: { tps: 42000 },
      activeSessions: 10,
      cpuPercent: 97,
      oplFleet: {
        schema: "opl_fleet_agent_telemetry.v1",
        product: "OPL Fleet Agent",
        stableNodeID: "studio",
        agentVersion: "0.2.27",
        modes: ["local", "direct", "fleet"],
        capabilities: ["local_codex_telemetry", "host_dashboard"],
        authority: "node_agent",
      },
      tpsHistory: [{ at: "2026-07-30T23:59:55.000Z", tps: 58000 }],
    }],
  }, {
    instanceId: "home-ops",
    serverVersion: "1.2.3",
  });

  assert.equal(PUBLIC_STATUS_PATH, "/api/v1/status");
  assert.equal(status.schemaVersion, PUBLIC_STATUS_SCHEMA_VERSION);
  assert.equal(status.productName, "OPL Fleet Cockpit · Ambient Ops");
  assert.equal(status.serverVersion, "1.2.3");
  assert.equal(status.instanceId, "home-ops");
  assert.deepEqual(status.provider, {
    kind: "gateway",
    scope: "fleet",
    id: "home-ops",
    name: "Home",
    productName: "OPL Fleet Telemetry Gateway",
  });
  assert.equal(status.capabilities.network, true);
  assert.equal(status.capabilities.loadVisualState, true);
  assert.equal(status.capabilities.machineHistory, true);
  assert.equal(status.capabilities.persistentHistory, true);
  assert.equal(status.capabilities.fleetHistory, true);
  assert.equal(status.capabilities.hostNetwork, true);
  assert.equal(status.capabilities.webDisplay, true);
  assert.equal(status.capabilities.liveActivityPush, false);
  assert.equal(status.machines[0].loadVisualState.modelVersion, 1);
  assert.equal(status.machines[0].loadVisualState.state, "constrained");
  assert.equal(status.machines[0].oplFleet.product, "OPL Fleet Agent");
  assert.equal(status.machines[0].oplFleet.authority, "node_agent");
  assert.ok(status.machines[0].loadVisualState.taskDensity > 0.8);
  assert.deepEqual(status.machines[0].tpsHistory, [
    { at: "2026-07-30T23:59:55.000Z", tps: 58000 },
  ]);
  assert.equal(status.fleet.loadVisualState.state, "constrained");
  assert.deepEqual(status.fleet.tpsHistory, [
    { at: "2026-07-30T23:59:55.000Z", tps: 58000 },
  ]);
});

test("preserves unknown CPU as activity rather than invented pressure", () => {
  const status = buildPublicStatus({
    generatedAt: "2026-07-31T00:00:00.000Z",
    demo: true,
    site: { name: "Demo", timeZone: "UTC" },
    overallStatus: "live",
    network: { status: "live", history: [] },
    codex: { status: "live" },
    fleet: {
      status: "live",
      oneMinuteTps: 60000,
      activeSessions: 10,
      cpuPercent: null,
      liveMachineCount: 1,
      workingMachineCount: 1,
    },
    machines: [{
      machineId: "mac",
      machineName: "Mac",
      oneMinute: { tps: 60000 },
      activeSessions: 10,
      cpuPercent: null,
    }],
  });

  assert.equal(status.machines[0].loadVisualState.state, "heavy");
  assert.equal(status.machines[0].loadVisualState.pressure, 0);
  assert.notEqual(status.fleet.loadVisualState.state, "constrained");
});


test("summary preserves canonical node identity, source versions and observation freshness", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  const machines = new Map([
    ["live", normalizeSnapshot("live", {
      schemaVersion: 3,
      machineName: "Native node",
      platform: "macOS",
      generatedAt: "2026-11-09T11:59:50.000Z",
      oneMinute: { tps: 12 },
      oplFleet: {
        schema: "opl_fleet_agent_telemetry.v1",
        product: "OPL Fleet Agent",
        stableNodeID: "live",
        agentVersion: "0.2.47",
        modes: ["local"],
        capabilities: ["local_codex_telemetry"],
        authority: "node_agent",
      },
    }, now)],
    ["stale", normalizeSnapshot("stale", {
      generatedAt: "2026-11-09T11:58:00.000Z",
      oneMinute: { tps: 22 },
    }, now)],
    ["error", normalizeSnapshot("error", {
      generatedAt: "2026-11-09T11:59:40.000Z",
      status: "error",
      error: "private diagnostic text",
      oneMinute: { tps: 32 },
    }, now)],
  ]);
  const dashboard = {
    site: { name: "Test fleet", timeZone: "UTC" },
    ...buildDashboard({
      machines,
      network: { status: "stale", updatedAt: "2026-11-09T11:58:30.000Z", source: "unifi-snmp-v3" },
      history: [],
      demo: false,
    }, { now }),
  };
  const publicStatus = buildPublicStatus(dashboard, { instanceId: "test-gateway", serverVersion: "0.1.47" });
  const summary = buildStatusSummary(publicStatus);
  assert.equal(summary.view, "summary");
  assert.equal(summary.access, "read_only");
  assert.equal(summary.authority, "observation_only");
  assert.equal(summary.instanceId, publicStatus.instanceId);
  assert.equal(summary.serverVersion, publicStatus.serverVersion);
  assert.deepEqual(summary.provider, publicStatus.provider);
  assert.equal(summary.generatedAt, now.toISOString());
  assert.equal(summary.demo, false);
  assert.equal(summary.fleet.oneMinuteTps, publicStatus.fleet.oneMinuteTps);
  assert.equal(summary.fleet.oneMinuteTps, 12);
  for (const [id, state, ageSeconds] of [["live", "fresh", 10], ["stale", "stale", 120], ["error", "error", 20]]) {
    const expected = publicStatus.machines.find((machine) => machine.machineId === id);
    const actual = summary.machines.find((machine) => machine.machineId === id);
    assert.equal(actual.observedAt, expected.generatedAt);
    assert.equal(actual.receivedAt, expected.receivedAt);
    assert.deepEqual(actual.freshness, { state, ageSeconds, lastKnown: state !== "fresh" });
    assert.deepEqual(actual.source, expected.oplFleet);
    assert.equal(actual.oneMinuteTps, expected.oneMinute.tps);
    assert.equal(actual.tpsHistory, undefined);
    assert.equal(actual.error, undefined);
    assert.equal(actual.loadVisualState, undefined);
  }
  const live = summary.machines.find((machine) => machine.machineId === "live");
  assert.equal(live.source.stableNodeID, live.machineId);
  assert.equal(live.source.agentVersion, "0.2.47");
  assert.notEqual(live.observedAt, summary.generatedAt);
  assert.deepEqual(summary.network.freshness, { state: "stale", ageSeconds: 90, lastKnown: true });
  assert.equal(summary.network.observedAt, publicStatus.network.updatedAt);
});

test("summary preserves missing observations and the dashboard's retired-node boundary", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  const status = buildPublicStatus({
    site: { name: "Empty fleet", timeZone: "UTC" },
    ...buildDashboard({
      machines: new Map([["retired", normalizeSnapshot("retired", {
        generatedAt: "2026-11-09T11:00:00.000Z", oneMinute: { tps: 999 },
      }, now)]]),
      network: { status: "error" },
      history: [],
      demo: true,
    }, { now }),
  }, { instanceId: "test-gateway", serverVersion: "0.1.47" });
  const summary = buildStatusSummary(status);
  assert.equal(summary.demo, true);
  assert.equal(summary.network.status, "error");
  assert.equal(summary.network.observedAt, null);
  assert.deepEqual(summary.network.freshness, { state: "unavailable", ageSeconds: null, lastKnown: false });
  assert.deepEqual(summary.machines, []);
  assert.equal(summary.fleet.machineCount, 0);
  assert.equal(summary.fleet.oneMinuteTps, 0);
  assert.equal(summary.fleet.status, status.fleet.status);
});
