import { test, expect } from "@playwright/test";
import { demoSnapshot } from "../../site/js/core/demo.js";

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("@playwright/test").Locator} Locator */

/** @param {number} count @param {boolean} [longNames=false] */
function containerRows(count, longNames = false) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    name: `container-${String(index + 1).padStart(2, "0")}${longNames && index % 3 === 0 ? "-long-name".repeat(12) : ""}`,
    image: "example/container:latest",
    status: index >= count - 2 ? "exited" : index === 0 ? "healthy" : "running",
    cpu_percent: index / 10,
    memory_usage: (index + 1) * 1024 ** 2,
  }));
}

/** @param {Page} page @param {ReturnType<typeof containerRows>} initial */
async function connectContainers(page, initial) {
  let containers = initial;
  let requests = 0;
  await page.route("**/api/4/*", async (route) => {
    const plugin = new URL(route.request().url()).pathname.split("/").at(-1);
    if (plugin === "containers") requests++;
    const data = demoSnapshot().data;
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(
        plugin === "containers"
          ? containers
          : (data[/** @type {keyof typeof data} */ (plugin)] ?? null),
      ),
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Glances API 地址", { exact: true })
    .fill("http://nas.test/api/4");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#connection-text")).toHaveText("已连接");
  await page.getByRole("button", { name: "暂停自动更新" }).click();
  return {
    /** @param {ReturnType<typeof containerRows>} next */
    setRows(next) {
      containers = next;
    },
    requests: () => requests,
  };
}

/** @param {Locator} panel @param {number} height */
async function resizePanel(panel, height) {
  await panel.evaluate(async (node, value) => {
    node.style.height = `${value}px`;
    // ResizeObserver schedules its measurement for the following paint.
    await new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve(undefined)),
      ),
    );
  }, height);
}

/** @param {Page} page */
async function refresh(page) {
  await Promise.all([
    page.waitForResponse("**/api/4/containers"),
    page.getByRole("button", { name: "刷新", exact: true }).click(),
  ]);
}

/** @param {Locator} panel @param {number} total */
async function collectPages(panel, total) {
  // Let any pending viewport resize finish before recording the first page.
  await panel.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(undefined)),
        ),
      ),
  );
  /** @type {string[]} */
  const names = [];
  for (let index = 0; index <= total; index++) {
    const viewport = panel.locator(".table-scroll");
    // Real geometry catches clipped rows, including names that wrap on mobile.
    const fit = await viewport.evaluate((node) => {
      const table = node.querySelector("table");
      return (
        table && table.getBoundingClientRect().height <= node.clientHeight + 1
      );
    });
    expect(fit).toBe(true);
    names.push(...(await panel.locator("tbody strong").allTextContents()));
    const next = panel.getByRole("button", { name: /下一页/ });
    if (!(await next.isVisible()) || (await next.isDisabled())) return names;
    await next.click();
  }
  throw new Error("Container pagination did not reach the last page");
}

test("container pages fill the panel and disappear when every row fits", async ({
  page,
}, testInfo) => {
  const rows = containerRows(8);
  const source = await connectContainers(page, rows);
  const panel = page.locator("#widget-containers");
  const controls = panel.locator(".pagination");
  const body = panel.locator("tbody tr");
  const previous = panel.getByRole("button", { name: /上一页/ });
  const next = panel.getByRole("button", { name: /下一页/ });
  const requests = source.requests();

  // On desktop, taller neighboring storage expands the same grid row.
  if ((page.viewportSize()?.width ?? 0) > 680) {
    const storage = page.locator("#widget-storage");
    await storage.evaluate((node) => {
      node.style.minHeight = "640px";
    });
    await expect(body).toHaveCount(8);
    await expect(controls).toBeHidden();
    await storage.evaluate((node) => {
      node.style.minHeight = "";
    });
  }

  await resizePanel(panel, 640);
  await expect(body).toHaveCount(8);
  await expect(controls).toBeHidden();
  await expect(panel.locator(".table-footer > span")).toHaveText("8 个容器");
  const exactHeight = await panel.evaluate((node) => {
    const viewport = /** @type {HTMLElement} */ (
      node.querySelector(".table-scroll")
    );
    const table = /** @type {HTMLTableElement} */ (node.querySelector("table"));
    return Math.ceil(
      node.getBoundingClientRect().height -
        viewport.clientHeight +
        table.getBoundingClientRect().height,
    );
  });
  await resizePanel(panel, exactHeight);
  await expect(body).toHaveCount(8);
  await expect(controls).toBeHidden();
  await panel.screenshot({
    path: testInfo.outputPath("containers-fit.png"),
  });
  await resizePanel(panel, 430);
  await expect(controls).toBeVisible();
  await expect(previous).toBeDisabled();
  await panel.screenshot({
    path: testInfo.outputPath("containers-paged.png"),
  });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(previous).toBeEnabled();
  await expect(next).toBeDisabled();

  await page.getByLabel("筛选容器状态").selectOption("stopped");
  await expect(body).toHaveCount(2);
  await expect(controls).toBeHidden();
  await page.getByLabel("筛选容器状态").selectOption("all");
  await expect(previous).toBeDisabled();
  expect(await collectPages(panel, rows.length)).toEqual(
    rows.map((row) => row.name),
  );
  expect(source.requests()).toBe(requests);

  await previous.focus();
  await resizePanel(panel, 640);
  await expect(body).toHaveCount(8);
  await expect(controls).toBeHidden();
  await expect(panel.locator(".table-scroll")).toBeFocused();

  await resizePanel(panel, 430);
  await expect(controls).toBeVisible();
  await next.click();
  source.setRows(rows.slice(0, 2));
  await refresh(page);
  await expect(body).toHaveCount(2);
  await expect(controls).toBeHidden();
  await expect(panel.locator(".table-footer > span")).toHaveText("2 个容器");
});

test("container pages handle wrapped rows, narrow layouts and hidden routes", async ({
  page,
}) => {
  const rows = containerRows(13, true);
  const source = await connectContainers(page, rows);
  const panel = page.locator("#widget-containers");
  await resizePanel(panel, 550);
  await expect(panel.locator(".pagination")).toBeVisible();
  expect(await collectPages(panel, rows.length)).toEqual(
    rows.map((row) => row.name),
  );

  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByLabel("筛选容器状态").selectOption("running");
  await page.getByLabel("筛选容器状态").selectOption("all");
  expect(await collectPages(panel, rows.length)).toEqual(
    rows.map((row) => row.name),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);

  await page.getByRole("link", { name: "容器服务", exact: true }).click();
  const detail = page.locator("#view-containers");
  await expect(detail.locator("tbody strong").first()).toHaveText(rows[0].name);
  await detail.getByRole("button", { name: "CPU", exact: true }).click();
  expect(await collectPages(detail, rows.length)).toEqual(
    rows.map((row) => row.name).reverse(),
  );

  // Data can shrink while the overview has no layout; it must clamp on return.
  source.setRows(rows.slice(0, 2));
  await refresh(page);
  await page.getByRole("link", { name: "运行概览", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(2);
  await expect(panel.locator(".pagination")).toBeHidden();

  // A single oversized identifier remains reachable through the table scroller.
  source.setRows([{ ...rows[0], name: "long-name-".repeat(150) }, rows[1]]);
  await refresh(page);
  await page.getByLabel("筛选容器状态").selectOption("stopped");
  await page.getByLabel("筛选容器状态").selectOption("all");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  expect(
    await panel
      .locator(".table-scroll")
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await panel.getByRole("button", { name: /下一页/ }).click();
  await expect(panel.locator("tbody strong")).toHaveText(rows[1].name);
});
