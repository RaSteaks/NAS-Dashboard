// @ts-check

/** @typedef {import("../core/types.js").WidgetDefinition} WidgetDefinition */
import { mountMihomoPanel } from "../ui/mihomo.js";

// Mihomo has its own transport; it never adds a Glances plugin request.
/** @type {WidgetDefinition} */
export const mihomoWidget = {
  id: "mihomo",
  title: "mihomo 监控",
  icon: "plug-zap",
  plugins: [],
  mount: (element) => mountMihomoPanel(element),
};
