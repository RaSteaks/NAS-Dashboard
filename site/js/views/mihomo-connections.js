// @ts-check

/** @typedef {import("../core/types.js").MihomoConnection} Connection */
/** @typedef {import("../core/types.js").WidgetContext} Context */
/** @typedef {import("../core/types.js").ViewDefinition} ViewDefinition */
import { bytes } from "../core/format.js";
import { el, icon, icons, panelHeading, updateStatus } from "../ui/dom.js";
import { mihomoStatus } from "../ui/mihomo.js";
import {
  mihomoNavigation,
  mihomoDate,
  connectionTarget,
  connectionSource,
} from "../ui/mihomo-navigation.js";
import { mihomoTable } from "../ui/mihomo-table.js";

/** @param {string} main @param {string} [secondary=""] */
function cell(main, secondary = "") {
  return el(
    "div",
    { class: "mihomo-two-line" },
    el("span", {}, main || "--"),
    ...(secondary ? [el("small", {}, secondary)] : []),
  );
}

// Connection inspection is entirely snapshot-driven: no DELETE/close actions,
// reverse-DNS requests or persistent storage of browsing metadata.
/** @type {ViewDefinition} */
export const mihomoConnectionsView = {
  id: "mihomo-connections",
  moduleId: "mihomo",
  eyebrow: "MIHOMO / CONNECTIONS",
  title: "mihomo 连接",
  description:
    "查看活跃连接与本页观察到的近期结束连接，按目标、来源、进程、规则和链路筛选。",
  mount(element) {
    const status = el("span", {
      class: "panel-status neutral",
      "data-mihomo-status": "",
    });
    const summary = el("div", { class: "mihomo-connection-summary" });
    const hint = el("p", { class: "panel-footnote mihomo-footnote" });
    const search = el("input", {
      id: "mihomo-connection-search",
      type: "search",
      placeholder: "域名、IP、进程、规则或链路",
      autocomplete: "off",
      spellcheck: "false",
    });
    const clear = el(
      "button",
      {
        type: "button",
        class: "icon-button",
        "aria-label": "清除连接搜索",
        hidden: "",
      },
      icon("x"),
    );
    const state = el(
      "select",
      { id: "mihomo-connection-state" },
      el("option", { value: "active" }, "活跃连接"),
      el("option", { value: "closed" }, "近期结束"),
    );
    const network = el(
      "select",
      { id: "mihomo-connection-network" },
      ...[
        ["all", "全部协议"],
        ["TCP", "TCP"],
        ["UDP", "UDP"],
        ["other", "其他协议"],
      ].map(([value, label]) => el("option", { value }, label)),
    );
    const filters = el(
      "div",
      { class: "mihomo-filters" },
      el(
        "div",
        { class: "mihomo-filter mihomo-search" },
        el("label", { for: search.id }, "搜索连接"),
        el("div", { class: "mihomo-search-control" }, search, clear),
      ),
      el(
        "div",
        { class: "mihomo-filter" },
        el("label", { for: state.id }, "连接状态"),
        state,
      ),
      el(
        "div",
        { class: "mihomo-filter" },
        el("label", { for: network.id }, "网络协议"),
        network,
      ),
    );
    /** @type {Context|undefined} */
    let context;
    /** @type {Connection|undefined} */
    let selected;
    const detailBody = el("div", { class: "dialog-body" });
    const close = el(
      "button",
      { type: "button", class: "button button-outline" },
      "关闭详情",
    );
    const dialog = el(
      "dialog",
      {
        class: "settings-dialog mihomo-connection-dialog",
        "aria-labelledby": "mihomo-connection-title",
      },
      el(
        "div",
        { class: "dialog-heading" },
        el("h2", { id: "mihomo-connection-title" }, "连接详情"),
      ),
      detailBody,
      el("div", { class: "dialog-footer" }, close),
    );
    close.addEventListener("click", () => dialog.close());
    const restoreFocus = () => {
      if (element.hidden) {
        selected = undefined;
        return;
      }
      const button = [
        ...element.querySelectorAll("button[data-connection-id]"),
      ].find(
        (item) =>
          item instanceof HTMLElement &&
          item.dataset.connectionId === selected?.id,
      );
      if (button instanceof HTMLElement) button.focus();
      else search.focus();
      selected = undefined;
    };
    dialog.addEventListener("close", restoreFocus);
    const drawDetail = () => {
      if (!selected) return;
      const latest = context
        ? [
            ...context.mihomo.activeConnections,
            ...context.mihomo.closedConnections,
          ].find((row) => row.id === selected?.id)
        : undefined;
      if (latest) selected = latest;
      const rows = [
        ["目标", connectionTarget(selected)],
        ["目标 IP", selected.destinationIP],
        ["来源", connectionSource(selected)],
        [
          "协议 / 入站",
          [selected.network, selected.type, selected.inboundName]
            .filter(Boolean)
            .join(" · "),
        ],
        ["进程", selected.process],
        ["进程路径", selected.processPath],
        [
          "规则",
          [selected.rule, selected.rulePayload].filter(Boolean).join(" · "),
        ],
        ["代理链", [...selected.chains].reverse().join(" → ")],
        [
          "累计下载 / 上传",
          `${bytes(selected.download)} / ${bytes(selected.upload)}`,
        ],
        [
          "下载 / 上传速率",
          `${bytes(selected.down, true)} / ${bytes(selected.up, true)}`,
        ],
        ["建立时间", mihomoDate(selected.start)],
        [
          "连接状态",
          selected.closedAt !== null
            ? `本页于 ${mihomoDate(selected.closedAt)} 观察到结束`
            : "活跃连接",
        ],
      ];
      detailBody.replaceChildren(
        el(
          "div",
          { class: "fact-list" },
          ...rows.map(([label, value]) =>
            el(
              "div",
              { class: "fact-row" },
              el("span", {}, label),
              el("strong", {}, value || "--"),
            ),
          ),
        ),
      );
    };
    /** @type {import("../ui/mihomo-table.js").Column<Connection>[]} */
    const columns = [
      {
        key: "host",
        title: "目标",
        sort: connectionTarget,
        render: (row) =>
          cell(connectionTarget(row), row.host ? row.destinationIP : ""),
      },
      {
        key: "source",
        title: "来源 / 进程",
        sort: (row) => row.sourceIP,
        render: (row) => cell(row.sourceIP, row.process),
      },
      {
        key: "network",
        title: "协议 / 入站",
        render: (row) => cell(row.network, row.type),
      },
      {
        key: "rule",
        title: "规则",
        render: (row) => cell(row.rule, row.rulePayload),
      },
      {
        key: "chains",
        title: "代理链",
        render: (row) => [...row.chains].reverse().join(" → ") || "--",
      },
      {
        key: "down",
        title: "下载速率",
        sort: (row) => row.down,
        render: (row) => bytes(row.down, true),
      },
      {
        key: "up",
        title: "上传速率",
        sort: (row) => row.up,
        render: (row) => bytes(row.up, true),
      },
      {
        key: "download",
        title: "累计下载",
        sort: (row) => row.download,
        render: (row) => bytes(row.download),
      },
      {
        key: "upload",
        title: "累计上传",
        sort: (row) => row.upload,
        render: (row) => bytes(row.upload),
      },
      {
        key: "start",
        title: "建立时间",
        sort: (row) => row.start,
        render: (row) => mihomoDate(row.start),
      },
      {
        key: "detail",
        title: "详情",
        render(row) {
          const button = el(
            "button",
            {
              type: "button",
              class: "button button-outline mihomo-detail-button",
              "aria-label": `查看连接 ${connectionTarget(row)} 的详情`,
              "data-connection-id": row.id,
              "data-row-key": row.id,
            },
            "详情",
          );
          button.addEventListener("click", () => {
            selected = row;
            drawDetail();
            dialog.showModal();
            close.focus();
          });
          return button;
        },
      },
    ];
    const table = mihomoTable("mihomo 连接列表", columns, "down");
    const draw = () => {
      if (!context) return;
      const { mihomo } = context;
      const query = search.value.trim().toLocaleLowerCase("zh-CN");
      clear.hidden = !search.value;
      const rows =
        state.value === "closed"
          ? mihomo.closedConnections
          : mihomo.activeConnections;
      const filtered = rows.filter(
        (row) =>
          (network.value === "all" ||
            (network.value === "other"
              ? !["TCP", "UDP"].includes(row.network)
              : row.network === network.value)) &&
          (!query ||
            [
              connectionTarget(row),
              row.sourceIP,
              row.process,
              row.processPath,
              row.rule,
              row.rulePayload,
              ...row.chains,
            ]
              .join(" ")
              .toLocaleLowerCase("zh-CN")
              .includes(query)),
      );
      updateStatus(status, mihomoStatus(context));
      summary.replaceChildren(
        el(
          "span",
          {},
          "活跃连接 ",
          el("strong", {}, String(mihomo.metrics.connections ?? "--")),
        ),
        el(
          "span",
          {},
          "已加载明细 ",
          el(
            "strong",
            {},
            mihomo.detailsAvailable
              ? String(mihomo.activeConnections.length)
              : "--",
          ),
        ),
        el(
          "span",
          {},
          "近期结束 ",
          el("strong", {}, String(mihomo.closedConnections.length)),
        ),
      );
      hint.textContent = [
        mihomo.errors.connections || "",
        mihomo.detailsAvailable
          ? mihomo.detailsTruncated
            ? "已截取最多 500 条活跃连接；不根据截取后的列表推断连接结束。"
            : "近期结束仅包含本页观察到离开活跃列表的连接，最多保留 200 条。"
          : mihomo.lastSuccess
            ? "当前代理未提供连接明细，请更新站点的 PHP 代理。"
            : "等待连接采样。",
        "速率为相邻有效采样的平均值，首次观察显示 --。",
      ]
        .filter(Boolean)
        .join(" ");
      table.update(
        filtered,
        mihomo.errors.connections ||
          (query || network.value !== "all"
            ? "没有符合条件的连接"
            : !mihomo.detailsAvailable
              ? "尚无连接明细"
              : state.value === "closed"
                ? "本次打开后尚未观察到结束的连接"
                : "暂无活跃连接"),
      );
      if (dialog.open) drawDetail();
    };
    let composing = false;
    search.addEventListener("compositionstart", () => {
      composing = true;
    });
    search.addEventListener("compositionend", () => {
      composing = false;
      table.resetPage();
      draw();
    });
    search.addEventListener("input", () => {
      if (!composing) {
        table.resetPage();
        draw();
      }
    });
    clear.addEventListener("click", () => {
      search.value = "";
      composing = false;
      table.resetPage();
      draw();
      search.focus();
    });
    for (const select of [state, network])
      select.addEventListener("change", () => {
        table.resetPage();
        draw();
      });
    element.append(
      mihomoNavigation("mihomo-connections"),
      el(
        "section",
        { class: "widget-panel" },
        panelHeading("连接明细", "network", status),
        summary,
        filters,
        table.element,
        hint,
      ),
      dialog,
    );
    icons();
    return {
      update(next) {
        context = next;
        draw();
      },
      destroy() {
        table.destroy();
        dialog.removeEventListener("close", restoreFocus);
        if (dialog.open) dialog.close();
        dialog.remove();
      },
    };
  },
};
