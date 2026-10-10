// @ts-check

/** @typedef {import("../core/types.js").Plugin} Plugin */
/** @typedef {import("../core/types.js").WidgetDefinition} WidgetDefinition */
/** @typedef {import("../core/types.js").WidgetId} WidgetId */
import { resourcesWidget } from "./resources.js";
import { storageWidget } from "./storage.js";
import { networkWidget } from "./network.js";
import { containersWidget } from "./containers.js";
import { mihomoWidget } from "./mihomo.js";

// Settings derive from this registry; the optional mihomo source declares no
// Glances plugins and is scheduled independently by the application.
/** @type {WidgetDefinition[]} */
export const widgets = [
  resourcesWidget,
  networkWidget,
  storageWidget,
  containersWidget,
  mihomoWidget,
];

/**
 * @param {WidgetId[]} enabled
 * @returns {Plugin[]}
 */
export function requiredPlugins(enabled) {
  return [
    ...new Set(
      /** @type {Plugin[]} */ ([
        "system",
        "uptime",
        "cpu",
        "mem",
        "load",
        "sensors",
        ...widgets
          .filter((widget) => enabled.includes(widget.id))
          .flatMap((widget) => widget.plugins),
      ]),
    ),
  ];
}
