import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// The caller supplies an endpoint for read-only integration checks; no IP is baked in.
const endpoint = process.env.GLANCES_API_URL;
if (!endpoint)
  throw new Error("Set GLANCES_API_URL to the Glances 4 endpoint.");
const base = process.env.DASHBOARD_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ channel: "chrome" });
await mkdir("artifacts", { recursive: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel("Glances API 地址", { exact: true }).fill(endpoint);
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page
    .locator("#test-result")
    .getByText("连接成功，CPU 与内存可读取", { exact: true })
    .waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page
    .locator("#connection-text")
    .getByText("已连接", { exact: true })
    .waitFor({ timeout: 15000 });
  await page.screenshot({
    path: "artifacts/dashboard-live-desktop.png",
    fullPage: true,
  });
  const live = await page.evaluate(() => ({
    status: document.querySelector("#connection-text")?.textContent,
    cpu: document.querySelector("#cpu-value")?.textContent,
    memory: document.querySelector("#memory-value")?.textContent,
    temperature: document.querySelector("#temperature-value")?.textContent,
    volumes: Array.from(document.querySelectorAll(".volume-name strong")).map(
      (element) => element.textContent,
    ),
    interface: document.querySelector(".panel-footnote")?.textContent,
    containers: document.querySelectorAll("#containers tbody .container-name")
      .length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  if (
    live.cpu === "--" ||
    live.memory === "--" ||
    live.overflow ||
    errors.length
  )
    throw new Error(JSON.stringify({ live, errors }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/dashboard-live-mobile.png",
    fullPage: true,
  });
  let developmentProxy = "not requested";
  // A static production preview intentionally has no PHP execution capability.
  if (process.env.VERIFY_DEV_PROXY === "1") {
    await page.getByRole("button", { name: "管理监控模块" }).click();
    await page.getByLabel("连接方式").selectOption("proxy");
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await page
      .locator("#test-result")
      .getByText("连接成功，CPU 与内存可读取", { exact: true })
      .waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page
      .locator("#connection-text")
      .getByText("已连接", { exact: true })
      .waitFor({ timeout: 15000 });
    developmentProxy = "passed";
  }
  console.log(
    JSON.stringify(
      { direct: live, developmentProxy, browserErrors: errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
