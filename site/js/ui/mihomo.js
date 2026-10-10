// @ts-check

/** @typedef {import("../core/types.js").WidgetContext} WidgetContext */
import { bytes, time } from "../core/format.js";
import { mihomoStaleMs } from "../core/mihomo.js";
import { lineChart } from "./chart.js";
import { el, icon, panelHeading, updateStatus } from "./dom.js";

/** @param {Pick<WidgetContext, "mihomo"|"paused"|"demo">} context */
export function mihomoStatus(context) {
  const { mihomo, paused, demo } = context;
  // A slower Glances interval must not hide a stale live-source reading.
  const stale =
    mihomo.lastSuccess > 0 && Date.now() - mihomo.lastSuccess > mihomoStaleMs;
  if (paused)
    return { text: demo ? "演示已暂停" : "已暂停更新", tone: "neutral" };
  if (demo) return { text: "演示数据", tone: "neutral" };
  if (stale) return { text: "数据已过期", tone: "warning" };
  const states = {
    idle: { text: "尚未连接", tone: "neutral" },
    loading: { text: "正在连接", tone: "neutral" },
    online: { text: "已采集", tone: "success" },
    partial: { text: "部分数据不可用", tone: "warning" },
    offline: { text: "连接中断", tone: "warning" },
  };
  return states[mihomo.connection];
}

/**
 * One presentation owner for overview and detail: both consume the same source
 * state and history, without fetching data or holding their own sample buffers.
 * @param {HTMLElement} element
 * @param {boolean} [detail=false]
 */
export function mountMihomoPanel(element, detail = false) {
  const status = el(
    "span",
    { class: "panel-status neutral", "data-mihomo-status": "" },
    "等待采集",
  );
  const down = el("strong", { "data-mihomo": "down" }, "--");
  const up = el("strong", { "data-mihomo": "up" }, "--");
  const facts = el("div", { class: "fact-grid mihomo-facts" });
  /** @type {Record<string, HTMLElement>} */
  const values = {};
  for (const [key, label] of [
    ["connections", "活跃连接"],
    ["memory", "内核内存"],
    ["downloadTotal", "累计下载"],
    ["uploadTotal", "累计上传"],
    ["version", "内核版本"],
  ]) {
    const value = el("strong", { "data-mihomo": key }, "--");
    values[key] = value;
    facts.append(
      el("div", { class: "fact-row" }, el("span", {}, label), value),
    );
  }
  const canvas = el("canvas", {
    role: "img",
    "aria-label": "mihomo 上传与下载区间平均速率趋势",
  });
  const empty = el(
    "div",
    { class: "chart-empty" },
    "等待下一次采样以计算平均速率",
  );
  const footnote = el("div", { class: "panel-footnote mihomo-footnote" });
  element.append(
    panelHeading("mihomo 监控", "plug-zap", status),
    el(
      "div",
      { class: "network-summary" },
      el(
        "span",
        { class: "network-rate" },
        icon("arrow-down"),
        el("span", {}, "下载", down),
      ),
      el(
        "span",
        { class: "network-rate upload" },
        icon("arrow-up"),
        el("span", {}, "上传", up),
      ),
    ),
    facts,
    el(
      "div",
      { class: `chart-area ${detail ? "detail-chart" : "network-chart"}` },
      canvas,
      empty,
    ),
    footnote,
  );
  if (!detail) {
    // Compact overview links open sibling detail pages without new polling.
    element.append(
      el(
        "nav",
        { class: "mihomo-shortcuts", "aria-label": "mihomo 明细入口" },
        el("a", { href: "#mihomo-connections" }, "查看连接"),
        el("a", { href: "#mihomo-usage" }, "查看用量"),
      ),
    );
  }
  const chart = lineChart(canvas, [
    { key: "rx", label: "下载", color: "--color-network", fill: true },
    { key: "tx", label: "上传", color: "--color-upload" },
  ]);
  return {
    /** @param {WidgetContext} context */
    update(context) {
      const { mihomo, config, windowMinutes, demo } = context;
      const metrics = mihomo.metrics;
      down.textContent = bytes(metrics.down, true);
      up.textContent = bytes(metrics.up, true);
      values.connections.textContent =
        metrics.connections === null ? "--" : String(metrics.connections);
      values.memory.textContent = bytes(metrics.memory);
      values.downloadTotal.textContent = bytes(metrics.downloadTotal);
      values.uploadTotal.textContent = bytes(metrics.uploadTotal);
      values.version.textContent = metrics.version || "--";
      updateStatus(status, mihomoStatus(context));
      // Byte labels follow the same saved formatter preference as NAS charts.
      canvas.setAttribute(
        "aria-label",
        "mihomo 上传与下载区间平均速率趋势，单位与当前数据单位一致",
      );
      empty.hidden = mihomo.history.some(
        (point) => point.rx !== null || point.tx !== null,
      );
      empty.textContent = mihomo.error || "等待下一次采样以计算平均速率";
      const freshness = mihomo.lastSuccess
        ? `最后采集 ${time(mihomo.lastSuccess)} · 上海时间`
        : "尚未采集";
      const errors = Object.entries(mihomo.errors).map(
        ([key, error]) => `${key}：${error}`,
      );
      footnote.textContent = [
        "每秒读取，网络较慢时自动延后 · 区间平均速率 · 累计流量由内核统计，重启或重置后重新累计",
        demo ? "演示数据" : freshness,
        ...errors,
        !config.mihomo.url
          ? "请在导航栏的「监控设置」中填写 mihomo 同源代理地址。"
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      chart.update(mihomo.history, windowMinutes);
    },
    destroy: () => chart.destroy(),
  };
}
