import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../../", import.meta.url));

// This suite executes the shipped PHP entry point, rather than the Node preview
// implementation. Containers, config and fake credentials are all disposable.
test("PHP/cURL mihomo proxy contract", { timeout: 180000 }, async (t) => {
  const fixtures = realpathSync(
    mkdtempSync(path.join(tmpdir(), "nas-mihomo-php-")),
  );
  // Mount only disposable fixtures and an exact copy of the shipped entry point,
  // avoiding exposure of unrelated workspace files to the test container.
  mkdirSync(path.join(fixtures, "site", "api"), { recursive: true });
  copyFileSync(
    path.join(root, "site", "api", "mihomo.php"),
    path.join(fixtures, "site", "api", "mihomo.php"),
  );
  copyFileSync(
    path.join(root, "tests", "php", "upstream.php"),
    path.join(fixtures, "upstream.php"),
  );
  /** @type {string[]} */
  const containers = [];
  writeFileSync(path.join(fixtures, "mode"), "good");
  writeFileSync(path.join(fixtures, "requests"), "");
  writeFileSync(
    path.join(fixtures, "private.php"),
    `<?php
// Private test-only configuration; environment overrides are verified below.
return ['api_url' => 'http://127.0.0.1:9090/fixture', 'secret' => 'fixture-secret'];
`,
  );

  /** @param {string[]} args */
  function docker(args) {
    return execFileSync("docker", args, {
      encoding: "utf8",
      timeout: 60000,
    }).trim();
  }
  /** @param {string[]} [environment=[]] */
  async function start(environment = []) {
    const name = `nas-mihomo-php-${randomUUID().slice(0, 8)}`;
    containers.push(name);
    docker([
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-p",
      "127.0.0.1::8080",
      "-v",
      `${fixtures}:/fixtures`,
      "-e",
      "MIHOMO_CONFIG=/fixtures/private.php",
      // Local literal addresses must bypass an inherited broken environment proxy.
      "-e",
      "http_proxy=http://127.0.0.1:1",
      "-e",
      "HTTP_PROXY=http://127.0.0.1:1",
      "-e",
      "ALL_PROXY=http://127.0.0.1:1",
      "-e",
      "PHP_CLI_SERVER_WORKERS=4",
      ...environment.flatMap((value) => ["-e", value]),
      "php:8.3-cli",
      "sh",
      "-c",
      // Disable opcode caching only in fixtures so private-config edits take
      // effect immediately, independent of a PHP worker's revalidation timer.
      "php -d opcache.enable=0 -S 127.0.0.1:9090 /fixtures/upstream.php >/tmp/upstream.log 2>&1 & exec php -d opcache.enable=0 -S 0.0.0.0:8080 -t /fixtures/site",
    ]);
    const port = docker(["port", name, "8080/tcp"]).split(":").at(-1);
    const url = `http://127.0.0.1:${port}/api/mihomo.php`;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 405) return url;
      } catch {
        /* The local PHP listener is still starting. */
      }
      await delay(100);
    }
    throw new Error("PHP test listener did not start");
  }
  try {
    const url = await start();
    /** @param {string} mode */
    function setMode(mode) {
      // Update inside the VM to avoid host bind-mount coherence delays between
      // consecutive scenarios on Docker Desktop.
      docker([
        "exec",
        containers[0],
        "php",
        "-r",
        'file_put_contents("/fixtures/mode", $argv[1]);',
        mode,
      ]);
    }
    /** @param {string} mode */
    async function snapshot(mode) {
      setMode(mode);
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json();
    }
    await t.test(
      "filters unknown connection fields, sends Bearer and closes a live memory stream",
      async () => {
        const started = performance.now();
        const result = await snapshot("good");
        assert.ok(
          performance.now() - started < 3000,
          "proxy must not wait for stream EOF or its 7s deadline",
        );
        assert.deepEqual(result.errors, {});
        assert.deepEqual(result.data, {
          connections: {
            count: 1,
            uploadTotal: 1024,
            downloadTotal: 2048,
            truncated: false,
            items: [
              {
                id: "c1",
                upload: 100,
                download: 200,
                start: "",
                rule: "",
                rulePayload: "",
                chains: [],
                network: "tcp",
                type: "",
                sourceIP: "192.0.2.10",
                sourcePort: "",
                destinationIP: "",
                destinationPort: "",
                host: "allowed.example",
                process: "",
                processPath: "",
                inboundName: "",
              },
            ],
          },
          memory: { inuse: 12345 },
          version: { version: "v1.fixture", meta: true },
        });
        assert.ok(result.collectedAt > 0);
        assert.doesNotMatch(
          JSON.stringify(result),
          /private-domain|fixture-secret|discard-me/,
        );
        const requests = readFileSync(path.join(fixtures, "requests"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(requests.length, 3);
        assert.ok(
          requests.every(
            (request) => request.authorization === "Bearer fixture-secret",
          ),
        );
        assert.deepEqual(requests.map((request) => request.path).sort(), [
          "/fixture/connections",
          "/fixture/memory",
          "/fixture/version",
        ]);
      },
    );
    await t.test(
      "browser parameters cannot redirect the configured upstream",
      async () => {
        const response = await fetch(
          `${url}?api_url=http://untrusted.invalid&secret=browser-secret&endpoint=restart`,
        );
        const result = await response.json();
        assert.deepEqual(result.errors, {});
        assert.doesNotMatch(
          readFileSync(path.join(fixtures, "requests"), "utf8"),
          /untrusted|browser-secret|restart/,
        );
      },
    );
    await t.test(
      "rejects control methods before contacting the upstream",
      async () => {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          const response = await fetch(url, { method });
          assert.equal(response.status, 405);
          assert.equal(response.headers.get("allow"), "GET");
        }
      },
    );
    await t.test(
      "handles partial and unauthorized upstreams without leaking responses",
      async () => {
        const partial = await snapshot("partial");
        assert.equal(partial.data.memory.inuse, 12345);
        assert.match(partial.errors.version, /HTTP 404/);
        const denied = await snapshot("unauthorized");
        assert.deepEqual(denied.data, {});
        assert.ok(
          Object.values(denied.errors).every((error) =>
            /认证失败/.test(String(error)),
          ),
        );
      },
    );
    await t.test(
      "preserves empty slices and unknown fields distinctly",
      async () => {
        assert.deepEqual((await snapshot("empty")).data.connections, {
          count: 0,
          uploadTotal: 0,
          downloadTotal: 0,
          items: [],
          truncated: false,
        });
        assert.deepEqual((await snapshot("missing")).data.connections, {
          count: null,
          uploadTotal: null,
          downloadTotal: null,
          items: null,
          truncated: false,
        });
      },
    );
    await t.test(
      "bounds responses and rejects malformed or incomplete streams",
      async () => {
        assert.match(
          (await snapshot("oversized")).errors.connections,
          /大小限制/,
        );
        assert.match((await snapshot("malformed")).errors.memory, /JSON/);
        assert.match(
          (await snapshot("incomplete")).errors.memory,
          /完整内存采样/,
        );
        assert.match((await snapshot("timeout")).errors.memory, /超时/);
      },
    );
    await t.test("does not follow upstream redirects", async () => {
      const result = await snapshot("redirect");
      assert.match(result.errors.connections, /HTTP 302/);
      assert.doesNotMatch(
        readFileSync(path.join(fixtures, "requests"), "utf8"),
        /forbidden/,
      );
    });
    await t.test(
      "bounds detail rows while preserving the complete active count",
      async () => {
        const result = await snapshot("many");
        assert.equal(result.data.connections.count, 601);
        assert.equal(result.data.connections.items.length, 500);
        assert.equal(result.data.connections.truncated, true);
        assert.equal(result.data.connections.items[0].host, "allowed.example");
        assert.doesNotMatch(JSON.stringify(result), /credential|discard-me/);
      },
    );
    await t.test(
      "environment URL and Secret override a private configuration",
      async () => {
        setMode("good");
        docker([
          "exec",
          containers[0],
          "php",
          "-r",
          'file_put_contents("/fixtures/private.php", $argv[1]);',
          "<?php return ['api_url' => 'invalid', 'secret' => 'wrong'];",
        ]);
        const override = await start([
          "MIHOMO_API_URL=http://127.0.0.1:9090/environment",
          "MIHOMO_SECRET=fixture-secret",
        ]);
        const result = await (await fetch(override)).json();
        assert.deepEqual(result.errors, {});
        assert.match(
          readFileSync(path.join(fixtures, "requests"), "utf8"),
          /\/environment\/connections/,
        );
        assert.equal((await fetch(url)).status, 503);
      },
    );
  } finally {
    for (const container of containers) {
      try {
        docker(["rm", "-f", container]);
      } catch {
        /* Already-removed test containers need no cleanup. */
      }
    }
    rmSync(fixtures, { recursive: true, force: true });
  }
});
