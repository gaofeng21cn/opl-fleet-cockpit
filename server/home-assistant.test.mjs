import test from "node:test";
import assert from "node:assert/strict";
import { homeAssistantStates } from "./home-assistant.mjs";

test("maps aggregate status to stable Home Assistant entities", () => {
  const states = homeAssistantStates({
    generatedAt: "2026-07-25T00:00:00.000Z",
    overallStatus: "live",
    demo: false,
    network: { status: "live", downloadMbps: 100, uploadMbps: 20 },
    codex: { status: "live", oneMinuteTps: 50, fiveMinuteTps: 45, activeSessions: 2, machineCount: 1 },
  }, "Home Ops");
  assert.equal(states.find((state) => state.entityId === "sensor.home_ops_opl_fleet_agent_1m").state, 50);
  assert.equal(states.find((state) => state.entityId === "sensor.home_ops_status").state, "live");
});
