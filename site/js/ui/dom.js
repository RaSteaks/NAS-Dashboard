// @ts-check

import { ICONS } from "./icons.js";

// Hydration mirrors lucide's createIcons(): attribute order is the icon's own
// defaults, then data-lucide, then the global attrs, then the placeholder's
// own attrs; the class list is merged separately and de-duplicated.

/**
 * @param {any} node
 * @returns {SVGElement}
 */
function createNode(node) {
  const [tag, attrs, children] = node;
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs))
    element.setAttribute(name, String(value));
  for (const child of children ?? []) element.append(createNode(child));
  return element;
}

const LIB = /** @type {Record<string, any>} */ (ICONS);

export function icons() {
  // Hydrate new placeholders once; metric refreshes must keep existing SVGs.
  for (const node of document.querySelectorAll("[data-lucide]:not(svg)")) {
    const name = node.getAttribute("data-lucide") ?? "";
    const iconNode = LIB[name];
    if (!iconNode) continue;
    const attrs = {
      ...iconNode[1],
      "data-lucide": name,
      "aria-hidden": "true",
      "stroke-width": 1.7,
    };
    for (const attr of node.attributes) attrs[attr.name] = attr.value;
    attrs.class = [
      ...new Set(["lucide", `lucide-${name}`, ...node.classList]),
    ].join(" ");
    node.replaceWith(createNode([iconNode[0], attrs, iconNode[2]]));
  }
}

/**
 * @param {string} name
 * @returns {HTMLElement}
 */
export function icon(name) {
  return el("i", { "data-lucide": name });
}

// API text always enters the DOM through textContent, never as HTML markup.
/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string>} [attributes={}]
 * @param {(Node|string)[]} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
export function $(id, type) {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing element: ${id}`);
  return node;
}

/**
 * @param {string} id
 * @param {string} value
 */
export function setText(id, value) {
  const node = $(id, HTMLElement);
  // Avoid repeating unchanged status announcements on each freshness tick.
  if (node.textContent !== value) node.textContent = value;
}

/**
 * @param {string} title
 * @param {string} iconName
 * @param {HTMLElement} status
 * @param {HTMLElement[]} actions
 * @returns {HTMLElement}
 */
export function panelHeading(title, iconName, status, ...actions) {
  return el(
    "div",
    { class: "panel-heading" },
    el("h3", {}, icon(iconName), title),
    el("div", { class: "panel-heading-actions" }, status, ...actions),
  );
}

/**
 * A detail card frame: quiet heading with icon plus an open body area.
 *
 * @param {string} title
 * @param {string} iconName
 * @returns {{card: HTMLElement, body: HTMLElement}}
 */
export function detailCard(title, iconName) {
  const body = el("div", { class: "detail-card-body" });
  const card = el(
    "article",
    { class: "detail-card" },
    el(
      "div",
      { class: "detail-card-heading" },
      el("h3", {}, icon(iconName), title),
    ),
    body,
  );
  return { card, body };
}

/**
 * Trend window segmented control. Buttons carry data-window so the shared
 * click handler and pressed-state sync cover every copy at once.
 *
 * @param {string} [label="趋势时间范围"]
 * @returns {HTMLElement}
 */
export function windowControl(label = "趋势时间范围") {
  return el(
    "div",
    { class: "segmented-control", role: "group", "aria-label": label },
    el(
      "button",
      { type: "button", "data-window": "5", "aria-pressed": "false" },
      "5 分钟",
    ),
    el(
      "button",
      { type: "button", "data-window": "15", "aria-pressed": "false" },
      "15 分钟",
    ),
  );
}

/**
 * @param {string[]} errors
 * @param {boolean} [empty=false]
 * @returns {{text: string, tone: string}}
 */
export function moduleStatus(errors, empty = false) {
  if (errors.length) return { text: "数据不可用", tone: "warning" };
  if (empty) return { text: "暂无数据", tone: "neutral" };
  return { text: "已采集", tone: "success" };
}

/**
 * @param {HTMLElement} element
 * @param {{text: string, tone: string}} status
 */
export function updateStatus(element, status) {
  element.className = `panel-status ${status.tone}`;
  element.textContent = status.text;
}
