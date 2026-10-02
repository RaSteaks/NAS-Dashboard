// @ts-check

/** @typedef {import("../core/types.js").HistoryPoint} HistoryPoint */
/** @typedef {import("../core/types.js").NetworkInterface} NetworkInterface */
/** @typedef {import("../core/types.js").ViewDefinition} ViewDefinition */
/** @typedef {import("../core/types.js").WidgetContext} WidgetContext */
import { bitrate, bytes } from "../core/format.js";
import {
  el,
  icon,
  moduleStatus,
  panelHeading,
  updateStatus,
  windowControl,
} from "../ui/dom.js";
import { lineChart } from "../ui/chart.js";

/**
 * @param {NetworkInterface} item
 * @returns {HTMLElement}
 */
function interfaceRow(item) {
  return el(
    "tr",
    {},
    el("td", { class: "table-text" }, item.name),
    el(
      "td",
      {},
      el(
        "span",
        {
          class: `container-status ${item.isUp === null ? "neutral" : item.isUp ? "success" : "warning"}`,
        },
        el("i", { class: "status-dot", "aria-hidden": "true" }),
        item.isUp === null ? "未提供" : item.isUp ? "已连接" : "未连接",
      ),
    ),
    el("td", { class: "table-number" }, bytes(item.rx, true)),
    el("td", { class: "table-number" }, bytes(item.tx, true)),
    el("td", { class: "table-number" }, bitrate(item.speed)),
    el("td", { class: "table-number" }, bytes(item.rxTotal)),
    el("td", { class: "table-number" }, bytes(item.txTotal)),
  );
}

/** @type {ViewDefinition} */
export const networkView = {
  id: "network",
  eyebrow: "NETWORK",
  title: "网络流量",
  description: "各网络接口的实时速率、链路状态与累计流量。",
  mount(element) {
    const status = el("span", { class: "panel-status neutral" }, "等待采集");
    const select = el(
      "select",
      { class: "interface-select", "aria-label": "选择接口图表" },
      el("option", { value: "all" }, "全部接口"),
    );
    const rx = el("strong");
    const tx = el("strong");
    const canvas = el("canvas", {
      role: "img",
      "aria-label": "所选接口的接收与发送速率趋势，单位 MiB 每秒。",
    });
    const empty = el("div", { class: "chart-empty" }, "等待采集网络数据");
    const chartPanel = el(
      "section",
      { class: "widget-panel detail-panel span" },
      panelHeading("速率趋势", "network", status, select),
      el(
        "div",
        { class: "network-summary" },
        el(
          "span",
          { class: "network-rate" },
          icon("arrow-down"),
          el("span", {}, "接收速率", rx),
        ),
        el(
          "span",
          { class: "network-rate upload" },
          icon("arrow-up"),
          el("span", {}, "发送速率", tx),
        ),
      ),
      el("div", { class: "chart-area detail-chart" }, canvas, empty),
      el(
        "div",
        { class: "panel-footnote" },
        "速率单位为 MiB/s；累计流量为 Glances 提供的接口计数器。",
      ),
    );
    const tableStatus = el(
      "span",
      { class: "panel-status neutral" },
      "等待采集",
    );
    const body = el("tbody");
    const table = el(
      "table",
      { class: "container-table", "aria-label": "网络接口明细" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { scope: "col" }, "接口"),
          el("th", { scope: "col" }, "链路状态"),
          el("th", { scope: "col" }, "接收速率"),
          el("th", { scope: "col" }, "发送速率"),
          el("th", { scope: "col" }, "链路速度"),
          el("th", { scope: "col" }, "累计接收"),
          el("th", { scope: "col" }, "累计发送"),
        ),
      ),
      body,
    );
    const tablePanel = el(
      "section",
      { class: "widget-panel detail-panel span" },
      panelHeading("接口明细", "network", tableStatus),
      el(
        "div",
        {
          class: "table-scroll",
          tabindex: "0",
          role: "region",
          "aria-label": "网络接口明细表格",
        },
        table,
      ),
    );
    element.append(
      el(
        "div",
        { class: "section-toolbar" },
        el("h2", {}, "实时明细"),
        el(
          "div",
          { class: "history-toolbar" },
          el("span", { class: "history-label" }, "趋势窗口"),
          windowControl(),
        ),
      ),
      el("div", { class: "detail-grid single" }, chartPanel),
      el("div", { class: "detail-grid single" }, tablePanel),
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
      updateStatus(
        tableStatus,
        moduleStatus(
          snapshot.errors.network ? [snapshot.errors.network] : [],
          !metrics.interfaces.length,
        ),
      );
      body.replaceChildren(
        ...(metrics.interfaces.length
          ? metrics.interfaces.map(interfaceRow)
          : [
              el(
                "tr",
                {},
                el(
                  "td",
                  { colspan: "7", class: "table-empty" },
                  snapshot.errors.network ||
                    (metrics.interfaces.length
                      ? "接口未提供每秒速率"
                      : "未发现匹配的网络接口"),
                ),
              ),
            ]),
      );
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
