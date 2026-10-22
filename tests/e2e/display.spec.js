import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Inspect rendered Chart.js state to prove controller switches retain measured samples.
/** @param {import('@playwright/test').Page} page */
const charts = (page) =>
  page.locator("canvas").evaluateAll((canvases) =>
    canvases.map((canvas) => {
      const chart = /** @type {any} */ (window).Chart.getChart(canvas);
      return {
        type: chart.config.type,
        fill: chart.data.datasets[0].fill,
        points: chart.data.datasets[0].data,
        font: chart.options.scales.x.ticks.font.size,
      };
    }),
  );

test("chart and text preferences apply immediately, retain history and survive reload", async ({
  page,
}, testInfo) => {
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?demo=1");
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  await page.getByRole("button", { name: "暂停自动更新" }).click();
  const before = await charts(page);
  const cpu = await page.locator("#cpu-value").textContent();
  for (const style of ["line", "bar", "area"]) {
    await page.getByLabel("图表类型").selectOption(style);
    const after = await charts(page);
    expect(after.map((chart) => chart.points)).toEqual(
      before.map((chart) => chart.points),
    );
    expect(
      after.every((chart) => chart.type === (style === "bar" ? "bar" : "line")),
    ).toBe(true);
    expect(
      after.every(
        (chart) => chart.fill === (style === "area" ? "origin" : false),
      ),
    ).toBe(true);
    await expect(page.locator("#cpu-value")).toHaveText(cpu ?? "");
    await expect(page.locator("#connection-text")).toHaveText("演示已暂停");
  }
  await page.getByLabel("显示字号").selectOption("large");
  expect((await charts(page))[0].font).toBeGreaterThan(before[0].font);
  await expect(page.locator("body")).toHaveCSS("font-size", "18px");
  await page.getByLabel("图表类型").selectOption("bar");
  await page.screenshot({
    path: `artifacts/display-large-bar-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByLabel("图表类型")).toHaveValue("bar");
  await expect(page.getByLabel("显示字号")).toHaveValue("large");
  await page.getByRole("link", { name: "系统资源", exact: true }).click();
  expect((await charts(page)).every((chart) => chart.type === "bar")).toBe(
    true,
  );
  await page.getByLabel("图表类型").selectOption("line");
  expect(
    (await charts(page)).every(
      (chart) => chart.type === "line" && chart.fill === false,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("large type fits narrow screens and controls work with keyboard", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1");
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  await page.getByLabel("显示字号").selectOption("large");
  const style = page.getByLabel("图表类型");
  await style.focus();
  // Headless WebKit cannot drive the OS-owned popup with key events. Check
  // keyboard traversal here; native arrow/Enter selection is verified in IAB.
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("显示字号")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(style).toBeFocused();
  await style.selectOption("bar");
  await expect(style).toHaveValue("bar");
  for (const route of [
    "运行概览",
    "系统资源",
    "存储空间",
    "网络流量",
    "容器服务",
  ]) {
    await page.getByRole("link", { name: route, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
  await page.getByRole("link", { name: "运行概览", exact: true }).click();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page
    .getByRole("button", { name: "保存设置", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "保存设置", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: `artifacts/display-large-settings-${testInfo.project.name}.png`,
  });
});
