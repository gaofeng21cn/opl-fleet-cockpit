import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateThroughput,
  countDynamicClients,
  counter64,
  createUnifiSnmpPoller,
  NetSnmpClient,
  parseInterfaceTable,
  selectInterfaces,
} from "./unifi-snmp.mjs";

const sample = (at, interfaces) => ({ sampledAt: new Date(at), interfaces });

test("decodes an unsigned 64-bit SNMP counter without precision loss", () => {
  assert.equal(counter64(Buffer.from("0020000000000001", "hex")), 9_007_199_254_740_993n);
});

test("selects WAN interfaces by index, name, or alias", () => {
  const current = sample("2026-07-25T00:00:00.000Z", [
    { index: 7, name: "eth7", alias: "WAN2" },
    { index: 8, name: "eth8", alias: "WAN" },
    { index: 9, name: "br0", alias: "LAN" },
  ]);
  assert.deepEqual(selectInterfaces(current, ["8", "WAN2"]).map((entry) => entry.index), [7, 8]);
});

test("keeps incomplete Counter64 rows available for selected-interface fallback", () => {
  const interfaces = parseInterfaceTable({
    3: { 1: Buffer.from("eth9"), 15: 1000 },
    23: {
      1: Buffer.from("eth7"),
      6: Buffer.from("0000000000000001", "hex"),
      10: Buffer.from("0000000000000002", "hex"),
      15: 1000,
    },
  });
  assert.deepEqual(interfaces, [
    {
      index: 3,
      name: "eth9",
      inOctets: null,
      outOctets: null,
      counterBits: null,
      speedMbps: 1000,
      alias: "",
    },
    {
      index: 23,
      name: "eth7",
      inOctets: 1n,
      outOctets: 2n,
      counterBits: 64,
      speedMbps: 1000,
      alias: "",
    },
  ]);
});

test("reads exact Counter32 values when selected Counter64 columns are absent", async () => {
  const session = {
    tableColumns: (_table, _columns, _repetitions, callback) => callback(null, {
      3: { 1: Buffer.from("eth9"), 15: 1000 },
      99: { 1: Buffer.from("veth99"), 15: 1000 },
    }),
    get: (oids, callback) => {
      assert.deepEqual(oids, [
        "1.3.6.1.2.1.2.2.1.10.3",
        "1.3.6.1.2.1.2.2.1.16.3",
      ]);
      callback(null, [
        { type: 65, value: 1234 },
        { type: 65, value: 5678 },
      ]);
    },
  };
  const client = new NetSnmpClient({ interfaces: ["eth9"] }, session);
  const result = await client.readInterfaces();
  assert.deepEqual(result.interfaces.map(({ index, inOctets, outOctets, counterBits }) => ({
    index,
    inOctets,
    outOctets,
    counterBits,
  })), [
    { index: 3, inOctets: 1234n, outOctets: 5678n, counterBits: 32 },
    { index: 99, inOctets: null, outOctets: null, counterBits: null },
  ]);
});

test("calculates aggregate dual-WAN throughput from Counter64 deltas", () => {
  const previous = sample("2026-07-25T00:00:00.000Z", [
    { index: 7, name: "eth7", alias: "WAN2", inOctets: 1000n, outOctets: 2000n },
    { index: 8, name: "eth8", alias: "WAN", inOctets: 3000n, outOctets: 4000n },
  ]);
  const current = sample("2026-07-25T00:00:02.000Z", [
    { index: 7, name: "eth7", alias: "WAN2", inOctets: 251_001_000n, outOctets: 25_002_000n },
    { index: 8, name: "eth8", alias: "WAN", inOctets: 253_003_000n, outOctets: 29_004_000n },
  ]);
  const result = calculateThroughput(previous, current, [7, 8]);
  assert.equal(result.downloadMbps, 2016);
  assert.equal(result.uploadMbps, 216);
  assert.equal(result.interfaces.length, 2);
});

test("counts unique dynamic clients on selected LAN interfaces", () => {
  const table = {
    "28.192.168.1.10": { 1: 28, 2: Buffer.from("001122334455", "hex"), 4: 3 },
    "28.192.168.1.11": { 1: 28, 2: Buffer.from("001122334455", "hex"), 4: 3 },
    "28.192.168.1.12": { 1: 28, 2: Buffer.from("aabbccddeeff", "hex"), 4: 3 },
    "29.192.168.2.10": { 1: 29, 2: Buffer.from("112233445566", "hex"), 4: 3 },
    "23.10.0.0.1": { 1: 23, 2: Buffer.from("deadbeef0001", "hex"), 4: 3 },
    "28.192.168.1.1": { 1: 28, 2: Buffer.from("deadbeef0002", "hex"), 4: 4 },
    "28.192.168.1.2": { 1: 28, 2: Buffer.alloc(6), 4: 3 },
  };

  assert.equal(countDynamicClients(table, [28, 29]), 3);
  assert.equal(countDynamicClients(table, [23]), 1);
  assert.equal(countDynamicClients(table, []), 0);
});

test("poller establishes a baseline before returning live data", async () => {
  const samples = [
    sample("2026-07-25T00:00:00.000Z", [
      { index: 8, name: "eth8", alias: "WAN", inOctets: 0n, outOctets: 0n },
    ]),
    sample("2026-07-25T00:00:01.000Z", [
      { index: 8, name: "eth8", alias: "WAN", inOctets: 125_000_000n, outOctets: 12_500_000n },
    ]),
  ];
  const client = { readInterfaces: async () => samples.shift() };
  const poll = createUnifiSnmpPoller({
    interfaces: ["eth8"],
    pollMs: 1,
  }, client);
  const result = await poll();
  assert.equal(result.source, "unifi-snmp-v3");
  assert.equal(result.downloadMbps, 1000);
  assert.equal(result.uploadMbps, 100);
});

test("poller adds optional LAN client count without changing WAN selection", async () => {
  const samples = [
    sample("2026-07-25T00:00:00.000Z", [
      { index: 8, name: "eth8", alias: "WAN", inOctets: 0n, outOctets: 0n },
      { index: 28, name: "br0", alias: "LAN", inOctets: 0n, outOctets: 0n },
    ]),
    sample("2026-07-25T00:00:01.000Z", [
      { index: 8, name: "eth8", alias: "WAN", inOctets: 125_000_000n, outOctets: 12_500_000n },
      { index: 28, name: "br0", alias: "LAN", inOctets: 0n, outOctets: 0n },
    ]),
  ];
  const client = {
    readInterfaces: async () => samples.shift(),
    readClientCount: async (indexes) => {
      assert.deepEqual(indexes, [28]);
      return 42;
    },
  };
  const poll = createUnifiSnmpPoller({
    interfaces: ["eth8"],
    clientInterfaces: ["br0"],
    pollMs: 1,
  }, client);

  const result = await poll();
  assert.equal(result.clients, 42);
  assert.equal(result.latencyMs, null);
  assert.equal(result.interfaces.length, 1);
  assert.equal(result.interfaces[0].index, 8);
});

test("poller smooths one-second counter updates across four output samples", async () => {
  const samples = Array.from({ length: 9 }, (_, index) => {
    const seconds = index * 0.25;
    const counterStep = Math.floor(seconds);
    return sample(new Date(Date.UTC(2026, 6, 25, 0, 0, 0, index * 250)), [
      {
        index: 8,
        name: "eth8",
        alias: "WAN",
        inOctets: BigInt(counterStep * 12_500_000),
        outOctets: BigInt(counterStep * 1_250_000),
      },
    ]);
  });
  const client = { readInterfaces: async () => samples.shift() };
  const poll = createUnifiSnmpPoller({
    interfaces: ["eth8"],
    pollMs: 1,
    rateWindowMs: 1000,
  }, client);

  const results = [];
  for (let index = 0; index < 8; index += 1) results.push(await poll());

  assert.deepEqual(results.slice(3).map(({ downloadMbps }) => downloadMbps), [100, 100, 100, 100, 100]);
  assert.deepEqual(results.slice(3).map(({ uploadMbps }) => uploadMbps), [10, 10, 10, 10, 10]);
});

test("two-second window bridges an irregular 1.5 second counter refresh", async () => {
  const samples = Array.from({ length: 13 }, (_, index) => {
    const counterStep = Math.floor(index / 6);
    return sample(new Date(Date.UTC(2026, 6, 25, 0, 0, 0, index * 250)), [
      {
        index: 8,
        name: "eth8",
        alias: "WAN",
        inOctets: BigInt(counterStep * 18_750_000),
        outOctets: BigInt(counterStep * 1_875_000),
      },
    ]);
  });
  const client = { readInterfaces: async () => samples.shift() };
  const poll = createUnifiSnmpPoller({
    interfaces: ["eth8"],
    pollMs: 1,
    rateWindowMs: 2000,
  }, client);

  const results = [];
  for (let index = 0; index < 12; index += 1) results.push(await poll());

  const settled = results.slice(5);
  assert.ok(settled.every(({ downloadMbps, uploadMbps }) => downloadMbps > 0 && uploadMbps > 0));
  assert.ok(Math.abs(average(settled.map(({ downloadMbps }) => downloadMbps)) - 100) < 10);
  assert.ok(Math.abs(average(settled.map(({ uploadMbps }) => uploadMbps)) - 10) < 1);
});

test("poller clears its baseline and closes the session after a read failure", async () => {
  const samples = [
    sample("2026-07-25T00:00:00.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 100n, outOctets: 50n },
    ]),
    new Error("temporary route failure"),
    sample("2026-07-25T00:00:02.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 200n, outOctets: 100n },
    ]),
    sample("2026-07-25T00:00:03.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 300n, outOctets: 150n },
    ]),
  ];
  let closed = false;
  const client = {
    readInterfaces: async () => {
      const next = samples.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    close: () => { closed = true; },
  };
  const poll = createUnifiSnmpPoller({
    interfaces: ["23"],
    pollMs: 1,
  }, client);

  await assert.rejects(poll(), /temporary route failure/);
  assert.equal(closed, true);
  const recovered = await poll();
  assert.equal(recovered.status, "live");
  assert.ok(recovered.downloadMbps > 0);
});

test("poller does not calculate across a failed baseline", async () => {
  const samples = [
    new Error("temporary route failure"),
    sample("2026-07-25T00:00:02.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 200n, outOctets: 100n },
    ]),
    sample("2026-07-25T00:00:03.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 300n, outOctets: 150n },
    ]),
  ];
  let closed = false;
  const client = {
    readInterfaces: async () => {
      const next = samples.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    close: () => { closed = true; },
  };
  const poll = createUnifiSnmpPoller({
    interfaces: ["23"],
    pollMs: 1,
  }, client);

  await assert.rejects(poll(), /temporary route failure/);
  assert.equal(closed, true);
  const recovered = await poll();
  assert.equal(recovered.status, "live");
  assert.ok(recovered.downloadMbps > 0);
});

test("poller rebuilds its baseline after a Counter64 reset", async () => {
  const samples = [
    sample("2026-07-25T00:00:00.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 900n, outOctets: 900n },
    ]),
    sample("2026-07-25T00:00:01.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 100n, outOctets: 100n },
    ]),
    sample("2026-07-25T00:00:02.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 200n, outOctets: 200n },
    ]),
    sample("2026-07-25T00:00:03.000Z", [
      { index: 23, name: "eth7", alias: "WAN", inOctets: 300n, outOctets: 300n },
    ]),
  ];
  const client = { readInterfaces: async () => samples.shift() };
  const poll = createUnifiSnmpPoller({
    interfaces: ["23"],
    pollMs: 1,
  }, client);

  const recovered = await poll();
  assert.equal(recovered.status, "live");
  assert.ok(recovered.downloadMbps > 0);
});

test("calculates a Counter32 wrap without treating it as an interface reset", () => {
  const previous = sample("2026-07-25T00:00:00.000Z", [
    {
      index: 3,
      name: "eth9",
      alias: "WAN",
      inOctets: 0xffff_ff00n,
      outOctets: 0xffff_ff80n,
      counterBits: 32,
    },
  ]);
  const current = sample("2026-07-25T00:00:01.000Z", [
    {
      index: 3,
      name: "eth9",
      alias: "WAN",
      inOctets: 0x100n,
      outOctets: 0x80n,
      counterBits: 32,
    },
  ]);
  const result = calculateThroughput(previous, current, [3]);
  assert.equal(result.downloadMbps, 0.004096);
  assert.equal(result.uploadMbps, 0.002048);
});

test("treats an implausible Counter32 decrease as an interface reset", () => {
  const previous = sample("2026-07-25T00:00:00.000Z", [
    {
      index: 3,
      name: "eth9",
      alias: "WAN",
      inOctets: 3_000_000_000n,
      outOctets: 3_000_000_000n,
      counterBits: 32,
      speedMbps: 1000,
    },
  ]);
  const current = sample("2026-07-25T00:00:01.000Z", [
    {
      index: 3,
      name: "eth9",
      alias: "WAN",
      inOctets: 10n,
      outOctets: 10n,
      counterBits: 32,
      speedMbps: 1000,
    },
  ]);
  assert.throws(
    () => calculateThroughput(previous, current, [3]),
    (error) => error.code === "SNMP_COUNTER_RESET" && /Counter32 decreased/.test(error.message),
  );
});

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
