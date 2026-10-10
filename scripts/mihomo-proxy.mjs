// Local preview mirrors the PHP aggregate contract, including bounded NDJSON
// sampling. Connection details use a fixed field allowlist; credentials stay private.

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("mihomo 未返回有效 JSON 对象");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value */
function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" ||
    (typeof value === "number" && Number.isInteger(value))
    ? String(value).slice(0, 512)
    : "";
}

/** @param {unknown} input @returns {Record<string, unknown>|null} */
function connectionDetails(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = /** @type {Record<string, unknown>} */ (input);
  if (typeof row.id !== "string" || !row.id) return null;
  const metadata =
    row.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? /** @type {Record<string, unknown>} */ (row.metadata)
      : {};
  /** @type {Record<string, unknown>} */
  const result = {
    id: row.id.slice(0, 128),
    upload: number(row.upload),
    download: number(row.download),
    start: text(row.start),
    rule: text(row.rule),
    rulePayload: text(row.rulePayload),
    chains: Array.isArray(row.chains) ? row.chains.slice(0, 16).map(text) : [],
  };
  for (const key of [
    "network",
    "type",
    "sourceIP",
    "sourcePort",
    "destinationIP",
    "destinationPort",
    "host",
    "process",
    "processPath",
    "inboundName",
  ])
    result[key] = text(metadata[key]);
  return result;
}

/** @param {string} apiUrl @param {string} secret */
export function validMihomoServer(apiUrl, secret) {
  try {
    const url = new URL(apiUrl);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/[\r\n]/.test(secret)
    );
  } catch {
    return false;
  }
}

/**
 * Stop a memory stream only after two complete JSON lines. A normal finite
 * response and a stream share the size bound, deadline and cancellation path.
 * @param {Response} response
 * @param {boolean} memory
 * @returns {Promise<Record<string, unknown>>}
 */
async function readBody(response, memory) {
  if (!response.ok) {
    // Client aborts can reject cancellation too; retain the HTTP diagnostic.
    await response.body?.cancel().catch(() => {});
    throw new Error(
      [401, 403].includes(response.status)
        ? "mihomo 认证失败，请检查服务端 Secret"
        : `mihomo 返回 HTTP ${response.status}`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("mihomo 未返回有效 JSON 对象");
  let bytes = 0;
  let buffer = "";
  let frames = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error("mihomo 响应超过大小限制");
      buffer += decoder.decode(value, { stream: true });
      if (!memory) continue;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const frame = record(JSON.parse(line));
        if (++frames === 2) return frame;
      }
    }
    buffer += decoder.decode();
    if (memory) throw new Error("mihomo 未提供完整内存采样");
    return record(JSON.parse(buffer));
  } finally {
    // A completed second frame is success even though the upstream remains open.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * @param {string} apiUrl
 * @param {string} secret
 * @param {AbortSignal} signal
 * @returns {Promise<import("../site/js/core/types.js").MihomoSnapshot>}
 */
export async function proxyMihomoSnapshot(apiUrl, secret, signal) {
  /** @type {import("../site/js/core/types.js").MihomoSnapshot} */
  const snapshot = { data: {}, errors: {}, collectedAt: 0 };
  await Promise.all(
    /** @type {const} */ (["connections", "memory", "version"]).map(
      async (endpoint) => {
        try {
          const response = await fetch(
            `${apiUrl.replace(/\/+$/, "")}/${endpoint}`,
            {
              signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
              redirect: "manual",
              headers: secret ? { Authorization: `Bearer ${secret}` } : {},
            },
          );
          const body = await readBody(response, endpoint === "memory");
          if (endpoint === "connections") {
            if (
              "connections" in body &&
              body.connections !== null &&
              !Array.isArray(body.connections)
            )
              throw new Error("mihomo 返回连接格式不正确");
            // Count the complete upstream list, but bound details and mark any
            // omissions so clients do not infer false closed connections.
            const items = Array.isArray(body.connections)
              ? body.connections
                  .slice(0, 500)
                  .map(connectionDetails)
                  .filter((row) => row !== null)
              : [];
            snapshot.data.connections = {
              count:
                "connections" in body
                  ? Array.isArray(body.connections)
                    ? body.connections.length
                    : 0
                  : null,
              uploadTotal: number(body.uploadTotal),
              downloadTotal: number(body.downloadTotal),
              items: "connections" in body ? items : null,
              truncated:
                Array.isArray(body.connections) &&
                items.length < body.connections.length,
            };
          } else if (endpoint === "memory")
            snapshot.data.memory = { inuse: number(body.inuse) };
          else
            snapshot.data.version = {
              version: typeof body.version === "string" ? body.version : "",
              meta: typeof body.meta === "boolean" ? body.meta : null,
            };
        } catch (error) {
          // Never expose fetch's error URL or a transport exception containing secrets.
          snapshot.errors[endpoint] =
            error instanceof SyntaxError
              ? "mihomo 未返回有效 JSON"
              : error instanceof Error && error.message.startsWith("mihomo ")
                ? error.message
                : "mihomo 无法连接或响应超时";
        }
      },
    ),
  );
  snapshot.collectedAt = Date.now();
  return snapshot;
}
