// @ts-check

/** @typedef {import("./types.js").Config} Config */
/** @typedef {import("./types.js").MihomoSnapshot} MihomoSnapshot */
/** @typedef {import("./types.js").MihomoMetrics} MihomoMetrics */
/** @typedef {import("./types.js").MihomoState} MihomoState */
/** @typedef {import("./types.js").MihomoConnection} MihomoConnection */
/** @typedef {import("./types.js").MihomoUsageRecord} UsageRecord */
import { validateApi } from "./config.js";
import { readJson } from "./api.js";
import { MihomoUsage } from "./mihomo-usage.js";

// Mihomo's target cadence and valid sample window never follow the Glances
// interval. The window tolerates slow proxy reads, while longer gaps reset rates.
export const mihomoRefreshMs = 1000;
export const mihomoStaleMs = 15000;

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/** @param {unknown} value @returns {number|null} */
function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" ? value.slice(0, 512) : "";
}

/**
 * Older proxies can keep providing summary metrics without detailed rows.
 * Normalize the new field allowlist independently of raw controller metadata.
 * @param {unknown} input
 * @returns {MihomoConnection[]}
 */
export function normalizeConnections(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  /** @type {MihomoConnection[]} */
  const connections = [];
  for (const value of input.slice(0, 500)) {
    const row = record(value);
    const id = text(row.id).slice(0, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const started = Date.parse(text(row.start));
    const processPath = text(row.processPath);
    connections.push({
      id,
      host: text(row.host),
      destinationIP: text(row.destinationIP),
      destinationPort: text(row.destinationPort),
      sourceIP: text(row.sourceIP),
      sourcePort: text(row.sourcePort),
      network: text(row.network).toUpperCase(),
      type: text(row.type),
      process: text(row.process) || processPath.split(/[\\/]/).at(-1) || "",
      processPath,
      inboundName: text(row.inboundName),
      rule: text(row.rule),
      rulePayload: text(row.rulePayload),
      chains: Array.isArray(row.chains)
        ? row.chains.slice(0, 16).map(text).filter(Boolean)
        : [],
      start: Number.isFinite(started) ? started : null,
      upload: number(row.upload),
      download: number(row.download),
      up: null,
      down: null,
      closedAt: null,
    });
  }
  return connections;
}

/** @returns {MihomoMetrics} */
function emptyMetrics() {
  return {
    up: null,
    down: null,
    uploadTotal: null,
    downloadTotal: null,
    connections: null,
    memory: null,
    version: "",
  };
}

/**
 * Read only the same-origin summary, never the controller or its credentials.
 * @param {Config} config
 * @param {AbortSignal} signal
 * @returns {Promise<MihomoSnapshot>}
 */
export async function fetchMihomoSnapshot(config, signal) {
  const error = validateApi(
    { mode: "proxy", url: config.mihomo.url },
    location.href,
  );
  if (error) throw new Error(error);
  const result = record(
    await readJson(
      await fetch(new URL(config.mihomo.url, location.href), {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(config.timeoutSeconds * 1000),
        ]),
        cache: "no-store",
        credentials: "same-origin",
      }),
    ),
  );
  if (
    !result.data ||
    !result.errors ||
    Array.isArray(result.data) ||
    Array.isArray(result.errors) ||
    typeof result.data !== "object" ||
    typeof result.errors !== "object"
  )
    throw new Error("mihomo 代理返回格式不正确");
  /** @type {MihomoSnapshot} */
  const snapshot = { data: {}, errors: {}, collectedAt: Date.now() };
  const data = record(result.data);
  const errors = record(result.errors);
  for (const endpoint of /** @type {const} */ ([
    "connections",
    "memory",
    "version",
  ])) {
    if (endpoint in errors) {
      if (typeof errors[endpoint] !== "string")
        throw new Error("mihomo 代理返回格式不正确");
      snapshot.errors[endpoint] = /** @type {string} */ (errors[endpoint]);
    } else if (endpoint in data) {
      if (
        !data[endpoint] ||
        typeof data[endpoint] !== "object" ||
        Array.isArray(data[endpoint])
      )
        snapshot.errors[endpoint] = "mihomo 返回格式不正确";
      else snapshot.data[endpoint] = data[endpoint];
    } else snapshot.errors[endpoint] = "mihomo 未提供该项数据";
  }
  signal.throwIfAborted();
  return snapshot;
}

/**
 * Failed endpoints retain their last reading, while absent fields in a valid
 * endpoint remain unknown. Connection counters and NAS interface rates differ.
 * @param {MihomoSnapshot} snapshot
 * @param {MihomoMetrics} [previous=emptyMetrics()]
 * @returns {MihomoMetrics}
 */
export function normalizeMihomo(snapshot, previous = emptyMetrics()) {
  const metrics = { ...previous, up: null, down: null };
  if (snapshot.data.connections && !snapshot.errors.connections) {
    const connections = record(snapshot.data.connections);
    metrics.uploadTotal = number(connections.uploadTotal);
    metrics.downloadTotal = number(connections.downloadTotal);
    const count = number(connections.count);
    metrics.connections =
      count !== null && Number.isInteger(count) ? count : null;
  }
  if (snapshot.data.memory && !snapshot.errors.memory)
    metrics.memory = number(record(snapshot.data.memory).inuse);
  if (snapshot.data.version && !snapshot.errors.version) {
    const version = record(snapshot.data.version).version;
    metrics.version = typeof version === "string" ? version : "";
  }
  return metrics;
}

/** @param {MihomoSnapshot} snapshot @returns {boolean} */
export function hasMihomoData(snapshot) {
  const values = normalizeMihomo(snapshot);
  return [
    values.connections,
    values.uploadTotal,
    values.downloadTotal,
    values.memory,
  ].some((value) => value !== null);
}

// One monitor per configured source owns its rate baseline and bounded history.
export class MihomoMonitor {
  /** @type {{time: number, up: number, down: number}|undefined} */
  baseline;
  /** @type {Map<string, MihomoConnection>} */
  observations = new Map();
  observedMonotonic = 0;
  observed = false;
  usage = new MihomoUsage();
  /** @type {MihomoState} */
  state = {
    metrics: emptyMetrics(),
    history: [],
    connection: "idle",
    errors: {},
    error: "",
    lastSuccess: 0,
    activeConnections: [],
    closedConnections: [],
    detailsAvailable: false,
    detailsTruncated: false,
    usageRecords: [],
    usageHistory: [],
    usageStartedAt: 0,
    usageHasSamples: false,
    usageBucketMs: 60000,
  };

  /** @param {Config} config */
  constructor(config) {
    this.config = config;
  }

  // Pauses, hidden tabs and network failures must never bridge rate samples.
  resetBaseline() {
    this.baseline = undefined;
    this.observations.clear();
    this.observed = false;
  }

  /**
   * Rates and usage share a per-connection observation, but usage owns its full
   * session totals. Failed/truncated lists never manufacture closed entries.
   * @param {MihomoSnapshot} snapshot
   * @param {number} monotonic
   */
  observeConnections(snapshot, monotonic) {
    if (!snapshot.data.connections || snapshot.errors.connections) return;
    const raw = record(snapshot.data.connections);
    this.state.detailsAvailable = Array.isArray(raw.items);
    if (!this.state.detailsAvailable) {
      this.state.activeConnections = [];
      this.state.detailsTruncated = false;
      this.observations.clear();
      this.observed = false;
      return;
    }
    const connections = normalizeConnections(raw.items);
    this.state.detailsTruncated =
      raw.truncated === true ||
      (this.state.metrics.connections !== null &&
        this.state.metrics.connections > connections.length);
    const elapsed = this.observed
      ? (monotonic - this.observedMonotonic) / 1000
      : 0;
    const paired = elapsed > 0 && elapsed * 1000 <= mihomoStaleMs;
    /** @type {UsageRecord[]} */
    const deltas = [];
    const activeIds = new Set(connections.map((row) => row.id));
    // Reappearing IDs are active even after a pause or controller reset.
    this.state.closedConnections = this.state.closedConnections.filter(
      (row) => !activeIds.has(row.id),
    );
    if (!this.usage.startedAt) this.usage.startedAt = snapshot.collectedAt;
    for (const connection of connections) {
      const previous = this.observations.get(connection.id);
      if (
        paired &&
        previous &&
        previous.start === connection.start &&
        previous.upload !== null &&
        previous.download !== null &&
        connection.upload !== null &&
        connection.download !== null &&
        connection.upload >= previous.upload &&
        connection.download >= previous.download
      ) {
        const upload = connection.upload - previous.upload;
        const download = connection.download - previous.download;
        connection.up = upload / elapsed;
        connection.down = download / elapsed;
        deltas.push({
          timestamp: snapshot.collectedAt,
          sourceIP: connection.sourceIP,
          host: connection.host || connection.destinationIP,
          outbound: connection.chains[0] || "",
          process: connection.process,
          rule: [connection.rule, connection.rulePayload]
            .filter(Boolean)
            .join(" · "),
          upload,
          download,
        });
      }
    }
    if (paired) {
      this.usage.add(deltas, snapshot.collectedAt);
      if (!this.state.detailsTruncated) {
        const closed = [...this.observations.values()]
          .filter((row) => !activeIds.has(row.id))
          .map((row) => ({
            ...row,
            up: null,
            down: null,
            closedAt: snapshot.collectedAt,
          }));
        this.state.closedConnections = [
          ...closed.reverse(),
          ...this.state.closedConnections,
        ].slice(0, 200);
      }
    }
    this.state.activeConnections = connections;
    this.observations = new Map(connections.map((row) => [row.id, row]));
    this.observedMonotonic = monotonic;
    this.observed = true;
    this.state.usageRecords = [...this.usage.records.values()];
    this.state.usageHistory = this.usage.history();
    this.state.usageStartedAt = this.usage.startedAt;
    this.state.usageHasSamples = this.usage.ready;
    this.state.usageBucketMs = this.usage.bucketMs;
  }

  /**
   * Use a monotonic clock for elapsed seconds; wall time is for labels/history.
   * @param {MihomoSnapshot} snapshot
   * @param {number} [monotonic=performance.now()]
   */
  receive(snapshot, monotonic = performance.now()) {
    const metrics = normalizeMihomo(snapshot, this.state.metrics);
    const useful = hasMihomoData(snapshot);
    this.state.connection = useful
      ? Object.keys(snapshot.errors).length
        ? "partial"
        : "online"
      : "offline";
    this.state.errors = snapshot.errors;
    this.state.error =
      Object.values(snapshot.errors)[0] ||
      (useful ? "" : "mihomo 未提供监控数据");
    if (useful) this.state.lastSuccess = snapshot.collectedAt;
    if (
      snapshot.data.connections &&
      !snapshot.errors.connections &&
      metrics.uploadTotal !== null &&
      metrics.downloadTotal !== null
    ) {
      const previous = this.baseline;
      const elapsed = previous ? (monotonic - previous.time) / 1000 : 0;
      if (
        previous &&
        (metrics.uploadTotal < previous.up ||
          metrics.downloadTotal < previous.down)
      )
        // A controller reset also invalidates per-connection deltas, while
        // already observed page-session usage remains available.
        this.resetBaseline();
      if (
        previous &&
        elapsed > 0 &&
        metrics.uploadTotal >= previous.up &&
        metrics.downloadTotal >= previous.down &&
        elapsed * 1000 <= mihomoStaleMs
      ) {
        metrics.up = (metrics.uploadTotal - previous.up) / elapsed;
        metrics.down = (metrics.downloadTotal - previous.down) / elapsed;
      }
      // A reset counter establishes a new baseline rather than a negative rate.
      this.baseline = {
        time: monotonic,
        up: metrics.uploadTotal,
        down: metrics.downloadTotal,
      };
    } else this.resetBaseline();
    this.state.metrics = metrics;
    this.observeConnections(snapshot, monotonic);
    const last = this.state.history.at(-1);
    if (last && snapshot.collectedAt - last.timestamp > mihomoStaleMs)
      this.state.history.push({
        timestamp: snapshot.collectedAt - 1,
        cpu: null,
        memory: null,
        connections: null,
        rx: null,
        tx: null,
      });
    this.state.history.push({
      timestamp: snapshot.collectedAt,
      cpu: null,
      memory:
        snapshot.data.memory && !snapshot.errors.memory ? metrics.memory : null,
      rx: metrics.down,
      tx: metrics.up,
      connections:
        snapshot.data.connections && !snapshot.errors.connections
          ? metrics.connections
          : null,
    });
    this.state.history = this.state.history.filter(
      (point) =>
        point.timestamp >=
        snapshot.collectedAt - this.config.historyMinutes * 60000,
    );
  }

  /** @param {string} error */
  fail(error) {
    this.receive({
      data: {},
      errors: { connections: error, memory: error, version: error },
      collectedAt: Date.now(),
    });
  }
}

/**
 * Explicit demo telemetry: increasing fake counters yield stable sample rates.
 * @param {number} [timestamp=Date.now()]
 * @returns {MihomoSnapshot}
 */
export function demoMihomoSnapshot(timestamp = Date.now()) {
  // Stable IDs and increasing per-connection counters exercise all three demo
  // pages; they never enter real-source usage or browser-persistent storage.
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `demo-${index}`,
    host: ["video.example", "updates.example", "docs.example", "music.example"][
      index % 4
    ],
    sourceIP: `192.0.2.${10 + (index % 3)}`,
    sourcePort: String(50000 + index),
    destinationIP: `198.51.100.${20 + index}`,
    destinationPort: index % 3 ? "443" : "53",
    network: index % 3 ? "TCP" : "UDP",
    type: index % 3 ? "Mixed" : "TUN",
    process: ["browser", "media-server", "backup"][index % 3],
    processPath: "",
    inboundName: "演示入口",
    rule: index % 3 ? "DomainSuffix" : "Match",
    rulePayload: index % 3 ? "example" : "",
    chains: index % 3 ? ["演示节点", "自动选择"] : ["DIRECT"],
    start: new Date(Math.floor(timestamp / 3600000) * 3600000).toISOString(),
    upload: (timestamp / 1000) * (index + 1) * 4096,
    download: (timestamp / 1000) * (index + 1) * 16384,
  }));
  return {
    collectedAt: timestamp,
    errors: {},
    data: {
      connections: {
        count: items.length,
        uploadTotal: (timestamp / 1000) * 0.6 * 1024 ** 2,
        downloadTotal: (timestamp / 1000) * 2.4 * 1024 ** 2,
        items,
        truncated: false,
      },
      memory: { inuse: 118 * 1024 ** 2 },
      version: { version: "演示版本", meta: true },
    },
  };
}
