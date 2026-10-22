import { defineConfig, devices } from "@playwright/test";

// Isolated, headless WebKit only: never launch Chrome or a personal profile.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "webkit",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 1100 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
      },
    },
  ],
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
