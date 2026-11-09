import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mountBundle } from "@anna-ai/cli/test";
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("official offline harness permits own app storage without a capability grant", async () => {
  const h = await mountBundle({ manifest });
  await h.runtime.call("storage", "set", { key: "contract-test", value: { version: 1 }, scope: "app" });
  const value = await h.runtime.call("storage", "get", { key: "contract-test", scope: "app" });
  assert.ok(value);
  assert.equal(h.calls.last().outcome, "ok");
});
test("official offline harness denies undeclared cross-app and local boundaries", async () => {
  const h = await mountBundle({ manifest });
  await assert.rejects(h.runtime.call("storage", "get", { key: "contract-test", scope: "user" }));
  await assert.rejects(h.runtime.call("credentials", "list_accounts", { provider: "google" }));
  await assert.rejects(h.runtime.call("tools", "invoke", { tool_id: "not-declared", method: "run", args: {} }));
});
test("web and llm mocks are explicit contract probes, not live validation", async () => {
  const h = await mountBundle({ manifest, mocks: {
    "web.search": () => ({ results: [], provider_tier: "basic", quota_consumed: 0 }),
    "llm.complete": () => ({ role: "assistant", content: { type: "text", text: "{}" }, stopReason: "endTurn" }),
  } });
  assert.deepEqual((await h.runtime.call("web", "search", { query: "synthetic fixture", search_depth: "basic" })).results, []);
  assert.equal((await h.runtime.call("llm", "complete", { messages: [{ role: "user", content: "synthetic fixture" }], maxTokens: 16 })).content.text, "{}");
});
