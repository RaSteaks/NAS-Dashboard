// @ts-check

/** @typedef {import("../core/types.js").WidgetDefinition} WidgetDefinition */
import { decimal } from "../core/format.js";
import { el, moduleStatus, panelHeading, updateStatus } from "../ui/dom.js";
import { lineChart } from "../ui/chart.js";

/** @type {WidgetDefinition} */
export const resourcesWidget = {
  id: "resources",
  title: "系统资源",
  icon: "activity",
  plugins: ["cpu", "mem"],
  mount(element) {
    const status = el("span", { class: "panel-status neutral" }, "等待采集");
    const summary = el("div", { class: "chart-legend" });
    const cpu = el("strong");
    const memory = el("strong");
    summary.append(
      el("span", {}, el("i", { class: "legend-dot cpu-color-bg" }), "CPU", cpu),
      el(
        "span",
        {},
        el("i", { class: "legend-dot memory-color-bg" }),
        "内存",
        memory,
      ),
    );
    const canvas = el("canvas", {
      role: "img",
      "aria-label": "CPU 与内存使用率趋势。当前数值见图例。",
    });
    const empty = el("div", { class: "chart-empty" }, "等待采集资源数据");
    element.append(
      panelHeading("资源趋势", "activity", status),
      summary,
      el("div", { class: "chart-area" }, canvas, empty),
    );
    const chart = lineChart(
      canvas,
      [
        { key: "cpu", label: "CPU", color: "--color-primary", fill: true },
        { key: "memory", label: "内存", color: "--color-memory" },
      ],
      true,
    );
    // The plot shares the same successful samples as the overview readouts.
    return {
      update({ metrics, snapshot, history, windowMinutes }) {
        cpu.textContent = `${decimal(metrics.cpu)}%`;
        memory.textContent = `${decimal(metrics.memory)}%`;
        updateStatus(
          status,
          moduleStatus(
            /** @type {string[]} */ (
              [snapshot.errors.cpu, snapshot.errors.mem].filter((item) =>
                Boolean(item),
              )
            ),
            metrics.cpu === null && metrics.memory === null,
          ),
        );
        empty.hidden = history.some(
          (point) => point.cpu !== null || point.memory !== null,
        );
        empty.textContent =
          snapshot.errors.cpu || snapshot.errors.mem || "等待采集资源数据";
        chart.update(history, windowMinutes);
      },
      destroy: chart.destroy,
    };
  },
};
