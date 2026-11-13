import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import test from "node:test";
import { Bonjour } from "bonjour-service";
import { createDiscoveryPublisher } from "./discovery.mjs";

test("answers multicast address queries after the startup announcement on Linux", {
  skip: process.platform !== "linux",
}, async (t) => {
  const address = Object.values(networkInterfaces()).flat().find((entry) =>
    entry.family === "IPv4" && !entry.internal)?.address;
  assert.ok(address, "a multicast-capable IPv4 interface is required");
  const host = `gateway-discovery-test-${process.pid}.local`;
  const observer = new Bonjour({ bind: "0.0.0.0", interface: address });
  const publisher = createDiscoveryPublisher({
    instanceId: `discovery-test-${process.pid}`,
    name: `Gateway Discovery Test ${process.pid}`,
    host,
    port: 8787,
    interfaceAddress: address,
  });
  t.after(async () => {
    await publisher.stop();
    await new Promise((resolve) => observer.destroy(resolve));
  });

  const announced = waitForResponse(observer.server.mdns, (packet) =>
    packet.answers.some((record) => record.type === "SRV" && record.data.target === host));
  publisher.start();
  await announced;

  // Only a solicited A response qualifies; a cached startup announcement has
  // PTR/SRV/TXT records as well and cannot make this regression test pass.
  const response = waitForResponse(observer.server.mdns, (packet) =>
    packet.answers.length === 1
      && packet.answers[0].type === "A"
      && packet.answers[0].name === host);
  observer.server.mdns.query(host, "A");
  assert.equal((await response).answers[0].data, address);
});

function waitForResponse(mdns, matches) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mdns.removeListener("response", onResponse);
      reject(new Error("Gateway did not answer the multicast DNS query"));
    }, 5000);
    function onResponse(packet) {
      if (!matches(packet)) return;
      clearTimeout(timer);
      mdns.removeListener("response", onResponse);
      resolve(packet);
    }
    mdns.on("response", onResponse);
  });
}
