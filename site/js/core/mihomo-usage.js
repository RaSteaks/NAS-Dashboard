// @ts-check

/** @typedef {import("./types.js").MihomoUsageRecord} UsageRecord */
/** @typedef {import("./types.js").MihomoUsageDimension} Dimension */
/** @typedef {import("./types.js").HistoryPoint} HistoryPoint */

/** @param {UsageRecord} row */
function key(row) {
  return JSON.stringify([
    row.timestamp,
    row.sourceIP,
    row.host,
    row.outbound,
    row.process,
    row.rule,
  ]);
}

// Only in-memory measured deltas belong here. Adaptive time buckets bound chart
// density without imposing the overview's short history window on usage totals.
export class MihomoUsage {
  /** @type {Map<string, UsageRecord>} */
  records = new Map();
  /** @type {Map<number, {upload: number, download: number}>} */
  buckets = new Map();
  bucketMs = 60000;
  startedAt = 0;
  ready = false;

  /** @param {UsageRecord[]} rows @param {number} timestamp */
  add(rows, timestamp) {
    this.ready = true;
    if (!this.startedAt) this.startedAt = timestamp;
    while ((timestamp - this.startedAt) / this.bucketMs > 240) {
      this.bucketMs *= 2;
      const oldRecords = [...this.records.values()];
      const oldBuckets = [...this.buckets.entries()];
      this.records.clear();
      this.buckets.clear();
      for (const row of oldRecords)
        this.merge({
          ...row,
          timestamp: Math.floor(row.timestamp / this.bucketMs) * this.bucketMs,
        });
      for (const [time, amount] of oldBuckets) {
        const bucket = Math.floor(time / this.bucketMs) * this.bucketMs;
        const previous = this.buckets.get(bucket) ?? { upload: 0, download: 0 };
        previous.upload += amount.upload;
        previous.download += amount.download;
        this.buckets.set(bucket, previous);
      }
    }
    const bucket = Math.floor(timestamp / this.bucketMs) * this.bucketMs;
    const total = this.buckets.get(bucket) ?? { upload: 0, download: 0 };
    for (const row of rows) {
      if (row.upload === 0 && row.download === 0) continue;
      this.merge({ ...row, timestamp: bucket });
      total.upload += row.upload;
      total.download += row.download;
    }
    // A valid zero-traffic observation differs from an unobserved time bucket.
    this.buckets.set(bucket, total);
  }

  /** @param {UsageRecord} row */
  merge(row) {
    const name = key(row);
    const previous = this.records.get(name);
    if (previous) {
      previous.upload += row.upload;
      previous.download += row.download;
    } else this.records.set(name, row);
  }

  /** @returns {HistoryPoint[]} */
  history() {
    /** @type {HistoryPoint[]} */
    const history = [];
    for (const [timestamp, value] of [...this.buckets.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const last = history.at(-1);
      if (last && timestamp - last.timestamp > this.bucketMs * 1.5)
        history.push({
          timestamp: timestamp - 1,
          cpu: null,
          memory: null,
          rx: null,
          tx: null,
        });
      history.push({
        timestamp,
        cpu: null,
        memory: null,
        rx: value.download,
        tx: value.upload,
      });
    }
    return history;
  }
}

/**
 * Shared aggregation for rankings, tables and drill-down. No cumulative
 * connection counter is added here, so re-rendering never double counts bytes.
 * @param {UsageRecord[]} records
 * @param {Dimension} dimension
 */
export function aggregateUsage(records, dimension) {
  /** @type {Map<string, {label: string, upload: number, download: number, total: number}>} */
  const groups = new Map();
  for (const row of records) {
    const label = row[dimension] || "未提供";
    const group = groups.get(label) ?? {
      label,
      upload: 0,
      download: 0,
      total: 0,
    };
    group.upload += row.upload;
    group.download += row.download;
    group.total = group.upload + group.download;
    groups.set(label, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label, "zh-CN"),
  );
}
