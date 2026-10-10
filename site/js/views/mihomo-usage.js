// @ts-check

/** @typedef {import("../core/types.js").WidgetContext} Context */
/** @typedef {import("../core/types.js").MihomoUsageDimension} Dimension */
/** @typedef {import("../core/types.js").ViewDefinition} ViewDefinition */
/** @typedef {{label: string, upload: number, download: number, total: number}} Group */
import { aggregateUsage } from "../core/mihomo-usage.js";
import { bytes } from "../core/format.js";
import { el, panelHeading, updateStatus } from "../ui/dom.js";
import { mihomoStatus } from "../ui/mihomo.js";
import { mihomoNavigation, mihomoDate } from "../ui/mihomo-navigation.js";
import { mihomoTable } from "../ui/mihomo-table.js";
import { lineChart } from "../ui/chart.js";

// All usage comes from the same page-session observations. Routing and the
// overview's short trend window never truncate these accumulated byte totals.
/** @type {ViewDefinition} */
export const mihomoUsageView = {
  id: "mihomo-usage",
  moduleId: "mihomo",
  eyebrow: "MIHOMO / USAGE",
  title: "mihomo 用量",
  description:
    "统计本次打开页面后采样到的连接流量增量，按设备、域名、出站、进程或规则查看。",
  mount(element) {
    const status = el("span", {
      class: "panel-status neutral",
      "data-mihomo-status": "",
    });
    const group = el(
      "select",
      { id: "mihomo-usage-group" },
      ...[
        ["sourceIP", "设备"],
        ["host", "域名 / 目标"],
        ["outbound", "出站节点"],
        ["process", "进程"],
        ["rule", "规则"],
      ].map(([value, label]) => el("option", { value }, label)),
    );
    const range = el("p", { class: "mihomo-usage-range" });
    const summary = el("div", { class: "summary-chips mihomo-usage-summary" });
    /** @type {Record<string, HTMLElement>} */
    const totals = {};
    for (const [key, title] of [
      ["download", "已采样下载"],
      ["upload", "已采样上传"],
      ["total", "已采样总用量"],
      ["groups", "统计项"],
    ]) {
      totals[key] = el("strong", { "data-mihomo-usage": key }, "--");
      summary.append(
        el(
          "div",
          { class: "summary-chip" },
          el("span", {}, title),
          totals[key],
        ),
      );
    }
    const canvas = el("canvas", {
      role: "img",
      "aria-label": "本次打开页面后的采样用量趋势，单位为字节换算单位",
    });
    const empty = el(
      "div",
      { class: "chart-empty" },
      "等待相邻有效连接采样以统计用量",
    );
    const chart = lineChart(
      canvas,
      [
        { key: "rx", label: "下载用量", color: "--color-network", fill: true },
        { key: "tx", label: "上传用量", color: "--color-upload" },
      ],
      "bytes",
    );
    const chartHint = el("p", { class: "panel-footnote mihomo-footnote" });
    const rankings = el("ol", { class: "mihomo-ranking" });
    /** @type {Context|undefined} */
    let context;
    let selected = "";
    let total = 0;
    /** @type {import("../ui/mihomo-table.js").Column<Group>[]} */
    const columns = [
      {
        key: "label",
        title: "统计对象",
        sort: (row) => row.label,
        render: (row) => row.label,
      },
      {
        key: "download",
        title: "下载用量",
        sort: (row) => row.download,
        render: (row) => bytes(row.download),
      },
      {
        key: "upload",
        title: "上传用量",
        sort: (row) => row.upload,
        render: (row) => bytes(row.upload),
      },
      {
        key: "total",
        title: "总用量",
        sort: (row) => row.total,
        render: (row) => bytes(row.total),
      },
      {
        key: "share",
        title: "占总用量",
        render: (row) =>
          `${total > 0 ? ((row.total / total) * 100).toFixed(1) : "0.0"}%`,
      },
      {
        key: "detail",
        title: "明细",
        render(row) {
          const button = el(
            "button",
            {
              type: "button",
              class: "button button-outline mihomo-detail-button",
              "aria-label": `查看 ${row.label} 的用量明细`,
              "data-row-key": row.label,
            },
            "查看明细",
          );
          button.addEventListener("click", () => {
            selected = row.label;
            draw();
          });
          return button;
        },
      },
    ];
    const table = mihomoTable("mihomo 用量排行", columns, "total");
    const detailTitle = el("span");
    const clear = el(
      "button",
      { type: "button", class: "button button-outline" },
      "收起明细",
    );
    const details = mihomoTable(
      "mihomo 用量分类明细",
      columns.slice(0, 5),
      "total",
    );
    const detailPanel = el(
      "section",
      { class: "widget-panel mihomo-usage-detail", hidden: "" },
      panelHeading("分类明细", "network", detailTitle, clear),
      details.element,
    );
    clear.addEventListener("click", () => {
      selected = "";
      draw();
      group.focus();
    });
    const draw = () => {
      if (!context) return;
      const { mihomo } = context;
      const dimension = /** @type {Dimension} */ (group.value);
      const rows = aggregateUsage(mihomo.usageRecords, dimension);
      const upload = rows.reduce((sum, row) => sum + row.upload, 0);
      const download = rows.reduce((sum, row) => sum + row.download, 0);
      total = upload + download;
      totals.upload.textContent = bytes(mihomo.usageHasSamples ? upload : null);
      totals.download.textContent = bytes(
        mihomo.usageHasSamples ? download : null,
      );
      totals.total.textContent = bytes(mihomo.usageHasSamples ? total : null);
      totals.groups.textContent = mihomo.usageHasSamples
        ? String(rows.length)
        : "--";
      range.textContent = context.demo
        ? "演示会话：模拟采样用量，刷新页面后重新开始"
        : mihomo.usageStartedAt
          ? `统计范围：本次打开页面 · 首个有效采样 ${mihomoDate(mihomo.usageStartedAt)} · 刷新页面后重新开始`
          : "统计范围：本次打开页面，等待首个有效采样";
      updateStatus(status, mihomoStatus(context));
      const unavailable = !mihomo.detailsAvailable
        ? "当前代理未提供连接明细，请更新 PHP 代理"
        : !mihomo.usageHasSamples
          ? "等待下一次有效连接采样以统计用量"
          : "有效采样中尚未记录流量增量";
      table.update(rows, unavailable);
      rankings.replaceChildren(
        ...rows
          .slice(0, 5)
          .map((row) =>
            el(
              "li",
              {},
              el("span", {}, row.label),
              el("strong", {}, bytes(row.total)),
            ),
          ),
      );
      if (!rows.length)
        rankings.append(
          el("li", { class: "panel-empty compact" }, unavailable),
        );
      empty.hidden = mihomo.usageHasSamples;
      empty.textContent = unavailable;
      const history = mihomo.usageHistory;
      const minutes = history.length
        ? Math.max(
            1,
            ((history.at(-1)?.timestamp ?? 0) - history[0].timestamp) / 60000 +
              mihomo.usageBucketMs / 60000,
          )
        : 15;
      chart.update(history, minutes);
      chartHint.textContent = `每 ${mihomo.usageBucketMs / 60000} 分钟汇总，保留本次打开以来的全部已采样用量。首次采样用于计数基线；暂停、后台、失败及短连接可能造成统计缺口。${mihomo.detailsTruncated ? " 当前连接明细已截取，统计仅覆盖已加载的连接。" : ""}`;
      detailPanel.hidden = !selected;
      if (selected) {
        detailTitle.textContent = `${selected} · ${dimension === "host" ? "按设备" : "按目标"}`;
        const filtered = mihomo.usageRecords.filter(
          (row) => (row[dimension] || "未提供") === selected,
        );
        details.update(
          aggregateUsage(filtered, dimension === "host" ? "sourceIP" : "host"),
          "暂无分类明细",
        );
      }
    };
    group.addEventListener("change", () => {
      selected = "";
      table.resetPage();
      draw();
    });
    element.append(
      mihomoNavigation("mihomo-usage"),
      el(
        "div",
        { class: "section-toolbar" },
        el("h2", {}, "本次打开后的用量"),
        el(
          "div",
          { class: "mihomo-filter mihomo-usage-select" },
          el("label", { for: group.id }, "统计维度"),
          group,
        ),
      ),
      range,
      summary,
      el(
        "div",
        { class: "detail-grid mihomo-trend-grid" },
        el(
          "section",
          { class: "widget-panel" },
          panelHeading("采样用量趋势", "activity", status),
          el("div", { class: "chart-area detail-chart" }, canvas, empty),
          chartHint,
        ),
        el(
          "section",
          { class: "widget-panel" },
          panelHeading("用量前五名", "network", el("span")),
          rankings,
        ),
      ),
      el(
        "section",
        { class: "widget-panel" },
        panelHeading("用量排行", "network", el("span")),
        table.element,
      ),
      detailPanel,
    );
    return {
      update(next) {
        context = next;
        draw();
      },
      destroy() {
        chart.destroy();
        table.destroy();
        details.destroy();
      },
    };
  },
};
