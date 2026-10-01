import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoSnapshot } from "../../site/js/core/demo.js";

/** @typedef {import("@playwright/test").Page} Page */

// Isolated fixtures exercise failure paths without depending on a private NAS.
/**
 * @param {Page} page
 */
async function mockGlances(page) {
  await page.route(
    "**/api/4/*",
    async (/** @type {import("@playwright/test").Route} */ route) => {
      const plugin =
        new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
      const data = demoSnapshot().data;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          data[/** @type {keyof typeof data} */ (plugin)] ?? null,
        ),
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    },
  );
}

/**
 * @param {Page} page
 */
async function connect(page) {
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByLabel("Glances API 地址", { exact: true })
    .fill("http://nas.test/api/4");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#connection-text")).toHaveText("已连接");
}

test("first visit collects an address, tests it, and persists settings", async ({
  page,
}) => {
  await mockGlances(page);
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByLabel("Glances API 地址", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#api-error")).toHaveText(/有效/);
  await page
    .getByLabel("Glances API 地址", { exact: true })
    .fill("http://nas.test/api/4");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator("#test-result")).toHaveText(
    "连接成功，CPU 与内存可读取",
  );
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#connection-text")).toHaveText("已连接");
  await expect(page.locator("#storage")).toContainText("/volume1");
  await page.reload();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("#connection-text")).toHaveText("已连接");
});

test("demo charts render and layout fits the viewport", async ({
  page,
}, testInfo) => {
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?demo=1");
  await expect(page.locator("#source-badge")).toHaveText("演示数据");
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  await expect(page.locator("canvas")).toHaveCount(2);
  const checks = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    charts: Array.from(document.querySelectorAll("canvas")).map((canvas) => {
      const pixels = /** @type {CanvasRenderingContext2D} */ (
        canvas.getContext("2d")
      ).getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let index = 3; index < pixels.length; index += 4)
        if (pixels[index] > 0) painted++;
      return {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        painted,
      };
    }),
  }));
  expect(checks.overflow).toBe(false);
  checks.charts.forEach((chart) => {
    expect(chart.width).toBeGreaterThan(150);
    expect(chart.height).toBeGreaterThan(100);
    expect(chart.painted).toBeGreaterThan(1000);
  });
  await page.screenshot({
    path: `artifacts/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "暂停自动更新" }).click();
  await expect(
    page.getByRole("button", { name: "恢复自动更新" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#connection-text")).toHaveText("演示已暂停");
});

test("network failure keeps prior readings and never switches to demo", async ({
  page,
}) => {
  await mockGlances(page);
  await connect(page);
  const value = await page.locator("#cpu-value").textContent();
  await page.route("**/api/4/*", (route) => route.abort());
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator("#connection-text")).toHaveText("连接中断");
  await expect(page.locator("#cpu-value")).toHaveText(value ?? "");
  await expect(page.locator("#source-badge")).toHaveText("GLANCES API");
  await expect(page.locator("#notice")).toContainText("最后一次采集");
});

test("missing sensors and containers do not block other metrics", async ({
  page,
}) => {
  await mockGlances(page);
  await page.route("**/api/4/sensors", (route) =>
    route.fulfill({ status: 404, body: "not available" }),
  );
  await page.route("**/api/4/containers", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");
  await page
    .getByLabel("Glances API 地址", { exact: true })
    .fill("http://nas.test/api/4");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#connection-text")).toHaveText("部分数据不可用");
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  await expect(page.locator("#temperature-value")).toHaveText("--");
  await expect(page.locator("#containers")).toContainText("暂无容器数据");
});

test("module settings and filters work with keyboard and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1");
  await expect(page.locator("#containers")).toContainText("backup-worker");
  await page.getByLabel("筛选容器状态").selectOption("stopped");
  await expect(page.locator("#containers tbody tr")).toHaveCount(1);
  await expect(page.locator("#containers")).toContainText("backup-worker");
  await page.getByRole("button", { name: "管理监控模块" }).click();
  await page.getByRole("checkbox", { name: "容器服务" }).uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#containers")).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "管理监控模块" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("monitoring and connection dialog pass automated accessibility checks", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.getByRole("button", { name: "管理监控模块" }).click();
  const dialogResult = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(dialogResult.violations).toEqual([]);
});
