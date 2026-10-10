// @ts-check

/** @typedef {import("../core/types.js").HistoryPoint} HistoryPoint */
import { chartByteScale, time } from "../core/format.js";

// UMD registers its controllers and plugins; keep Node-only imports safe.
const Chart = /** @type {any} */ (typeof window === "undefined" ? {} : window)
  .Chart;

/**
 * @typedef {object} Series
 * @property {"cpu"|"memory"|"rx"|"tx"|"connections"} key
 * @property {string} label
 * @property {string} color
 * @property {boolean} [fill]
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Series[]} series
 * @param {boolean|"bytes"|"count"} [mode=false] True is percent; false is bytes/second.
 * @returns {{
 *   update: (history: HistoryPoint[], windowMinutes: number) => void,
 *   destroy: () => void,
 * }}
 */
export function lineChart(canvas, series, mode = false) {
  const percent = mode === true;
  const count = mode === "count";
  const unit = () =>
    percent
      ? "%"
      : count
        ? " 条"
        : ` ${chartByteScale().unit}${mode === "bytes" ? "" : "/s"}`;
  const colors = getComputedStyle(document.documentElement);
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: series.map((item) => ({
        label: item.label,
        data: [],
        borderColor: colors.getPropertyValue(item.color).trim(),
        backgroundColor: colors.getPropertyValue(`${item.color}-soft`).trim(),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25,
        fill: item.fill ? "origin" : false,
        spanGaps: false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: {
          displayColors: true,
          backgroundColor: colors.getPropertyValue("--color-text").trim(),
          titleFont: { family: "system-ui", size: 12 },
          bodyFont: { family: "system-ui", size: 12 },
          padding: 10,
          callbacks: {
            title: (/** @type {any[]} */ items) =>
              items.length ? time(items[0].parsed.x ?? Date.now()) : "",
            label: (/** @type {any} */ item) =>
              `${item.dataset.label}: ${item.parsed.y?.toFixed(count ? 0 : 1) ?? "--"}${unit()}`,
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          grid: { display: false },
          border: { display: false },
          ticks: {
            maxTicksLimit: 5,
            maxRotation: 0,
            color: colors.getPropertyValue("--color-muted").trim(),
            font: { size: 11 },
            callback: (/** @type {number} */ value) =>
              time(Number(value)).slice(0, 5),
          },
        },
        y: {
          min: 0,
          ...(percent ? { max: 100 } : {}),
          border: { display: false },
          grid: { color: colors.getPropertyValue("--color-grid").trim() },
          ticks: {
            ...(count ? { precision: 0 } : {}),
            maxTicksLimit: 5,
            color: colors.getPropertyValue("--color-muted").trim(),
            font: { size: 11 },
            callback: (/** @type {number} */ value) =>
              `${value}${percent ? "%" : ""}`,
          },
        },
      },
    },
  });
  return {
    update(history, windowMinutes) {
      const end = history.at(-1)?.timestamp ?? Date.now();
      const start = end - windowMinutes * 60000;
      // Re-read per update so a saved unit preference re-scales live charts.
      // Memory and usage are bytes, connection counts are unitless, and NAS
      // percentages retain their existing 0–100 range.
      const divisor = percent || count ? 1 : chartByteScale().divisor;
      chart.options.scales.x.min = start;
      chart.options.scales.x.max = end;
      chart.data.datasets.forEach(
        (/** @type {any} */ dataset, /** @type {number} */ index) => {
          dataset.data = history
            .filter((point) => point.timestamp >= start)
            .map((point) => {
              const value = point[series[index].key];
              return {
                x: point.timestamp,
                y: value == null ? null : value / divisor,
              };
            });
          // Isolated readings across gaps need a visible point. Rapid manual
          // refreshes can also be too close to draw a trace at the time scale.
          dataset.pointRadius = dataset.data.map(
            (
              /** @type {{x: number, y: number|null}} */ point,
              /** @type {number} */ index,
              /** @type {{x: number, y: number|null}[]} */ points,
            ) => {
              if (point.y === null) return 0;
              const previous = points[index - 1],
                next = points[index + 1];
              const isolated =
                (!previous || previous.y === null) &&
                (!next || next.y === null);
              const compactLast =
                index === points.length - 1 &&
                previous &&
                previous.y !== null &&
                point.x - previous.x < 1000;
              return isolated || compactLast ? 3 : 0;
            },
          );
        },
      );
      // Resolve shared point styles after a null baseline; animation is already
      // disabled above, so a normal update also remains immediate.
      chart.update();
    },
    destroy: () => chart.destroy(),
  };
}
