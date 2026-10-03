import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  lstatSync,
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

// Build and exercise the shipped image, including publication to a normal directory.
test(
  "image publishes an ordinary site and preserves private files on updates and failures",
  { timeout: 180000 },
  () => {
    const root = mkdtempSync(join(tmpdir(), "nas-gitsync-test-"));
    const data = join(root, "data");
    const remote = join(root, "remote.git");
    const container = `nas-gitsync-test-${randomUUID().slice(0, 8)}`;
    const localImage = `${container}:test`;
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Sync Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Sync Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    };
    /** @param {string[]} args @param {string} [input] */
    function git(args, input) {
      return execFileSync("git", ["-C", remote, ...args], {
        env,
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    }
    /** @param {string | null} content @param {string} [parent] @param {string} [branch] */
    function publish(content, parent, branch = "main") {
      const blob = git(
        ["hash-object", "-w", "--stdin"],
        content ?? "invalid site",
      );
      const files =
        `100644 blob ${blob}\t${content === null ? "other.txt" : "index.html"}\n` +
        (content === "first" ? `100644 blob ${blob}\tobsolete.css\n` : "");
      const site = git(["mktree"], files);
      const tree = git(["mktree"], `040000 tree ${site}\tsite\n`);
      const commit = git(
        ["commit-tree", tree, ...(parent ? ["-p", parent] : [])],
        "test: sync fixture\n\nVerify image environment configuration.\n",
      );
      git(["update-ref", `refs/heads/${branch}`, commit]);
      return commit;
    }
    try {
      execFileSync("docker", ["build", "-t", localImage, "docker"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      });
      /** @type {{services: Record<string, {image: string, user: string, environment: Record<string, string>, command?: unknown, entrypoint?: unknown}>}} */
      const config = JSON.parse(
        execFileSync("docker", ["compose", "config", "--format", "json"], {
          encoding: "utf8",
        }),
      );
      const service = config.services["nas-dashboard-sync"];
      // Compose versions serialize an omitted override as either null or absent.
      assert.equal(service.command ?? null, null);
      assert.equal(service.entrypoint ?? null, null);
      mkdirSync(remote);
      mkdirSync(data);
      mkdirSync(join(data, ".git"));
      writeFileSync(join(data, ".git", "existing"), "old checkout metadata");
      mkdirSync(join(data, "config"));
      writeFileSync(
        join(data, "config", "glances.php"),
        "private configuration",
      );
      git(["init", "--bare", "--initial-branch=main"]);
      /** @param {string} [ref] */
      function sync(ref = "main") {
        const vars = {
          ...service.environment,
          GITSYNC_REPO: "file:///fixture",
          GITSYNC_REF: ref,
          GITSYNC_SYNC_TIMEOUT: "10s",
        };
        return spawnSync(
          "docker",
          [
            "run",
            "--rm",
            "--name",
            container,
            "-v",
            `${data}:/data`,
            "-v",
            `${remote}:/fixture:ro`,
            ...Object.entries(vars).flatMap(([key, value]) => [
              "-e",
              `${key}=${value}`,
            ]),
            localImage,
          ],
          { encoding: "utf8", timeout: 90000 },
        );
      }
      /** @param {string} content @param {string} hash */
      function verify(content, hash) {
        assert.equal(
          readFileSync(join(data, "site/index.html"), "utf8"),
          content,
        );
        // The publisher stamps the site with the synced commit for the badge.
        assert.equal(
          readFileSync(join(data, "site/build.json"), "utf8"),
          `{"commit":"${hash}"}\n`,
        );
        const published = lstatSync(join(data, "site"));
        assert.ok(published.isDirectory());
        assert.equal(published.isSymbolicLink(), false);
        assert.equal(
          published.mode & 0o777,
          0o755,
          "HTTP must traverse the staged directory",
        );
        const target = readlinkSync(join(data, "current"));
        assert.equal(
          isAbsolute(target),
          false,
          "link must also work on the NAS host",
        );
        assert.equal(target.split("/").at(-1), hash);
        assert.equal(
          readFileSync(join(data, "config/glances.php"), "utf8"),
          "private configuration",
        );
        assert.equal(
          readFileSync(join(data, ".git/existing"), "utf8"),
          "old checkout metadata",
        );
      }
      const first = publish("first");
      let result = sync();
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      verify("first", first);
      const next = publish("updated", first);
      result = sync();
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      verify("updated", next);
      assert.equal(
        existsSync(join(data, "site/obsolete.css")),
        false,
        "deleted upstream files must disappear",
      );
      result = sync();
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      verify("updated", next);
      const release = publish("release", next, "release");
      result = sync("release");
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      verify("release", release);
      result = sync("missing");
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      verify("release", release);
      publish(null, release, "invalid-site");
      result = sync("invalid-site");
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /no site\/index.html/);
      assert.equal(
        readFileSync(join(data, "site/index.html"), "utf8"),
        "release",
      );
      assert.equal(
        readFileSync(join(data, "config/glances.php"), "utf8"),
        "private configuration",
      );
    } finally {
      // The name is unique to this disposable test; no deployed container is touched.
      spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      spawnSync("docker", ["image", "rm", localImage], { stdio: "ignore" });
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("README includes the current environment-only Compose", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  assert.ok(
    readFileSync("README.md", "utf8").includes("```yaml\n" + compose + "```"),
  );
});
