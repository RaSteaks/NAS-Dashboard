// @ts-check

/** @typedef {import("../core/types.js").ViewDefinition} ViewDefinition */
import { el, panelHeading, windowControl } from "../ui/dom.js";
import { mountMihomoPanel } from "../ui/mihomo.js";
import { mihomoNavigation } from "../ui/mihomo-navigation.js";
import { lineChart } from "../ui/chart.js";
import { bytes, decimal } from "../core/format.js";

// The detail route reuses the source state; navigation creates no API requests.
/** @type {ViewDefinition} */
export const mihomoView = {
  id: "mihomo",
  eyebrow: "MIHOMO",
  title: "mihomo 监控",
  description: "流量、内存、连接趋势与出站分布，速率为相邻采样之间的平均值。",
  mount(element) {
    const panel = el("section", {
      class: "widget-panel detail-panel span",
      "aria-label": "mihomo 运行明细",
    });
    element.append(
      mihomoNavigation("mihomo"),
      el(
        "div",
        { class: "section-toolbar" },
        el("h2", {}, "运行明细"),
        el(
          "div",
          { class: "history-toolbar" },
          el("span", { class: "history-label" }, "趋势窗口"),
          windowControl(),
        ),
      ),
      el("div", { class: "detail-grid single" }, panel),
    );
    const summary = mountMihomoPanel(panel, true);
    /** @type {{update: (context: import("../core/types.js").WidgetContext) => void, destroy: () => void}[]} */
    const trends = [];
    const grid = el("div", { class: "detail-grid mihomo-trend-grid" });
    for (const [key, title, color] of /** @type {const} */ ([
      ["memory", "内存趋势", "--color-memory"],
      ["connections", "活跃连接趋势", "--color-network"],
    ])) {
      const value = el("strong", { "data-mihomo-trend": key });
      const canvas = el("canvas", {
        role: "img",
        "aria-label": `${title}，${key === "memory" ? "单位随数据单位设置" : "单位为条"}`,
      });
      const empty = el("div", { class: "chart-empty" }, "等待采集趋势数据");
      const card = el(
        "section",
        { class: "widget-panel detail-panel" },
        panelHeading(title, key === "memory" ? "activity" : "network", value),
        el("div", { class: "chart-area detail-chart" }, canvas, empty),
      );
      const chart = lineChart(
        canvas,
        [{ key, label: title, color, fill: true }],
        key === "memory" ? "bytes" : "count",
      );
      grid.append(card);
      trends.push({
        update(context) {
          const amount = context.mihomo.metrics[key];
          value.textContent =
            key === "memory"
              ? bytes(amount)
              : amount === null
                ? "--"
                : `${amount} 条`;
          empty.hidden = context.mihomo.history.some(
            (point) => point[key] != null,
          );
          chart.update(context.mihomo.history, context.windowMinutes);
        },
        destroy: chart.destroy,
      });
    }
    const directions = el("div", { class: "mihomo-breakdown" });
    const protocols = el("div", { class: "mihomo-breakdown" });
    const ranking = el("ol", { class: "mihomo-ranking" });
    const distribution = el(
      "div",
      { class: "detail-grid mihomo-trend-grid" },
      el(
        "section",
        { class: "widget-panel" },
        panelHeading("流量与协议分布", "network", el("span")),
        directions,
        protocols,
      ),
      el(
        "section",
        { class: "widget-panel" },
        panelHeading(
          "出站速率排行",
          "plug-zap",
          el("span", { class: "panel-footnote" }, "已加载的活跃连接"),
        ),
        ranking,
      ),
    );
    element.append(grid, distribution);
    return {
      update(context) {
        summary.update(context);
        trends.forEach((trend) => trend.update(context));
        const { mihomo } = context;
        const { downloadTotal: down, uploadTotal: up } = mihomo.metrics;
        const total = down !== null && up !== null ? down + up : null;
        const ratio =
          total !== null && total > 0 && down !== null
            ? (down / total) * 100
            : 0;
        directions.replaceChildren(
          el("div", { class: "mihomo-breakdown-heading" }, "累计流量方向"),
          el(
            "div",
            { class: "mihomo-flow-bar", "aria-hidden": "true" },
            el("span", { style: `width:${ratio}%` }),
            el("span", { style: `width:${total ? 100 - ratio : 0}%` }),
          ),
          el(
            "div",
            { class: "mihomo-split" },
            el(
              "span",
              {},
              `下载 ${total === null ? "--" : decimal(ratio)}% · ${bytes(down)}`,
            ),
            el(
              "span",
              {},
              `上传 ${total === null ? "--" : decimal(total ? 100 - ratio : 0)}% · ${bytes(up)}`,
            ),
          ),
        );
        const counts = { TCP: 0, UDP: 0, 其他: 0 };
        for (const row of mihomo.activeConnections)
          counts[
            row.network === "TCP"
              ? "TCP"
              : row.network === "UDP"
                ? "UDP"
                : "其他"
          ]++;
        protocols.replaceChildren(
          el(
            "div",
            { class: "mihomo-breakdown-heading" },
            "已加载连接的协议分布",
          ),
          el(
            "div",
            { class: "mihomo-protocols" },
            ...Object.entries(counts).map(([name, count]) =>
              el(
                "span",
                {},
                name,
                el(
                  "strong",
                  {},
                  mihomo.detailsAvailable ? String(count) : "--",
                ),
              ),
            ),
          ),
          el(
            "p",
            { class: "field-hint" },
            mihomo.detailsTruncated
              ? `内核共 ${mihomo.metrics.connections ?? "--"} 条连接，图表基于已加载的 ${mihomo.activeConnections.length} 条。`
              : mihomo.detailsAvailable
                ? "与连接页共用采样，切换页面不增加请求。"
                : "当前代理未提供明细，请更新 PHP 代理。",
          ),
        );
        /** @type {Map<string, number>} */
        const outbound = new Map();
        for (const row of mihomo.activeConnections) {
          if (row.up === null || row.down === null) continue;
          const name = row.chains[0] || "未提供出站";
          outbound.set(name, (outbound.get(name) ?? 0) + row.up + row.down);
        }
        const top = [...outbound.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        ranking.replaceChildren(
          ...top.map(([name, speed]) =>
            el(
              "li",
              {},
              el("span", {}, name),
              el("strong", {}, bytes(speed, true)),
            ),
          ),
        );
        if (!top.length)
          ranking.append(
            el(
              "li",
              { class: "panel-empty compact" },
              mihomo.errors.connections
                ? "连接数据暂不可用"
                : "下一次有效连接采样后显示排行",
            ),
          );
      },
      destroy() {
        summary.destroy();
        trends.forEach((trend) => trend.destroy());
      },
    };
  },
};
