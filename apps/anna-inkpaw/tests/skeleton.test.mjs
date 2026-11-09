import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { implementationStatus } from "../bundle/app.js";
import { createApp } from "../src/skeleton.ts";
import { acceptanceCases } from "../src/acceptance.ts";
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("architecture entry is explicitly nonfunctional", () => {
  assert.equal(implementationStatus, "skeleton");
  assert.throws(() => createApp({}), /not available/);
});
test("manifest has no second-principal capabilities or external origins", () => {
  assert.equal(manifest.schema, 4);
  assert.deepEqual(manifest.required_executas, []);
  assert.deepEqual(manifest.optional_executas, []);
  assert.deepEqual(manifest.ui.bundle.external_origins, []);
  assert.equal(manifest.storage, undefined);
  assert.equal(manifest.ui.host_api, undefined);
  assert.equal(manifest.ui.browser_permissions, undefined);
  assert.equal(manifest.ui.views[0].single_instance, true);
  assert.deepEqual(manifest.ui.form_factors, ["desktop"]);
});
test("license is retained in the static bundle", async () => {
  const bundled = await readFile(new URL("../bundle/LICENSE.txt", import.meta.url), "utf8");
  const original = await readFile(new URL("../../../LICENSE", import.meta.url), "utf8");
  assert.equal(bundled, original);
});
for (const title of acceptanceCases) test.todo(title);
