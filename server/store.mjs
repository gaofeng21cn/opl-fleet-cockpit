import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appendHistorySample,
  STATUS_HISTORY_RETENTION_MS,
  STATUS_HISTORY_SAMPLE_MS,
} from "../src/status-history.mjs";

export class StatusStore {
  constructor(dataDir, { networkPersistIntervalMs = 5000, persistIntervalMs = 0 } = {}) {
    this.dataDir = dataDir;
    this.path = join(dataDir, "state.json");
    this.machines = new Map();
    this.machineHistory = new Map();
    this.machineNetworkHistory = new Map();
    this.fleetHistory = [];
    this.network = { status: "error", source: "unconfigured", error: "UniFi is not configured" };
    this.networkHistory = [];
    this.persistChain = Promise.resolve();
    this.persistSequence = 0;
    this.persistIntervalMs = Math.max(0, Number(persistIntervalMs) || 0);
    this.networkPersistIntervalMs = Math.max(1, Number(networkPersistIntervalMs) || 5000);
    this.persistTimer = null;
    this.dirty = false;
  }

  async load() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.path, "utf8"));
      this.machines = new Map((saved.machines || []).map((machine) => [machine.machineId, machine]));
      this.machineHistory = new Map(
        Object.entries(saved.machineHistory || {}).map(([machineId, history]) => [
          machineId,
          Array.isArray(history) ? history.slice(-1_000) : [],
        ]),
      );
      this.machineNetworkHistory = new Map(
        Object.entries(saved.machineNetworkHistory || {}).map(([machineId, history]) => [
          machineId,
          Array.isArray(history) ? history.slice(-1_000) : [],
        ]),
      );
      this.fleetHistory = Array.isArray(saved.fleetHistory) ? saved.fleetHistory.slice(-1_000) : [];
      this.network = saved.network || this.network;
      this.networkHistory = (saved.networkHistory || []).slice(-300);
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Unable to load persisted state:", error.message);
    }
  }

  setMachine(snapshot) {
    const isNewMachine = !this.machines.has(snapshot.machineId);
    this.machines.set(snapshot.machineId, snapshot);
    this.recordMachineHistory(snapshot);
    return isNewMachine ? this.persist() : this.requestPersist();
  }

  async removeMachine(machineId) {
    if (!this.machines.delete(machineId)) return false;
    this.machineHistory.delete(machineId);
    this.machineNetworkHistory.delete(machineId);
    await this.persist();
    return true;
  }

  async pruneMachines(before) {
    const cutoff = before.valueOf();
    const removed = [];
    for (const [machineId, snapshot] of this.machines) {
      const receivedAt = new Date(snapshot.receivedAt || snapshot.generatedAt).valueOf();
      if (!Number.isFinite(receivedAt) || receivedAt < cutoff) {
        this.machines.delete(machineId);
        this.machineHistory.delete(machineId);
        this.machineNetworkHistory.delete(machineId);
        removed.push(machineId);
      }
    }
    if (removed.length) await this.persist();
    return removed;
  }

  setNetwork(network, { recordHistory = true } = {}) {
    this.network = network;
    if (recordHistory && Number.isFinite(network.downloadMbps) && Number.isFinite(network.uploadMbps)) {
      this.networkHistory.push({
        at: network.updatedAt,
        downloadMbps: network.downloadMbps,
        uploadMbps: network.uploadMbps,
      });
      this.networkHistory = this.networkHistory.slice(-300);
    }
    this.dirty = true;
    this.schedulePersist(this.persistIntervalMs || this.networkPersistIntervalMs);
    return this.persistChain;
  }

  requestPersist() {
    if (this.persistIntervalMs <= 0) return this.persist();
    this.dirty = true;
    this.schedulePersist(this.persistIntervalMs);
    return this.persistChain;
  }

  async persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.dirty = false;
    const body = JSON.stringify({
      machines: [...this.machines.values()],
      machineHistory: Object.fromEntries(this.machineHistory),
      machineNetworkHistory: Object.fromEntries(this.machineNetworkHistory),
      fleetHistory: this.fleetHistory,
      network: this.network,
      networkHistory: this.networkHistory,
    });
    const sequence = ++this.persistSequence;
    this.persistChain = this.persistChain.catch(() => undefined).then(async () => {
      const temporary = `${this.path}.${process.pid}.${sequence}.tmp`;
      try {
        await writeFile(temporary, body, { mode: 0o600 });
        await rename(temporary, this.path);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    return this.persistChain;
  }

  flush() {
    return this.dirty ? this.persist() : this.persistChain;
  }

  schedulePersist(delayMs = this.networkPersistIntervalMs) {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (!this.dirty) return;
      this.persist().catch((error) => {
        this.dirty = true;
        console.error("Failed to persist gateway state:", error?.message || error);
      });
    }, Math.max(1, Number(delayMs) || this.networkPersistIntervalMs));
    this.persistTimer.unref?.();
  }

  recordMachineHistory(snapshot) {
    const history = appendHistorySample(
      this.machineHistory.get(snapshot.machineId),
      {
        at: snapshot.generatedAt,
        tps: snapshot.oneMinute?.tps,
      },
    );
    this.machineHistory.set(snapshot.machineId, history);
    if (snapshot.network) {
      const networkHistory = appendNetworkHistorySample(
        this.machineNetworkHistory.get(snapshot.machineId),
        {
          at: snapshot.network.updatedAt || snapshot.generatedAt,
          downloadMbps: snapshot.network.downloadMbps,
          uploadMbps: snapshot.network.uploadMbps,
        },
      );
      this.machineNetworkHistory.set(snapshot.machineId, networkHistory);
    }
  }

  recordFleetHistory(sample) {
    this.fleetHistory = appendHistorySample(this.fleetHistory, sample, { sampleIntervalMs: 10_000 });
    return this.requestPersist();
  }
}

function appendNetworkHistorySample(history, sample) {
  const sampleAt = new Date(sample?.at).valueOf();
  if (!Number.isFinite(sampleAt)) return Array.isArray(history) ? history : [];
  const cutoff = sampleAt - STATUS_HISTORY_RETENTION_MS;
  const retained = (Array.isArray(history) ? history : []).filter((entry) => {
    const at = new Date(entry?.at).valueOf();
    return Number.isFinite(at) && at >= cutoff && at <= sampleAt;
  });
  const normalized = {
    at: new Date(sampleAt).toISOString(),
    downloadMbps: Math.max(0, Number(sample?.downloadMbps) || 0),
    uploadMbps: Math.max(0, Number(sample?.uploadMbps) || 0),
  };
  const last = retained.at(-1);
  if (!last) return [normalized];
  const lastAt = new Date(last.at).valueOf();
  if (sampleAt < lastAt) return retained;
  if (sampleAt - lastAt < STATUS_HISTORY_SAMPLE_MS) {
    return [...retained.slice(0, -1), { ...normalized, at: last.at }];
  }
  return [...retained, normalized].slice(-1_000);
}
