import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
test("schema 4 manifest grants no external principal or local capabilities", () => {
  assert.equal(manifest.schema, 4);
  assert.deepEqual(manifest.required_executas, []);
  assert.deepEqual(manifest.optional_executas, []);
  assert.deepEqual(manifest.ui.bundle.external_origins, []);
  assert.equal(manifest.storage, undefined);
  assert.equal(manifest.ui.host_api, undefined);
  assert.equal(manifest.ui.browser_permissions, undefined);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.host_capabilities, undefined);
  assert.equal(manifest.ui.views[0].single_instance, true);
  assert.deepEqual(manifest.ui.form_factors, ["desktop"]);
});
test("static bundle preserves the repository license", async () => {
  assert.equal(
    await readFile(new URL("../bundle/LICENSE.txt", import.meta.url), "utf8"),
    await readFile(new URL("../../../LICENSE", import.meta.url), "utf8"),
  );
});
test("UI uses an external script and text-only rendering for untrusted facts", async () => {
  const html = await readFile(
    new URL("../bundle/index.html", import.meta.url),
    "utf8",
  );
  const js = await readFile(
    new URL("../bundle/app.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(
    js,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
  );
  assert.doesNotMatch(js, /window\.(confirm|alert|prompt)\(/);
  assert.match(html, /id="clear-confirmation"/);
  assert.match(js, /noopener noreferrer/);
  assert.match(js, /onThemeChange/);
  assert.match(js, /onLocaleChange/);
  assert.match(js, /entry_payload/);
});
