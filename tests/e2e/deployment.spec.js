import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { demoSnapshot } from "../../site/js/core/demo.js";

// Real HTTP caching is required here: Playwright routing disables the cache and
// would miss an old dependency surviving a freshly published entry module.
for (const { label, basePath, commit } of [
  { label: "published commit", basePath: "/", commit: "a".repeat(40) },
  {
    label: "manual deployment in a subdirectory",
    basePath: "/monitor/",
    commit: "",
  },
]) {
  test(`deployment replaces cached modules and preserves settings: ${label}`, async ({
    page,
  }) => {
    let updated = false;
    let legacyApiReads = 0;
    /** @type {string[]} */
    const errors = [];
    /** @type {URL[]} */
    const moduleRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (updated && url.pathname.startsWith(`${basePath}js/`))
        moduleRequests.push(url);
    });
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith(basePath)) {
        response.writeHead(404).end();
        return;
      }
      const relative = url.pathname.slice(basePath.length);
      response.setHeader("Cache-Control", "no-store");
      if (relative === "" && !updated) {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><body><script type="module">
          import { fetchSnapshot } from "./js/core/api.js";
          document.body.dataset.ready = String(typeof fetchSnapshot === "function");
        </script></body>`);
        return;
      }
      if (relative === "config.json") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({ api: { mode: "proxy", url: "./api/index.php" } }),
        );
        return;
      }
      if (relative === "build.json") {
        response.writeHead(commit ? 200 : 404, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify(commit ? { commit } : {}));
        return;
      }
      if (relative === "api/index.php") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(demoSnapshot()));
        return;
      }
      try {
        let body = await readFile(
          new URL(`../../site/${relative || "index.html"}`, import.meta.url),
        );
        if (relative === "js/core/api.js" && !updated) {
          // Before mihomo, readJson was private. A stale copy breaks module
          // linking before icons, settings or configuration can initialize.
          body = Buffer.from(
            body
              .toString()
              .replace(
                "export async function readJson",
                "async function readJson",
              ),
          );
          legacyApiReads++;
        }
        response.setHeader(
          "Content-Type",
          relative.endsWith(".js")
            ? "text/javascript"
            : relative.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
        if (relative)
          response.setHeader("Cache-Control", "public, max-age=31536000");
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve(undefined)),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture port");
    const origin = `http://127.0.0.1:${address.port}${basePath}`;
    try {
      await page.goto(origin);
      await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
      await page.evaluate(() => {
        // Existing browser settings predate the optional mihomo configuration.
        localStorage.setItem(
          "nas-dashboard.settings.v1",
          JSON.stringify({
            name: "更新前的 NAS",
            api: { mode: "proxy", url: "./api/index.php" },
            widgets: ["resources", "storage", "network", "containers"],
          }),
        );
      });
      updated = true;
      await page.goto(origin);
      await expect(page.locator("#connection-text")).toHaveText("已连接");
      await expect(page.locator("#device-name")).toHaveText("更新前的 NAS");
      await expect(page.locator("svg[data-lucide='settings-2']")).toBeVisible();
      await page.getByRole("button", { name: "监控设置", exact: true }).click();
      await expect(page.getByLabel("连接方式", { exact: true })).toHaveValue(
        "proxy",
      );
      await expect(
        page.getByLabel("同源代理地址", { exact: true }),
      ).toHaveValue("./api/index.php");
      await expect(
        page.getByLabel("mihomo 同源代理地址", { exact: true }),
      ).toHaveValue("./api/mihomo.php");
      expect(legacyApiReads).toBe(1);
      expect(errors).toEqual([]);
      expect(moduleRequests.length).toBeGreaterThan(20);
      const revisions = new Set(
        moduleRequests.map((url) => url.searchParams.get("v")),
      );
      expect(revisions.size).toBe(1);
      expect([...revisions][0]).toMatch(
        commit ? new RegExp(`^${commit}$`) : /^manual-/,
      );
    } finally {
      await test.info().attach("startup-errors", {
        body: JSON.stringify(errors),
        contentType: "application/json",
      });
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve(undefined))),
      );
    }
  });
}

test("startup failure offers reload and invalid metadata preserves first-run setup", async ({
  page,
}) => {
  let unavailable = true;
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      "nas-dashboard.settings.v1",
      JSON.stringify({ name: "保留的 NAS 设置" }),
    );
  });
  await page.route("**/build.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ commit: "../invalid-revision" }),
    }),
  );
  await page.route("**/js/core/api.js*", (route) =>
    unavailable ? route.abort() : route.continue(),
  );
  await page.goto("/");
  await expect(page.locator("#notice")).toBeVisible();
  await expect(page.locator("#notice-text")).toContainText("页面加载失败");
  // A failed import never deletes settings. Reload retries the same deployment
  // after its missing file becomes available and restores first-run controls.
  unavailable = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("设备名称", { exact: true })).toHaveValue(
    "保留的 NAS 设置",
  );
  await expect(
    page.getByRole("checkbox", { name: "mihomo 监控" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
