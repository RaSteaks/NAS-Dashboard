import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaults,
  mergeConfig,
  saveSettings,
  validateApi,
} from "../site/js/core/config.js";
import {
  MihomoMonitor,
  fetchMihomoSnapshot,
  hasMihomoData,
  normalizeMihomo,
  normalizeConnections,
} from "../site/js/core/mihomo.js";
import { MihomoUsage, aggregateUsage } from "../site/js/core/mihomo-usage.js";
import { Poller } from "../site/js/core/poller.js";
import {
  proxyMihomoSnapshot,
  validMihomoServer,
} from "../scripts/mihomo-proxy.mjs";
import { requiredPlugins } from "../site/js/widgets/index.js";

/** @typedef {import("../site/js/core/types.js").MihomoSnapshot} MihomoSnapshot */

/** @param {number} up @param {number} down @param {number} [at=100000] @returns {MihomoSnapshot} */
function sample(up, down, at = 100000) {
  return {
    data: {
      connections: { count: 0, uploadTotal: up, downloadTotal: down },
      memory: { inuse: 100 },
      version: { version: "v1.test", meta: true },
    },
    errors: {},
    collectedAt: at,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mihomo configuration and transport", () => {
  it("keeps old defaults and strips credentials from imported or saved settings", () => {
    expect(defaults.widgets).not.toContain("mihomo");
    expect(
      mergeConfig({ api: { mode: "direct", url: "http://nas.test/api/4" } })
        .mihomo,
    ).toEqual({ url: "./api/mihomo.php" });
    const config = mergeConfig({
      widgets: ["mihomo"],
      mihomo: { url: "./api/mihomo.php", secret: "private" },
    });
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    expect(saveSettings(config)).toBe(true);
    expect(setItem.mock.calls[0][1]).not.toContain("private");
    expect(config.mihomo).toEqual({ url: "./api/mihomo.php" });
    expect(requiredPlugins(["mihomo"])).not.toContain("mihomo");
  });

  it("accepts subpath proxies but rejects external origins, credentials and query tokens", () => {
    const page = "https://nas.test/dashboard/";
    expect(
      validateApi({ mode: "proxy", url: "./api/mihomo.php" }, page),
    ).toBeNull();
    for (const url of [
      "https://other.test/api",
      "http://nas.test/api",
      "https://a:b@nas.test/api",
      "./api?secret=x",
    ])
      expect(validateApi({ mode: "proxy", url }, page)).not.toBeNull();
  });

  it("fetches only the public same-origin summary and uses browser freshness", async () => {
    vi.stubGlobal("location", { href: "https://nas.test/dashboard/" });
    const fetcher = vi.fn(
      /** @param {string|URL} _url @param {RequestInit} _options */
      async (_url, _options) =>
        new Response(JSON.stringify(sample(100, 200, 0)), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const next = await fetchMihomoSnapshot(
      defaults,
      new AbortController().signal,
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://nas.test/dashboard/api/mihomo.php",
    );
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("headers");
    expect(next.collectedAt).toBeGreaterThan(0);
    expect(normalizeMihomo(next).connections).toBe(0);
  });

  it.each([
    ["text/plain", "<?php source", "JSON"],
    ["application/json", '{"data":[],"errors":{}}', "格式"],
    ["application/json", '{"data":{},"errors":{"memory":12}}', "格式"],
  ])("rejects malformed summaries (%s)", async (type, body, message) => {
    vi.stubGlobal("location", { href: "http://nas.test/" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(body, { headers: { "Content-Type": type } }),
      ),
    );
    await expect(
      fetchMihomoSnapshot(defaults, new AbortController().signal),
    ).rejects.toThrow(message);
  });

  it("isolates missing and failed endpoints", async () => {
    vi.stubGlobal("location", { href: "http://nas.test/" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { connections: { count: 0 } },
              errors: { memory: "认证失败" },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const next = await fetchMihomoSnapshot(
      defaults,
      new AbortController().signal,
    );
    expect(next.errors.memory).toBe("认证失败");
    expect(next.errors.version).toContain("未提供");
    expect(hasMihomoData(next)).toBe(true);
  });
});

describe("mihomo rate samples", () => {
  it("does not extend its sample window when Glances has a long interval", () => {
    const monitor = new MihomoMonitor({ ...defaults, refreshSeconds: 60 });
    monitor.receive(sample(100, 200), 0);
    monitor.receive(sample(1000, 2000, 116000), 16000);
    // Live-source gaps remain unknown even while Glances waits another minute.
    expect(monitor.state.metrics.down).toBeNull();
    expect(monitor.state.history.at(-2)).toMatchObject({
      timestamp: 115999,
      rx: null,
      tx: null,
    });
    monitor.receive(sample(1100, 2200, 117000), 17000);
    expect(monitor.state.metrics.down).toBe(200);
  });

  it("uses actual elapsed seconds and keeps first or unknown readings empty", () => {
    const monitor = new MihomoMonitor(defaults);
    monitor.receive(sample(100, 200), 1000);
    expect(monitor.state.metrics.up).toBeNull();
    monitor.receive(sample(1500, 3000, 107000), 8000);
    expect(monitor.state.metrics.up).toBe(200);
    expect(monitor.state.metrics.down).toBe(400);
    expect(monitor.state.metrics.connections).toBe(0);
    expect(
      normalizeMihomo({
        data: { connections: { count: "0", uploadTotal: -1 }, memory: {} },
        errors: {},
        collectedAt: 0,
      }),
    ).toMatchObject({
      connections: null,
      uploadTotal: null,
      downloadTotal: null,
      memory: null,
    });
  });

  it("preserves measured zero traffic and rejects counter resets", () => {
    const monitor = new MihomoMonitor(defaults);
    monitor.receive(sample(100, 200), 0);
    monitor.receive(sample(100, 200, 105000), 5000);
    expect(monitor.state.metrics.up).toBe(0);
    monitor.receive(sample(1, 300, 110000), 10000);
    expect(monitor.state.metrics.up).toBeNull();
    expect(monitor.state.metrics.down).toBeNull();
    monitor.receive(sample(101, 400, 115000), 15000);
    expect(monitor.state.metrics.up).toBe(20);
  });

  it("retains failed endpoint values but never bridges failed or paused rate samples", () => {
    const monitor = new MihomoMonitor(defaults);
    monitor.receive(sample(100, 200), 0);
    monitor.receive(
      {
        data: { memory: { inuse: 200 } },
        errors: { connections: "offline" },
        collectedAt: 105000,
      },
      5000,
    );
    expect(monitor.state.metrics).toMatchObject({
      uploadTotal: 100,
      memory: 200,
      up: null,
    });
    expect(monitor.state.connection).toBe("partial");
    monitor.receive(sample(300, 400, 110000), 10000);
    expect(monitor.state.metrics.up).toBeNull();
    monitor.receive(sample(400, 500, 115000), 15000);
    expect(monitor.state.metrics.up).toBe(20);
    monitor.resetBaseline();
    monitor.receive(sample(500, 600, 120000), 20000);
    expect(monitor.state.metrics.up).toBeNull();
  });

  it("marks long gaps and bounds history without borrowing NAS telemetry", () => {
    const monitor = new MihomoMonitor({ ...defaults, historyMinutes: 1 });
    monitor.receive(sample(100, 200), 0);
    monitor.receive(sample(1000, 2000, 170000), 70000);
    expect(monitor.state.metrics.down).toBeNull();
    expect(monitor.state.history).toHaveLength(2);
    expect(monitor.state.history[0]).toMatchObject({
      timestamp: 169999,
      rx: null,
      tx: null,
    });
    expect(
      monitor.state.history.every(
        // The new memory trend contains mihomo bytes, never NAS percentages.
        (point) =>
          point.cpu === null && (point.memory === null || point.memory === 100),
      ),
    ).toBe(true);
    monitor.receive(sample(1100, 2200, 175000), 75000);
    expect(monitor.state.metrics.down).toBe(40);
  });

  it("does not treat version metadata as successful monitoring", () => {
    const next = {
      data: { version: { version: "v1" } },
      errors: {},
      collectedAt: 1000,
    };
    expect(hasMihomoData(next)).toBe(false);
    const monitor = new MihomoMonitor(defaults);
    monitor.receive(next);
    expect(monitor.state.connection).toBe("offline");
    expect(monitor.state.lastSuccess).toBe(0);
  });

  it("keeps each source's backoff and abort independent", async () => {
    vi.useFakeTimers();
    const glancesFetch = vi.fn(async () => ({ data: { cpu: { total: 1 } } }));
    const mihomoFetch = vi.fn(async () => ({
      data: { version: { version: "v1" } },
      errors: {},
      collectedAt: 0,
    }));
    const first = new Poller({
      intervalMs: 5000,
      fetch: glancesFetch,
      hasData: () => true,
      onData: vi.fn(),
      onError: vi.fn(),
      onBusy: vi.fn(),
    });
    const second = new Poller({
      intervalMs: 5000,
      fetch: mihomoFetch,
      hasData: hasMihomoData,
      onData: vi.fn(),
      onError: vi.fn(),
      onBusy: vi.fn(),
    });
    first.start();
    second.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(glancesFetch).toHaveBeenCalledTimes(2);
    expect(mihomoFetch).toHaveBeenCalledTimes(1);
    second.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(glancesFetch).toHaveBeenCalledTimes(3);
    expect(mihomoFetch).toHaveBeenCalledTimes(1);
    first.stop();
  });
});

describe("preview mihomo proxy", () => {
  it("filters sensitive fields and stops memory after the second frame across chunks", async () => {
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const fetcher = vi.fn(async (url, options) => {
      expect(options.headers.Authorization).toBe("Bearer fixture-secret");
      expect(options.redirect).toBe("manual");
      if (url.endsWith("/memory"))
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"inuse":0}\n{"in'));
              controller.enqueue(encoder.encode('use":123,"oslimit":0}\n'));
              // Remain open to prove the reader does not await EOF.
            },
            cancel,
          }),
        );
      return new Response(
        JSON.stringify(
          url.endsWith("/connections")
            ? {
                connections: [
                  {
                    id: "c1",
                    metadata: {
                      host: "allowed.example",
                      private: "private-target",
                    },
                  },
                ],
                uploadTotal: 1,
                downloadTotal: 2,
                secret: "fixture-secret",
              }
            : { version: "v1", meta: true, private: "hidden" },
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const next = await proxyMihomoSnapshot(
      "http://127.0.0.1:9090/",
      "fixture-secret",
      new AbortController().signal,
    );
    expect(next.errors).toEqual({});
    expect(next.data.memory).toEqual({ inuse: 123 });
    expect(next.data.connections).toEqual({
      count: 1,
      uploadTotal: 1,
      downloadTotal: 2,
      items: [
        {
          id: "c1",
          upload: null,
          download: null,
          start: "",
          rule: "",
          rulePayload: "",
          chains: [],
          network: "",
          type: "",
          sourceIP: "",
          sourcePort: "",
          destinationIP: "",
          destinationPort: "",
          host: "allowed.example",
          process: "",
          processPath: "",
          inboundName: "",
        },
      ],
      truncated: false,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(next)).not.toContain("private-target");
    expect(JSON.stringify(next)).not.toContain("fixture-secret");
  });

  it("distinguishes null connection slices from absent fields and rejects invalid config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        url.endsWith("/memory")
          ? new Response('{"inuse":0}\n{"inuse":1}\n')
          : new Response(
              url.endsWith("/connections")
                ? '{"connections":null}'
                : '{"version":"v1"}',
            ),
      ),
    );
    const next = await proxyMihomoSnapshot(
      "http://localhost:9090",
      "",
      new AbortController().signal,
    );
    expect(next.data.connections).toEqual({
      count: 0,
      uploadTotal: null,
      downloadTotal: null,
      items: [],
      truncated: false,
    });
    expect(validMihomoServer("http://localhost:9090", "")).toBe(true);
    expect(validMihomoServer("http://a:b@localhost:9090", "")).toBe(false);
    expect(validMihomoServer("http://localhost:9090?x=1", "")).toBe(false);
    expect(validMihomoServer("http://localhost:9090", "x\r\ny")).toBe(false);
  });

  it("isolates unauthorized, oversized and incomplete stream responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        url.endsWith("/memory")
          ? new Response('{"inuse":0}\n')
          : url.endsWith("/connections")
            ? new Response("x".repeat(2 * 1024 * 1024 + 1))
            : new Response("denied", { status: 401 }),
      ),
    );
    const next = await proxyMihomoSnapshot(
      "http://localhost:9090",
      "",
      new AbortController().signal,
    );
    expect(next.data).toEqual({});
    expect(next.errors.memory).toContain("完整内存采样");
    expect(next.errors.connections).toContain("大小限制");
    expect(next.errors.version).toContain("Secret");
  });
});

/** @param {string} id @param {number} upload @param {number} download */
function connection(id, upload, download) {
  return {
    id,
    upload,
    download,
    start: new Date(1000).toISOString(),
    host: `${id}.example`,
    sourceIP: "192.0.2.10",
    network: "TCP",
    process: "browser",
    chains: ["node", "group"],
    rule: "DomainSuffix",
    rulePayload: "example",
  };
}

/** @param {unknown[]} items @param {number} at @param {boolean} [truncated=false] @returns {MihomoSnapshot} */
function detailed(items, at, truncated = false) {
  return {
    data: {
      connections: {
        count: items.length + (truncated ? 1 : 0),
        items,
        truncated,
        uploadTotal: at,
        downloadTotal: at * 2,
      },
      memory: { inuse: 100 },
      version: { version: "fixture" },
    },
    errors: {},
    collectedAt: at,
  };
}

describe("detailed mihomo observations", () => {
  it("normalizes only known fields, deduplicates IDs and bounds connection details", () => {
    const result = normalizeConnections([
      {
        ...connection("c1", 100, 200),
        secret: "private",
        process: "",
        processPath: "/bin/browser",
        network: "tcp",
      },
      connection("c1", 400, 800),
      {},
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      process: "browser",
      network: "TCP",
      start: 1000,
      up: null,
      down: null,
    });
    expect(result[0]).not.toHaveProperty("secret");
    expect(
      normalizeConnections(
        Array.from({ length: 501 }, (_, index) =>
          connection(`c${index}`, 0, 0),
        ),
      ),
    ).toHaveLength(500);
  });

  it("uses first observations as baselines and counts measured deltas exactly once", () => {
    const monitor = new MihomoMonitor(defaults);
    monitor.receive(detailed([connection("c1", 1000, 2000)], 100000), 0);
    expect(monitor.state.usageRecords).toEqual([]);
    expect(monitor.state.usageHasSamples).toBe(false);
    monitor.receive(detailed([connection("c1", 1100, 2400)], 105000), 5000);
    expect(monitor.state.activeConnections[0]).toMatchObject({
      up: 20,
      down: 80,
    });
    expect(aggregateUsage(monitor.state.usageRecords, "sourceIP")).toEqual([
      { label: "192.0.2.10", upload: 100, download: 400, total: 500 },
    ]);
    monitor.receive(detailed([connection("c1", 1100, 2400)], 110000), 10000);
    expect(aggregateUsage(monitor.state.usageRecords, "host")[0].total).toBe(
      500,
    );
    expect(monitor.state.activeConnections[0].up).toBe(0);
  });

  it("keeps full-session usage when the short overview history expires", () => {
    const monitor = new MihomoMonitor({ ...defaults, historyMinutes: 1 });
    monitor.receive(detailed([connection("c1", 100, 200)], 100000), 0);
    monitor.receive(detailed([connection("c1", 200, 500)], 105000), 5000);
    monitor.resetBaseline();
    monitor.receive(detailed([connection("c1", 900, 1900)], 200000), 100000);
    monitor.receive(detailed([connection("c1", 1000, 2200)], 205000), 105000);
    expect(
      monitor.state.history.every((point) => point.timestamp >= 145000),
    ).toBe(true);
    expect(
      aggregateUsage(monitor.state.usageRecords, "outbound")[0],
    ).toMatchObject({ upload: 200, download: 600, total: 800 });
    expect(monitor.state.usageStartedAt).toBe(100000);
  });

  it("does not fabricate usage or ended connections across failures and truncated lists", () => {
    const monitor = new MihomoMonitor(defaults);
    monitor.receive(
      detailed([connection("a", 100, 100), connection("b", 100, 100)], 100000),
      0,
    );
    monitor.receive(detailed([connection("a", 200, 200)], 105000, true), 5000);
    expect(monitor.state.closedConnections).toEqual([]);
    const previousUsage = aggregateUsage(
      monitor.state.usageRecords,
      "process",
    )[0].total;
    monitor.receive(
      { data: {}, errors: { connections: "offline" }, collectedAt: 110000 },
      10000,
    );
    monitor.receive(detailed([connection("a", 1000, 1000)], 115000), 15000);
    expect(monitor.state.closedConnections).toEqual([]);
    expect(monitor.state.activeConnections[0].up).toBeNull();
    expect(aggregateUsage(monitor.state.usageRecords, "process")[0].total).toBe(
      previousUsage,
    );
    monitor.receive(detailed([], 120000), 20000);
    expect(monitor.state.closedConnections[0]).toMatchObject({
      id: "a",
      closedAt: 120000,
      up: null,
    });
  });

  it("caps recently ended records and preserves usage after counter reset", () => {
    const monitor = new MihomoMonitor(defaults);
    const rows = Array.from({ length: 220 }, (_, index) =>
      connection(`c${index}`, 100, 200),
    );
    monitor.receive(detailed(rows, 100000), 0);
    monitor.receive(
      detailed(
        rows.map((row) => ({ ...row, upload: 200, download: 400 })),
        105000,
      ),
      5000,
    );
    const total = aggregateUsage(monitor.state.usageRecords, "sourceIP")[0]
      .total;
    monitor.receive(detailed([], 110000), 10000);
    expect(monitor.state.closedConnections).toHaveLength(200);
    const reset = detailed([connection("c1", 0, 0)], 115000);
    reset.data.connections = {
      count: 1,
      items: [connection("c1", 0, 0)],
      truncated: false,
      uploadTotal: 0,
      downloadTotal: 0,
    };
    monitor.receive(reset, 15000);
    expect(monitor.state.activeConnections[0].up).toBeNull();
    expect(
      aggregateUsage(monitor.state.usageRecords, "sourceIP")[0].total,
    ).toBe(total);
    expect(
      monitor.state.closedConnections.every((row) => row.id !== "c1"),
    ).toBe(true);
  });

  it("coarsens long-session charts without losing any recorded byte totals", () => {
    const usage = new MihomoUsage();
    const row = {
      timestamp: 1000,
      sourceIP: "device",
      host: "target",
      outbound: "node",
      process: "app",
      rule: "rule",
      upload: 10,
      download: 20,
    };
    for (let index = 0; index < 1000; index++)
      usage.add([row], 1000 + index * 60000);
    expect(usage.bucketMs).toBeGreaterThan(60000);
    expect(usage.history().length).toBeLessThanOrEqual(241);
    expect(aggregateUsage([...usage.records.values()], "host")[0]).toEqual({
      label: "target",
      upload: 10000,
      download: 20000,
      total: 30000,
    });
    expect(
      usage
        .history()
        .reduce((sum, point) => sum + (point.tx ?? 0) + (point.rx ?? 0), 0),
    ).toBe(30000);
  });
});
