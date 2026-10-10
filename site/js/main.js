// @ts-check

/** @typedef {import("./core/types.js").Config} Config */
/** @typedef {import("./core/types.js").HistoryPoint} HistoryPoint */
/** @typedef {import("./core/types.js").Metrics} Metrics */
/** @typedef {import("./core/types.js").Snapshot} Snapshot */
/** @typedef {import("./core/types.js").MihomoSnapshot} MihomoSnapshot */
/** @typedef {import("./core/types.js").ViewDefinition} ViewDefinition */
/** @typedef {import("./core/types.js").WidgetContext} WidgetContext */
/** @typedef {import("./core/types.js").WidgetDefinition} WidgetDefinition */
/** @typedef {import("./core/types.js").WidgetId} WidgetId */
import {
  defaults,
  loadConfig,
  normalizeApiAddress,
  saveSettings,
  validateApi,
} from "./core/config.js";
import { fetchSnapshot, requestError } from "./core/api.js";
import { demoHistory, demoSnapshot } from "./core/demo.js";
import { bytes, decimal, setByteUnits, time, uptime } from "./core/format.js";
import { normalize } from "./core/metrics.js";
import { Poller } from "./core/poller.js";
import {
  MihomoMonitor,
  demoMihomoSnapshot,
  fetchMihomoSnapshot,
  hasMihomoData,
  mihomoRefreshMs,
  mihomoStaleMs,
} from "./core/mihomo.js";
import { mihomoStatus } from "./ui/mihomo.js";
import { $, el, icon, icons, setText, updateStatus } from "./ui/dom.js";
import { requiredPlugins, widgets } from "./widgets/index.js";
import { detailViews, viewMeta } from "./views/index.js";

/** @type {Config} */
let config = structuredClone(defaults);
let demo = new URL(location.href).searchParams.get("demo") === "1";
let paused = false;
let windowMinutes = 15;
let currentView = "overview";
/** @type {import("./core/poller.js").Poller<Snapshot>|undefined} */
let poller;
/** @type {import("./core/poller.js").Poller<MihomoSnapshot>|undefined} */
let mihomoPoller;
let mihomo = new MihomoMonitor(config);
// Source guards prevent overlap while live reads leave Glances refresh usable.
/** @type {Set<"glances"|"mihomo">} */
const busySources = new Set();
/** @type {Snapshot|undefined} */
let snapshot;
/** @type {Metrics|undefined} */
let metrics;
/** @type {HistoryPoint[]} */
let history = [];
let lastSuccess = 0;
/** @type {"idle"|"loading"|"online"|"partial"|"offline"} */
let connection = "idle";
let connectionError = "";
let configError = "";
let storageWarning = "";
/** @type {AbortController|undefined} */
let testController;
/** @type {AbortController|undefined} */
let mihomoTestController;
/** @type {HTMLElement|undefined} */
let returnFocus;
/** @type {Map<WidgetId, ReturnType<WidgetDefinition["mount"]>>} */
const mounted = new Map();
/** @type {Map<string, ReturnType<ViewDefinition["mount"]>>} */
const viewInstances = new Map();
const viewIds = new Set(["overview", ...detailViews.map((view) => view.id)]);
const dialog = $("settings-dialog", HTMLDialogElement);

/**
 * @param {string} message
 * @param {string} [action=""]
 * @param {string} [tone="info"]
 */
function notice(message, action = "", tone = "info") {
  $("notice", HTMLElement).hidden = !message;
  $("notice", HTMLElement).className = `notice ${tone}`;
  setText("notice-text", message);
  setText("notice-action", action);
  // Notices offer data retries only; settings live in the shared navigation.
  $("notice-action", HTMLButtonElement).hidden = !action;
}

function renderConnection() {
  const sources = [
    ...(demo || config.api.url
      ? [
          {
            name: "Glances",
            connection,
            lastSuccess,
            error: connectionError,
            errors: snapshot?.errors ?? {},
            staleAfterMs: Math.max(15000, config.refreshSeconds * 3000),
          },
        ]
      : []),
    ...(mihomoActive()
      ? [{ name: "mihomo", ...mihomo.state, staleAfterMs: mihomoStaleMs }]
      : []),
  ];
  const stale = sources.some(
    (source) =>
      source.lastSuccess > 0 &&
      Date.now() - source.lastSuccess > source.staleAfterMs,
  );
  const overall = !sources.length
    ? "idle"
    : sources.every((source) => source.connection === "online")
      ? "online"
      : sources.some((source) =>
            ["online", "partial"].includes(source.connection),
          )
        ? "partial"
        : sources.some((source) => source.connection === "loading")
          ? "loading"
          : "offline";
  const states = {
    idle: "尚未连接",
    loading: "正在连接",
    online: "已连接",
    partial: "部分数据不可用",
    offline: "连接中断",
  };
  const text = paused ? "已暂停更新" : stale ? "数据已过期" : states[overall];
  setText(
    "connection-text",
    demo ? (paused ? "演示已暂停" : "演示采样") : text,
  );
  $("connection-status", HTMLElement).className =
    `status-label ${demo || paused ? "neutral" : overall === "online" && !stale ? "success" : "warning"}`;
  $("device-dot", HTMLElement).className =
    `status-dot ${connection === "online" && !stale && !demo ? "success" : "neutral"}`;
  setText(
    "source-badge",
    demo
      ? "演示数据"
      : sources.length
        ? `${sources.map((source) => source.name.toUpperCase()).join(" + ")} API`
        : "未连接",
  );
  $("source-badge", HTMLElement).className =
    `source-badge ${demo ? "demo" : ""}`;
  setText(
    "refresh-label",
    mihomoActive()
      ? [
          ...(demo || config.api.url
            ? [`Glances 每 ${config.refreshSeconds} 秒`]
            : []),
          "mihomo 每秒",
        ].join(" · ")
      : `每 ${config.refreshSeconds} 秒更新`,
  );
  const successes = sources
    .map((source) => source.lastSuccess)
    .filter((value) => value > 0);
  const updated = successes.length ? Math.min(...successes) : 0;
  setText(
    "last-updated",
    updated ? `最后更新 ${time(updated)} · 上海时间` : "尚未更新 · 上海时间",
  );
  setText(
    "footer-status",
    demo
      ? "演示采样"
      : paused
        ? "自动更新已暂停"
        : overall === "online" && !stale
          ? `${sources.map((source) => source.name).join(" 与 ")} 已连接`
          : text,
  );
  // Freshness ticks update status text only, without repainting every chart.
  for (const status of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll("[data-mihomo-status]")
  ))
    updateStatus(status, mihomoStatus({ mihomo: mihomo.state, paused, demo }));
  if (configError)
    notice(
      `${configError} 请在导航栏的「监控设置」中检查连接配置。`,
      "",
      "warning",
    );
  else if (!sources.length && !demo)
    notice(
      "尚未连接 NAS，请在导航栏的「监控设置」中填写 Glances API 地址，或启用 mihomo 监控。",
    );
  else if (overall === "offline")
    notice(
      `${sources.map((source) => `${source.name}：${source.error || "接口未提供监控数据"}`).join("；")}。${updated ? "显示最后一次采集结果。" : "请检查地址或网络后重试。"}`,
      "重试",
      "warning",
    );
  else if (overall === "partial")
    notice(
      `部分指标无法读取：${sources
        .filter((source) => source.connection !== "online")
        .map(
          (source) =>
            `${source.name} ${Object.keys(source.errors).join("、") || source.error || "正在连接"}`,
        )
        .join("；")}。`,
      "重试",
      "warning",
    );
  else if (stale && !demo && !paused)
    notice("数据已过期，正在等待新的采样。", "重试", "warning");
  else if (storageWarning) notice(storageWarning);
  else notice("");
}

/**
 * @param {string} id
 * @param {number|null} value
 * @param {number} threshold
 */
function metricState(id, value, threshold) {
  setText(
    `${id}-state`,
    value === null ? "未提供" : value >= threshold ? "偏高" : "正常",
  );
  $(`${id}-state`, HTMLElement).className =
    value !== null && value >= threshold ? "warning-text" : "";
}

/**
 * @param {Metrics} current
 */
function renderOverview(current) {
  setText("hostname", current.hostname || config.name);
  setText("system-info", current.os || config.subtitle);
  setText("uptime-value", uptime(current.uptime));
  setText("cpu-value", decimal(current.cpu));
  setText("memory-value", decimal(current.memory));
  $("cpu-meter", HTMLElement).style.width =
    `${Math.max(0, Math.min(100, current.cpu ?? 0))}%`;
  $("memory-meter", HTMLElement).style.width =
    `${Math.max(0, Math.min(100, current.memory ?? 0))}%`;
  setText(
    "cpu-detail",
    current.cores !== null ? `${current.cores} 逻辑核心` : "核心数未提供",
  );
  setText(
    "memory-detail",
    `${bytes(current.memoryUsed)} / ${bytes(current.memoryTotal)}`,
  );
  setText("load-value", decimal(current.load[0], 2));
  setText("load-five", decimal(current.load[1], 2));
  setText("load-fifteen", decimal(current.load[2], 2));
  setText(
    "load-detail",
    current.cores !== null
      ? `参考容量 ${current.cores.toFixed(2)}`
      : "核心数未提供",
  );
  setText("temperature-value", decimal(current.temperature, 0));
  setText(
    "temperature-title",
    /cpu|package|core|k10temp/i.test(current.temperatureLabel)
      ? "CPU 温度"
      : "设备温度",
  );
  setText("temperature-detail", current.temperatureLabel || "未提供温度传感器");
  $("temperature-marker", HTMLElement).hidden = current.temperature === null;
  $("temperature-marker", HTMLElement).style.left =
    `${Math.max(0, Math.min(100, current.temperature ?? 0))}%`;
  metricState("cpu", current.cpu, config.thresholds.cpu);
  metricState("memory", current.memory, config.thresholds.memory);
  metricState("load", current.load[0], current.cores ?? Infinity);
  metricState(
    "temperature",
    current.temperature,
    config.thresholds.temperature,
  );
  for (const id of ["cpu", "memory", "load", "temperature"]) {
    const value =
      id === "load"
        ? current.load[0]
        : current[/** @type {"cpu"|"memory"|"temperature"} */ (id)];
    const card = /** @type {HTMLElement|null} */ (
      document.querySelector(`[data-metric="${id}"]`)
    );
    if (card) card.dataset.available = String(value !== null);
  }
}

/** Update only the affected module during live reads. @param {WidgetId} [moduleId] */
function renderAll(moduleId) {
  if (!snapshot || !metrics) return;
  /** @type {WidgetContext} */
  const context = {
    metrics,
    snapshot,
    history,
    config,
    windowMinutes,
    mihomo: mihomo.state,
    paused,
    demo,
  };
  for (const [id, widget] of mounted)
    if (!moduleId || moduleId === id) widget.update(context);
  for (const [id, view] of viewInstances) {
    const owner =
      detailViews.find((definition) => definition.id === id)?.moduleId ?? id;
    if (!moduleId || moduleId === owner) view.update(context);
  }
  icons();
}

/** Sync every trend window copy after lazy views add their own buttons. */
function syncWindowButtons() {
  for (const item of /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll("[data-window]")
  ))
    item.setAttribute(
      "aria-pressed",
      String(Number(item.dataset.window) === windowMinutes),
    );
}

/**
 * @param {string} id
 * @returns {boolean}
 */
function viewEnabled(id) {
  // Several mihomo pages belong to one optional module; disabling it hides all
  // sibling routes while their navigation still highlights the parent module.
  return (
    id === "overview" ||
    config.widgets.includes(
      /** @type {WidgetId} */ (
        detailViews.find((view) => view.id === id)?.moduleId ?? id
      ),
    )
  );
}

/**
 * @returns {string}
 */
function currentRoute() {
  const id = location.hash.slice(1);
  return viewIds.has(id) ? id : "overview";
}

/**
 * Switch the visible view. Mounts happen after reveal so charts measure a
 * real container; scroll only on user navigation, not on reconnects.
 *
 * @param {string} id
 * @param {boolean} [scroll=true]
 */
function showView(id, scroll = true) {
  if (!viewIds.has(id) || !viewEnabled(id)) id = "overview";
  const focusFromMihomo =
    document.activeElement instanceof HTMLElement &&
    Boolean(
      document.activeElement.closest(
        ".mihomo-subnav, .mihomo-shortcuts, .mihomo-connection-dialog",
      ),
    );
  currentView = id;
  for (const section of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll(".view")
  )) {
    // Browser Back can navigate while a view-owned dialog is open. Close it
    // before hiding its owner so no invisible modal can keep the page inert.
    if (section.dataset.view !== id)
      for (const modal of section.querySelectorAll("dialog[open]"))
        if (modal instanceof HTMLDialogElement) modal.close();
    section.hidden = section.dataset.view !== id;
  }
  if (id !== "overview" && !viewInstances.has(id)) {
    const definition = detailViews.find((view) => view.id === id);
    const host = document.getElementById(`view-${id}`);
    if (definition && host) {
      // Reconnects destroy instances but not their DOM; drop stale copies.
      host.replaceChildren();
      viewInstances.set(id, definition.mount(host));
    }
    syncWindowButtons();
  }
  const meta = viewMeta(id);
  setText("page-eyebrow", meta.eyebrow);
  setText("page-title-text", meta.title);
  setText("page-description", meta.description);
  setText("breadcrumb-view", meta.title);
  document.title = `${config.name} · ${meta.title}${demo ? " · 演示" : ""}`;
  // Sidebar and mobile strip carry the same routes; both reflect the state.
  const navigationId =
    detailViews.find((view) => view.id === id)?.moduleId ?? id;
  for (const link of document.querySelectorAll(".nav-links a, .mobile-nav a")) {
    const active = link.getAttribute("href") === `#${navigationId}`;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  renderAll();
  if (focusFromMihomo) {
    const section = document.getElementById(`view-${id}`);
    const activeLink = section?.querySelector(
      '.mihomo-subnav a[aria-current="page"]',
    );
    if (activeLink instanceof HTMLElement)
      activeLink.focus({ preventScroll: true });
  }
  if (scroll) window.scrollTo(0, 0);
  icons();
}

function mountWidgets() {
  mounted.forEach((widget) => widget.destroy());
  mounted.clear();
  const grid = $("widget-grid", HTMLElement);
  grid.replaceChildren();
  for (const definition of widgets) {
    const enabled = config.widgets.includes(definition.id);
    for (const link of /** @type {NodeListOf<HTMLAnchorElement>} */ (
      document.querySelectorAll(`a[href="#${definition.id}"]`)
    ))
      link.hidden = !enabled;
    if (!enabled) continue;
    // Widget sections use a widget- prefix; the bare id belongs to the view.
    const section = el("section", {
      id: `widget-${definition.id}`,
      class: `widget-panel widget-${definition.id}`,
      "aria-label": definition.title,
    });
    grid.append(section);
    mounted.set(definition.id, definition.mount(section));
  }
  if (!config.widgets.length)
    grid.append(
      el(
        "div",
        { class: "no-widgets" },
        // Empty states explain the canonical entry instead of adding shortcuts.
        "未启用监控模块，请在导航栏的「监控设置」中选择模块。",
      ),
    );
  icons();
}

/**
 * @param {Snapshot} next
 */
function receive(next) {
  // A failed sample leaves the last successful values visible with stale status.
  const useful = Object.keys(next.data).some(
    (plugin) => !["system", "uptime"].includes(plugin),
  );
  if (!useful) {
    connection = "offline";
    connectionError = Object.values(next.errors)[0] || "接口未提供监控数据";
    // Preserve values but propagate source errors into each Glances module.
    snapshot = {
      data: snapshot?.data ?? {},
      errors: next.errors,
      collectedAt: lastSuccess,
    };
    renderAll();
    renderConnection();
    return;
  }
  snapshot = next;
  metrics = normalize(next, config);
  lastSuccess = next.collectedAt;
  connection = Object.keys(next.errors).length ? "partial" : "online";
  connectionError = "";
  const previous = history.at(-1);
  if (
    previous &&
    next.collectedAt - previous.timestamp > config.refreshSeconds * 2500
  )
    history.push({
      timestamp: next.collectedAt - 1,
      cpu: null,
      memory: null,
      rx: null,
      tx: null,
    });
  history.push({
    timestamp: next.collectedAt,
    cpu: metrics.cpu,
    memory: metrics.memory,
    rx: metrics.rx,
    tx: metrics.tx,
  });
  history = history.filter(
    (point) =>
      point.timestamp >= next.collectedAt - config.historyMinutes * 60000,
  );
  renderOverview(metrics);
  renderAll();
  renderConnection();
}

/** Reset only the NAS source, including its module-local buffers. */
function resetGlances() {
  snapshot = { data: {}, errors: {}, collectedAt: 0 };
  metrics = normalize(snapshot, config);
  lastSuccess = 0;
  history = demo ? demoHistory() : [];
  connection = config.api.url || demo ? "loading" : "idle";
  connectionError = "";
}

function mihomoActive() {
  return (
    config.widgets.includes("mihomo") && (demo || Boolean(config.mihomo.url))
  );
}

/** A changed controller never shares counters or samples with its predecessor. */
function resetMihomo() {
  mihomo = new MihomoMonitor(config);
  mihomo.state.connection = mihomoActive() ? "loading" : "idle";
  if (demo && mihomoActive()) {
    const now = Date.now();
    for (let index = 180; index >= 0; index--)
      mihomo.receive(
        demoMihomoSnapshot(now - index * 5000),
        now - index * 5000,
      );
  }
}

// Explicit connections reset samples so data from different sources cannot mix.
function connect() {
  setByteUnits(config.unit, config.unitBase);
  resetGlances();
  resetMihomo();
  // Views keep local sample buffers (per-interface history, sort, paging);
  // destroying them here keeps reconnects from mixing data sources.
  viewInstances.forEach((view) => view.destroy());
  viewInstances.clear();
  renderOverview(/** @type {Metrics} */ (metrics));
  mountWidgets();
  renderHeader();
  renderConnection();
  // Revalidate the route: a just-disabled module must fall back to overview.
  showView(currentRoute(), false);
  startPoller();
}

/** Device labels and the document title follow the saved configuration. */
function renderHeader() {
  setText("device-name", config.name);
  setText("breadcrumb-name", config.name);
  setText("device-subtitle", config.subtitle);
  document.title = `${config.name} · ${viewMeta(currentView).title}${demo ? " · 演示" : ""}`;
}

/** Continuous mihomo reads must not lock manual Glances refresh in dual-source mode. */
function refreshAvailability() {
  const busy = busySources.has(demo || config.api.url ? "glances" : "mihomo");
  $("refresh-button", HTMLButtonElement).disabled =
    busy || (!demo && !config.api.url && !mihomoActive());
  $("refresh-button", HTMLElement).classList.toggle("is-busy", busy);
  $("refresh-button", HTMLElement).setAttribute("aria-busy", String(busy));
}

/**
 * Rebuild only affected source pollers; preserve samples on a paused dashboard.
 * @param {boolean} [glances=true]
 * @param {boolean} [proxy=true]
 */
function startPoller(glances = true, proxy = true) {
  if (glances) {
    poller?.stop();
    poller = undefined;
    busySources.delete("glances");
  }
  if (proxy) {
    mihomoPoller?.stop();
    mihomoPoller = undefined;
    busySources.delete("mihomo");
  }
  refreshAvailability();
  if (glances && (demo || config.api.url)) {
    const instance = new Poller({
      intervalMs: config.refreshSeconds * 1000,
      fetch: (signal) =>
        demo
          ? Promise.resolve(demoSnapshot())
          : fetchSnapshot(config, requiredPlugins(config.widgets), signal),
      onData: receive,
      hasData: (next) =>
        Object.keys(next.data).some(
          (key) => !["system", "uptime"].includes(key),
        ),
      onError(error) {
        // Whole-request failures still mark only this source's modules stale.
        const message = requestError(error);
        receive({
          data: {},
          errors: Object.fromEntries(
            requiredPlugins(config.widgets).map((plugin) => [plugin, message]),
          ),
          collectedAt: Date.now(),
        });
      },
      onBusy(busy) {
        if (poller !== instance) return;
        if (busy) busySources.add("glances");
        else busySources.delete("glances");
        refreshAvailability();
      },
    });
    poller = instance;
    if (!paused && !document.hidden) instance.start();
  }
  if (proxy && mihomoActive()) {
    const instance = new Poller({
      // The proxy's memory sample takes about a second: count that time in
      // the live cadence rather than waiting another interval after each read.
      intervalMs: mihomoRefreshMs,
      cadence: "start",
      fetch: (signal) =>
        demo
          ? Promise.resolve(demoMihomoSnapshot())
          : fetchMihomoSnapshot(config, signal),
      hasData: hasMihomoData,
      onData(next) {
        mihomo.receive(next, demo ? next.collectedAt : performance.now());
        renderAll("mihomo");
        renderConnection();
      },
      onError(error) {
        mihomo.fail(requestError(error));
        renderAll("mihomo");
        renderConnection();
      },
      onBusy(busy) {
        if (mihomoPoller !== instance) return;
        if (busy) busySources.add("mihomo");
        else busySources.delete("mihomo");
        refreshAvailability();
      },
    });
    mihomoPoller = instance;
    if (!paused && !document.hidden) instance.start();
  }
}

/** Repaint the dashboard from the snapshot already on screen. */
function repaint() {
  renderHeader();
  renderConnection();
  if (!snapshot || !metrics) return;
  renderOverview(metrics);
  renderAll();
}

// Use the published revision rather than GitHub's latest HEAD: the links must
// identify the files actually deployed. Manual deployments may lack the stamp.
async function loadBuild() {
  try {
    const response = await fetch(new URL("./build.json", location.href), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return;
    const build = /** @type {{commit?: unknown}} */ (await response.json());
    // Only a complete commit hash may become a GitHub navigation target.
    if (
      typeof build?.commit !== "string" ||
      !/^[0-9a-f]{40}$/i.test(build.commit)
    )
      return;
    for (const badge of /** @type {NodeListOf<HTMLAnchorElement>} */ (
      document.querySelectorAll("a[data-build-id]")
    )) {
      badge.textContent = `GitHub ${build.commit.slice(0, 7)}`;
      badge.title = `GitHub commit ${build.commit}`;
      badge.href = `https://github.com/RaSteaks/NAS-Dashboard/commit/${build.commit}`;
      badge.setAttribute(
        "aria-label",
        `查看 GitHub 提交 ${build.commit}（在新标签页打开）`,
      );
      badge.hidden = false;
    }
  } catch {
    // Missing or unreadable metadata must not interrupt monitoring or imply a revision.
  }
}

function clearTest() {
  testController?.abort();
  testController = undefined;
  setText("test-result", "");
  $("test-button", HTMLButtonElement).disabled = $(
    "setting-demo",
    HTMLInputElement,
  ).checked;
  $("test-button", HTMLElement).classList.remove("is-busy");
  $("test-button", HTMLElement).setAttribute("aria-busy", "false");
}

/** Cancel stale test results when a draft changes or the dialog closes. */
function clearMihomoTest() {
  mihomoTestController?.abort();
  mihomoTestController = undefined;
  setText("mihomo-test-result", "");
  $("mihomo-test-button", HTMLElement).classList.remove("is-busy");
  $("mihomo-test-button", HTMLElement).setAttribute("aria-busy", "false");
  updateMihomoSettings();
}

function updateMihomoSettings() {
  const enabled = Boolean(
    document.querySelector('input[name="widget"][value="mihomo"]:checked'),
  );
  $("setting-mihomo-url", HTMLInputElement).disabled = !enabled;
  $("mihomo-test-button", HTMLButtonElement).disabled =
    !enabled || $("setting-demo", HTMLInputElement).checked;
}

function updateApiLabel() {
  const proxy = $("setting-mode", HTMLSelectElement).value === "proxy";
  setText("api-field-label", proxy ? "同源代理地址" : "Glances API 地址");
  $("setting-url", HTMLInputElement).placeholder = proxy
    ? "./api/index.php"
    : "http://NAS-IP:61208/api/4";
  setText(
    "api-help",
    proxy
      ? "代理上游地址由服务端配置。"
      : "HTTPS 页面请使用 HTTPS API 或同源代理。",
  );
}

/**
 * @param {boolean} [firstRun=false]
 */
function openSettings(firstRun = false) {
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  $("setting-name", HTMLInputElement).value = config.name;
  $("setting-mode", HTMLSelectElement).value = config.api.mode;
  $("setting-unit", HTMLSelectElement).value = config.unit;
  $("setting-base", HTMLSelectElement).value = String(config.unitBase);
  const interval = $("setting-interval", HTMLSelectElement);
  if (
    !Array.from(interval.options).some(
      (option) => Number(option.value) === config.refreshSeconds,
    )
  )
    interval.append(
      el(
        "option",
        { value: String(config.refreshSeconds) },
        `${config.refreshSeconds} 秒`,
      ),
    );
  interval.value = String(config.refreshSeconds);
  $("setting-url", HTMLInputElement).value = config.api.url;
  $("setting-mihomo-url", HTMLInputElement).value = config.mihomo.url;
  $("setting-demo", HTMLInputElement).checked = demo;
  $("setting-url", HTMLElement).removeAttribute("aria-invalid");
  setText("api-error", "");
  setText("mihomo-error", "");
  $("setting-mihomo-url", HTMLElement).removeAttribute("aria-invalid");
  setText("save-result", "");
  setText("settings-title", firstRun ? "连接监控数据源" : "监控设置");
  $("module-options", HTMLElement).replaceChildren(
    ...widgets.map((widget) => {
      const input = el("input", {
        type: "checkbox",
        value: widget.id,
        name: "widget",
      });
      input.checked = config.widgets.includes(widget.id);
      return el(
        "label",
        { class: "module-option" },
        input,
        icon(widget.icon),
        el("span", {}, widget.title),
      );
    }),
  );
  updateApiLabel();
  clearTest();
  clearMihomoTest();
  icons();
  dialog.showModal();
  if (firstRun) $("setting-url", HTMLInputElement).focus();
}

/** @returns {Config} */
function draft() {
  return {
    ...config,
    name: $("setting-name", HTMLInputElement).value.trim() || defaults.name,
    api: {
      mode: /** @type {"direct"|"proxy"} */ (
        $("setting-mode", HTMLSelectElement).value
      ),
      url: normalizeApiAddress($("setting-url", HTMLInputElement).value),
    },
    mihomo: {
      url: normalizeApiAddress($("setting-mihomo-url", HTMLInputElement).value),
    },
    refreshSeconds: Number($("setting-interval", HTMLSelectElement).value),
    unit: /** @type {Config["unit"]} */ (
      $("setting-unit", HTMLSelectElement).value
    ),
    unitBase:
      Number($("setting-base", HTMLSelectElement).value) === 1000
        ? /** @type {1000} */ (1000)
        : /** @type {1024} */ (1024),
    widgets: /** @type {WidgetId[]} */ (
      Array.from(
        /** @type {NodeListOf<HTMLInputElement>} */ (
          document.querySelectorAll('input[name="widget"]:checked')
        ),
      ).map((input) => input.value)
    ),
  };
}

/**
 * @param {Config} next
 * @returns {boolean}
 */
function validateDraft(next) {
  // Glances may be empty for mihomo-only use, including an explicit action to
  // disable that last source. First-run saves still require a valid connection.
  const enabled = next.widgets.includes("mihomo");
  const error =
    next.api.url || (!enabled && !config.widgets.includes("mihomo"))
      ? validateApi(next.api, location.href)
      : null;
  setText("api-error", error || "");
  $("setting-url", HTMLElement).setAttribute(
    "aria-invalid",
    String(Boolean(error)),
  );
  const proxyError = enabled ? validateMihomoDraft(next) : false;
  if (error) $("setting-url", HTMLInputElement).focus();
  return !error && !proxyError;
}

/** @param {Config} next @returns {boolean} True when invalid. */
function validateMihomoDraft(next) {
  const error = validateApi(
    { mode: "proxy", url: next.mihomo.url },
    location.href,
  );
  setText("mihomo-error", error || "");
  $("setting-mihomo-url", HTMLElement).setAttribute(
    "aria-invalid",
    String(Boolean(error)),
  );
  if (error) $("setting-mihomo-url", HTMLInputElement).focus();
  return Boolean(error);
}

// Keep one manual entry across overview, detail views, and compact navigation.
$("settings-sidebar", HTMLButtonElement).addEventListener("click", () =>
  openSettings(),
);
for (const id of ["settings-close", "settings-cancel"])
  $(id, HTMLElement).addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  clearTest();
  clearMihomoTest();
  returnFocus?.focus();
});
$("setting-mode", HTMLSelectElement).addEventListener("change", () => {
  const field = $("setting-url", HTMLInputElement);
  const proxy = $("setting-mode", HTMLSelectElement).value === "proxy";
  field.value = proxy
    ? "./api/index.php"
    : config.api.mode === "direct"
      ? config.api.url
      : "";
  updateApiLabel();
  clearTest();
});
$("setting-url", HTMLElement).addEventListener("input", () => {
  clearTest();
  setText("api-error", "");
  $("setting-url", HTMLElement).removeAttribute("aria-invalid");
});
$("setting-demo", HTMLInputElement).addEventListener("change", () => {
  clearTest();
  clearMihomoTest();
});
$("module-options", HTMLElement).addEventListener("change", clearMihomoTest);
$("setting-mihomo-url", HTMLElement).addEventListener("input", () => {
  clearMihomoTest();
  setText("mihomo-error", "");
  $("setting-mihomo-url", HTMLElement).removeAttribute("aria-invalid");
});
$("test-button", HTMLButtonElement).addEventListener("click", async () => {
  const next = draft();
  // This button tests Glances only, even when mihomo is the active source.
  const error = validateApi(next.api, location.href);
  setText("api-error", error || "");
  $("setting-url", HTMLElement).setAttribute(
    "aria-invalid",
    String(Boolean(error)),
  );
  if (error) {
    $("setting-url", HTMLInputElement).focus();
    return;
  }
  clearTest();
  const controller = new AbortController();
  testController = controller;
  $("test-button", HTMLButtonElement).disabled = true;
  $("test-button", HTMLElement).classList.add("is-busy");
  $("test-button", HTMLElement).setAttribute("aria-busy", "true");
  setText("test-result", "正在测试连接…");
  try {
    const result = await fetchSnapshot(next, ["cpu", "mem"], controller.signal);
    if (controller.signal.aborted) return;
    if (result.errors.cpu || result.errors.mem)
      throw new Error(result.errors.cpu || result.errors.mem);
    const values = normalize(result, next);
    if (values.cpu === null || values.memory === null)
      throw new Error("接口未提供 CPU 或内存指标");
    $("test-result", HTMLElement).className = "success-text";
    setText("test-result", "连接成功，CPU 与内存可读取");
  } catch (error) {
    if (controller.signal.aborted) return;
    $("test-result", HTMLElement).className = "warning-text";
    setText("test-result", requestError(error));
  } finally {
    if (testController === controller) {
      $("test-button", HTMLButtonElement).disabled = false;
      $("test-button", HTMLElement).classList.remove("is-busy");
      $("test-button", HTMLElement).setAttribute("aria-busy", "false");
    }
  }
});

$("mihomo-test-button", HTMLButtonElement).addEventListener(
  "click",
  async () => {
    const next = draft();
    if (validateMihomoDraft(next)) return;
    clearMihomoTest();
    const controller = new AbortController();
    mihomoTestController = controller;
    const button = $("mihomo-test-button", HTMLButtonElement);
    button.disabled = true;
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    setText("mihomo-test-result", "正在测试连接…");
    try {
      const result = await fetchMihomoSnapshot(next, controller.signal);
      if (controller.signal.aborted) return;
      if (!hasMihomoData(result))
        throw new Error(
          Object.values(result.errors)[0] || "mihomo 未提供监控数据",
        );
      const partial = Object.keys(result.errors).length > 0;
      $("mihomo-test-result", HTMLElement).className = partial
        ? "warning-text"
        : "success-text";
      setText(
        "mihomo-test-result",
        partial
          ? `连接成功，部分数据不可用：${Object.values(result.errors).join("；")}`
          : "连接成功，mihomo 监控数据可读取",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      $("mihomo-test-result", HTMLElement).className = "warning-text";
      setText("mihomo-test-result", requestError(error));
    } finally {
      if (mihomoTestController === controller) {
        mihomoTestController = undefined;
        updateMihomoSettings();
        button.classList.remove("is-busy");
        button.setAttribute("aria-busy", "false");
      }
    }
  },
);
$("settings-form", HTMLElement).addEventListener("submit", (event) => {
  event.preventDefault();
  // Enter used to commit an IME composition must not save the connection form.
  if (document.querySelector('#settings-form input[data-composing="true"]'))
    return;
  const next = draft();
  const nextDemo = $("setting-demo", HTMLInputElement).checked;
  if (!nextDemo && !validateDraft(next)) return;
  // Only a different data source invalidates the samples on screen. Display
  // preferences and module choices repaint in place instead: reconnecting here
  // would blank a paused page and wait for a poll that never starts.
  const demoChanged = nextDemo !== demo;
  const glancesChanged =
    next.api.mode !== config.api.mode || next.api.url !== config.api.url;
  const mihomoChanged = next.mihomo.url !== config.mihomo.url;
  const mihomoEnabledChanged =
    next.widgets.includes("mihomo") !== config.widgets.includes("mihomo");
  const modulesChanged = next.widgets.join() !== config.widgets.join();
  const intervalChanged = next.refreshSeconds !== config.refreshSeconds;
  config = next;
  demo = nextDemo;
  const url = new URL(location.href);
  if (demo) url.searchParams.set("demo", "1");
  else url.searchParams.delete("demo");
  window.history.replaceState(null, "", url);
  storageWarning = saveSettings(config)
    ? ""
    : "浏览器未允许保存设置，当前页面仍可使用。";
  configError = "";
  dialog.close();
  if (demoChanged) {
    connect();
    return;
  }
  setByteUnits(config.unit, config.unitBase);
  if (glancesChanged) resetGlances();
  if (mihomoChanged) resetMihomo();
  else if (mihomoEnabledChanged) {
    // Module toggles preserve samples just like other display preferences, but
    // never average across the interval when the source was disabled.
    mihomo.resetBaseline();
    if (mihomoActive() && !mihomo.state.lastSuccess) {
      if (demo) resetMihomo();
      else mihomo.state.connection = "loading";
    }
  }
  mihomo.config = config;
  if (modulesChanged || glancesChanged || mihomoChanged) {
    for (const [id, view] of viewInstances) {
      const owner =
        detailViews.find((definition) => definition.id === id)?.moduleId ?? id;
      if (
        modulesChanged ||
        (glancesChanged && owner !== "mihomo") ||
        (mihomoChanged && owner === "mihomo")
      ) {
        view.destroy();
        viewInstances.delete(id);
      }
    }
    if (modulesChanged || glancesChanged) mountWidgets();
    // Revalidate the route: a just-disabled module must fall back to overview.
    showView(currentRoute(), false);
  }
  if (intervalChanged || modulesChanged || glancesChanged || mihomoChanged)
    startPoller(
      intervalChanged || modulesChanged || glancesChanged,
      mihomoChanged || mihomoEnabledChanged,
    );
  repaint();
});
for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll("#settings-form input")
)) {
  input.addEventListener("compositionstart", () => {
    input.dataset.composing = "true";
  });
  input.addEventListener("compositionend", () => {
    input.dataset.composing = "false";
  });
}
$("refresh-button", HTMLButtonElement).addEventListener("click", () => {
  refreshSources();
});
$("notice-action", HTMLElement).addEventListener("click", () => {
  refreshSources();
});
$("pause-button", HTMLElement).addEventListener("click", () => {
  paused = !paused;
  $("pause-button", HTMLElement).setAttribute("aria-pressed", String(paused));
  const label = paused ? "恢复自动更新" : "暂停自动更新";
  $("pause-button", HTMLElement).setAttribute("aria-label", label);
  $("pause-button", HTMLElement).title = label;
  $("pause-button", HTMLElement).replaceChildren(
    icon(paused ? "play" : "pause"),
  );
  icons();
  if (paused) stopSources();
  else if (!document.hidden) resumeSources();
  renderConnection();
});
// Delegated so trend window buttons inside lazily mounted views also work.
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-window]");
  if (!(button instanceof HTMLButtonElement)) return;
  windowMinutes = Number(button.dataset.window);
  syncWindowButtons();
  renderAll();
});
// Navigation is hash-routed; views switch instead of scrolling to widgets.
window.addEventListener("hashchange", () => showView(currentRoute()));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopSources();
  else if (!paused) resumeSources();
  renderConnection();
});
window.addEventListener("online", () => {
  mihomo.resetBaseline();
  if (!paused && !document.hidden) refreshSources();
});
window.addEventListener("pagehide", stopSources);
window.addEventListener("pageshow", (event) => {
  if (event.persisted && !paused && !document.hidden) resumeSources();
});

// All lifecycle controls cover both sources; a pause never mixes elapsed rates.
function refreshSources() {
  void poller?.refresh();
  void mihomoPoller?.refresh();
}
function stopSources() {
  poller?.stop();
  mihomoPoller?.stop();
  mihomo.resetBaseline();
}
function resumeSources() {
  mihomo.resetBaseline();
  poller?.start();
  mihomoPoller?.start();
}
setInterval(renderConnection, 1000);

async function init() {
  icons();
  try {
    config = await loadConfig();
  } catch (error) {
    configError = requestError(error);
  }
  connect();
  void loadBuild();
  if (!demo && !config.api.url && !mihomoActive()) openSettings(true);
}

void init();
