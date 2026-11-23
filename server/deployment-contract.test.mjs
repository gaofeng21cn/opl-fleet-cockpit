import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function renderCompose(files) {
  const result = spawnSync(
    "docker",
    ["compose", ...files.flatMap((file) => ["-f", file]), "config", "--format", "json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.error?.code === "ENOENT") return null;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("production Compose is self-contained for DSM single-file projects", async (t) => {
  const config = renderCompose(["compose.yaml"]);
  if (!config) {
    t.skip("Docker Compose is not installed");
    return;
  }

  const service = config.services?.gateway;
  assert.ok(service);
  assert.equal(service.network_mode, "host");
  assert.equal(service.environment.DISCOVERY_ENABLED, "true");
  assert.equal(service.ports, undefined);
  assert.equal(service.build, undefined);
  assert.match(service.image, /^ghcr\.io\/gaofeng21cn\/opl-fleet-cockpit:(?!latest$)[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(config.volumes?.cockpit_data?.name, "opl-fleet-cockpit_data");
});

test("local build overlay explicitly switches away from host networking", async () => {
  const compose = await readFile(join(repoRoot, "compose.local-build.yaml"), "utf8");
  assert.match(compose, /network_mode:\s*bridge/);
  assert.match(compose, /DISCOVERY_ENABLED:\s*["']?false/);
  assert.match(compose, /ports:/);
});
