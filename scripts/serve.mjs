// Development server: serves the static site/ folder and mirrors the PHP
// snapshot contract at /api/index.php, so local runs exercise the proxy mode
// without requiring PHP. Zero dependencies; Node >= 22.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proxyMihomoSnapshot, validMihomoServer } from "./mihomo-proxy.mjs";

const rootDir = await realpath(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site"),
);
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 5173);
const allowed = [
  "cpu",
  "mem",
  "load",
  "sensors",
  "fs",
  "network",
  "containers",
  "system",
  "uptime",
];

/**
 * @param {string} name
 * @returns {Record<string, string>}
 */
function envFile(name) {
  const file = path.join(rootDir, "..", name);
  if (!existsSync(file)) return {};
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

const glancesApiUrl =
  process.env.GLANCES_API_URL ??
  envFile(".env.local").GLANCES_API_URL ??
  envFile(".env").GLANCES_API_URL ??
  "";

// Local secrets are read on the server only, just like the Web Station proxy.
const mihomoApiUrl =
  process.env.MIHOMO_API_URL ??
  envFile(".env.local").MIHOMO_API_URL ??
  envFile(".env").MIHOMO_API_URL ??
  "";
const mihomoSecret =
  process.env.MIHOMO_SECRET ??
  envFile(".env.local").MIHOMO_SECRET ??
  envFile(".env").MIHOMO_SECRET ??
  "";

/** @type {Record<string, string>} */
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".php": "text/plain; charset=utf-8",
};

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function withinSite(file) {
  const relative = path.relative(rootDir, file);
  // Directory boundaries reject siblings such as site-backup, not just parents.
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

// Mirrors the PHP snapshot contract without requiring local PHP.
/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function proxySnapshot(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "只允许 GET 请求" });
    return;
  }
  const parameters = new URL(request.url ?? "", "http://localhost")
    .searchParams;
  const plugins = [
    ...new Set((parameters.get("plugins") ?? allowed.join(",")).split(",")),
  ];
  if (!plugins.length || plugins.some((plugin) => !allowed.includes(plugin))) {
    json(response, 400, { error: "不支持的监控指标" });
    return;
  }
  if (!glancesApiUrl) {
    json(response, 503, {
      error: "请在 .env.local 中配置 GLANCES_API_URL，或选择直接连接。",
    });
    return;
  }
  /** @type {Record<string, unknown>} */
  const data = {};
  /** @type {Record<string, string>} */
  const errors = {};
  const controller = new AbortController();
  response.on("close", () => controller.abort());
  await Promise.all(
    plugins.map(async (plugin) => {
      try {
        const result = await fetch(
          `${glancesApiUrl.replace(/\/+$/, "")}/${plugin}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(7000),
            ]),
          },
        );
        if (!result.ok) {
          errors[plugin] = `上游返回 HTTP ${result.status}`;
          return;
        }
        data[plugin] = await result.json();
      } catch {
        errors[plugin] = "Glances 无法连接或未返回有效 JSON";
      }
    }),
  );
  if (!response.destroyed)
    json(response, 200, { data, errors, collectedAt: Date.now() });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/api/mihomo.php") {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      json(response, 405, { error: "只允许 GET 请求" });
    } else if (!validMihomoServer(mihomoApiUrl, mihomoSecret)) {
      json(response, 503, {
        error: "请在服务端配置 MIHOMO_API_URL 与 MIHOMO_SECRET。",
      });
    } else {
      const controller = new AbortController();
      response.on("close", () => controller.abort());
      const snapshot = await proxyMihomoSnapshot(
        mihomoApiUrl,
        mihomoSecret,
        controller.signal,
      );
      if (!response.destroyed) json(response, 200, snapshot);
    }
    return;
  }
  if (url.pathname === "/api/index.php") {
    await proxySnapshot(request, response);
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    json(response, 400, { error: "无效的路径" });
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.normalize(path.join(rootDir, pathname));
  if (!withinSite(file)) {
    json(response, 403, { error: "禁止访问" });
    return;
  }
  try {
    // Check the physical target too, so symlinks cannot expose private files.
    const resolvedFile = await realpath(file);
    if (!withinSite(resolvedFile)) {
      json(response, 403, { error: "禁止访问" });
      return;
    }
    const body = await readFile(resolvedFile);
    const type = mimeTypes[path.extname(file).toLowerCase()];
    response.writeHead(200, {
      "Content-Type": type ?? "application/octet-stream",
      "Cache-Control": /\.(html|json)$/.test(file) ? "no-store" : "no-cache",
    });
    response.end(body);
  } catch {
    json(response, 404, { error: "未找到文件" });
  }
});

server.on("error", (error) => {
  if (/** @type {NodeJS.ErrnoException} */ (error).code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用，请先停止已有服务。`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`NAS Dashboard 开发服务已启动: http://${host}:${port}`);
  console.log(
    glancesApiUrl
      ? "Glances 同源代理已启用（GLANCES_API_URL 已配置）"
      : "Glances 同源代理未配置：在 .env.local 中设置 GLANCES_API_URL 后重启",
  );
  // Report configuration presence only; controller URLs and Secrets stay private.
  console.log(
    mihomoApiUrl
      ? "mihomo 同源代理已启用（MIHOMO_API_URL 已配置）"
      : "mihomo 同源代理未配置：在 .env.local 中设置 MIHOMO_API_URL 后重启",
  );
});
