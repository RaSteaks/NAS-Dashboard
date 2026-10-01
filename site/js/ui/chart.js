// @ts-check

/** @typedef {import("../core/types.js").HistoryPoint} HistoryPoint */
import { time } from "../core/format.js";

// UMD registers its controllers and plugins; keep Node-only imports safe.
const Chart = /** @type {any} */ (typeof window === "undefined" ? {} : window)
  .Chart;

/**
 * @typedef {object} Series
 * @property {"cpu"|"memory"|"rx"|"tx"} key
 * @property {string} label
 * @property {string} color
 * @property {boolean} [fill]
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Series[]} series
 * @param {boolean} [percent=false]
 * @returns {{
 *   update: (history: HistoryPoint[], windowMinutes: number) => void,
 *   destroy: () => void,
 * }}
 */
export function lineChart(canvas, series, percent = false) {
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
              `${item.dataset.label}: ${item.parsed.y?.toFixed(1) ?? "--"}${percent ? "%" : " MiB/s"}`,
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
                y: value === null ? null : value / (percent ? 1 : 1024 ** 2),
              };
            });
          // Show the first real sample before enough points exist to draw a trace.
          dataset.pointRadius = dataset.data.length === 1 ? 3 : 0;
        },
      );
      chart.update("none");
    },
    destroy: () => chart.destroy(),
  };
}
