// @ts-check

/** @typedef {import("./core/types.js").Config} Config */
/** @typedef {import("./core/types.js").HistoryPoint} HistoryPoint */
/** @typedef {import("./core/types.js").Metrics} Metrics */
/** @typedef {import("./core/types.js").Snapshot} Snapshot */
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
import { bytes, decimal, time, uptime } from "./core/format.js";
import { normalize } from "./core/metrics.js";
import { Poller } from "./core/poller.js";
import { $, el, icon, icons, setText } from "./ui/dom.js";
import { requiredPlugins, widgets } from "./widgets/index.js";
import { detailViews, viewMeta } from "./views/index.js";

/** @type {Config} */
let config = structuredClone(defaults);
let demo = new URL(location.href).searchParams.get("demo") === "1";
let paused = false;
let windowMinutes = 15;
let currentView = "overview";
/** @type {import("./core/poller.js").Poller|undefined} */
let poller;
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
 * @param {string} [action="连接设置"]
 * @param {string} [tone="info"]
 */
function notice(message, action = "连接设置", tone = "info") {
  $("notice", HTMLElement).hidden = !message;
  $("notice", HTMLElement).className = `notice ${tone}`;
  setText("notice-text", message);
  setText("notice-action", action);
}

function renderConnection() {
  const stale =
    lastSuccess > 0 &&
    Date.now() - lastSuccess > Math.max(15000, config.refreshSeconds * 3000);
  const states = {
    idle: "尚未连接",
    loading: "正在连接",
    online: "已连接",
    partial: "部分数据不可用",
    offline: "连接中断",
  };
  const text = paused
    ? "已暂停更新"
    : stale && connection !== "idle"
      ? "数据已过期"
      : states[connection];
  setText(
    "connection-text",
    demo ? (paused ? "演示已暂停" : "演示采样") : text,
  );
  $("connection-status", HTMLElement).className =
    `status-label ${demo || paused ? "neutral" : connection === "online" && !stale ? "success" : "warning"}`;
  $("device-dot", HTMLElement).className =
    `status-dot ${connection === "online" && !stale && !demo ? "success" : "neutral"}`;
  setText(
    "source-badge",
    demo ? "演示数据" : config.api.url ? "GLANCES API" : "未连接",
  );
  $("source-badge", HTMLElement).className =
    `source-badge ${demo ? "demo" : ""}`;
  setText("refresh-label", `每 ${config.refreshSeconds} 秒更新`);
  setText(
    "last-updated",
    lastSuccess
      ? `最后更新 ${time(lastSuccess)} · 上海时间`
      : "尚未更新 · 上海时间",
  );
  setText(
    "footer-status",
    demo
      ? "演示采样"
      : paused
        ? "自动更新已暂停"
        : connection === "online" && !stale
          ? "Glances 已连接"
          : text,
  );
  if (configError) notice(configError, "连接设置", "warning");
  else if (!config.api.url && !demo)
    notice("尚未连接 NAS，请填写 Glances API 地址。");
  else if (connection === "offline")
    notice(
      `${connectionError}。${lastSuccess ? "显示最后一次采集结果。" : "请检查地址或网络后重试。"}`,
      "重试",
      "warning",
    );
  else if (connection === "partial" && snapshot)
    notice(
      `部分指标无法读取：${Object.keys(snapshot.errors).join("、")}。`,
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

function renderAll() {
  if (!snapshot || !metrics) return;
  /** @type {WidgetContext} */
  const context = {
    metrics,
    snapshot,
    history,
    config,
    windowMinutes,
  };
  for (const widget of mounted.values()) widget.update(context);
  for (const view of viewInstances.values()) view.update(context);
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
  // Detail views depend on their widget's plugins; disabled modules fall back.
  return (
    id === "overview" || config.widgets.includes(/** @type {WidgetId} */ (id))
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
  currentView = id;
  for (const section of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll(".view")
  ))
    section.hidden = section.dataset.view !== id;
  if (id !== "overview" && !viewInstances.has(id)) {
    const definition = detailViews.find((view) => view.id === id);
    const host = document.getElementById(`view-${id}`);
    if (definition && host) viewInstances.set(id, definition.mount(host));
    syncWindowButtons();
  }
  const meta = viewMeta(id);
  setText("page-eyebrow", meta.eyebrow);
  setText("page-title-text", meta.title);
  setText("page-description", meta.description);
  setText("breadcrumb-view", meta.title);
  document.title = `${config.name} · ${meta.title}${demo ? " · 演示" : ""}`;
  // Sidebar and mobile strip carry the same routes; both reflect the state.
  for (const link of document.querySelectorAll(".nav-links a, .mobile-nav a")) {
    const active = link.getAttribute("href") === `#${id}`;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  renderAll();
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
        "未启用监控模块",
        el(
          "button",
          {
            type: "button",
            class: "button button-outline",
            id: "enable-widgets",
          },
          "选择模块",
        ),
      ),
    );
  document
    .getElementById("enable-widgets")
    ?.addEventListener("click", () => openSettings());
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

// Explicit connections reset samples so data from different sources cannot mix.
function connect() {
  poller?.stop();
  $("refresh-button", HTMLButtonElement).disabled = false;
  $("refresh-button", HTMLElement).classList.remove("is-busy");
  $("refresh-button", HTMLElement).setAttribute("aria-busy", "false");
  snapshot = undefined;
  metrics = undefined;
  lastSuccess = 0;
  history = demo ? demoHistory() : [];
  // Views keep local sample buffers (per-interface history, sort, paging);
  // destroying them here keeps reconnects from mixing data sources.
  viewInstances.forEach((view) => view.destroy());
  viewInstances.clear();
  connection = config.api.url || demo ? "loading" : "idle";
  renderOverview(normalize({ data: {}, errors: {}, collectedAt: 0 }, config));
  mountWidgets();
  setText("device-name", config.name);
  setText("breadcrumb-name", config.name);
  setText("device-subtitle", config.subtitle);
  document.title = `${config.name} · ${viewMeta(currentView).title}${demo ? " · 演示" : ""}`;
  renderConnection();
  // Revalidate the route: a just-disabled module must fall back to overview.
  showView(currentRoute(), false);
  if (!demo && !config.api.url) return;
  const instance = new Poller({
    intervalMs: config.refreshSeconds * 1000,
    fetch: (signal) =>
      demo
        ? Promise.resolve(demoSnapshot())
        : fetchSnapshot(config, requiredPlugins(config.widgets), signal),
    onData: receive,
    onError(error) {
      connection = "offline";
      connectionError = requestError(error);
      renderConnection();
    },
    onBusy(busy) {
      if (poller !== instance) return;
      $("refresh-button", HTMLButtonElement).disabled = busy;
      $("refresh-button", HTMLElement).classList.toggle("is-busy", busy);
      $("refresh-button", HTMLElement).setAttribute("aria-busy", String(busy));
    },
  });
  poller = instance;
  if (!paused && !document.hidden) instance.start();
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
  $("setting-demo", HTMLInputElement).checked = demo;
  $("setting-url", HTMLElement).removeAttribute("aria-invalid");
  setText("api-error", "");
  setText("save-result", "");
  setText("settings-title", firstRun ? "连接你的 NAS" : "监控设置");
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
    refreshSeconds: Number($("setting-interval", HTMLSelectElement).value),
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
  const error = validateApi(next.api, location.href);
  setText("api-error", error || "");
  $("setting-url", HTMLElement).setAttribute(
    "aria-invalid",
    String(Boolean(error)),
  );
  if (error) $("setting-url", HTMLInputElement).focus();
  return !error;
}

for (const id of ["settings-sidebar", "settings-top", "widgets-button"])
  $(id, HTMLElement).addEventListener("click", () => openSettings());
for (const id of ["settings-close", "settings-cancel"])
  $(id, HTMLElement).addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  clearTest();
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
$("setting-demo", HTMLInputElement).addEventListener("change", clearTest);
$("test-button", HTMLButtonElement).addEventListener("click", async () => {
  const next = draft();
  if (!validateDraft(next)) return;
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
$("settings-form", HTMLElement).addEventListener("submit", (event) => {
  event.preventDefault();
  // Enter used to commit an IME composition must not save the connection form.
  if (document.querySelector('#settings-form input[data-composing="true"]'))
    return;
  const next = draft();
  const nextDemo = $("setting-demo", HTMLInputElement).checked;
  if (!nextDemo && !validateDraft(next)) return;
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
  connect();
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
  if (!poller || (!config.api.url && !demo)) openSettings(true);
  else void poller.refresh();
});
$("notice-action", HTMLElement).addEventListener("click", () => {
  if ($("notice-action", HTMLElement).textContent === "重试" && poller)
    void poller.refresh();
  else openSettings(!config.api.url);
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
  if (paused) poller?.stop();
  else if (!document.hidden) poller?.start();
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
  if (document.hidden) poller?.stop();
  else if (!paused) poller?.start();
  renderConnection();
});
window.addEventListener("online", () => {
  if (!paused && !document.hidden) void poller?.refresh();
});
window.addEventListener("pagehide", () => poller?.stop());
setInterval(renderConnection, 1000);

async function init() {
  icons();
  try {
    config = await loadConfig();
  } catch (error) {
    configError = requestError(error);
  }
  connect();
  if (!demo && !config.api.url) openSettings(true);
}

void init();
