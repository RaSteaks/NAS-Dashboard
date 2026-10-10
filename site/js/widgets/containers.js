// @ts-check

/** @typedef {import("../core/types.js").Container} Container */
/** @typedef {import("../core/types.js").WidgetDefinition} WidgetDefinition */
import { bytes, decimal } from "../core/format.js";
import {
  el,
  icon,
  moduleStatus,
  panelHeading,
  updateStatus,
} from "../ui/dom.js";
import { heightPagination } from "../ui/table-pagination.js";

/**
 * @param {Pick<Container, "status">} container
 * @returns {{label: string, tone: string, isRunning: boolean}}
 */
export function containerStatus(container) {
  const value = container.status.toLowerCase();
  // Newer Glances versions replace running with Docker health-check states.
  if (value === "healthy")
    return { label: "健康", tone: "success", isRunning: true };
  if (value === "unhealthy")
    return { label: "不健康", tone: "warning", isRunning: true };
  if (value === "starting")
    return { label: "启动中", tone: "warning", isRunning: true };
  if (value === "running" || value.startsWith("up "))
    return { label: "运行中", tone: "success", isRunning: true };
  if (["exited", "stopped", "created"].includes(value))
    return { label: "已停止", tone: "neutral", isRunning: false };
  if (value === "paused")
    return { label: "已暂停", tone: "warning", isRunning: false };
  if (value === "restarting")
    return { label: "重启中", tone: "warning", isRunning: false };
  return {
    label: value === "unknown" ? "未提供" : container.status,
    tone: "neutral",
    isRunning: false,
  };
}

/** @type {WidgetDefinition} */
export const containersWidget = {
  id: "containers",
  title: "容器服务",
  icon: "boxes",
  plugins: ["containers"],
  mount(element) {
    const state = el("span", { class: "panel-status neutral" }, "等待采集");
    const filter = el(
      "select",
      { "aria-label": "筛选容器状态", class: "interface-select" },
      el("option", { value: "all" }, "全部容器"),
      el("option", { value: "running" }, "运行中"),
      el("option", { value: "stopped" }, "已停止"),
    );
    const body = el("tbody");
    const table = el(
      "table",
      { class: "container-table", "aria-label": "容器运行数据" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { scope: "col" }, "容器名称"),
          el("th", { scope: "col" }, "状态"),
          el("th", { scope: "col" }, "CPU"),
          el("th", { scope: "col" }, "内存"),
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
        "aria-label": "容器数据表格",
      },
      table,
    );
    const pagination = heightPagination(table, viewport, "容器", "个容器");
    element.classList.add("container-panel");
    element.append(
      panelHeading("容器服务", "boxes", state, filter),
      viewport,
      pagination.footer,
    );
    /** @type {Container[]} */
    let containers = [];
    /** @type {string|undefined} */
    let error;
    // Fit all available rows before paging; filters reuse the same NAS snapshot.
    const draw = () => {
      const filtered = containers.filter(
        (item) =>
          filter.value === "all" ||
          (filter.value === "running"
            ? containerStatus(item).isRunning
            : containerStatus(item).label === "已停止"),
      );
      updateStatus(
        state,
        moduleStatus(error ? [error] : [], !containers.length),
      );
      pagination.update(
        filtered.map((container) => {
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
        }),
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
        draw();
      },
      destroy: pagination.destroy,
    };
  },
};
