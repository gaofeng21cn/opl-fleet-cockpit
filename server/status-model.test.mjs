import test from "node:test";
import assert from "node:assert/strict";
import {
  bindPairedIdentity,
  buildDashboard,
  freshness,
  networkFreshness,
  normalizeSnapshot,
  reconcilePairedMachineIdentities,
} from "./status-model.mjs";

test("normalizes a machine snapshot without retaining unknown content", () => {
  const snapshot = normalizeSnapshot("mac", {
    machineName: "Mac",
    generatedAt: "2026-07-25T00:00:00.000Z",
    prompt: "must not be retained",
    oneMinute: { tps: 12.5, inputTokens: 100, cachedInputTokens: 80 },
  }, new Date("2026-07-25T00:00:01.000Z"));
  assert.equal(snapshot.oneMinute.tps, 12.5);
  assert.equal(snapshot.prompt, undefined);
  assert.equal(snapshot.oplFleet, null);
});

test("normalizes the current OPL Fleet Agent telemetry envelope", () => {
  const snapshot = normalizeSnapshot("primary-mac", {
    schemaVersion: 3,
    machineName: "Primary Mac",
    platform: "macOS",
    generatedAt: "2026-08-01T00:00:00.000Z",
    oneMinute: { tps: 12.5 },
    oplFleet: {
      schema: "opl_fleet_agent_telemetry.v1",
      product: "OPL Fleet Agent",
      stableNodeID: "primary-mac",
      agentVersion: "0.2.27",
      modes: ["local", "direct", "fleet"],
      capabilities: [
        "node_local_observation",
        "node_local_doctor",
        "node_local_execution_constraints",
        "sanitized_execution_receipts",
        "local_codex_telemetry",
        "host_dashboard",
      ],
      authority: "node_agent",
    },
  }, new Date("2026-08-01T00:00:01.000Z"));

  assert.deepEqual(snapshot.oplFleet, {
    schema: "opl_fleet_agent_telemetry.v1",
    product: "OPL Fleet Agent",
    stableNodeID: "primary-mac",
    agentVersion: "0.2.27",
    modes: ["local", "direct", "fleet"],
    capabilities: [
      "node_local_observation",
      "node_local_doctor",
      "node_local_execution_constraints",
      "sanitized_execution_receipts",
      "local_codex_telemetry",
      "host_dashboard",
    ],
    authority: "node_agent",
  });
});

test("rejects the retired Fleet Agent wire identity", () => {
  const retiredProduct = ["OPL Fleet Agent", ["Codex", "TPS"].join(" ")].join(" · ");

  assert.throws(() => normalizeSnapshot("retired-mac", {
    schemaVersion: 3,
    oplFleet: {
      schema: "opl_fleet_agent_telemetry.v1",
      product: retiredProduct,
      stableNodeID: "retired-mac",
      agentVersion: "0.2.29",
      modes: ["local", "direct", "fleet"],
      capabilities: ["local_codex_telemetry", "host_dashboard"],
      authority: "node_agent",
    },
  }), /product/);
});

test("rejects invalid OPL Fleet Agent identity, authority, and unknown fields", () => {
  const valid = {
    schemaVersion: 3,
    oplFleet: {
      schema: "opl_fleet_agent_telemetry.v1",
      product: "OPL Fleet Agent",
      stableNodeID: "primary-mac",
      agentVersion: "0.2.27",
      modes: ["local", "direct", "fleet"],
      capabilities: ["local_codex_telemetry", "host_dashboard"],
      authority: "node_agent",
    },
  };

  assert.throws(
    () => normalizeSnapshot("other-mac", valid),
    /stableNodeID must match/,
  );
  assert.throws(
    () => normalizeSnapshot("primary-mac", {
      ...valid,
      oplFleet: { ...valid.oplFleet, authority: "controller" },
    }),
    /authority/,
  );
  assert.throws(
    () => normalizeSnapshot("primary-mac", { ...valid, prompt: "must reject" }),
    /unknown fields: prompt/,
  );
  assert.throws(
    () => normalizeSnapshot("primary-mac", {
      ...valid,
      oplFleet: { ...valid.oplFleet, dispatch: true },
    }),
    /unknown fields: dispatch/,
  );
  assert.throws(
    () => normalizeSnapshot("primary-mac", {
      ...valid,
      oplFleet: { ...valid.oplFleet, product: "Unknown Fleet Agent" },
    }),
    /product/,
  );
});

test("rejects unsupported OPL Fleet Agent versions, modes, and capabilities", () => {
  const envelope = {
    schema: "opl_fleet_agent_telemetry.v1",
    product: "OPL Fleet Agent",
    stableNodeID: "primary-mac",
    agentVersion: "0.2.27",
    modes: ["local", "direct", "fleet"],
    capabilities: ["local_codex_telemetry"],
    authority: "node_agent",
  };

  assert.throws(
    () => normalizeSnapshot("primary-mac", {
      schemaVersion: 2,
      oplFleet: envelope,
    }),
    /schemaVersion 3/,
  );
  assert.throws(
    () => normalizeSnapshot("primary-mac", {
      schemaVersion: 3,
      oplFleet: { ...envelope, agentVersion: "latest" },
    }),
    /semantic version/,
  );
  assert.throws(
    () => normalizeSnapshot("primary-mac", {
      schemaVersion: 3,
      oplFleet: { ...envelope, modes: ["dispatch"] },
    }),
    /modes contains an unsupported value/,
  );
  assert.throws(
    () => normalizeSnapshot("primary-mac", {
      schemaVersion: 3,
      oplFleet: { ...envelope, capabilities: ["fleet_dispatch"] },
    }),
    /capabilities contains an unsupported value/,
  );
});

test("binds a paired machine name over an untrusted snapshot name", () => {
  const snapshot = normalizeSnapshot("gaofeng-worksta", {
    machineName: "Gaofeng-WS",
    generatedAt: "2026-07-25T00:00:00.000Z",
  });
  const bound = bindPairedIdentity(snapshot, {
    machineId: "gaofeng-worksta",
    machineName: "GAOFENG-WORKSTA",
    platform: "Windows",
  });

  assert.equal(bound.machineId, "gaofeng-worksta");
  assert.equal(bound.machineName, "GAOFENG-WORKSTA");
  assert.equal(bound.platform, "unknown");
});

test("reconciles persisted snapshots to paired names at startup", () => {
  const machines = new Map([
    ["gaofeng-worksta", normalizeSnapshot("gaofeng-worksta", {
      machineName: "Gaofeng-WS",
      generatedAt: "2026-07-25T00:00:00.000Z",
    })],
    ["unpaired", normalizeSnapshot("unpaired", {
      machineName: "Unpaired host",
      generatedAt: "2026-07-25T00:00:00.000Z",
    })],
  ]);

  assert.equal(reconcilePairedMachineIdentities(machines, (machineId) => (
    machineId === "gaofeng-worksta"
      ? { machineName: "GAOFENG-WORKSTA" }
      : null
  )), true);
  assert.equal(machines.get("gaofeng-worksta").machineName, "GAOFENG-WORKSTA");
  assert.equal(machines.get("unpaired").machineName, "Unpaired host");
  assert.equal(reconcilePairedMachineIdentities(machines, () => null), false);
});

test("normalizes only supported host pet fields", () => {
  const snapshot = normalizeSnapshot("mac", {
    generatedAt: "2026-07-25T00:00:00.000Z",
    pet: {
      id: "Ledger-Owl",
      displayName: "Ledger Owl",
      spriteVersionNumber: 1,
      assetHash: "a".repeat(64),
      state: "running",
      stateSince: "2026-07-24T23:59:50.000Z",
      prompt: "must not be retained",
    },
  }, new Date("2026-07-25T00:00:01.000Z"));

  assert.deepEqual(snapshot.pet, {
    id: "ledger-owl",
    displayName: "Ledger Owl",
    spriteVersionNumber: 1,
    assetHash: "a".repeat(64),
    state: "running",
    stateSince: "2026-07-24T23:59:50.000Z",
  });
  assert.equal(snapshot.pet.prompt, undefined);
});

test("rejects invalid pet identity and clamps unsupported state", () => {
  const invalid = normalizeSnapshot("mac", { pet: { id: "../owl" } });
  const fallback = normalizeSnapshot("mac", {
    pet: { id: "ledger-owl", state: "unknown", assetHash: "not-a-hash" },
  });

  assert.equal(invalid.pet, null);
  assert.equal(fallback.pet.state, "idle");
  assert.equal(fallback.pet.assetHash, null);
});

test("freshness moves from live through stale to error", () => {
  const snapshot = normalizeSnapshot("mac", { generatedAt: "2026-07-25T00:00:00.000Z" });
  assert.equal(freshness(snapshot, new Date("2026-07-25T00:00:20.000Z"), 30, 300).status, "live");
  assert.equal(freshness(snapshot, new Date("2026-07-25T00:01:00.000Z"), 30, 300).status, "stale");
  assert.equal(freshness(snapshot, new Date("2026-07-25T00:06:00.000Z"), 30, 300).status, "error");
});

test("dashboard aggregates machine throughput", () => {
  const now = new Date("2026-07-25T00:00:10.000Z");
  const machines = new Map([
    ["a", normalizeSnapshot("a", { generatedAt: now, oneMinute: { tps: 10 }, fiveMinutes: { tps: 8 }, activeSessions: 2 }, now)],
    ["b", normalizeSnapshot("b", { generatedAt: now, oneMinute: { tps: 20 }, fiveMinutes: { tps: 18 }, activeSessions: 3 }, now)],
  ]);
  const dashboard = buildDashboard({ machines, network: { status: "live" }, history: [], demo: false }, { now });
  assert.equal(dashboard.codex.oneMinuteTps, 30);
  assert.equal(dashboard.codex.fiveMinuteTps, 26);
  assert.equal(dashboard.codex.activeSessions, 5);
  assert.equal(dashboard.fleet.oneMinuteTps, 30);
  assert.equal(dashboard.fleet.liveMachineCount, 2);
  assert.equal(dashboard.fleet.workingMachineCount, 2);
});

test("dashboard exposes persisted fleet and per-host network histories", () => {
  const now = new Date("2026-07-25T00:00:10.000Z");
  const machines = new Map([
    ["a", normalizeSnapshot("a", {
      generatedAt: now,
      oneMinute: { tps: 20 },
      network: { downloadMbps: 123.4, uploadMbps: 12.3, sampledAt: now },
    }, now)],
  ]);
  const fleetHistory = [{ at: "2026-07-25T00:00:10.000Z", tps: 20 }];
  const machineNetworkHistory = new Map([["a", [{
    at: "2026-07-25T00:00:10.000Z",
    downloadMbps: 123.4,
    uploadMbps: 12.3,
  }]]]);

  const dashboard = buildDashboard({
    machines,
    machineNetworkHistory,
    fleetHistory,
    network: { status: "live" },
    history: [],
    demo: false,
  }, { now });

  assert.deepEqual(dashboard.fleet.tpsHistory, fleetHistory);
  assert.equal(dashboard.machines[0].network.source, "host");
  assert.deepEqual(dashboard.machines[0].network.history, machineNetworkHistory.get("a"));
});

test("dashboard keeps absent host network telemetry unavailable", () => {
  const now = new Date("2026-07-25T00:00:10.000Z");
  const machines = new Map([
    ["a", normalizeSnapshot("a", { generatedAt: now }, now)],
  ]);
  const dashboard = buildDashboard({ machines, network: { status: "live" }, history: [], demo: false }, { now });

  assert.equal(dashboard.machines[0].network.status, "unavailable");
  assert.equal(dashboard.machines[0].network.downloadMbps, null);
});

test("dashboard exposes the persisted TPS history for each rendered machine", () => {
  const now = new Date("2026-07-25T00:00:10.000Z");
  const machines = new Map([
    ["a", normalizeSnapshot("a", { generatedAt: now, oneMinute: { tps: 20 } }, now)],
  ]);
  const machineHistory = new Map([
    ["a", [
      { at: "2026-07-25T00:00:05.000Z", tps: 10 },
      { at: "2026-07-25T00:00:10.000Z", tps: 20 },
    ]],
  ]);

  const dashboard = buildDashboard({
    machines,
    machineHistory,
    network: { status: "live" },
    history: [],
    demo: false,
  }, { now });

  assert.deepEqual(dashboard.machines[0].tpsHistory, machineHistory.get("a"));
});

test("keeps optional host telemetry bounded and aggregates only reported live hosts", () => {
  const now = new Date("2026-07-25T00:00:10.000Z");
  const machines = new Map([
    ["a", normalizeSnapshot("a", {
      generatedAt: now,
      cpuPercent: 72,
      memoryPercent: 44,
      oneMinute: { tps: 10 },
    }, now)],
    ["b", normalizeSnapshot("b", {
      generatedAt: now,
      cpuPercent: 140,
      memoryPercent: -10,
      oneMinute: { tps: 20 },
    }, now)],
    ["c", normalizeSnapshot("c", {
      generatedAt: "2026-07-24T23:59:00.000Z",
      cpuPercent: 99,
      oneMinute: { tps: 999 },
    }, now)],
  ]);
  const dashboard = buildDashboard({ machines, network: { status: "live" }, history: [], demo: false }, { now });
  assert.equal(dashboard.machines.find((machine) => machine.machineId === "b").cpuPercent, 100);
  assert.equal(dashboard.machines.find((machine) => machine.machineId === "b").memoryPercent, 0);
  assert.equal(dashboard.codex.cpuPercent, 86);
  assert.equal(dashboard.codex.cpuReportedMachineCount, 2);
  assert.equal(dashboard.codex.memoryPercent, 22);
  assert.equal(dashboard.codex.memoryReportedMachineCount, 2);
});

test("an expired machine is retired from the dashboard and aggregate", () => {
  const now = new Date("2026-07-25T00:10:00.000Z");
  const machines = new Map([
    ["live", normalizeSnapshot("live", { generatedAt: now, oneMinute: { tps: 20 } }, now)],
    ["expired", normalizeSnapshot("expired", { generatedAt: "2026-07-25T00:00:00.000Z", oneMinute: { tps: 999 } }, now)],
  ]);
  const dashboard = buildDashboard({ machines, network: { status: "live", updatedAt: now }, history: [], demo: false }, { now, liveAfterSeconds: 30, staleAfterSeconds: 300 });
  assert.equal(dashboard.codex.status, "live");
  assert.equal(dashboard.codex.oneMinuteTps, 20);
  assert.equal(dashboard.machines.length, 1);
});

test("a stale duplicate stays visible but is excluded from aggregate TPS", () => {
  const now = new Date("2026-07-25T00:01:00.000Z");
  const machines = new Map([
    ["live", normalizeSnapshot("live", { generatedAt: now, oneMinute: { tps: 20 } }, now)],
    ["stale", normalizeSnapshot("stale", { generatedAt: "2026-07-25T00:00:20.000Z", oneMinute: { tps: 999 } }, now)],
  ]);
  const dashboard = buildDashboard(
    { machines, network: { status: "live", updatedAt: now }, history: [], demo: false },
    { now, liveAfterSeconds: 30, staleAfterSeconds: 300 },
  );
  assert.equal(dashboard.machines.find((machine) => machine.machineId === "stale").status, "stale");
  assert.equal(dashboard.codex.oneMinuteTps, 20);
  assert.equal(dashboard.fleet.workingMachineCount, 1);
});

test("projects a host pet to waiting when its machine is stale", () => {
  const now = new Date("2026-07-25T00:01:00.000Z");
  const machines = new Map([
    ["stale", normalizeSnapshot("stale", {
      generatedAt: "2026-07-25T00:00:20.000Z",
      pet: { id: "ledger-owl", state: "running" },
    }, now)],
  ]);
  const dashboard = buildDashboard(
    { machines, network: { status: "live", updatedAt: now }, history: [], demo: false },
    { now, liveAfterSeconds: 30, staleAfterSeconds: 300 },
  );

  assert.equal(dashboard.machines[0].status, "stale");
  assert.equal(dashboard.machines[0].pet.state, "waiting");
});

test("network status ages from live to stale to error", () => {
  const network = { status: "live", updatedAt: "2026-07-25T00:00:00.000Z" };
  assert.equal(networkFreshness(network, new Date("2026-07-25T00:00:10.000Z"), 30, 300).status, "live");
  assert.equal(networkFreshness(network, new Date("2026-07-25T00:01:00.000Z"), 30, 300).status, "stale");
  assert.equal(networkFreshness(network, new Date("2026-07-25T00:06:00.000Z"), 30, 300).status, "error");
});

test("future generated timestamps are clamped to receipt time", () => {
  const receivedAt = new Date("2026-07-25T00:00:00.000Z");
  const snapshot = normalizeSnapshot("machine", { generatedAt: "2030-01-01T00:00:00.000Z" }, receivedAt);
  assert.equal(snapshot.generatedAt, receivedAt.toISOString());
});
