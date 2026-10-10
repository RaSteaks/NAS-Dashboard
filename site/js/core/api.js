// @ts-check

/** @typedef {import("./types.js").Config} Config */
/** @typedef {import("./types.js").Plugin} Plugin */
/** @typedef {import("./types.js").Snapshot} Snapshot */
import { validateApi } from "./config.js";

/**
 * @param {unknown} error
 * @returns {string}
 */
export function requestError(error) {
  if (
    error instanceof DOMException &&
    ["TimeoutError", "AbortError"].includes(error.name)
  )
    return "请求超时";
  if (error instanceof TypeError) return "无法连接接口，请检查网络或跨域配置";
  return error instanceof Error ? error.message : "无法读取数据";
}

/**
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
// Both sources share HTTP diagnostics; their snapshot contracts stay separate.
export async function readJson(response) {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error("访问被拒绝，请检查代理认证配置");
    if (response.status === 404) throw new Error("未找到接口，请检查 API 路径");
    if (response.status === 503)
      throw new Error("代理尚未配置或未启用 PHP / cURL");
    throw new Error(`接口返回 HTTP ${response.status}`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json"))
    throw new Error("接口未返回 JSON，请检查 PHP 服务与 API 地址");
  try {
    return await response.json();
  } catch {
    throw new Error("接口返回了无效 JSON");
  }
}

/**
 * @param {Config} config
 * @param {Plugin[]} plugins
 * @param {AbortSignal} signal
 * @returns {Promise<Snapshot>}
 */
export async function fetchSnapshot(config, plugins, signal) {
  const validation = validateApi(config.api, location.href);
  if (validation) throw new Error(validation);
  const timeout = AbortSignal.timeout(config.timeoutSeconds * 1000);
  const requestSignal = AbortSignal.any([signal, timeout]);
  /** @type {RequestInit} */
  const options = {
    signal: requestSignal,
    cache: "no-store",
    credentials: "same-origin",
  };
  if (config.api.mode === "proxy") {
    const url = new URL(config.api.url, location.href);
    url.searchParams.set("plugins", plugins.join(","));
    const result = await readJson(await fetch(url, options));
    if (
      !result ||
      typeof result !== "object" ||
      !("data" in result) ||
      !("errors" in result)
    )
      throw new Error("代理返回格式不正确");
    const snapshot = /** @type {Snapshot} */ (result);
    if (
      !snapshot.data ||
      typeof snapshot.data !== "object" ||
      Array.isArray(snapshot.data) ||
      !snapshot.errors ||
      typeof snapshot.errors !== "object" ||
      Array.isArray(snapshot.errors)
    )
      throw new Error("代理返回格式不正确");
    // Freshness is measured on this browser, independent of NAS clock drift.
    return {
      data: snapshot.data,
      errors: snapshot.errors,
      collectedAt: Date.now(),
    };
  }
  const data = /** @type {Snapshot["data"]} */ ({});
  const errors = /** @type {Snapshot["errors"]} */ ({});
  const base = config.api.url.replace(/\/+$/, "");
  const results = await Promise.allSettled(
    plugins.map(async (plugin) => {
      data[plugin] = await readJson(await fetch(`${base}/${plugin}`, options));
    }),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected")
      errors[plugins[index]] = requestError(result.reason);
  });
  signal.throwIfAborted();
  return { data, errors, collectedAt: Date.now() };
}
