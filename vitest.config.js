import { defineConfig } from "vitest/config";

// Browser workflows run separately; unit tests never require a reachable NAS.
export default defineConfig({
  test: { include: ["tests/*.test.js"], environment: "node" },
});
