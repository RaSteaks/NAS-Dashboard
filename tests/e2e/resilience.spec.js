import { test, expect } from "@playwright/test";

test("icon hydration preserves SVG nodes and deduplicates placeholder classes", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  const result = await page.evaluate(async () => {
    const moduleURL = new URL("/js/ui/dom.js", location.href);
    const { icons, icon } =
      /** @type {typeof import("../../site/js/ui/dom.js")} */ (
        await import(moduleURL.href)
      );
    const original = document.querySelector("svg[data-lucide]");
    if (!original) throw new Error("Missing initial icon");
    const originalClasses = original.getAttribute("class");
    const fixture = document.createElement("div");
    const placeholder = icon("server");
    placeholder.className = "lucide lucide-server custom-icon";
    placeholder.setAttribute("title", "Custom icon");
    fixture.append(placeholder);
    document.body.append(fixture);
    icons();
    const custom = fixture.querySelector("svg");
    if (!custom) throw new Error("Missing hydrated placeholder");
    for (let index = 0; index < 5; index++) icons();
    const latePlaceholder = icon("cpu");
    fixture.append(latePlaceholder);
    icons();
    const outcome = {
      originalPreserved:
        original === document.querySelector("svg[data-lucide]"),
      originalClassesPreserved:
        originalClasses === original.getAttribute("class"),
      customPreserved: custom === fixture.querySelector("svg.custom-icon"),
      customClasses: [...custom.classList],
      customTitle: custom.getAttribute("title"),
      latePlaceholderHydrated: Boolean(
        fixture.querySelector('svg[data-lucide="cpu"]'),
      ),
    };
    fixture.remove();
    return outcome;
  });
  expect(result).toEqual({
    originalPreserved: true,
    originalClassesPreserved: true,
    customPreserved: true,
    customClasses: ["lucide", "lucide-server", "custom-icon"],
    customTitle: "Custom icon",
    latePlaceholderHydrated: true,
  });
});

// Long source labels and small viewports must not resize the page shell.
test("long labels fit and native filters preserve focus and selection", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await expect(page.locator("#cpu-value")).not.toHaveText("--");
  const filter = page.getByLabel("筛选容器状态");
  await filter.focus();
  await expect(filter).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("region", { name: "容器数据表格" }),
  ).toBeFocused();
  // Native macOS menu input is outside CDP; Playwright's selectOption owns this step.
  await filter.selectOption("running");
  await expect(filter).toHaveValue("running");
  await expect(page.locator("#widget-containers")).not.toContainText(
    "backup-worker",
  );
  // The shared navigation entry remains reachable before testing compact layouts.
  await page.getByRole("button", { name: "监控设置", exact: true }).click();
  await page
    .getByLabel("设备名称", { exact: true })
    .fill("我的家庭存储服务器-NAS-with-a-long-device-name");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    const settings = page.getByRole("button", {
      name: "监控设置",
      exact: true,
    });
    await expect(settings).toHaveCount(1);
    await settings.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
  }
});

test("invalid schemes and URL credentials stay in the form", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("Glances API 地址", { exact: true });
  await input.fill("https://user:secret@nas.test/api/4");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#api-error")).toHaveText(/密码/);
  await expect(input).toBeFocused();
  await input.fill("file:///etc/passwd");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator("#api-error")).toHaveText(/HTTP/);
  await expect(page.getByRole("dialog")).toBeVisible();
});
