import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatusStore } from "./store.mjs";

test("prunes inactive machines from memory and persisted state", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ambient-ops-store-"));
  try {
    const store = new StatusStore(dataDir, { networkPersistIntervalMs: 1 });
    await store.load();
    await store.setMachine(machine("old", "2026-07-25T00:00:00.000Z"));
    await store.setMachine(machine("live", "2026-07-25T00:10:00.000Z"));

    const removed = await store.pruneMachines(new Date("2026-07-25T00:05:00.000Z"));

    assert.deepEqual(removed, ["old"]);
    assert.deepEqual([...store.machines.keys()], ["live"]);
    const saved = JSON.parse(await readFile(store.path, "utf8"));
    assert.deepEqual(saved.machines.map((entry) => entry.machineId), ["live"]);
    assert.equal(saved.machineHistory.old, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("persists bounded per-machine TPS history across restarts", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ambient-ops-store-"));
  try {
    const store = new StatusStore(dataDir);
    await store.load();
    await store.setMachine(machine("live", "2026-07-25T00:00:00.000Z", 10));
    await store.setMachine(machine("live", "2026-07-25T00:00:01.000Z", 20));
    await store.setMachine(machine("live", "2026-07-25T00:00:05.000Z", 30));

    const reloaded = new StatusStore(dataDir);
    await reloaded.load();

    assert.deepEqual(reloaded.machineHistory.get("live"), [
      { at: "2026-07-25T00:00:00.000Z", tps: 20 },
      { at: "2026-07-25T00:00:05.000Z", tps: 30 },
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("persists fleet TPS and per-machine network history across restarts", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ambient-ops-store-"));
  try {
    const store = new StatusStore(dataDir);
    await store.load();
    await store.setMachine({
      ...machine("live", "2026-07-25T00:00:00.000Z", 10),
      network: {
        source: "host",
        updatedAt: "2026-07-25T00:00:00.000Z",
        downloadMbps: 100,
        uploadMbps: 20,
      },
    });
    await store.recordFleetHistory({ at: "2026-07-25T00:00:00.000Z", tps: 10 });
    await store.recordFleetHistory({ at: "2026-07-25T00:00:10.000Z", tps: 20 });

    const reloaded = new StatusStore(dataDir);
    await reloaded.load();

    assert.deepEqual(reloaded.fleetHistory, [
      { at: "2026-07-25T00:00:00.000Z", tps: 10 },
      { at: "2026-07-25T00:00:10.000Z", tps: 20 },
    ]);
    assert.deepEqual(reloaded.machineNetworkHistory.get("live"), [{
      at: "2026-07-25T00:00:00.000Z",
      downloadMbps: 100,
      uploadMbps: 20,
    }]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("loads legacy machine state whose bundled pet has no asset hash", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ambient-ops-store-"));
  try {
    await writeFile(join(dataDir, "state.json"), JSON.stringify({
      machines: [{
        ...machine("old-mac", "2026-07-25T00:00:00.000Z"),
        pet: {
          id: "ledger-owl",
          displayName: "Ledger Owl",
          spriteVersionNumber: 1,
          state: "idle",
          stateSince: "2026-07-25T00:00:00.000Z",
        },
      }],
    }));
    const store = new StatusStore(dataDir);

    await store.load();

    assert.equal(store.machines.get("old-mac").pet.id, "ledger-owl");
    assert.equal(store.machines.get("old-mac").pet.assetHash, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("coalesces frequent updates when persistIntervalMs is configured", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ambient-ops-store-"));
  try {
    const store = new StatusStore(dataDir, { persistIntervalMs: 500, networkPersistIntervalMs: 500 });
    await store.load();
    await store.setMachine(machine("live", "2026-07-25T00:00:00.000Z", 10));
    assert.equal(store.persistSequence, 1);

    await store.setMachine(machine("live", "2026-07-25T00:00:05.000Z", 12));
    await store.recordFleetHistory({ at: "2026-07-25T00:00:05.000Z", tps: 12 });
    await store.setNetwork({
      status: "live",
      source: "unifi-snmp-v3",
      downloadMbps: 50,
      uploadMbps: 10,
      updatedAt: "2026-07-25T00:00:05.000Z",
    });

    assert.equal(store.persistSequence, 1);
    await store.flush();
    assert.equal(store.persistSequence, 2);

    const savedText = await readFile(store.path, "utf8");
    assert.equal(savedText.includes("\n"), false);
    const reloaded = new StatusStore(dataDir);
    await reloaded.load();
    assert.equal(reloaded.machines.get("live").oneMinute.tps, 12);
    assert.equal(reloaded.fleetHistory.length, 1);
    assert.equal(reloaded.network.downloadMbps, 50);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("cleans up temporary file and prevents unhandled rejection on scheduled persist error", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ambient-ops-store-"));
  try {
    const store = new StatusStore(dataDir, { persistIntervalMs: 10, networkPersistIntervalMs: 10 });
    store.path = join(dataDir, "missing-dir", "state.json");
    await store.setNetwork({
      status: "live",
      source: "unifi-snmp-v3",
      downloadMbps: 5,
      uploadMbps: 1,
      updatedAt: "2026-07-25T00:00:00.000Z",
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(store.dirty, true);
    assert.deepEqual(await readdir(dataDir), []);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function machine(machineId, receivedAt, tps = 0) {
  return {
    machineId,
    machineName: machineId,
    generatedAt: receivedAt,
    receivedAt,
    reportedStatus: "live",
    oneMinute: { tps },
    fiveMinutes: {},
    activeSessions: 0,
  };
}
