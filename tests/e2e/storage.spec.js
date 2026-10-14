import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoSnapshot } from "../../site/js/core/demo.js";
import { smartFixture } from "../fixtures/smart.js";

/** @typedef {import("@playwright/test").Page} Page */

/**
 * @param {Page} page
 * @param {{status: number, data: unknown, offline?: boolean}} control
 */
async function connect(page, control) {
  await page.route("**/api/4/*", async (route) => {
    if (control.offline) return route.abort();
    const plugin = new URL(route.request().url()).pathname.split("/").at(-1);
    const data = demoSnapshot().data;
    await route.fulfill({
      status: plugin === "smart" ? control.status : 200,
      contentType: "application/json",
      body: JSON.stringify(
        plugin === "smart"
          ? control.data
          : (data[/** @type {keyof typeof data} */ (plugin)] ?? null),
      ),
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Glances API 地址", { exact: true })
    .fill("http://nas.test/api/4");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  await page.getByRole("link", { name: "存储空间", exact: true }).click();
  await expect(page.locator("#view-storage")).toBeVisible();
}

test("storage lists every SMART disk with raw Celsius or an unknown reading", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const control = {
    status: 200,
    data: structuredClone(smartFixture),
    offline: false,
  };
  // Keep names untrusted and exercise wrapping without inventing bay/model identities.
  control.data[0].DeviceName = `sdc <img src=x> ${"LongModel".repeat(16)}`;
  await connect(page, control);
  const view = page.locator("#view-storage");
  const list = view.getByRole("list", { name: "硬盘温度" });
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(5);
  await expect(rows.locator("strong")).toHaveText([
    "--",
    "34 °C",
    "33 °C",
    "34 °C",
    "33 °C",
  ]);
  await expect(rows.first()).toContainText(control.data[0].DeviceName);
  // A long model name must not split the missing marker across two lines.
  const unknown = await rows.first().locator("strong").boundingBox();
  expect(unknown?.height).toBeLessThan(24);
  await expect(list.locator("img")).toHaveCount(0);
  await expect(view).toContainText("5 块硬盘，4 块有温度数据");
  await expect(view).toContainText("cachedev_0");
  await expect(page.locator("#temperature-value")).not.toHaveText("34");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `artifacts/storage-smart-${testInfo.project.name}.png`,
    fullPage: true,
  });

  // A total outage keeps the prior successful sample with the shared stale warning.
  control.offline = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator("#connection-text")).toHaveText("连接中断");
  await expect(rows.locator("strong")).toHaveText([
    "--",
    "34 °C",
    "33 °C",
    "34 °C",
    "33 °C",
  ]);
  await expect(view).toContainText("硬盘温度暂不可用");
});

test("unavailable and empty SMART data leave capacity usable and recover on refresh", async ({
  page,
}) => {
  const control = {
    status: 400,
    data: /** @type {unknown} */ ({ detail: "Unknown plugin smart" }),
  };
  await connect(page, control);
  const view = page.locator("#view-storage");
  const list = view.getByRole("list", { name: "硬盘温度" });
  await expect(page.locator("#connection-text")).toHaveText("部分数据不可用");
  await expect(list.locator("strong")).toHaveText("--");
  await expect(view).toContainText("硬盘温度暂不可用");
  await expect(view).toContainText("cachedev_0");

  control.status = 200;
  control.data = [];
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator("#connection-text")).toHaveText("已连接");
  await expect(list.locator("strong")).toHaveText("--");
  await expect(view).toContainText("0 块硬盘，0 块有温度数据");

  control.data = [
    { DeviceName: "sda" },
    { DeviceName: "sdb", 194: { raw: "0", value: "100" } },
  ];
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.locator("strong")).toHaveText(["--", "0 °C"]);
  await expect(view).toContainText("2 块硬盘，1 块有温度数据");
});
