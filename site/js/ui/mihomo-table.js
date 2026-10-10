// @ts-check

import { el } from "./dom.js";
import { heightPagination } from "./table-pagination.js";

/**
 * @template T
 * @typedef {object} Column
 * @property {string} key
 * @property {string} title
 * @property {(row: T) => Node|string} render
 * @property {(row: T) => string|number|null} [sort]
 */

/**
 * Shared read-only table frame. Sorting and pagination stay local, preserve the
 * data-source snapshot, and reuse the app's row-height pagination owner.
 * @template T
 * @param {string} label
 * @param {Column<T>[]} columns
 * @param {string} [defaultSort=""]
 */
export function mihomoTable(label, columns, defaultSort = "") {
  let sort = defaultSort;
  let descending = true;
  /** @type {T[]} */
  let rows = [];
  let emptyText = "暂无数据";
  const body = el("tbody");
  /** @type {Map<string, HTMLElement>} */
  const headings = new Map();
  const header = el("tr");
  for (const column of columns) {
    const th = el("th", { scope: "col" });
    if (column.sort) {
      const button = el(
        "button",
        {
          type: "button",
          class: "sort-button",
          "aria-label": `按${column.title}排序`,
        },
        column.title,
      );
      button.addEventListener("click", () => {
        descending = sort === column.key ? !descending : true;
        sort = column.key;
        pagination.resetPage();
        draw();
      });
      th.append(button);
      headings.set(column.key, th);
    } else th.textContent = column.title;
    header.append(th);
  }
  const table = el(
    "table",
    { class: "container-table mihomo-table", "aria-label": label },
    el("thead", {}, header),
    body,
  );
  const viewport = el(
    "div",
    {
      class: "table-scroll mihomo-table-viewport",
      tabindex: "0",
      role: "region",
      "aria-label": label,
    },
    table,
  );
  const pagination = heightPagination(table, viewport, label, "条");
  const element = el(
    "div",
    {},
    el(
      "p",
      { class: "field-hint mihomo-table-help" },
      "横向滚动可查看超出区域的字段。",
    ),
    viewport,
    pagination.footer,
  );
  function draw() {
    const focused =
      document.activeElement instanceof HTMLElement &&
      body.contains(document.activeElement)
        ? document.activeElement.dataset.rowKey
        : undefined;
    const column = columns.find((item) => item.key === sort);
    const sorted = [...rows];
    if (column?.sort) {
      const value = column.sort;
      sorted.sort((a, b) => {
        const left = value(a),
          right = value(b);
        if (left === null) return right === null ? 0 : 1;
        if (right === null) return -1;
        const result =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right), "zh-CN", {
                numeric: true,
              });
        return descending ? -result : result;
      });
    }
    pagination.update(
      sorted.map((row) =>
        el(
          "tr",
          {},
          ...columns.map((item) =>
            el("td", { class: "mihomo-cell" }, item.render(row)),
          ),
        ),
      ),
      emptyText,
    );
    // Preserve keyboard focus on a still-visible row action during live polls.
    if (focused) {
      const replacement = [
        ...body.querySelectorAll("button[data-row-key]"),
      ].find(
        (button) =>
          button instanceof HTMLElement && button.dataset.rowKey === focused,
      );
      if (replacement instanceof HTMLElement)
        replacement.focus({ preventScroll: true });
    }
    for (const [key, th] of headings)
      th.setAttribute(
        "aria-sort",
        sort === key ? (descending ? "descending" : "ascending") : "none",
      );
  }
  draw();
  return {
    element,
    /** @param {T[]} nextRows @param {string} [empty="暂无数据"] */
    update(nextRows, empty = "暂无数据") {
      rows = nextRows;
      emptyText = empty;
      draw();
    },
    resetPage: pagination.resetPage,
    destroy: pagination.destroy,
  };
}
