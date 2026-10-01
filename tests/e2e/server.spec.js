import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

// Each test owns its temporary sibling; private user configuration is never read.
test("static server rejects encoded traversal to a sibling with the site prefix", async ({
  request,
}) => {
  const directory = await mkdtemp(path.join(projectRoot, "site-backup-"));
  try {
    await writeFile(
      path.join(directory, "fixture.txt"),
      "outside-site fixture",
    );
    const response = await request.get(
      `/..%2F${path.basename(directory)}%2Ffixture.txt`,
    );
    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("outside-site fixture");
    const asset = await request.get("/js/core/config.js");
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).toContain("javascript");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("static server rejects a symlink whose physical target is outside site", async ({
  request,
}) => {
  const directory = await mkdtemp(path.join(projectRoot, "site-backup-"));
  const link = path.join(
    projectRoot,
    "site",
    `${path.basename(directory)}.txt`,
  );
  let linked = false;
  try {
    const target = path.join(directory, "fixture.txt");
    await writeFile(target, "outside-site fixture");
    await symlink(target, link);
    linked = true;
    const response = await request.get(`/${path.basename(link)}`);
    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("outside-site fixture");
  } finally {
    if (linked) await unlink(link);
    await rm(directory, { recursive: true, force: true });
  }
});
