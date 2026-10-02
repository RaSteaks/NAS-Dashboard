// @ts-check

/** @typedef {import("../core/types.js").ViewDefinition} ViewDefinition */
/** @typedef {import("../core/types.js").WidgetContext} WidgetContext */
import { bytes, decimal, uptime } from "../core/format.js";
import {
  detailCard,
  el,
  moduleStatus,
  panelHeading,
  updateStatus,
  windowControl,
} from "../ui/dom.js";
import { lineChart } from "../ui/chart.js";

/** @type {{key: "cpuUser"|"cpuSystem"|"cpuWait", label: string, tone: string}[]} */
const CPU_SEGMENTS = [
  { key: "cpuUser", label: "用户态", tone: "user" },
  { key: "cpuSystem", label: "内核态", tone: "system" },
  { key: "cpuWait", label: "I/O 等待", tone: "wait" },
];

/**
 * @param {number|null} value
 * @returns {string}
 */
function share(value) {
  return value === null ? "--" : `${decimal(value)}%`;
}

/**
 * @param {string} label
 * @param {string} value
 * @param {string} [warning=""]
 * @returns {HTMLElement}
 */
function factRow(label, value, warning = "") {
  return el(
    "div",
    { class: `fact-row ${warning}` },
    el("span", {}, label),
    el("strong", {}, value),
  );
}

/** @type {ViewDefinition} */
export const resourcesView = {
  id: "resources",
  eyebrow: "SYSTEM RESOURCES",
  title: "系统资源",
  description: "处理器、内存、负载与温度的完整读数。",
  mount(element) {
    const cpu = detailCard("处理器", "cpu");
    const cpuTotal = el("strong", {}, "--");
    const cpuBar = el("div", { class: "breakdown-bar" });
    const cpuLegend = el("div", { class: "breakdown-legend" });
    cpu.body.append(
      el("div", { class: "detail-value" }, cpuTotal, el("span", {}, "%")),
      cpuBar,
      cpuLegend,
    );

    const memory = detailCard("内存", "memory-stick");
    const memoryTotal = el("strong", {}, "--");
    const memoryMeter = el(
      "div",
      { class: "metric-meter" },
      el("span", { class: "memory-color-bg" }),
    );
    const memoryFacts = el("div", { class: "fact-list" });
    memory.body.append(
      el("div", { class: "detail-value" }, memoryTotal, el("span", {}, "%")),
      memoryMeter,
      memoryFacts,
    );

    const load = detailCard("系统负载", "gauge");
    const loadRows = el("div", { class: "fact-list" });
    load.body.append(loadRows);

    const sensors = detailCard("温度传感器", "thermometer");
    const sensorList = el("div", { class: "fact-list" });
    sensors.body.append(sensorList);

    const system = detailCard("系统信息", "server");
    const systemFacts = el("div", { class: "fact-list fact-grid" });
    system.body.append(systemFacts);
    system.card.classList.add("span");

    const cpuStatus = el("span", { class: "panel-status neutral" }, "等待采集");
    const cpuValue = el("strong");
    const cpuCanvas = el("canvas", {
      role: "img",
      "aria-label": "CPU 使用率趋势。当前数值见图例。",
    });
    const cpuEmpty = el("div", { class: "chart-empty" }, "等待采集资源数据");
    const cpuPanel = el(
      "section",
      { class: "widget-panel detail-panel" },
      panelHeading("CPU 趋势", "activity", cpuStatus),
      el(
        "div",
        { class: "chart-legend" },
        el(
          "span",
          {},
          el("i", { class: "legend-dot cpu-color-bg" }),
          "当前使用率",
          cpuValue,
        ),
      ),
      el("div", { class: "chart-area detail-chart" }, cpuCanvas, cpuEmpty),
    );

    const memoryStatus = el(
      "span",
      { class: "panel-status neutral" },
      "等待采集",
    );
    const memoryValue = el("strong");
    const memoryCanvas = el("canvas", {
      role: "img",
      "aria-label": "内存使用率趋势。当前数值见图例。",
    });
    const memoryEmpty = el("div", { class: "chart-empty" }, "等待采集资源数据");
    const memoryPanel = el(
      "section",
      { class: "widget-panel detail-panel" },
      panelHeading("内存趋势", "memory-stick", memoryStatus),
      el(
        "div",
        { class: "chart-legend" },
        el(
          "span",
          {},
          el("i", { class: "legend-dot memory-color-bg" }),
          "当前使用率",
          memoryValue,
        ),
      ),
      el(
        "div",
        { class: "chart-area detail-chart" },
        memoryCanvas,
        memoryEmpty,
      ),
    );

    element.append(
      el(
        "div",
        { class: "section-toolbar" },
        el("h2", {}, "使用趋势"),
        el(
          "div",
          { class: "history-toolbar" },
          el("span", { class: "history-label" }, "趋势窗口"),
          windowControl(),
        ),
      ),
      el(
        "div",
        { class: "detail-grid" },
        cpu.card,
        memory.card,
        load.card,
        sensors.card,
        system.card,
      ),
      el("div", { class: "detail-grid" }, cpuPanel, memoryPanel),
    );
    const cpuChart = lineChart(
      cpuCanvas,
      [{ key: "cpu", label: "CPU", color: "--color-primary", fill: true }],
      true,
    );
    const memoryChart = lineChart(
      memoryCanvas,
      [{ key: "memory", label: "内存", color: "--color-memory", fill: true }],
      true,
    );
    /** @type {HTMLElement[]} */
    const loadMeters = [];
    /** @type {HTMLElement[]} */
    const loadValues = [];
    const loadLabels = ["1 分钟", "5 分钟", "15 分钟"];
    const capacityValue = el("strong", {}, "--");
    loadRows.append(
      ...loadLabels.map((label) => {
        const value = el("strong", {}, "--");
        const meter = el("span", { class: "load-color-bg" });
        loadValues.push(value);
        loadMeters.push(meter);
        return el(
          "div",
          { class: "fact-row load-row" },
          el("span", {}, label),
          value,
          el("div", { class: "fact-meter" }, meter),
        );
      }),
      el(
        "div",
        { class: "fact-row" },
        el("span", {}, "参考容量"),
        capacityValue,
      ),
    );
    /**
     * @param {WidgetContext} context
     */
    const update = ({ metrics, snapshot, history, config, windowMinutes }) => {
      cpuTotal.textContent = decimal(metrics.cpu);
      cpuBar.replaceChildren(
        ...CPU_SEGMENTS.map((segment) => {
          const value = metrics[segment.key] ?? 0;
          const node = el("i", { class: `breakdown-seg ${segment.tone}` });
          node.style.width = `${Math.max(0, Math.min(100, value))}%`;
          return node;
        }),
      );
      cpuLegend.replaceChildren(
        ...CPU_SEGMENTS.map((segment) =>
          el(
            "span",
            {},
            el("i", { class: `legend-dot ${segment.tone}-bg` }),
            segment.label,
            el("strong", {}, share(metrics[segment.key])),
          ),
        ),
        el(
          "span",
          {},
          el("i", { class: "legend-dot neutral-bg" }),
          "逻辑核心",
          el(
            "strong",
            {},
            metrics.cores === null ? "--" : String(metrics.cores),
          ),
        ),
      );
      memoryTotal.textContent = decimal(metrics.memory);
      /** @type {HTMLElement} */ (memoryMeter.firstElementChild).style.width =
        `${Math.max(0, Math.min(100, metrics.memory ?? 0))}%`;
      memoryFacts.replaceChildren(
        factRow("已用", bytes(metrics.memoryUsed)),
        factRow("总量", bytes(metrics.memoryTotal)),
        factRow("剩余", bytes(metrics.memoryFree)),
      );
      metrics.load.forEach((value, index) => {
        loadValues[index].textContent = decimal(value, 2);
        loadMeters[index].style.width =
          metrics.cores === null || value === null
            ? "0%"
            : `${Math.max(0, Math.min(100, (value / metrics.cores) * 100))}%`;
      });
      if (metrics.cores === null) capacityValue.textContent = "--";
      else capacityValue.textContent = metrics.cores.toFixed(2);
      const threshold = config.thresholds.temperature;
      sensorList.replaceChildren(
        ...(metrics.sensors.length
          ? metrics.sensors.map((sensor) =>
              factRow(
                sensor.label,
                `${decimal(sensor.value, 0)} °C`,
                sensor.value >= threshold ? "warning" : "",
              ),
            )
          : [
              el(
                "div",
                { class: "panel-empty compact" },
                snapshot.errors.sensors || "未提供温度传感器",
              ),
            ]),
      );
      systemFacts.replaceChildren(
        factRow("主机名", metrics.hostname || config.name),
        factRow("操作系统", metrics.os || config.subtitle),
        factRow("已运行", uptime(metrics.uptime)),
        factRow(
          "逻辑核心",
          metrics.cores === null ? "--" : String(metrics.cores),
        ),
      );
      cpuValue.textContent = `${decimal(metrics.cpu)}%`;
      memoryValue.textContent = `${decimal(metrics.memory)}%`;
      updateStatus(
        cpuStatus,
        moduleStatus(
          snapshot.errors.cpu ? [snapshot.errors.cpu] : [],
          metrics.cpu === null,
        ),
      );
      updateStatus(
        memoryStatus,
        moduleStatus(
          snapshot.errors.mem ? [snapshot.errors.mem] : [],
          metrics.memory === null,
        ),
      );
      cpuEmpty.hidden = history.some((point) => point.cpu !== null);
      cpuEmpty.textContent = snapshot.errors.cpu || "等待采集资源数据";
      memoryEmpty.hidden = history.some((point) => point.memory !== null);
      memoryEmpty.textContent = snapshot.errors.mem || "等待采集资源数据";
      cpuChart.update(history, windowMinutes);
      memoryChart.update(history, windowMinutes);
    };
    return {
      update,
      destroy() {
        cpuChart.destroy();
        memoryChart.destroy();
      },
    };
  },
};
