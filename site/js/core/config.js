// @ts-check

/** @typedef {import("./types.js").ApiConfig} ApiConfig */
/** @typedef {import("./types.js").Config} Config */
/** @typedef {import("./types.js").WidgetId} WidgetId */

/** @type {Config} */
export const defaults = {
  name: "我的 NAS",
  subtitle: "Synology · 系统监控",
  api: { mode: "direct", url: "" },
  refreshSeconds: 5,
  timeoutSeconds: 8,
  historyMinutes: 15,
  volumePattern: "^/volume[0-9]+$",
  networkInterfaces: [],
  networkIgnorePattern: "^(lo$|docker|veth|br-|virbr|tun|tap)",
  widgets: ["resources", "storage", "network", "containers"],
  unit: "auto",
  unitBase: 1024,
  thresholds: { cpu: 85, memory: 85, storage: 85, temperature: 70 },
};

export const storageKey = "nas-dashboard.settings.v1";
/** @type {WidgetId[]} */
const widgetIds = ["resources", "storage", "network", "containers"];
/** @type {Config["unit"][]} */
const byteUnits = ["auto", "B", "KB", "MB", "GB", "TB"];

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeApiAddress(value) {
  const address = value.trim().replace(/\/+$/, "");
  if (/^[\w.-]+:\d+(?:\/|$)/.test(address)) return `http://${address}`;
  return address;
}

/**
 * @param {ApiConfig} api
 * @param {string} pageUrl
 * @returns {string|null}
 */
export function validateApi(api, pageUrl) {
  try {
    const url = new URL(api.url, pageUrl);
    if (!api.url.trim() || !["http:", "https:"].includes(url.protocol))
      return "请输入有效的 HTTP 或 HTTPS 地址。";
    if (url.username || url.password || url.hash || url.search)
      return "地址不能包含密码、查询参数或锚点。";
    if (new URL(pageUrl).protocol === "https:" && url.protocol === "http:")
      return "HTTPS 页面需要 HTTPS 地址，或使用同源代理。";
    if (api.mode === "proxy" && url.origin !== new URL(pageUrl).origin)
      return "代理地址需与当前页面同源。";
    return null;
  } catch {
    return "请输入有效的地址。";
  }
}

/**
 * @param {unknown} input
 * @param {Config} [base=defaults]
 * @returns {Config}
 */
export function mergeConfig(input, base = defaults) {
  if (!input || typeof input !== "object") return structuredClone(base);
  const value = /** @type {Partial<Config>} */ (input);
  const config = structuredClone(base);
  if (typeof value.name === "string" && value.name.trim())
    config.name = value.name;
  if (typeof value.subtitle === "string") config.subtitle = value.subtitle;
  if (
    value.api &&
    ["proxy", "direct"].includes(value.api.mode) &&
    typeof value.api.url === "string"
  )
    config.api = { mode: value.api.mode, url: value.api.url.trim() };
  for (const field of /** @type {["refreshSeconds","timeoutSeconds","historyMinutes"]} */ ([
    "refreshSeconds",
    "timeoutSeconds",
    "historyMinutes",
  ])) {
    const number = value[field];
    if (typeof number === "number" && Number.isFinite(number))
      config[field] = Math.min(
        60,
        Math.max(field === "refreshSeconds" ? 3 : 1, number),
      );
  }
  for (const field of /** @type {["volumePattern","networkIgnorePattern"]} */ ([
    "volumePattern",
    "networkIgnorePattern",
  ])) {
    if (typeof value[field] !== "string") continue;
    try {
      new RegExp(value[field]);
      config[field] = value[field];
    } catch {
      // Invalid filters retain the working defaults instead of breaking polling.
    }
  }
  if (Array.isArray(value.networkInterfaces))
    config.networkInterfaces = value.networkInterfaces.filter(
      (item) => typeof item === "string",
    );
  if (Array.isArray(value.widgets))
    config.widgets = widgetIds.filter((id) => value.widgets?.includes(id));
  if (
    typeof value.unit === "string" &&
    byteUnits.includes(/** @type {Config["unit"]} */ (value.unit))
  )
    config.unit = /** @type {Config["unit"]} */ (value.unit);
  if (value.unitBase === 1000 || value.unitBase === 1024)
    config.unitBase = value.unitBase;
  if (value.thresholds) {
    for (const field of /** @type {["cpu","memory","storage","temperature"]} */ ([
      "cpu",
      "memory",
      "storage",
      "temperature",
    ])) {
      const number = value.thresholds[field];
      if (typeof number === "number" && Number.isFinite(number) && number > 0)
        config.thresholds[field] = Math.min(
          field === "temperature" ? 150 : 100,
          number,
        );
    }
  }
  return config;
}

/**
 * @returns {Promise<Config>}
 */
export async function loadConfig() {
  const response = await fetch(new URL("./config.json", location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("配置文件读取失败，请检查 config.json。");
  let input;
  try {
    input = await response.json();
  } catch {
    throw new Error("配置文件格式错误，请检查 config.json。");
  }
  let config = mergeConfig(input);
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) config = mergeConfig(JSON.parse(saved), config);
  } catch {
    // Private browsing can disable storage; the server configuration still works.
  }
  return config;
}

/**
 * @param {Config} config
 * @returns {boolean}
 */
export function saveSettings(config) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        name: config.name,
        api: config.api,
        refreshSeconds: config.refreshSeconds,
        widgets: config.widgets,
        unit: config.unit,
        unitBase: config.unitBase,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
