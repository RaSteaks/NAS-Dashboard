// @ts-check

/** @typedef {import("../core/types.js").HistoryPoint} HistoryPoint */
/** @typedef {import("../core/types.js").WidgetContext} WidgetContext */
/** @typedef {import("../core/types.js").WidgetDefinition} WidgetDefinition */
import { bytes, chartByteScale } from "../core/format.js";
import {
  el,
  icon,
  moduleStatus,
  panelHeading,
  updateStatus,
} from "../ui/dom.js";
import { lineChart } from "../ui/chart.js";

/** @type {WidgetDefinition} */
export const networkWidget = {
  id: "network",
  title: "网络流量",
  icon: "network",
  plugins: ["network"],
  mount(element) {
    const status = el("span", { class: "panel-status neutral" }, "等待采集");
    const select = el(
      "select",
      { class: "interface-select", "aria-label": "网络接口" },
      el("option", { value: "all" }, "全部接口"),
    );
    const rx = el("strong");
    const tx = el("strong");
    const canvas = el("canvas", {
      role: "img",
      // Mounted after the unit preference applies, so the label names the step.
      "aria-label": `网络接收与发送速率趋势，单位 ${chartByteScale().unit} 每秒。`,
    });
    const unitLabel = () =>
      `网络接收与发送速率趋势，单位 ${chartByteScale().unit} 每秒。`;
    const empty = el("div", { class: "chart-empty" }, "等待采集网络数据");
    const footnote = el("div", { class: "panel-footnote" });
    element.append(
      panelHeading("网络流量", "network", status, select),
      el(
        "div",
        { class: "network-summary" },
        el(
          "span",
          { class: "network-rate" },
          icon("arrow-down"),
          el("span", {}, "接收", rx),
        ),
        el(
          "span",
          { class: "network-rate upload" },
          icon("arrow-up"),
          el("span", {}, "发送", tx),
        ),
      ),
      el("div", { class: "chart-area network-chart" }, canvas, empty),
      footnote,
    );
    const chart = lineChart(canvas, [
      { key: "rx", label: "接收", color: "--color-network", fill: true },
      { key: "tx", label: "发送", color: "--color-upload" },
    ]);
    /** @type {WidgetContext|undefined} */
    let lastContext;
    /** @type {HistoryPoint[]} */
    let selectedHistory = [];
    let lastSelection = "all";
    /**
     * @param {WidgetContext} context
     */
    const update = (context) => {
      lastContext = context;
      const { metrics, snapshot, history, windowMinutes } = context;
      // A saved unit preference repaints this widget in place, without a remount.
      canvas.setAttribute("aria-label", unitLabel());
      const names = ["all", ...metrics.interfaces.map((item) => item.name)];
      if (
        Array.from(select.options)
          .map((option) => option.value)
          .join() !== names.join()
      ) {
        const selected = select.value;
        select.replaceChildren(
          el("option", { value: "all" }, "全部接口"),
          ...metrics.interfaces.map((item) =>
            el("option", { value: item.name }, item.name),
          ),
        );
        select.value = names.includes(selected) ? selected : "all";
      }
      const selected = metrics.interfaces.find(
        (item) => item.name === select.value,
      );
      rx.textContent = bytes(selected ? selected.rx : metrics.rx, true);
      tx.textContent = bytes(selected ? selected.tx : metrics.tx, true);
      updateStatus(
        status,
        moduleStatus(
          snapshot.errors.network ? [snapshot.errors.network] : [],
          !metrics.interfaces.length,
        ),
      );
      footnote.textContent = selected
        ? `${selected.name} · ${selected.isUp === null ? "链路状态未提供" : selected.isUp ? "链路已连接" : "链路未连接"}`
        : `监测 ${metrics.interfaces.length} 个接口 · ${chartByteScale().unit}/s`;
      if (lastSelection !== select.value) {
        selectedHistory = [];
        lastSelection = select.value;
      }
      if (selected && selectedHistory.at(-1)?.timestamp !== metrics.timestamp) {
        selectedHistory.push({
          timestamp: metrics.timestamp,
          cpu: null,
          memory: null,
          rx: selected.rx,
          tx: selected.tx,
        });
        selectedHistory = selectedHistory.filter(
          (point) =>
            point.timestamp >=
            metrics.timestamp - context.config.historyMinutes * 60000,
        );
      }
      const points = selected ? selectedHistory : history;
      empty.hidden = points.some(
        (point) => point.rx !== null || point.tx !== null,
      );
      empty.textContent =
        snapshot.errors.network ||
        (metrics.interfaces.length
          ? "接口未提供每秒速率"
          : "未发现匹配的网络接口");
      chart.update(points, windowMinutes);
    };
    select.addEventListener("change", () => {
      if (lastContext) update(lastContext);
    });
    return { update, destroy: chart.destroy };
  },
};
