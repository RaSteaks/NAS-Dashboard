// @ts-check

/** @typedef {import("../core/types.js").Container} Container */
/** @typedef {import("../core/types.js").ViewDefinition} ViewDefinition */
/** @typedef {import("../core/types.js").WidgetContext} WidgetContext */
import { bytes, decimal } from "../core/format.js";
import {
  detailCard,
  el,
  icon,
  moduleStatus,
  panelHeading,
  updateStatus,
} from "../ui/dom.js";
import { heightPagination } from "../ui/table-pagination.js";
import { containerStatus } from "../widgets/containers.js";

/**
 * @param {Container[]} containers
 * @param {(container: Container) => number|null} pick
 * @returns {number|null}
 */
function sum(containers, pick) {
  // Aggregates require complete readings; unknown stays unknown, not zero.
  const values = containers.map(pick);
  return values.length && values.every((value) => value !== null)
    ? values.reduce((total, value) => total + (value ?? 0), 0)
    : null;
}

/**
 * @param {Container} container
 * @returns {HTMLTableRowElement}
 */
function containerRow(container) {
  const value = containerStatus(container);
  return el(
    "tr",
    {},
    el(
      "td",
      {},
      el(
        "div",
        { class: "container-name" },
        el("span", { class: "container-symbol" }, icon("box")),
        el(
          "div",
          {},
          el("strong", {}, container.name),
          el(
            "span",
            { class: "container-image", title: container.image },
            container.image,
          ),
        ),
      ),
    ),
    el(
      "td",
      {},
      el(
        "span",
        { class: `container-status ${value.tone}` },
        el("i", { class: "status-dot", "aria-hidden": "true" }),
        value.label,
      ),
    ),
    el("td", { class: "table-number" }, `${decimal(container.cpu)}%`),
    el("td", { class: "table-number" }, bytes(container.memory)),
  );
}

/** @type {ViewDefinition} */
export const containersView = {
  id: "containers",
  eyebrow: "CONTAINERS",
  title: "容器服务",
  description: "Docker 容器运行状态与资源占用明细。",
  mount(element) {
    const summary = detailCard("运行汇总", "boxes");
    summary.card.classList.add("span");
    const total = el("strong", {}, "0");
    const running = el("strong", {}, "0");
    const stopped = el("strong", {}, "0");
    const cpu = el("strong", {}, "--");
    const memory = el("strong", {}, "--");
    summary.body.append(
      el(
        "div",
        { class: "summary-chips" },
        el(
          "span",
          { class: "summary-chip" },
          el("span", {}, "容器总数"),
          total,
        ),
        el(
          "span",
          { class: "summary-chip success" },
          el("span", {}, "运行中"),
          running,
        ),
        el(
          "span",
          { class: "summary-chip" },
          el("span", {}, "未运行"),
          stopped,
        ),
        el("span", { class: "summary-chip" }, el("span", {}, "CPU 合计"), cpu),
        el(
          "span",
          { class: "summary-chip" },
          el("span", {}, "内存合计"),
          memory,
        ),
      ),
    );
    const state = el("span", { class: "panel-status neutral" }, "等待采集");
    const filter = el(
      "select",
      { "aria-label": "筛选容器明细", class: "interface-select" },
      el("option", { value: "all" }, "全部容器"),
      el("option", { value: "running" }, "运行中"),
      el("option", { value: "stopped" }, "已停止"),
    );
    /** @type {{key: "name"|"cpu"|"memory", dir: "asc"|"desc"}} */
    let sort = { key: "name", dir: "asc" };
    const nameHeader = el("th", { scope: "col" });
    const cpuHeader = el("th", { scope: "col" });
    const memoryHeader = el("th", { scope: "col" });
    /**
     * @param {HTMLElement} header
     * @param {"name"|"cpu"|"memory"} key
     * @param {string} label
     */
    const sortHeader = (header, key, label) => {
      const button = el(
        "button",
        { type: "button", class: "sort-button" },
        label,
      );
      button.addEventListener("click", () => {
        sort =
          sort.key === key
            ? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
            : { key, dir: key === "name" ? "asc" : "desc" };
        pagination.resetPage();
        draw();
      });
      header.append(button);
    };
    sortHeader(nameHeader, "name", "容器名称");
    sortHeader(cpuHeader, "cpu", "CPU");
    sortHeader(memoryHeader, "memory", "内存");
    const body = el("tbody");
    const table = el(
      "table",
      { class: "container-table", "aria-label": "容器明细数据" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          nameHeader,
          el("th", { scope: "col" }, "状态"),
          cpuHeader,
          memoryHeader,
        ),
      ),
      body,
    );
    const viewport = el(
      "div",
      {
        class: "table-scroll",
        tabindex: "0",
        role: "region",
        "aria-label": "容器明细表格",
      },
      table,
    );
    const pagination = heightPagination(table, viewport, "容器明细", "个容器");
    const tablePanel = el(
      "section",
      { class: "widget-panel detail-panel container-panel span" },
      panelHeading("容器明细", "boxes", state, filter),
      viewport,
      pagination.footer,
    );
    element.append(summary.card, tablePanel);
    /** @type {Container[]} */
    let containers = [];
    /** @type {string|undefined} */
    let error;
    // Sort before fitting pages so every container remains reachable locally.
    const draw = () => {
      const filtered = containers.filter(
        (item) =>
          filter.value === "all" ||
          (filter.value === "running"
            ? containerStatus(item).isRunning
            : containerStatus(item).label === "已停止"),
      );
      const factor = sort.dir === "asc" ? 1 : -1;
      const sorted = [...filtered].sort((a, b) => {
        if (sort.key === "name") return a.name.localeCompare(b.name) * factor;
        const left = a[sort.key];
        const right = b[sort.key];
        // Unknown values always sink to the bottom, whatever the direction.
        if (left === null) return right === null ? 0 : 1;
        if (right === null) return -1;
        return (left - right) * factor;
      });
      updateStatus(
        state,
        moduleStatus(error ? [error] : [], !containers.length),
      );
      const headers = {
        name: nameHeader,
        cpu: cpuHeader,
        memory: memoryHeader,
      };
      for (const [key, header] of Object.entries(headers))
        header.setAttribute(
          "aria-sort",
          key === sort.key
            ? sort.dir === "asc"
              ? "ascending"
              : "descending"
            : "none",
        );
      pagination.update(
        sorted.map(containerRow),
        error ||
          (containers.length
            ? "没有符合条件的容器"
            : "暂无容器数据，请检查 Glances 容器监控"),
      );
    };
    filter.addEventListener("change", () => {
      pagination.resetPage();
      draw();
    });
    return {
      update({ metrics, snapshot }) {
        containers = metrics.containers;
        error = snapshot.errors.containers;
        const runningCount = containers.filter(
          (item) => containerStatus(item).isRunning,
        ).length;
        total.textContent = String(containers.length);
        running.textContent = String(runningCount);
        stopped.textContent = String(containers.length - runningCount);
        cpu.textContent = `${decimal(sum(containers, (item) => item.cpu))}%`;
        memory.textContent = bytes(sum(containers, (item) => item.memory));
        draw();
      },
      destroy: pagination.destroy,
    };
  },
};
