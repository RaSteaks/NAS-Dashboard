// @ts-check

/** @typedef {import("../core/types.js").ViewDefinition} ViewDefinition */
import { resourcesView } from "./resources.js";
import { storageView } from "./storage.js";
import { networkView } from "./network.js";
import { containersView } from "./containers.js";
import { mihomoView } from "./mihomo.js";
import { mihomoConnectionsView } from "./mihomo-connections.js";
import { mihomoUsageView } from "./mihomo-usage.js";

// Detail views mount lazily. Mihomo's three sibling pages share one module and
// source context, without starting additional network requests on navigation.
/** @type {ViewDefinition[]} */
export const detailViews = [
  resourcesView,
  storageView,
  networkView,
  containersView,
  mihomoView,
  mihomoConnectionsView,
  mihomoUsageView,
];

/** @type {{eyebrow: string, title: string, description: string}} */
const overviewMeta = {
  eyebrow: "NAS MONITOR",
  title: "运行概览",
  description: "设备的每一刻，尽在掌握。",
};

/**
 * Heading metadata for a view id; unknown ids fall back to the overview.
 *
 * @param {string} id
 * @returns {{eyebrow: string, title: string, description: string}}
 */
export function viewMeta(id) {
  return detailViews.find((view) => view.id === id) ?? overviewMeta;
}
