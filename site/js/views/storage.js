// @ts-check

/** @typedef {import("../core/types.js").Volume} Volume */
/** @typedef {import("../core/types.js").ViewDefinition} ViewDefinition */
/** @typedef {import("../core/types.js").WidgetContext} WidgetContext */
import { bytes, decimal } from "../core/format.js";
import { detailCard, el, icon } from "../ui/dom.js";

/**
 * @param {Volume[]} volumes
 * @param {(volume: Volume) => number|null} pick
 * @returns {number|null}
 */
function sum(volumes, pick) {
  // Aggregate only complete readings; a missing size is not zero capacity.
  const values = volumes.map(pick);
  return values.length && values.every((value) => value !== null)
    ? values.reduce((total, value) => total + (value ?? 0), 0)
    : null;
}

/**
 * @param {Volume} volume
 * @param {number} threshold
 * @returns {HTMLElement}
 */
function volumeCard(volume, threshold) {
  const warning = volume.percent !== null && volume.percent >= threshold;
  const meter = el("meter", {
    min: "0",
    max: "100",
    value: String(volume.percent ?? 0),
    "aria-label": `${volume.mount} 已用 ${decimal(volume.percent)}%`,
    class: `volume-meter ${warning ? "warning" : ""}`,
  });
  meter.hidden = volume.percent === null;
  return el(
    "article",
    { class: "volume-card" },
    el(
      "div",
      { class: "volume-heading" },
      el("span", { class: "volume-symbol" }, icon("hard-drive")),
      el(
        "div",
        { class: "volume-name" },
        el("strong", {}, volume.mount),
        el(
          "span",
          { class: "volume-device" },
          `${volume.type || "文件系统未提供"} · ${volume.device || "设备未提供"}`,
        ),
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
      el("span", {}, `已用 ${bytes(volume.used)} / ${bytes(volume.size)}`),
      el("span", {}, `剩余 ${bytes(volume.free)}`),
    ),
  );
}

/** @type {ViewDefinition} */
export const storageView = {
  id: "storage",
  eyebrow: "STORAGE",
  title: "存储空间",
  description: "各存储卷的容量、占用与剩余空间。",
  mount(element) {
    const summary = detailCard("容量汇总", "hard-drive");
    summary.card.classList.add("span");
    const size = el("strong", {}, "--");
    const used = el("strong", {}, "--");
    const free = el("strong", {}, "--");
    const count = el("strong", {}, "0");
    summary.body.append(
      el(
        "div",
        { class: "summary-chips" },
        el("span", { class: "summary-chip" }, el("span", {}, "总容量"), size),
        el("span", { class: "summary-chip" }, el("span", {}, "已用空间"), used),
        el("span", { class: "summary-chip" }, el("span", {}, "可用空间"), free),
        el(
          "span",
          { class: "summary-chip" },
          el("span", {}, "存储卷数量"),
          count,
        ),
      ),
    );
    const listHeading = el("h2", {}, "存储卷明细");
    const list = el("div", { class: "volume-cards" });
    element.append(
      summary.card,
      el("div", { class: "section-toolbar" }, listHeading),
      list,
    );
    return {
      update({ metrics, snapshot, config }) {
        const volumes = metrics.volumes;
        size.textContent = bytes(sum(volumes, (volume) => volume.size));
        used.textContent = bytes(sum(volumes, (volume) => volume.used));
        free.textContent = bytes(sum(volumes, (volume) => volume.free));
        count.textContent = String(volumes.length);
        list.replaceChildren(
          ...(volumes.length
            ? volumes.map((volume) =>
                volumeCard(volume, config.thresholds.storage),
              )
            : [
                el(
                  "div",
                  { class: "panel-empty span" },
                  icon("hard-drive"),
                  el("p", {}, snapshot.errors.fs || "未发现匹配的存储卷"),
                ),
              ]),
        );
      },
      destroy() {},
    };
  },
};
