// @ts-check

/** @typedef {import("../core/types.js").WidgetDefinition} WidgetDefinition */
import { bytes, decimal } from "../core/format.js";
import {
  el,
  icon,
  moduleStatus,
  panelHeading,
  updateStatus,
} from "../ui/dom.js";

/** @type {WidgetDefinition} */
export const storageWidget = {
  id: "storage",
  title: "存储空间",
  icon: "hard-drive",
  plugins: ["fs"],
  mount(element) {
    const status = el("span", { class: "panel-status neutral" }, "等待采集");
    const summary = el("div", { class: "storage-summary" });
    const list = el("div", { class: "volume-list" });
    element.append(
      panelHeading("存储空间", "hard-drive", status),
      summary,
      list,
    );
    return {
      update({ metrics, snapshot, config }) {
        const volumes = metrics.volumes;
        // Sum only complete volume readings; missing capacity is not free space.
        const free =
          volumes.length && volumes.every((volume) => volume.free !== null)
            ? volumes.reduce((sum, volume) => sum + (volume.free ?? 0), 0)
            : null;
        summary.replaceChildren(
          el("span", {}, "可用空间", el("strong", {}, bytes(free))),
          el("span", { class: "storage-count" }, `${volumes.length} 个存储卷`),
        );
        updateStatus(
          status,
          moduleStatus(
            snapshot.errors.fs ? [snapshot.errors.fs] : [],
            !volumes.length,
          ),
        );
        if (!volumes.length) {
          list.replaceChildren(
            el(
              "div",
              { class: "panel-empty" },
              icon("hard-drive"),
              el("p", {}, snapshot.errors.fs || "未发现匹配的存储卷"),
            ),
          );
          return;
        }
        list.replaceChildren(
          ...volumes.map((volume, index) => {
            const warning =
              volume.percent !== null &&
              volume.percent >= config.thresholds.storage;
            const meter = el("meter", {
              min: "0",
              max: "100",
              value: String(volume.percent ?? 0),
              "aria-label": `${volume.mount} 已用 ${decimal(volume.percent)}%`,
              class: `volume-meter ${warning ? "warning" : ""} ${index % 2 ? "secondary" : ""}`,
            });
            meter.hidden = volume.percent === null;
            return el(
              "article",
              { class: "volume-row" },
              el(
                "div",
                { class: "volume-heading" },
                el("span", { class: "volume-symbol" }, icon("hard-drive")),
                el(
                  "div",
                  { class: "volume-name" },
                  el("strong", {}, volume.mount),
                  el("span", {}, volume.type || "文件系统未提供"),
                ),
                el(
                  "span",
                  { class: `volume-percent ${warning ? "warning-text" : ""}` },
                  `${decimal(volume.percent)}%`,
                ),
              ),
              meter,
              el(
                "div",
                { class: "volume-caption" },
                el(
                  "span",
                  {},
                  `已用 ${bytes(volume.used)} / ${bytes(volume.size)}`,
                ),
                el("span", {}, `剩余 ${bytes(volume.free)}`),
              ),
            );
          }),
        );
      },
      destroy() {},
    };
  },
};
