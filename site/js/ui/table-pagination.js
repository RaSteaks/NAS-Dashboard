// @ts-check

import { el, icons } from "./dom.js";

/**
 * Paginate a native table by measured row heights, including wrapped names.
 * The viewport must have a content-independent height so rows cannot resize it.
 * @param {HTMLTableElement} table
 * @param {HTMLElement} viewport
 * @param {string} label
 * @param {string} unit
 */
export function heightPagination(table, viewport, label, unit) {
  const body = table.tBodies[0];
  const count = el("span", { "aria-live": "polite", "aria-atomic": "true" });
  const previous = el(
    "button",
    {
      type: "button",
      class: "pagination-button",
      "aria-label": `上一页${label}`,
    },
    "上一页",
  );
  const next = el(
    "button",
    {
      type: "button",
      class: "pagination-button",
      "aria-label": `下一页${label}`,
    },
    "下一页",
  );
  const controls = el(
    "div",
    { class: "pagination", hidden: "" },
    previous,
    next,
  );
  const footer = el("div", { class: "table-footer" }, count, controls);
  /** @type {HTMLTableRowElement[]} */
  let rows = [];
  let emptyText = "暂无数据";
  let page = 0;
  let starts = [0];
  let frame = 0;

  function render() {
    const start = starts[page];
    const end = starts[page + 1] ?? rows.length;
    body.replaceChildren(...rows.slice(start, end));
    if (!rows.length)
      body.append(
        el(
          "tr",
          {},
          el(
            "td",
            {
              colspan: String(table.tHead?.rows[0]?.cells.length ?? 1),
              class: "table-empty",
            },
            emptyText,
          ),
        ),
      );
    const paginated = starts.length > 1;
    const text = paginated
      ? `${start + 1}–${end} / ${rows.length} ${unit}`
      : `${rows.length} ${unit}`;
    if (count.textContent !== text) count.textContent = text;
    // Keep the footer's height stable when all rows fit and controls disappear.
    if (!paginated && controls.contains(document.activeElement))
      viewport.focus({ preventScroll: true });
    controls.hidden = !paginated;
    previous.disabled = page === 0;
    next.disabled = page >= starts.length - 1;
  }

  function layout() {
    // Hidden routes have no geometry; ResizeObserver retries on their return.
    if (!viewport.clientHeight || !viewport.clientWidth) return;
    const anchor = starts[page] ?? 0;
    body.replaceChildren(...rows);
    icons();
    const available = Math.max(
      0,
      viewport.clientHeight -
        (table.tHead?.getBoundingClientRect().height ?? 0),
    );
    starts = [0];
    let used = 0;
    rows.forEach((row, index) => {
      const height = row.getBoundingClientRect().height;
      if (index > (starts.at(-1) ?? 0) && used + height > available) {
        starts.push(index);
        used = 0;
      }
      // An unusually tall row owns one page and remains vertically scrollable.
      used += height;
    });
    // Preserve the visible position on resize; smaller datasets clamp safely.
    page = starts.reduce(
      (last, start, index) => (start <= anchor ? index : last),
      0,
    );
    render();
  }

  const schedule = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        layout();
      });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(viewport);
  if (table.tHead) observer.observe(table.tHead);
  previous.addEventListener("click", () => {
    page = Math.max(0, page - 1);
    viewport.scrollTop = 0;
    render();
  });
  next.addEventListener("click", () => {
    page = Math.min(starts.length - 1, page + 1);
    viewport.scrollTop = 0;
    render();
  });

  return {
    footer,
    /** @param {HTMLTableRowElement[]} nextRows @param {string} empty */
    update(nextRows, empty) {
      rows = nextRows;
      emptyText = empty;
      layout();
    },
    resetPage() {
      page = 0;
      viewport.scrollTop = 0;
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
