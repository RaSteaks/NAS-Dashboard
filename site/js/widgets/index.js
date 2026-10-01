// @ts-check

/** @typedef {import("../core/types.js").Plugin} Plugin */
/** @typedef {import("../core/types.js").WidgetDefinition} WidgetDefinition */
/** @typedef {import("../core/types.js").WidgetId} WidgetId */
import { resourcesWidget } from "./resources.js";
import { storageWidget } from "./storage.js";
import { networkWidget } from "./network.js";
import { containersWidget } from "./containers.js";

// Register future widgets here; polling and settings derive from this registry.
/** @type {WidgetDefinition[]} */
export const widgets = [
  resourcesWidget,
  networkWidget,
  storageWidget,
  containersWidget,
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
