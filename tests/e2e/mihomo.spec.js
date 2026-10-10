import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { defaults } from "../../site/js/core/config.js";
import { demoSnapshot } from "../../site/js/core/demo.js";

/** @typedef {import("@playwright/test").Page} Page */

/** @param {Page} page */
async function mockSources(page) {
  const control = {
    mihomo: "online",
    glances: "online",
    requests: 0,
    nasRequests: 0,
    rowCount: 12,
    excludeFirst: false,
    legacy: false,
    host: "",
  };
  const started = new Date(Date.now() - 60000).toISOString();
  await page.route("**/api/4/*", async (route) => {
    control.nasRequests++;
    const plugin =
      new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const data = demoSnapshot().data;
    await route.fulfill(
      control.glances === "offline"
        ? { status: 503, contentType: "application/json", body: "{}" }
        : {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(
              data[/** @type {keyof typeof data} */ (plugin)],
            ),
            headers: { "Access-Control-Allow-Origin": "*" },
          },
    );
  });
  await page.route("**/api/mihomo*.php", async (route) => {
    control.requests++;
    const errors =
      control.mihomo === "offline"
        ? {
            connections: "mihomo 认证失败，请检查服务端 Secret",
            memory: "认证失败",
            version: "认证失败",
          }
        : control.mihomo === "partial"
          ? { memory: "内存采样不可用" }
          : {};
    const items = Array.from({ length: control.rowCount }, (_, index) => ({
      id: `connection-${index}`,
      host:
        index === 0 && control.host ? control.host : `target-${index}.example`,
      sourceIP: `192.0.2.${10 + (index % 3)}`,
      sourcePort: String(50000 + index),
      destinationIP: `198.51.100.${20 + index}`,
      destinationPort: "443",
      network: index % 2 ? "UDP" : "TCP",
      type: "Mixed",
      process: ["browser", "media", "backup"][index % 3],
      processPath: "/apps/browser",
      inboundName: "mixed-in",
      rule: "DomainSuffix",
      rulePayload: "example",
      chains: [index % 2 ? "node-B" : "node-A", "Auto"],
      start: started,
      upload: control.requests * (index + 1) * 1024,
      download: control.requests * (index + 1) * 2048,
    })).filter((_, index) => !control.excludeFirst || index !== 0);
    const data =
      control.mihomo === "offline"
        ? {}
        : {
            connections: {
              count: items.length,
              uploadTotal: control.requests * 1024 ** 2,
              downloadTotal: control.requests * 4 * 1024 ** 2,
              ...(control.legacy ? {} : { items, truncated: false }),
            },
            ...(control.mihomo === "partial"
              ? {}
              : { memory: { inuse: 118 * 1024 ** 2 } }),
            version: { version: "v1.19.test", meta: true },
          };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data, errors, collectedAt: 0 }),
    });
  });
  return control;
}

/** @param {Page} page @param {boolean} [dual=false] @param {number} [historyMinutes=15] */
async function configured(page, dual = false, historyMinutes = 15) {
  await page.addInitScript(
    (config) => {
      localStorage.setItem("nas-dashboard.settings.v1", JSON.stringify(config));
    },
    {
      ...defaults,
      historyMinutes,
      api: { mode: "direct", url: dual ? "http://nas.test/api/4" : "" },
      widgets: dual ? [...defaults.widgets, "mihomo"] : ["mihomo"],
    },
  );
  await page.goto("/");
  await expect(page.locator("#connection-text")).toHaveText("已连接");
}

/** @param {Page} page */
async function refresh(page) {
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "刷新", exact: true }),
  ).toBeEnabled();
}

test("mihomo alone can be configured, tested, persisted and navigated on both layouts", async ({
  page,
}, testInfo) => {
  const control = await mockSources(page);
  await page.goto("/");
  await expect(
    page.getByLabel("mihomo 同源代理地址", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: "mihomo 监控" }).check();
  await expect(
    page.getByLabel("mihomo 同源代理地址", { exact: true }),
  ).toHaveValue("./api/mihomo.php");
  await page
    .getByRole("button", { name: "测试 mihomo 连接", exact: true })
    .click();
  await expect(page.locator("#mihomo-test-result")).toHaveText(
    "连接成功，mihomo 监控数据可读取",
  );
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("#connection-text")).toHaveText("已连接");
  await expect(page.locator("#source-badge")).toHaveText("MIHOMO API");
  await expect(page.locator("#cpu-value")).toHaveText("--");
  await expect(
    page.locator('#widget-mihomo [data-mihomo="memory"]'),
  ).toHaveText("118.0 MiB");
  await expect(
    page.locator('#widget-mihomo [data-mihomo="connections"]'),
  ).toHaveText("12");
  await expect(page.locator('#widget-mihomo [data-mihomo="up"]')).toHaveText(
    "--",
  );
  await refresh(page);
  await expect(
    page.locator('#widget-mihomo [data-mihomo="up"]'),
  ).not.toHaveText("--");
  // The first rate follows a null baseline: it must still paint a visible point.
  expect(
    await page.locator("#widget-mihomo canvas").evaluate((canvas) => {
      const chart = /** @type {any} */ (window).Chart.getChart(canvas);
      return chart
        .getDatasetMeta(0)
        .data.some(
          (/** @type {any} */ point) => !point.skip && point.options.radius > 0,
        );
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "暂停自动更新" }).click();
  const requests = control.requests;
  // Native links must support keyboard navigation as well as touch/click.
  const navigation = page.getByRole("link", {
    name: "mihomo 监控",
    exact: true,
  });
  await navigation.focus();
  await navigation.press("Enter");
  await expect(navigation).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#view-mihomo")).toBeVisible();
  await expect(page.locator("#page-title-text")).toHaveText("mihomo 监控");
  await expect(page.locator('#view-mihomo [data-mihomo="version"]')).toHaveText(
    "v1.19.test",
  );
  await expect(page.locator("#view-mihomo [data-mihomo-status]")).toHaveText(
    "已暂停更新",
  );
  expect(control.requests).toBe(requests);
  expect(control.nasRequests).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  // Match the project's WCAG AA checks; hash routes are not document skip links.
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: `artifacts/mihomo-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("#view-mihomo")).toBeVisible();
  await expect(page.locator("#connection-text")).toHaveText("已连接");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("nas-dashboard.settings.v1"),
    ),
  ).not.toContain("secret");
  // Disabling the only source is a valid reversible settings action.
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page.getByRole("checkbox", { name: "mihomo 监控" }).uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("#page-title-text")).toHaveText("运行概览");
  await expect(
    page.getByRole("button", { name: "刷新", exact: true }),
  ).toBeDisabled();
});

test("dual sources isolate failures and recover without crossing rate baselines", async ({
  page,
}) => {
  const control = await mockSources(page);
  await configured(page, true);
  await expect(page.locator("#source-badge")).toHaveText(
    "GLANCES + MIHOMO API",
  );
  await refresh(page);
  await expect(
    page.locator('#widget-mihomo [data-mihomo="up"]'),
  ).not.toHaveText("--");
  const total = await page
    .locator('#widget-mihomo [data-mihomo="downloadTotal"]')
    .textContent();
  control.mihomo = "offline";
  await refresh(page);
  await expect(page.locator("#connection-text")).toHaveText("部分数据不可用");
  await expect(page.locator("#widget-mihomo [data-mihomo-status]")).toHaveText(
    "连接中断",
  );
  await expect(
    page.locator('#widget-mihomo [data-mihomo="downloadTotal"]'),
  ).toHaveText(total ?? "");
  await expect(page.locator('#widget-mihomo [data-mihomo="up"]')).toHaveText(
    "--",
  );
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  control.mihomo = "online";
  control.glances = "offline";
  await refresh(page);
  await expect(page.locator("#connection-text")).toHaveText("部分数据不可用");
  await expect(page.locator("#widget-mihomo [data-mihomo-status]")).toHaveText(
    "已采集",
  );
  await expect(page.locator('#widget-mihomo [data-mihomo="up"]')).toHaveText(
    "--",
  );
  control.glances = "online";
  await refresh(page);
  await expect(page.locator("#connection-text")).toHaveText("已连接");
  await expect(
    page.locator('#widget-mihomo [data-mihomo="up"]'),
  ).not.toHaveText("--");
});

test("partial memory failures retain values and display the affected endpoint", async ({
  page,
}) => {
  const control = await mockSources(page);
  await configured(page);
  control.mihomo = "partial";
  await refresh(page);
  await expect(page.locator("#connection-text")).toHaveText("部分数据不可用");
  await expect(
    page.locator('#widget-mihomo [data-mihomo="memory"]'),
  ).toHaveText("118.0 MiB");
  await expect(page.locator("#widget-mihomo")).toContainText(
    "memory：内存采样不可用",
  );
  await expect(
    page.locator('#widget-mihomo [data-mihomo="up"]'),
  ).not.toHaveText("--");
});

test("pause and source edits preserve NAS readings and reset only mihomo", async ({
  page,
}) => {
  const control = await mockSources(page);
  await configured(page, true);
  await refresh(page);
  await page.getByRole("button", { name: "暂停自动更新" }).click();
  const cpu = await page.locator("#cpu-value").textContent();
  const nasRequests = control.nasRequests;
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page
    .getByLabel("mihomo 同源代理地址", { exact: true })
    .fill("./api/mihomo-alt.php");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#cpu-value")).toHaveText(cpu ?? "");
  await expect(
    page.locator('#widget-mihomo [data-mihomo="memory"]'),
  ).toHaveText("--");
  expect(control.nasRequests).toBe(nasRequests);
  await refresh(page);
  await expect(page.locator('#widget-mihomo [data-mihomo="up"]')).toHaveText(
    "--",
  );
  await refresh(page);
  await expect(
    page.locator('#widget-mihomo [data-mihomo="up"]'),
  ).not.toHaveText("--");
  await page.getByRole("button", { name: "恢复自动更新" }).click();
  await expect(page.locator('#widget-mihomo [data-mihomo="up"]')).toHaveText(
    "--",
  );
});

test("mihomo proxy validation stays in the dialog and disabling hides its active route", async ({
  page,
}) => {
  const control = await mockSources(page);
  await configured(page, true);
  await page.getByRole("link", { name: "mihomo 监控", exact: true }).click();
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page
    .getByLabel("mihomo 同源代理地址", { exact: true })
    .fill("http://other.test:9090");
  const requests = control.requests;
  await page
    .getByRole("button", { name: "测试 mihomo 连接", exact: true })
    .click();
  await expect(page.locator("#mihomo-error")).toContainText("同源");
  await expect(
    page.getByLabel("mihomo 同源代理地址", { exact: true }),
  ).toBeFocused();
  expect(control.requests).toBe(requests);
  await page.getByRole("checkbox", { name: "mihomo 监控" }).uncheck();
  await expect(
    page.getByLabel("mihomo 同源代理地址", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#page-title-text")).toHaveText("运行概览");
  await expect(page.locator("#widget-mihomo")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "mihomo 监控", exact: true }),
  ).toHaveCount(0);
});

test("demo mihomo is opt-in and never contacts its proxy", async ({ page }) => {
  const control = await mockSources(page);
  await page.goto("/?demo=1");
  await expect(page.locator("#widget-mihomo")).toHaveCount(0);
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page.getByRole("checkbox", { name: "mihomo 监控" }).check();
  await expect(
    page.getByRole("button", { name: "测试 mihomo 连接", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(
    page.locator('#widget-mihomo [data-mihomo="version"]'),
  ).toHaveText("演示版本");
  await expect(page.locator("#widget-mihomo [data-mihomo-status]")).toHaveText(
    "演示数据",
  );
  expect(control.requests).toBe(0);
});

test("hidden tabs stop both sources and resume with a fresh rate baseline", async ({
  page,
}) => {
  await page.clock.install();
  const control = await mockSources(page);
  await configured(page, true);
  await page.clock.runFor(5000);
  await expect(
    page.locator('#widget-mihomo [data-mihomo="up"]'),
  ).not.toHaveText("--");
  await expect(
    page.getByRole("button", { name: "刷新", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const requests = control.requests;
  const nasRequests = control.nasRequests;
  await page.clock.runFor(30000);
  expect(control.requests).toBe(requests);
  expect(control.nasRequests).toBe(nasRequests);
  await expect(page.locator("#widget-mihomo [data-mihomo-status]")).toHaveText(
    "数据已过期",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#connection-text")).toHaveText("已连接");
  await expect(page.locator('#widget-mihomo [data-mihomo="up"]')).toHaveText(
    "--",
  );
  await page.clock.runFor(5000);
  await expect(
    page.locator('#widget-mihomo [data-mihomo="up"]'),
  ).not.toHaveText("--");
});

test("NAS address changes and paused module toggles retain mihomo samples", async ({
  page,
}) => {
  const control = await mockSources(page);
  await configured(page, true);
  await refresh(page);
  await page.getByRole("button", { name: "暂停自动更新" }).click();
  const total = await page
    .locator('#widget-mihomo [data-mihomo="downloadTotal"]')
    .textContent();
  const requests = control.requests;
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page
    .getByLabel("Glances API 地址", { exact: true })
    .fill("http://nas-alternate.test/api/4");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#cpu-value")).toHaveText("--");
  await expect(
    page.locator('#widget-mihomo [data-mihomo="downloadTotal"]'),
  ).toHaveText(total ?? "");
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page.getByRole("checkbox", { name: "mihomo 监控" }).uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page.getByRole("checkbox", { name: "mihomo 监控" }).check();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(
    page.locator('#widget-mihomo [data-mihomo="downloadTotal"]'),
  ).toHaveText(total ?? "");
  expect(control.requests).toBe(requests);
});

test("three mihomo pages share samples, rankings and page-session usage", async ({
  page,
}, testInfo) => {
  const control = await mockSources(page);
  await configured(page);
  await refresh(page);
  await page.getByRole("button", { name: "暂停自动更新" }).click();
  const requests = control.requests;
  await page.getByRole("link", { name: "mihomo 监控", exact: true }).click();
  await expect(page.locator("#view-mihomo canvas")).toHaveCount(3);
  await expect(page.locator("#view-mihomo")).toContainText("TCP");
  await expect(page.locator("#view-mihomo")).toContainText("node-A");
  await page.screenshot({
    path: `artifacts/mihomo-overview-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "连接", exact: true }).click();
  await expect(page.locator("#view-mihomo-connections")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "连接", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("table", { name: "mihomo 连接列表" }),
  ).toContainText("target-11.example");
  await page.screenshot({
    path: `artifacts/mihomo-connections-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "用量", exact: true }).click();
  await expect(page.locator('[data-mihomo-usage="total"]')).toHaveText(
    "234.0 KiB",
  );
  await page.getByLabel("统计维度", { exact: true }).selectOption("process");
  await expect(
    page.getByRole("table", { name: "mihomo 用量排行", exact: true }),
  ).toContainText("browser");
  await page
    .getByRole("button", { name: "查看 browser 的用量明细", exact: true })
    .click();
  await expect(page.locator(".mihomo-usage-detail")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "mihomo 用量分类明细", exact: true }),
  ).toContainText("target-");
  await page.getByRole("button", { name: "收起明细", exact: true }).click();
  await expect(page.getByLabel("统计维度", { exact: true })).toBeFocused();
  await page.screenshot({
    path: `artifacts/mihomo-usage-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "概览", exact: true }).click();
  await expect(page.locator("#view-mihomo")).toBeVisible();
  await page.getByRole("link", { name: "用量", exact: true }).click();
  await expect(page.getByLabel("统计维度", { exact: true })).toHaveValue(
    "process",
  );
  await expect(page.locator('[data-mihomo-usage="total"]')).toHaveText(
    "234.0 KiB",
  );
  expect(control.requests).toBe(requests);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});

test("connection filtering, sorting, pagination, details and observed endings work", async ({
  page,
}) => {
  const control = await mockSources(page);
  control.rowCount = 30;
  await configured(page);
  await page.getByRole("link", { name: "查看连接", exact: true }).click();
  const table = page.getByRole("table", {
    name: "mihomo 连接列表",
    exact: true,
  });
  await expect
    .poll(async () => table.locator("tbody tr").count())
    .toBeGreaterThan(0);
  expect(await table.locator("tbody tr").count()).toBeLessThan(30);
  const first = await table.locator("tbody tr").first().textContent();
  await page
    .getByRole("button", { name: "下一页mihomo 连接列表", exact: true })
    .click();
  await expect(table.locator("tbody tr").first()).not.toHaveText(first ?? "");
  await page.getByLabel("网络协议", { exact: true }).selectOption("UDP");
  await page.getByLabel("搜索连接", { exact: true }).fill("target-29");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("target-29.example");
  await page.getByRole("button", { name: "清除连接搜索", exact: true }).click();
  await expect(page.getByLabel("搜索连接", { exact: true })).toBeFocused();
  await page.getByLabel("网络协议", { exact: true }).selectOption("all");
  await page
    .getByRole("button", { name: "按累计下载排序", exact: true })
    .click();
  await expect(table.locator("tbody tr").first()).toContainText(
    "target-29.example",
  );
  await page
    .getByRole("button", { name: "按累计下载排序", exact: true })
    .click();
  await expect(table.locator("tbody tr").first()).toContainText(
    "target-0.example",
  );
  const details = page.getByRole("button", {
    name: "查看连接 target-0.example:443 的详情",
    exact: true,
  });
  await details.click();
  await expect(page.getByRole("dialog")).toContainText("Auto → node-A");
  await expect(page.getByRole("dialog")).toContainText("192.0.2.10");
  await expect(page.getByRole("dialog")).toContainText("DomainSuffix");
  const accessible = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessible.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(details).toBeFocused();
  control.excludeFirst = true;
  await refresh(page);
  await page.getByLabel("连接状态", { exact: true }).selectOption("closed");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("target-0.example");
  await expect(table).toContainText("--");
  await details.click();
  await page.goBack();
  await expect(page.locator(".mihomo-connection-dialog")).toHaveJSProperty(
    "open",
    false,
  );
  await expect(page.locator("#overview")).toBeVisible();
  await page.goForward();
  await expect(page.locator("#view-mihomo-connections")).toBeVisible();
});

test("usage covers the whole page session beyond the overview history and resets on reload", async ({
  page,
}) => {
  await page.clock.install();
  const control = await mockSources(page);
  await configured(page, false, 1);
  for (let index = 0; index < 14; index++) {
    const requests = control.requests;
    await page.clock.runFor(5000);
    await expect.poll(() => control.requests).toBeGreaterThan(requests);
    await expect(
      page.getByRole("button", { name: "刷新", exact: true }),
    ).toBeEnabled();
  }
  await page.getByRole("button", { name: "暂停自动更新" }).click();
  await page.getByRole("link", { name: "查看用量", exact: true }).click();
  const total = await page.locator('[data-mihomo-usage="total"]').textContent();
  expect(total).toBe("3.2 MiB");
  await page.getByLabel("统计维度", { exact: true }).selectOption("outbound");
  await expect(page.locator('[data-mihomo-usage="total"]')).toHaveText(
    total ?? "",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("nas-dashboard.settings.v1"),
    ),
  ).not.toContain("target-0.example");
  await page.reload();
  await expect(page.locator('[data-mihomo-usage="total"]')).toHaveText("--");
  await page.clock.runFor(5000);
  await expect(page.locator('[data-mihomo-usage="total"]')).toHaveText(
    "234.0 KiB",
  );
});

test("older proxies remain usable and connection text never becomes markup", async ({
  page,
}) => {
  const control = await mockSources(page);
  control.legacy = true;
  await configured(page);
  await page.getByRole("link", { name: "查看连接", exact: true }).click();
  await expect(page.locator("#view-mihomo-connections")).toContainText(
    "更新站点的 PHP 代理",
  );
  await page.getByRole("link", { name: "用量", exact: true }).click();
  await expect(page.locator('[data-mihomo-usage="total"]')).toHaveText("--");
  control.legacy = false;
  control.host = '<img src=x onerror="window.injected=true">';
  await refresh(page);
  await page.getByRole("link", { name: "连接", exact: true }).click();
  await page.getByLabel("搜索连接", { exact: true }).fill("<img");
  await expect(
    page.getByRole("table", { name: "mihomo 连接列表" }),
  ).toContainText("<img");
  await expect(page.locator("#view-mihomo-connections table img")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => /** @type {any} */ (window).injected),
  ).toBeUndefined();
});
