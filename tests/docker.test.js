import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const compose = readFileSync(
  new URL("../docker-compose.yml", import.meta.url),
  "utf8",
);
// The standalone Compose file owns the script. Remove its block indentation and
// Compose's dollar escaping to run that exact shell logic against local fixtures.
const command = compose.split("    command:\n      - |\n")[1];
if (!command) throw new Error("Missing Compose sync command");
const entrypoint = command.replace(/^ {8}/gm, "").replaceAll("$$", "$");
let root = "";
let checkout = "";
let remote = "";
/** @type {NodeJS.ProcessEnv} */
let env;

/** @param {string} repo @param {string[]} args @param {string} [input] */
function git(repo, args, input) {
  return execFileSync("git", ["-C", repo, ...args], {
    env,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/** @param {string} name */
function repository(name) {
  const repo = join(root, name);
  mkdirSync(repo);
  git(repo, ["init", "--bare", "--initial-branch=main"]);
  return repo;
}

/**
 * Git plumbing builds real fixture commits without hooks or a user identity.
 * @param {string} repo
 * @param {string} branch
 * @param {string} content
 * @param {string} [parent]
 */
function publish(repo, branch, content, parent) {
  const blob = git(repo, ["hash-object", "-w", "--stdin"], content);
  const site = git(repo, ["mktree"], `100644 blob ${blob}\tindex.html\n`);
  const tree = git(repo, ["mktree"], `040000 tree ${site}\tsite\n`);
  const commit = git(
    repo,
    ["commit-tree", tree, ...(parent ? ["-p", parent] : [])],
    `test: publish ${branch}\n\nCreate a local deployment fixture.\n`,
  );
  git(repo, ["update-ref", `refs/heads/${branch}`, commit]);
  return commit;
}

/** @param {NodeJS.ProcessEnv} overrides */
function start(overrides = {}) {
  return spawnSync("sh", [join(root, "entrypoint.sh")], {
    env: { ...env, ...overrides },
    encoding: "utf8",
    timeout: 10000,
  });
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 * @param {string} content
 * @param {string} commit
 * @param {number} [exitCode]
 */
function expectDeployment(result, content, commit, exitCode = 0) {
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(exitCode);
  expect(readFileSync(join(checkout, "site/index.html"), "utf8")).toBe(content);
  expect(readFileSync(join(checkout, "site/VERSION"), "utf8").trim()).toBe(
    git(checkout, ["rev-parse", "--short", commit]),
  );
  expect(git(checkout, ["rev-parse", "HEAD"])).toBe(commit);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nas-docker-test-"));
  checkout = join(root, "checkout");
  const bin = join(root, "bin");
  mkdirSync(bin);
  env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Deployment Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Deployment Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
    REPO_DIR: checkout,
    TEST_ROOT: root,
    PULL_RETRIES: "3",
    BRANCH: "main",
  };
  remote = repository("remote.git");
  env.REPO_URL = pathToFileURL(remote).href;
  // Only the retry delay is mocked; Git reads/writes actual isolated repositories.
  writeFileSync(join(root, "entrypoint.sh"), entrypoint);
  const shims = {
    sleep: `echo retry >> "$TEST_ROOT/retries"
if [ -n "\${TEST_RESTORE_FROM:-}" ]; then
  mv "$TEST_RESTORE_FROM" "$TEST_RESTORE_TO"
fi`,
  };
  for (const [name, body] of Object.entries(shims)) {
    writeFileSync(join(bin, name), `#!/bin/sh\nset -eu\n${body}\n`, {
      mode: 0o755,
    });
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Compose Git sync", () => {
  it("clones once and deploys a newer commit on restart", () => {
    const first = publish(remote, "main", "first");
    expectDeployment(start(), "first", first);
    const next = publish(remote, "main", "next", first);
    expectDeployment(start(), "next", next);
  });

  it("switches branches in an existing shallow checkout", () => {
    publish(remote, "main", "main");
    const release = publish(remote, "release", "release");
    expect(start().status).toBe(0);
    expectDeployment(start({ BRANCH: "release" }), "release", release);
  });

  it("switches repository URLs while keeping the checkout", () => {
    publish(remote, "main", "original");
    expect(start().status).toBe(0);
    const replacement = repository("replacement.git");
    const commit = publish(replacement, "main", "replacement");
    const url = pathToFileURL(replacement).href;
    expectDeployment(start({ REPO_URL: url }), "replacement", commit);
    expect(git(checkout, ["remote", "get-url", "origin"])).toBe(url);
  });

  it("retries a failed fetch and deploys when the remote recovers", () => {
    const first = publish(remote, "main", "first");
    expect(start().status).toBe(0);
    const next = publish(remote, "main", "recovered", first);
    const unavailable = join(root, "temporarily-unavailable.git");
    renameSync(remote, unavailable);
    expectDeployment(
      start({
        TEST_RESTORE_FROM: unavailable,
        TEST_RESTORE_TO: remote,
      }),
      "recovered",
      next,
    );
    expect(readFileSync(join(root, "retries"), "utf8")).toBe("retry\n");
  });

  it.each(["unavailable repository", "missing branch"])(
    "keeps the previous deployment after exhausting retries for %s",
    (failure) => {
      const first = publish(remote, "main", "previous");
      expect(start().status).toBe(0);
      if (failure === "unavailable repository") {
        renameSync(remote, join(root, "offline.git"));
      }
      const result = start(
        failure === "missing branch" ? { BRANCH: "missing" } : {},
      );
      expectDeployment(result, "previous", first, 1);
      expect(result.stderr).toContain("failed after 3 attempts");
      expect(readFileSync(join(root, "retries"), "utf8")).toBe(
        "retry\nretry\n",
      );
    },
  );

  it("exits with failure and no VERSION when the initial clone cannot succeed", () => {
    const result = start({
      REPO_URL: pathToFileURL(join(root, "missing.git")).href,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("failed after 3 attempts");
    expect(existsSync(join(checkout, "site/VERSION"))).toBe(false);
  });

  it("preserves private untracked PHP configuration across updates", () => {
    const first = publish(remote, "main", "first");
    expectDeployment(start(), "first", first);
    mkdirSync(join(checkout, "config"));
    const config = join(checkout, "config/glances.php");
    writeFileSync(config, "private fixture configuration");
    const next = publish(remote, "main", "next", first);
    expectDeployment(start(), "next", next);
    expect(readFileSync(config, "utf8")).toBe("private fixture configuration");
  });

  it("rejects an incoming branch without a site before replacing the deployed files", () => {
    const first = publish(remote, "main", "previous");
    expectDeployment(start(), "previous", first);
    const emptyTree = git(remote, ["mktree"], "");
    const invalid = git(
      remote,
      ["commit-tree", emptyTree],
      "test: empty site\n\nInvalid deployment fixture.\n",
    );
    git(remote, ["update-ref", "refs/heads/invalid", invalid]);
    expectDeployment(start({ BRANCH: "invalid" }), "previous", first, 1);
  });

  it("does not delete existing files from a nonempty initial bind mount", () => {
    publish(remote, "main", "first");
    mkdirSync(checkout);
    const existing = join(checkout, "compose.yaml");
    writeFileSync(existing, "existing project file");
    expect(start().status).toBe(1);
    expect(readFileSync(existing, "utf8")).toBe("existing project file");
    expect(existsSync(join(checkout, "site/VERSION"))).toBe(false);
  });

  it.each(["0", "invalid", "-1"])(
    "rejects invalid retry count %s before cloning",
    (retries) => {
      publish(remote, "main", "first");
      const result = start({ PULL_RETRIES: retries });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("positive integer");
      expect(existsSync(checkout)).toBe(false);
    },
  );

  it("keeps the README copy of the standalone deployment YAML current", () => {
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    expect(readme).toContain("```yaml\n" + compose + "```");
  });
});
