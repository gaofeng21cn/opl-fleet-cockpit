const SENSOR_DEFINITIONS = [
  ["network_download_mbps", "Network download", "Mbit/s", (status) => status.network.downloadMbps],
  ["network_upload_mbps", "Network upload", "Mbit/s", (status) => status.network.uploadMbps],
  ["opl_fleet_agent_1m", "OPL Fleet Agent 1 minute", "TPS", (status) => status.codex.oneMinuteTps],
  ["opl_fleet_agent_5m", "OPL Fleet Agent 5 minutes", "TPS", (status) => status.codex.fiveMinuteTps],
  ["active_sessions", "Active Codex sessions", null, (status) => status.codex.activeSessions],
  ["machine_count", "Reporting machines", null, (status) => status.codex.machineCount],
];

export class HomeAssistantBridge {
  constructor({ enabled, baseUrl, token, entityPrefix = "ambient_ops", timeoutMs = 5000 }) {
    this.requested = enabled;
    this.enabled = Boolean(enabled && baseUrl && token);
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.token = token || "";
    this.entityPrefix = sanitizeEntityPart(entityPrefix) || "ambient_ops";
    this.timeoutMs = timeoutMs;
    this.syncing = false;
    this.lastSuccessAt = null;
    this.lastAttemptAt = null;
    this.lastError = enabled && !this.enabled ? "HA is enabled but URL or token is missing" : null;
  }

  health() {
    return {
      requested: this.requested,
      enabled: this.enabled,
      syncing: this.syncing,
      lastSuccessAt: this.lastSuccessAt,
      lastAttemptAt: this.lastAttemptAt,
      error: this.lastError,
    };
  }

  async sync(dashboard) {
    if (!this.enabled || this.syncing) return false;
    this.syncing = true;
    this.lastAttemptAt = new Date().toISOString();
    try {
      const states = homeAssistantStates(dashboard, this.entityPrefix);
      const results = await Promise.allSettled(states.map((state) => this.writeState(state)));
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.syncing = false;
    }
  }

  async writeState({ entityId, state, attributes }) {
    const response = await fetch(`${this.baseUrl}/api/states/${entityId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: String(state), attributes }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Home Assistant returned HTTP ${response.status}`);
  }
}

export function homeAssistantStates(dashboard, prefix = "ambient_ops") {
  const safePrefix = sanitizeEntityPart(prefix) || "ambient_ops";
  const states = SENSOR_DEFINITIONS.map(([suffix, name, unit, read]) => ({
    entityId: `sensor.${safePrefix}_${suffix}`,
    state: finiteState(read(dashboard)),
    attributes: {
      friendly_name: name,
      ...(unit ? { unit_of_measurement: unit, state_class: "measurement" } : {}),
      generated_at: dashboard.generatedAt,
      source: "Ambient Ops",
    },
  }));
  states.push({
    entityId: `sensor.${safePrefix}_status`,
    state: dashboard.overallStatus,
    attributes: {
      friendly_name: "Ambient Ops status",
      network_status: dashboard.network.status,
      codex_status: dashboard.codex.status,
      demo: dashboard.demo,
      generated_at: dashboard.generatedAt,
      source: "Ambient Ops",
    },
  });
  return states;
}

function finiteState(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function sanitizeEntityPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}
