import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import PhpParser from "php-parser";
import {
  defaults,
  mergeConfig,
  normalizeApiAddress,
  validateApi,
} from "../site/js/core/config.js";
import { fetchSnapshot } from "../site/js/core/api.js";
import {
  bitrate,
  bytes,
  chartByteScale,
  setByteUnits,
} from "../site/js/core/format.js";
import { normalize } from "../site/js/core/metrics.js";
import { Poller } from "../site/js/core/poller.js";
import { requiredPlugins } from "../site/js/widgets/index.js";
import { containerStatus } from "../site/js/widgets/containers.js";

/** @typedef {import("../site/js/core/types.js").Snapshot} Snapshot */
/** @typedef {import("../site/js/core/types.js").HistoryPoint} HistoryPoint */

/**
 * @param {Record<string, unknown>} data
 * @returns {import("../site/js/core/types.js").Snapshot}
 */
const snapshot = (data) => ({
  data,
  errors: {},
  collectedAt: 1000,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // Formatting reads a module-level preference; reset it for other suites.
  setByteUnits("auto", 1024);
});

describe("Glances normalization", () => {
  it("preserves unknown metrics instead of inventing zeros", () => {
    const result = normalize(
      snapshot({ cpu: { total: null }, mem: {} }),
      defaults,
    );
    expect(result.cpu).toBeNull();
    expect(result.memory).toBeNull();
    expect(result.rx).toBeNull();
    expect(result.temperature).toBeNull();
  });
  it("uses Glances rates and excludes loopback traffic", () => {
    const result = normalize(
      snapshot({
        network: [
          {
            interface_name: "ovs_eth1",
            bytes_recv: 100000,
            bytes_recv_rate_per_sec: 123,
            bytes_sent_rate_per_sec: 456,
            time_since_update: 0.2,
          },
          {
            interface_name: "lo",
            bytes_recv_rate_per_sec: 100000,
            bytes_sent_rate_per_sec: 100000,
          },
        ],
      }),
      defaults,
    );
    expect(result.rx).toBe(123);
    expect(result.tx).toBe(456);
    expect(result.interfaces).toHaveLength(1);
  });
  it("never treats delta bytes or sample age as throughput", () => {
    const result = normalize(
      snapshot({
        network: [
          {
            interface_name: "eth0",
            bytes_recv: 1200,
            bytes_sent: 50,
            time_since_update: 2,
          },
        ],
      }),
      defaults,
    );
    expect(result.rx).toBeNull();
    expect(result.tx).toBeNull();
  });
  it("avoids counting both a bond and its physical members", () => {
    const network = ["bond0", "eth0", "eth1"].map((interface_name) => ({
      interface_name,
      bytes_recv_rate_per_sec: 100,
      bytes_sent_rate_per_sec: 20,
    }));
    const result = normalize(snapshot({ network }), defaults);
    expect(result.rx).toBe(100);
    expect(result.interfaces[0].name).toBe("bond0");
  });
  it("honors explicitly selected network interfaces", () => {
    const config = mergeConfig({ networkInterfaces: ["eth0"] });
    const result = normalize(
      snapshot({
        network: [
          { interface_name: "bond0", bytes_recv_rate_per_sec: 100 },
          { interface_name: "eth0", bytes_recv_rate_per_sec: 40 },
        ],
      }),
      config,
    );
    expect(result.rx).toBe(40);
  });
  it("filters container bind mounts and deduplicates NAS volumes", () => {
    const fs = ["/", "/etc/hosts", "/volume3", "/volume3"].map((mnt_point) => ({
      mnt_point,
      size: 100,
      free: 50,
    }));
    const result = normalize(snapshot({ fs }), defaults);
    expect(result.volumes.map((volume) => volume.mount)).toEqual(["/volume3"]);
  });
  // These shapes were observed on the user's Glances 4 NAS, not just demo data.
  it("supports temperature_core and picks the hottest CPU sensor", () => {
    const result = normalize(
      snapshot({
        sensors: [
          { label: "Core 0", type: "temperature_core", value: 39, unit: "C" },
          { label: "Core 1", type: "temperature_core", value: 41, unit: "C" },
          { label: "disk", type: "temperature_hdd", value: 45, unit: "C" },
          { label: "fan", type: "fan_speed", value: 1000 },
        ],
      }),
      defaults,
    );
    expect(result.temperature).toBe(41);
    expect(result.temperatureLabel).toBe("Core 1");
  });
  it("supports container image arrays without displaying commands", () => {
    const result = normalize(
      snapshot({
        containers: [
          {
            name: "glances",
            image: ["nicolargo/glances:latest-full"],
            status: "running",
            cpu_percent: 0.5,
            memory_usage: 123,
            command: "private command",
          },
        ],
      }),
      defaults,
    );
    expect(result.containers[0].image).toBe("nicolargo/glances:latest-full");
    expect(result.containers[0]).not.toHaveProperty("command");
  });
  it("exposes every temperature sensor for detail views, hottest first", () => {
    const result = normalize(
      snapshot({
        sensors: [
          { label: "CPU Package", type: "temperature_core", value: 44 },
          { label: "Disk 0", type: "temperature_hdd", value: 51 },
          { label: "fan", type: "fan_speed", value: 1000 },
          { label: "broken", type: "temperature_core", value: null },
        ],
      }),
      defaults,
    );
    expect(result.sensors).toEqual([
      { label: "Disk 0", value: 51 },
      { label: "CPU Package", value: 44 },
    ]);
  });
  it("carries memory free space and interface counters for detail views", () => {
    const result = normalize(
      snapshot({
        mem: { percent: 42.5, used: 7, total: 16, free: 9 },
        network: [
          {
            interface_name: "eth0",
            bytes_recv_rate_per_sec: 12,
            bytes_sent_rate_per_sec: 6,
            bytes_recv: 900,
            bytes_sent: 450,
            speed: 1000000000,
            is_up: true,
          },
        ],
      }),
      defaults,
    );
    expect(result.memoryFree).toBe(9);
    expect(result.interfaces[0]).toMatchObject({
      name: "eth0",
      rxTotal: 900,
      txTotal: 450,
      speed: 1000000000,
      isUp: true,
    });
  });
});

describe("detail formatting", () => {
  it("scales link speed to readable bit units", () => {
    expect(bitrate(1e9)).toBe("1.0 Gbit/s");
    expect(bitrate(125 * 1e6)).toBe("125.0 Mbit/s");
    expect(bitrate(null)).toBe("--");
  });
  it("auto-scales binary units and rate suffixes by default", () => {
    expect(bytes(1024 ** 3)).toBe("1.0 GiB");
    expect(bytes(4096, true)).toBe("4.0 KiB/s");
    expect(bytes(512)).toBe("512 B");
    expect(bytes(null, true)).toBe("--");
  });
  it("pins every reading to the chosen unit", () => {
    setByteUnits("GB", 1000);
    expect(bytes(2.5 * 1000 ** 3)).toBe("2.5 GB");
    // A pinned unit converts sub-step values instead of re-scaling them.
    expect(bytes(900 * 1000 ** 2, true)).toBe("0.9 GB/s");
    setByteUnits("MB", 1024);
    expect(bytes(2 * 1024 ** 3)).toBe("2,048.0 MiB");
  });
  it("auto-scales decimal units when the base is 1000", () => {
    setByteUnits("auto", 1000);
    expect(bytes(1000 ** 4)).toBe("1.0 TB");
    expect(bytes(1500)).toBe("1.5 KB");
  });
  it("scales network charts to the plotted unit", () => {
    expect(chartByteScale()).toEqual({ divisor: 1024 ** 2, unit: "MiB" });
    setByteUnits("GB", 1000);
    expect(chartByteScale()).toEqual({ divisor: 1000 ** 3, unit: "GB" });
    setByteUnits("auto", 1000);
    expect(chartByteScale()).toEqual({ divisor: 1000 ** 2, unit: "MB" });
  });
});

describe("configuration", () => {
  it("requires a user-supplied API and normalizes host:port addresses", () => {
    expect(defaults.api.url).toBe("");
    expect(normalizeApiAddress(" 192.0.2.10:61208/api/4/ ")).toBe(
      "http://192.0.2.10:61208/api/4",
    );
    expect(normalizeApiAddress("./api/index.php")).toBe("./api/index.php");
  });
  it("rejects mixed content, credentials, and cross-origin proxy addresses", () => {
    const page = "https://dashboard.test/";
    expect(
      validateApi({ mode: "direct", url: "http://nas.test/api/4" }, page),
    ).toBeTruthy();
    expect(
      validateApi(
        { mode: "direct", url: "https://user:password@nas.test/api/4" },
        page,
      ),
    ).toBeTruthy();
    expect(
      validateApi(
        { mode: "proxy", url: "https://nas.test/api/index.php" },
        page,
      ),
    ).toBeTruthy();
    expect(
      validateApi({ mode: "proxy", url: "./api/index.php" }, page),
    ).toBeNull();
  });
  it("rejects invalid filters without breaking defaults", () => {
    const result = mergeConfig({
      volumePattern: "[",
      refreshSeconds: -1,
      widgets: ["network", "made-up"],
    });
    expect(result.volumePattern).toBe(defaults.volumePattern);
    expect(result.refreshSeconds).toBe(3);
    expect(result.widgets).toEqual(["network"]);
  });
  it("accepts a display unit preference and rejects unknown values", () => {
    const result = mergeConfig({ unit: "MB", unitBase: 1000 });
    expect(result.unit).toBe("MB");
    expect(result.unitBase).toBe(1000);
    const invalid = mergeConfig({ unit: "quanta", unitBase: 10 });
    expect(invalid.unit).toBe(defaults.unit);
    expect(invalid.unitBase).toBe(defaults.unitBase);
  });
  it("stops requesting disabled optional modules", () => {
    expect(requiredPlugins([])).not.toContain("containers");
    expect(requiredPlugins([])).not.toContain("network");
    expect(requiredPlugins([])).not.toContain("fs");
    expect(requiredPlugins(["storage"])).toContain("fs");
  });
});

describe("API transport", () => {
  it("isolates failed plugins in direct mode", async () => {
    vi.stubGlobal("location", { href: "http://dashboard.test/" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        url.endsWith("/cpu")
          ? new Response('{"total": 12}', {
              headers: { "content-type": "application/json" },
            })
          : new Response("not found", { status: 404 }),
      ),
    );
    const result = await fetchSnapshot(
      mergeConfig({ api: { mode: "direct", url: "http://nas.test/api/4" } }),
      ["cpu", "sensors"],
      new AbortController().signal,
    );
    expect(result.data.cpu).toEqual({ total: 12 });
    expect(result.errors.sensors).toContain("未找到");
  });
  it("does not consume source PHP or HTML as JSON", async () => {
    vi.stubGlobal("location", { href: "http://dashboard.test/" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<?php code", {
            headers: { "content-type": "text/plain" },
          }),
      ),
    );
    await expect(
      fetchSnapshot(
        mergeConfig({ api: { mode: "proxy", url: "./api/index.php" } }),
        ["cpu"],
        new AbortController().signal,
      ),
    ).rejects.toThrow("JSON");
  });
  it("uses same-origin snapshot requests in proxy mode", async () => {
    vi.stubGlobal("location", { href: "http://dashboard.test/nas/" });
    const fetcher = vi.fn(
      /** @param {string|URL} _url */
      async (_url) =>
        new Response(
          '{"data":{"cpu":{"total":12}},"errors":{},"collectedAt":0}',
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchSnapshot(
      mergeConfig({ api: { mode: "proxy", url: "./api/index.php" } }),
      ["cpu"],
      new AbortController().signal,
    );
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "http://dashboard.test/nas/api/index.php?plugins=cpu",
    );
    expect(result.collectedAt).toBeGreaterThan(0);
  });
});

describe("polling lifecycle", () => {
  it("never overlaps requests and aborts on stop", async () => {
    vi.useFakeTimers();
    /** @type {AbortSignal|undefined} */
    let requestSignal;
    /** @type {((value: Snapshot) => void)|undefined} */
    let settle;
    const fetcher = vi.fn((signal) => {
      requestSignal = signal;
      return new Promise((resolve) => {
        settle = resolve;
      });
    });
    const onData = vi.fn();
    const poller = new Poller({
      intervalMs: 5000,
      fetch: fetcher,
      onData,
      onError: vi.fn(),
      onBusy: vi.fn(),
    });
    poller.start();
    await poller.refresh();
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    poller.stop();
    expect(requestSignal?.aborted).toBe(true);
    settle?.(snapshot({ cpu: { total: 1 } }));
    await Promise.resolve();
    expect(onData).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("backs off after failure and resets after successful sampling", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(snapshot({ cpu: { total: 1 } }));
    const poller = new Poller({
      intervalMs: 5000,
      fetch: fetcher,
      onData: vi.fn(),
      onError: vi.fn(),
      onBusy: vi.fn(),
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    poller.stop();
  });
});

describe("Docker health states", () => {
  it.each([
    ["healthy", "健康", "success", true],
    ["unhealthy", "不健康", "warning", true],
    ["starting", "启动中", "warning", true],
    ["exited", "已停止", "neutral", false],
  ])(
    "maps %s without hiding running containers",
    (status, label, tone, isRunning) => {
      expect(containerStatus({ status: String(status) })).toEqual({
        label,
        tone,
        isRunning,
      });
    },
  );
});

describe("Web Station proxy syntax", () => {
  it.each(["../site/api/index.php", "../config/glances.example.php"])(
    "parses %s as PHP 8",
    (file) => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const parser = new PhpParser.Engine({ parser: { version: "8.1" } });
      expect(() => parser.parseCode(source, file)).not.toThrow();
    },
  );
});
