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
// Run the actual inline command using the same errexit option as the container.
const command = compose.split("    command:\n      - |\n")[1];
if (!command) throw new Error("Missing Compose sync command");
const script = command.replace(/^ {8}/gm, "");
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

/** Build real fixture commits without hooks or a developer identity.
 * @param {string} content @param {string} [parent]
 */
function publish(content, parent) {
  const blob = git(remote, ["hash-object", "-w", "--stdin"], content);
  const site = git(remote, ["mktree"], `100644 blob ${blob}\tindex.html\n`);
  const tree = git(remote, ["mktree"], `040000 tree ${site}\tsite\n`);
  const commit = git(
    remote,
    ["commit-tree", tree, ...(parent ? ["-p", parent] : [])],
    "test: publish main\n\nCreate a local deployment fixture.\n",
  );
  git(remote, ["update-ref", "refs/heads/main", commit]);
  return commit;
}

function start() {
  return spawnSync("sh", ["-ec", script], {
    cwd: checkout,
    env,
    encoding: "utf8",
    timeout: 10000,
  });
}

/** @param {string} content @param {string} commit */
function expectCheckout(content, commit) {
  expect(readFileSync(join(checkout, "site/index.html"), "utf8")).toBe(content);
  expect(git(checkout, ["rev-parse", "HEAD"])).toBe(commit);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nas-docker-test-"));
  checkout = join(root, "checkout");
  remote = join(root, "remote.git");
  mkdirSync(checkout);
  mkdirSync(remote);
  env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Deployment Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Deployment Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  git(remote, ["init", "--bare", "--initial-branch=main"]);
  // Redirect only the fixed public URL to a local fixture; shell logic stays intact.
  git(remote, [
    "config",
    "--global",
    `url.${pathToFileURL(remote).href}.insteadOf`,
    "https://github.com/RaSteaks/NAS-Dashboard.git",
  ]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Compose Git sync", () => {
  it("clones once and deploys a newer main commit on the next start", () => {
    const first = publish("first");
    expect(start().status).toBe(0);
    expectCheckout("first", first);
    const next = publish("next", first);
    const result = start();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("sync: complete");
    expectCheckout("next", next);
  });

  it("succeeds when started again with no new commit", () => {
    const commit = publish("unchanged");
    expect(start().status).toBe(0);
    expect(start().status).toBe(0);
    expectCheckout("unchanged", commit);
  });

  it("stops after a failed fetch without resetting the existing website", () => {
    const commit = publish("previous");
    expect(start().status).toBe(0);
    // A stale FETCH_HEAD exists; a failed fetch must not run reset against it.
    expect(start().status).toBe(0);
    writeFileSync(join(checkout, "site/index.html"), "local content");
    renameSync(remote, join(root, "offline.git"));
    const result = start();
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("sync: complete");
    expectCheckout("local content", commit);
  });

  it("reports initial clone failure without publishing a site", () => {
    renameSync(remote, join(root, "offline.git"));
    const result = start();
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("sync: complete");
    expect(existsSync(join(checkout, "site/index.html"))).toBe(false);
  });

  it("preserves private untracked PHP configuration across updates", () => {
    const first = publish("first");
    expect(start().status).toBe(0);
    mkdirSync(join(checkout, "config"));
    const config = join(checkout, "config/glances.php");
    writeFileSync(config, "private fixture configuration");
    const next = publish("next", first);
    expect(start().status).toBe(0);
    expectCheckout("next", next);
    expect(readFileSync(config, "utf8")).toBe("private fixture configuration");
  });

  it("does not delete existing files from a nonempty initial bind mount", () => {
    publish("first");
    const existing = join(checkout, "compose.yaml");
    writeFileSync(existing, "existing project file");
    const result = start();
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(readFileSync(existing, "utf8")).toBe("existing project file");
    expect(existsSync(join(checkout, "site/index.html"))).toBe(false);
  });

  it("keeps the README deployment YAML current", () => {
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    expect(readme).toContain("```yaml\n" + compose + "```");
  });
});
