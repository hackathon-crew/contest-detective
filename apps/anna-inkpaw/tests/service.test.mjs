import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "../src/service.ts";
import { TRUSTED_SOURCES } from "../src/sources.ts";
import {
  candidate,
  codedError,
  completion,
  confirmed,
  deferred,
  fakeRuntime,
  fetchedPage,
  instant,
  profile,
  saved,
} from "./fixtures/service.mjs";

function setup(options) {
  const host = fakeRuntime(options);
  const updates = [];
  const controller = createController(
    host.runtime,
    (state) => updates.push(state),
    { now: () => new Date(instant) },
  );
  return { ...host, controller, updates };
}
async function prepared(options) {
  const context = setup(options);
  await context.controller.initialize();
  context.controller.edit(profile);
  await context.controller.confirm();
  return context;
}
const callsOf = (host, name) => host.calls.filter((call) => call.name === name);

test("initialize and entry restore no paid calls, never replace existing confirmed work", async () => {
  const host = setup({ value: saved() });
  await host.controller.initialize();
  assert.deepEqual(host.controller.state.confirmed, confirmed);
  host.controller.receiveEntry({ query: "first entry" });
  assert.equal(host.controller.state.query, "");
  assert.equal(host.controller.state.pendingEntry, "first entry");
  assert.deepEqual(host.controller.state.confirmed, confirmed);
  host.controller.receiveEntry({ query: "second entry" });
  assert.equal(host.controller.state.pendingEntry, "second entry");
  assert.deepEqual(host.controller.state.confirmed, confirmed);
  host.controller.applyPendingEntry();
  assert.equal(host.controller.state.query, "second entry");
  assert.equal(host.controller.state.confirmed, null);
  assert.equal(host.controller.state.result, null);
  assert.equal(host.paidCalls().length, 0);
  assert.deepEqual(host.calls[0].args, {
    key: "inkpaw/personal-v1",
    scope: "app",
  });
});

test("typing updates query without payment and invalidates only when text changes", async () => {
  const host = await prepared();
  host.controller.setQuery("new paragraph");
  assert.equal(host.controller.state.confirmed, null);
  assert.deepEqual(host.controller.state.draft.topics, []);
  host.controller.edit(profile);
  await host.controller.confirm();
  const prior = host.controller.state.confirmed;
  host.controller.setQuery("new paragraph");
  assert.deepEqual(host.controller.state.confirmed, prior);
  host.controller.receiveEntry({ query: "do not overwrite typed paragraph" });
  assert.equal(host.controller.state.query, "new paragraph");
  assert.equal(
    host.controller.state.pendingEntry,
    "do not overwrite typed paragraph",
  );
  host.controller.setQuery("q".repeat(5000));
  assert.equal(host.controller.state.query.length, 4000);
  assert.equal(host.paidCalls().length, 0);
});

test("both paid workflows need affirmative consent and search needs a confirmed profile", async () => {
  const host = setup();
  await host.controller.initialize();
  await host.controller.draftFromText("AI", false);
  await host.controller.search(true);
  host.controller.edit(profile);
  await host.controller.search(true);
  await host.controller.confirm();
  await host.controller.search(false);
  assert.equal(host.paidCalls().length, 0);
  assert.match(host.controller.state.error, /allowance/);
});

test("draft uses one bounded completion and never persists unconfirmed text or profile", async () => {
  const host = setup();
  await host.controller.initialize();
  await host.controller.draftFromText("Private raw paragraph", true);
  assert.deepEqual(host.controller.state.draft, profile);
  assert.equal(host.controller.state.confirmed, null);
  assert.equal(host.controller.state.phase, "reviewing");
  assert.equal(host.paidCalls().length, 1);
  const request = host.paidCalls()[0];
  assert.equal(request.args.maxTokens, 1200);
  assert.equal(request.args.thinking, false);
  assert.equal(request.args.messages[0].content.type, "text");
  assert.equal(host.controller.state.observedCu, 0.7);
  assert.equal(callsOf(host, "storage.set").length, 0);
});

for (const stopReason of ["maxTokens", "contentFilter", "toolUse"]) {
  test(`incomplete ${stopReason} draft is rejected without automatic retry`, async () => {
    const host = setup({
      handlers: { "llm.complete": () => completion(profile, { stopReason }) },
    });
    await host.controller.draftFromText("Synthetic text", true);
    assert.equal(host.controller.state.phase, "failed");
    assert.equal(host.controller.state.confirmed, null);
    assert.equal(host.controller.state.draft.topics.length, 0);
    assert.equal(host.paidCalls().length, 1);
  });
}

test("malformed JSON draft is rejected without treating it as profile fields", async () => {
  const host = setup({
    handlers: {
      "llm.complete": () => ({
        content: { type: "text", text: '{"topics":' },
        stopReason: "endTurn",
      }),
    },
  });
  await host.controller.draftFromText("Synthetic", true);
  assert.equal(host.controller.state.phase, "failed");
  assert.equal(host.controller.state.observedCu, null);
  assert.equal(host.paidCalls().length, 1);
});

test("search is bounded, consent-based and never leaks raw text or hard constraints into queries", async () => {
  const host = await prepared({
    handlers: {
      "web.search": () => ({
        results: [
          { url: TRUSTED_SOURCES[0].entryUrl },
          ...Array.from({ length: 12 }, (_, i) => ({
            url: `https://discovery.vendor.dev/call-${i}`,
          })),
        ],
        quota_consumed: 0.2,
      }),
    },
  });
  host.controller.setQuery("private paragraph NEVER_SEND_RAW");
  host.controller.edit({
    ...profile,
    availability: "PRIVATE_AVAILABILITY",
    constraints: ["PRIVATE_CONSTRAINT"],
  });
  await host.controller.confirm();
  const storageBefore = callsOf(host, "storage.set").length;
  const result = await host.controller.search(true);
  const searches = callsOf(host, "web.search");
  assert.equal(searches.length, 2);
  assert.ok(searches.every((call) => call.args.search_depth === "basic"));
  assert.ok(
    searches.every((call) => !/PRIVATE_|NEVER_SEND_RAW/.test(call.args.query)),
  );
  assert.ok(searches.every((call) => /AI/.test(call.args.query)));
  assert.equal(callsOf(host, "web.fetch").length, 1);
  const fetch = callsOf(host, "web.fetch")[0];
  assert.equal(fetch.args.urls.length, 8);
  assert.ok(fetch.args.urls.includes(TRUSTED_SOURCES[0].entryUrl));
  assert.ok(
    fetch.args.urls.some((url) => url.includes("discovery.vendor.dev")),
  );
  assert.equal(fetch.args.format, "text");
  assert.equal(callsOf(host, "llm.complete").length, 1);
  assert.equal(callsOf(host, "llm.complete")[0].args.maxTokens, 6000);
  assert.equal(result.matches.length, 0);
  assert.ok(
    result.excluded.some((item) =>
      /availability|constraint/i.test(item.reason),
    ),
  );
  assert.equal(callsOf(host, "storage.set").length, storageBefore);
  assert.ok(Math.abs(result.observedCu - 1.2) < 1e-9);
});

test("a current search produces source-backed matches without saving result pages", async () => {
  const host = await prepared();
  const storageBefore = callsOf(host, "storage.set").length;
  const result = await host.controller.search(true);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].opportunity.provenance, "live");
  assert.equal(result.matches[0].opportunity.checkedAt, instant);
  assert.equal(
    result.matches[0].opportunity.name.evidence[0].fetchedAt,
    instant,
  );
  assert.equal(result.matches[0].opportunity.name.level, "official");
  assert.equal(callsOf(host, "storage.set").length, storageBefore);
  assert.deepEqual(Object.keys(host.stored().value).sort(), [
    "bookmarks",
    "confirmedProfile",
    "version",
  ]);
  assert.ok(
    !JSON.stringify(host.stored()).includes("Synthetic fixture AI opportunity"),
  );
  host.controller.edit({ ...profile, topics: ["design"] });
  assert.equal(host.controller.state.confirmed, null);
  assert.equal(host.controller.state.result, null);
});

test("unknown public origins remain visible only as unverified discovery leads", async () => {
  const host = await prepared({
    handlers: {
      "llm.complete": (args) => {
        const pages = JSON.parse(args.messages[1].content.text).pages;
        return completion({
          opportunities: pages.map((page, index) => candidate(page.url, index)),
        });
      },
    },
  });
  const result = await host.controller.search(true);
  assert.ok(result.matches.length > 0);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].name.level, "unverified");
  assert.equal(result.leads[0].name.evidence[0].officialBasis, null);
  assert.ok(
    result.notices.some((notice) => /unverified organizer/.test(notice)),
  );
});

test("partial fetch, unsafe redirects and truncation never become full evidence", async () => {
  const host = await prepared({
    handlers: {
      "web.search": () => ({
        results: [
          { url: TRUSTED_SOURCES[0].entryUrl },
          { url: "https://discovery.vendor.dev/unsafe-redirect" },
          { url: "https://discovery.vendor.dev/truncated" },
          { url: "http://127.0.0.1/private" },
        ],
        quota_consumed: 0.2,
      }),
      "web.fetch": (args) => ({
        pages: args.urls.map((url, index) =>
          index === 0
            ? fetchedPage(url)
            : index === 1
              ? fetchedPage(url, { final_url: "https://127.0.0.1/private" })
              : fetchedPage(url, { truncated: true }),
        ),
        quota_consumed: 0.1,
      }),
    },
  });
  const result = await host.controller.search(true);
  assert.equal(result.matches.length, 1);
  assert.equal(result.incomplete, true);
  assert.ok(result.notices.some((notice) => /truncated/.test(notice)));
  const pages = JSON.parse(
    callsOf(host, "llm.complete")[0].args.messages[1].content.text,
  ).pages;
  assert.equal(
    pages.length,
    callsOf(host, "web.fetch")[0].args.urls.length - 1,
  );
  assert.ok(pages.every((page) => !page.finalUrl.includes("127.0.0.1")));
  assert.ok(
    pages.every(
      (page) => page.provenance === "live" && page.fetchedAt === instant,
    ),
  );
});

test("failed pages and search snippets never substitute for evidence or trigger extraction", async () => {
  const host = await prepared({
    handlers: {
      "web.fetch": (args) => ({
        pages: args.urls.map((url) => ({
          url,
          ok: false,
          error: "Synthetic failure",
        })),
        quota_consumed: 0.1,
      }),
    },
  });
  const result = await host.controller.search(true);
  assert.deepEqual(result.matches, []);
  assert.equal(result.incomplete, true);
  assert.equal(callsOf(host, "llm.complete").length, 0);
  assert.ok(result.notices.some((notice) => /No usable/.test(notice)));
});

test("repeated clicks and cancel retain lock while a charged request remains unresolved", async () => {
  const pending = deferred();
  const host = await prepared({
    handlers: { "web.search": () => pending.promise },
  });
  const running = host.controller.search(true);
  await host.controller.search(true);
  assert.equal(callsOf(host, "web.search").length, 1);
  host.controller.cancel();
  assert.equal(host.controller.state.busy, true);
  assert.equal(host.controller.state.phase, "cancelled");
  await host.controller.draftFromText("New paid operation", true);
  assert.equal(host.paidCalls().length, 1);
  pending.resolve({ results: [], quota_consumed: 0.2 });
  assert.equal(await running, null);
  assert.equal(host.controller.state.busy, false);
  assert.equal(callsOf(host, "web.fetch").length, 0);
  assert.equal(host.controller.state.result, null);
});

test("editing during a pending draft cancels stale writes but not the outstanding-charge lock", async () => {
  const pending = deferred();
  const host = setup({ handlers: { "llm.complete": () => pending.promise } });
  const running = host.controller.draftFromText("Text", true);
  const edited = { ...profile, topics: ["manual choice"] };
  host.controller.edit(edited);
  assert.equal(host.controller.state.busy, true);
  await host.controller.draftFromText("Second request", true);
  assert.equal(host.paidCalls().length, 1);
  pending.resolve(completion(profile));
  await running;
  assert.deepEqual(host.controller.state.draft, edited);
  assert.equal(host.controller.state.busy, false);
});

test("cancel during fetch prevents the extraction charge", async () => {
  const pending = deferred();
  const host = await prepared({
    handlers: { "web.fetch": () => pending.promise },
  });
  const running = host.controller.search(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callsOf(host, "web.fetch").length, 1);
  host.controller.cancel();
  pending.resolve({
    pages: [fetchedPage(TRUSTED_SOURCES[0].entryUrl)],
    quota_consumed: 0.1,
  });
  await running;
  assert.equal(callsOf(host, "llm.complete").length, 0);
  assert.equal(host.controller.state.result, null);
});

test("cancel during extraction discards the late result", async () => {
  const pending = deferred();
  const host = await prepared({
    handlers: { "llm.complete": () => pending.promise },
  });
  const running = host.controller.search(true);
  await new Promise((resolve) => setImmediate(resolve));
  host.controller.cancel();
  pending.resolve(
    completion({ opportunities: [candidate(TRUSTED_SOURCES[0].entryUrl)] }),
  );
  await running;
  assert.equal(host.controller.state.result, null);
  assert.equal(host.controller.state.phase, "cancelled");
});

test("uncertain timeout never retries and blocks all new paid work for this session", async () => {
  const host = await prepared({
    handlers: {
      "web.search": () => {
        throw codedError("TIMEOUT");
      },
    },
  });
  await host.controller.search(true);
  assert.equal(host.controller.state.uncertain, true);
  assert.match(host.controller.state.error, /Check Anna activity and CU usage/);
  await host.controller.search(true);
  await host.controller.draftFromText("Second paid request", true);
  await host.controller.initialize();
  await host.controller.search(true);
  assert.equal(host.paidCalls().length, 1);
  assert.equal(host.controller.state.uncertain, true);
});

test("dispose suppresses late callbacks and prevents the next paid step", async () => {
  const pending = deferred();
  const host = await prepared({
    handlers: { "web.search": () => pending.promise },
  });
  const running = host.controller.search(true);
  host.controller.dispose();
  const count = host.updates.length;
  pending.resolve({ results: [], quota_consumed: 0.2 });
  await running;
  await host.controller.initialize();
  host.controller.receiveEntry({ query: "after disposal" });
  assert.equal(host.updates.length, count);
  assert.equal(host.paidCalls().length, 1);
  assert.equal(callsOf(host, "web.fetch").length, 0);
});

test("missing CU stays unknown even when tokens exist or other calls report CU", async () => {
  const host = await prepared({
    handlers: {
      "llm.complete": () =>
        completion(
          { opportunities: [] },
          { _meta: undefined, usage: { inputTokens: 500, outputTokens: 200 } },
        ),
    },
  });
  const result = await host.controller.search(true);
  assert.equal(result.observedCu, null);
  assert.equal(host.controller.state.observedCu, null);
});

test("malformed or truncated extraction fails closed without result or retry", async () => {
  const host = await prepared({
    handlers: {
      "llm.complete": () =>
        completion(
          { opportunities: [candidate(TRUSTED_SOURCES[0].entryUrl)] },
          { stopReason: "maxTokens" },
        ),
    },
  });
  await host.controller.search(true);
  assert.equal(host.controller.state.result, null);
  assert.equal(host.controller.state.phase, "failed");
  assert.equal(callsOf(host, "llm.complete").length, 1);
});

test("APS restoration whitelists fields and confirmation uses returned ETag", async () => {
  const bookmark = {
    id: "saved-id",
    name: "Saved title",
    url: "https://discovery.vendor.dev/saved",
    savedAt: instant,
    checkedAt: instant,
    unexpected: "discard",
  };
  const host = setup({
    value: {
      ...saved({ bookmarks: [bookmark] }),
      rawParagraph: "never restore",
      pages: ["never restore"],
    },
  });
  await host.controller.initialize();
  assert.equal(host.controller.state.query, "");
  assert.equal(host.controller.state.bookmarks[0].unexpected, undefined);
  host.controller.edit(profile);
  await host.controller.confirm();
  assert.equal(callsOf(host, "storage.set")[0].args.if_match, "fixture-etag-1");
  assert.ok(!JSON.stringify(host.stored()).includes("never restore"));
  assert.ok(!JSON.stringify(host.stored()).includes("unexpected"));
});

test("malformed or unsafe saved data is not restored or overwritten", async () => {
  for (const bad of [
    saved({ version: 2 }),
    saved({
      confirmedProfile: {
        ...confirmed,
        profile: { ...profile, arbitrary: "unsafe" },
      },
    }),
    saved({
      bookmarks: [
        {
          id: "x",
          name: "x",
          url: "javascript:alert(1)",
          savedAt: instant,
          checkedAt: instant,
        },
      ],
    }),
  ]) {
    const host = setup({ value: bad });
    await host.controller.initialize();
    assert.equal(host.controller.state.storageReady, false);
    host.controller.edit(profile);
    await host.controller.confirm();
    assert.ok(host.controller.state.confirmed);
    assert.equal(callsOf(host, "storage.set").length, 0);
    assert.match(host.controller.state.notice, /not saved/);
  }
});

test("first insert re-reads and omits if_match as documented by APS", async () => {
  const host = setup();
  await host.controller.initialize();
  host.controller.edit(profile);
  await host.controller.confirm();
  assert.equal(callsOf(host, "storage.get").length, 2);
  assert.equal(
    Object.hasOwn(callsOf(host, "storage.set")[0].args, "if_match"),
    false,
  );
  assert.equal(host.stored().value.confirmedProfile.profile.topics[0], "AI");
});

test("concurrent first creation is preserved and further writes require explicit reload", async () => {
  const host = setup();
  await host.controller.initialize();
  host.changeStored(
    saved({
      confirmedProfile: {
        ...confirmed,
        profile: { ...profile, topics: ["remote profile"] },
      },
    }),
  );
  host.controller.edit(profile);
  await host.controller.confirm();
  assert.equal(callsOf(host, "storage.set").length, 0);
  assert.equal(host.controller.state.storageReady, false);
  assert.equal(host.controller.state.confirmed.profile.topics[0], "AI");
  assert.match(host.controller.state.error, /another window/);
  await host.controller.confirm();
  assert.equal(callsOf(host, "storage.set").length, 0);
  await host.controller.initialize();
  assert.equal(host.controller.state.confirmed.profile.topics[0], "AI");
  await host.controller.confirm();
  assert.equal(callsOf(host, "storage.set")[0].args.if_match, "remote-etag");
});

test("load failure preserves work and never overwrites old data", async () => {
  const host = await prepared();
  host.handlers["storage.get"] = () => {
    throw codedError("UPSTREAM_ERROR");
  };
  await host.controller.initialize();
  assert.equal(host.controller.state.storageReady, false);
  assert.equal(host.controller.state.confirmed.profile.topics[0], "AI");
  const sets = callsOf(host, "storage.set").length;
  host.controller.edit({ ...profile, topics: ["manual unsaved"] });
  await host.controller.confirm();
  assert.equal(callsOf(host, "storage.set").length, sets);
  assert.equal(host.stored().value.confirmedProfile.profile.topics[0], "AI");
});

test("ETag conflict or uncertain save preserves in-memory confirmation and locks subsequent writes", async () => {
  for (const code of ["precondition_failed", "TIMEOUT"]) {
    const host = await prepared();
    host.handlers["storage.set"] = () => {
      throw codedError(code);
    };
    host.controller.edit({ ...profile, topics: ["unsaved choice"] });
    await host.controller.confirm();
    assert.equal(
      host.controller.state.confirmed.profile.topics[0],
      "unsaved choice",
    );
    assert.equal(host.controller.state.storageReady, false);
    assert.match(host.controller.state.notice, /not saved/);
    const sets = callsOf(host, "storage.set").length;
    await host.controller.confirm();
    assert.equal(callsOf(host, "storage.set").length, sets);
  }
});

test("bookmark stores only a safe dated snapshot and each later write uses current ETag", async () => {
  const host = await prepared();
  const result = await host.controller.search(true);
  await host.controller.bookmark(result.matches[0]);
  assert.equal(host.controller.state.bookmarks.length, 1);
  const bookmark = host.stored().value.bookmarks[0];
  assert.deepEqual(Object.keys(bookmark).sort(), [
    "checkedAt",
    "id",
    "name",
    "savedAt",
    "url",
  ]);
  assert.equal(bookmark.checkedAt, instant);
  assert.equal(
    callsOf(host, "storage.set").at(-1).args.if_match,
    "fixture-etag-2",
  );
  await host.controller.bookmark(result.matches[0]);
  assert.equal(callsOf(host, "storage.set").length, 2);
  await host.controller.removeBookmark(bookmark.id);
  assert.equal(
    callsOf(host, "storage.set").at(-1).args.if_match,
    "fixture-etag-3",
  );
  assert.equal(host.stored().value.bookmarks.length, 0);
});

test("bookmark failure never claims a saved bookmark and maximum is thirty", async () => {
  const host = await prepared();
  const result = await host.controller.search(true);
  host.handlers["storage.set"] = () => {
    throw codedError("precondition_failed");
  };
  await host.controller.bookmark(result.matches[0]);
  assert.equal(host.controller.state.bookmarks.length, 0);
  const full = await prepared({
    value: saved({
      bookmarks: Array.from({ length: 30 }, (_, i) => ({
        id: `saved-${i}`,
        name: `Saved ${i}`,
        url: `https://discovery.vendor.dev/saved-${i}`,
        savedAt: instant,
        checkedAt: instant,
      })),
    }),
  });
  const next = await full.controller.search(true);
  const sets = callsOf(full, "storage.set").length;
  await full.controller.bookmark(next.matches[0]);
  assert.equal(callsOf(full, "storage.set").length, sets);
  assert.match(full.controller.state.error, /30 bookmarks/);
});

test("clear performs conditional deletion and accurately discloses soft deletion", async () => {
  const host = await prepared();
  await host.controller.clearPersonalData();
  assert.equal(
    callsOf(host, "storage.delete")[0].args.if_match,
    "fixture-etag-2",
  );
  assert.equal(host.controller.state.confirmed, null);
  assert.equal(host.controller.state.bookmarks.length, 0);
  assert.equal(host.stored(), null);
  assert.match(host.controller.state.notice, /soft deletion/);
  assert.match(
    host.controller.state.notice,
    /earlier chat events are unchanged/,
  );
});

test("clear failure or conflict does not erase visible work or falsely claim deletion", async () => {
  for (const code of ["precondition_failed", "TIMEOUT"]) {
    const host = await prepared();
    await host.controller.search(true);
    host.handlers["storage.delete"] = () => {
      throw codedError(code);
    };
    await host.controller.clearPersonalData();
    assert.ok(host.controller.state.confirmed);
    assert.ok(host.controller.state.result);
    assert.equal(host.controller.state.storageReady, false);
    assert.ok(host.stored());
    assert.ok(!/Personal data cleared/.test(host.controller.state.notice));
  }
});

test("clear detects another window's changes before deleting", async () => {
  const host = await prepared();
  host.changeStored(saved(), "newer-remote-etag");
  await host.controller.clearPersonalData();
  assert.equal(callsOf(host, "storage.delete").length, 0);
  assert.ok(host.controller.state.confirmed);
  assert.equal(host.stored().etag, "newer-remote-etag");
});

test("clear treats documented not-found as already removed", async () => {
  const host = await prepared();
  host.handlers["storage.delete"] = () => {
    throw codedError(-32022);
  };
  await host.controller.clearPersonalData();
  assert.equal(host.controller.state.confirmed, null);
  assert.match(host.controller.state.notice, /Personal data cleared/);
});

test("explicit summary is minimal, transient, and never includes private profile or query", async () => {
  const host = await prepared();
  host.controller.receiveEntry({ query: "PRIVATE RAW PARAGRAPH" });
  await host.controller.search(true);
  assert.equal(callsOf(host, "chat.append_artifact").length, 0);
  await host.controller.appendSummary();
  const artifact = callsOf(host, "chat.append_artifact")[0].args.artifact;
  assert.equal(artifact.kind, "app_event");
  assert.deepEqual(Object.keys(artifact.data), ["leads"]);
  assert.ok(artifact.data.leads.length <= 5);
  assert.deepEqual(Object.keys(artifact.data.leads[0]), ["title", "url"]);
  assert.ok(!JSON.stringify(artifact).includes("PRIVATE RAW"));
  assert.ok(!JSON.stringify(artifact).includes('"profile"'));
  assert.match(host.controller.state.notice, /transient/);
  assert.match(host.controller.state.notice, /may not be saved/);
});

test("a new empty session prefills entry without paying, but a manual profile stages it", async () => {
  const host = setup();
  host.controller.receiveEntry({ query: "first entry" });
  assert.equal(host.controller.state.query, "first entry");
  assert.equal(host.controller.state.pendingEntry, null);
  assert.equal(host.paidCalls().length, 0);
  const manual = setup();
  manual.controller.edit(profile);
  manual.controller.receiveEntry({ query: "other request" });
  assert.equal(manual.controller.state.query, "");
  assert.equal(manual.controller.state.pendingEntry, "other request");
  assert.deepEqual(manual.controller.state.draft, profile);
});

test("the SDK's plain RPC timeout Error is outcome-uncertain and never starts another charge", async () => {
  const host = await prepared({
    handlers: {
      "web.search": () => {
        throw new Error(
          "RPC web.search timed out after 60000ms (pass { timeoutMs } as the 2nd arg to override)",
        );
      },
    },
  });
  await host.controller.search(true);
  assert.equal(host.controller.state.uncertain, true);
  await host.controller.search(true);
  assert.equal(host.paidCalls().length, 1);
});

test("entry arriving before APS restore is staged instead of pairing a new query with old confirmation", async () => {
  const pending = deferred();
  const host = setup({ handlers: { "storage.get": () => pending.promise } });
  const loading = host.controller.initialize();
  host.controller.receiveEntry({ query: "new request while storage loads" });
  assert.equal(host.controller.state.query, "new request while storage loads");
  pending.resolve({ exists: true, value: saved(), etag: "restored-etag" });
  await loading;
  assert.deepEqual(host.controller.state.confirmed, confirmed);
  assert.equal(host.controller.state.query, "");
  assert.equal(
    host.controller.state.pendingEntry,
    "new request while storage loads",
  );
  assert.equal(host.paidCalls().length, 0);
});

test("cancelled request timing out still blocks a new charge", async () => {
  const pending = deferred();
  const host = setup({ handlers: { "llm.complete": () => pending.promise } });
  const running = host.controller.draftFromText("first text", true);
  host.controller.cancel();
  pending.reject(new Error("RPC llm.complete timed out after 60000ms"));
  await running;
  assert.equal(host.controller.state.uncertain, true);
  await host.controller.draftFromText("second text", true);
  assert.equal(host.paidCalls().length, 1);
});

test("invalid visible edits revoke confirmation and cannot charge a search for the old profile", async () => {
  for (const invalid of [
    { ...profile, topics: ["x".repeat(81)] },
    { ...profile, location: "x".repeat(121) },
  ]) {
    const host = await prepared();
    host.controller.edit(invalid);
    assert.equal(host.controller.state.confirmed, null);
    assert.equal(host.controller.state.result, null);
    assert.deepEqual(host.controller.state.draft, profile);
    assert.match(host.controller.state.error, /profile is invalid/);
    await host.controller.search(true);
    assert.equal(host.paidCalls().length, 0);
    assert.match(host.controller.state.error, /confirm your current profile/);
  }
});

test("invalid edits clear existing results rather than retaining stale confirmed matches", async () => {
  const host = await prepared();
  await host.controller.search(true);
  assert.ok(host.controller.state.result);
  const paidBefore = host.paidCalls().length;
  host.controller.edit({ ...profile, topics: ["x".repeat(81)] });
  assert.equal(host.controller.state.confirmed, null);
  assert.equal(host.controller.state.result, null);
  await host.controller.search(true);
  assert.equal(host.paidCalls().length, paidBefore);
});

test("invalid edits cancel pending paid work while retaining the unresolved-call lock", async () => {
  const pending = deferred();
  const host = await prepared({
    handlers: { "web.search": () => pending.promise },
  });
  const running = host.controller.search(true);
  host.controller.edit({ ...profile, topics: ["x".repeat(81)] });
  assert.equal(host.controller.state.confirmed, null);
  assert.equal(host.controller.state.busy, true);
  await host.controller.draftFromText("Another paid draft", true);
  assert.equal(host.paidCalls().length, 1);
  pending.resolve({ results: [], quota_consumed: 0.2 });
  await running;
  assert.equal(host.controller.state.result, null);
  assert.equal(host.controller.state.busy, false);
  assert.equal(callsOf(host, "web.fetch").length, 0);
  assert.equal(host.paidCalls().length, 1);
});

test("a documented first-insert precondition failure is not retried or presented as saved", async () => {
  const host = setup({
    handlers: {
      "storage.set": (args) => {
        assert.equal(Object.hasOwn(args, "if_match"), false);
        throw codedError("precondition_failed");
      },
    },
  });
  await host.controller.initialize();
  host.controller.edit(profile);
  await host.controller.confirm();
  assert.equal(callsOf(host, "storage.get").length, 2);
  assert.equal(callsOf(host, "storage.set").length, 1);
  assert.equal(host.controller.state.storageReady, false);
  assert.ok(host.controller.state.confirmed);
  assert.match(host.controller.state.notice, /not saved/);
  await host.controller.confirm();
  assert.equal(callsOf(host, "storage.set").length, 1);
});

test("APS existence flag distinguishes stored null and malformed rows from a missing key", async () => {
  for (const reply of [
    { exists: true, value: null, etag: "null-row-etag" },
    { value: saved(), etag: "missing-existence-flag" },
  ]) {
    const host = setup({ handlers: { "storage.get": () => reply } });
    await host.controller.initialize();
    assert.equal(host.controller.state.storageReady, false);
    host.controller.edit(profile);
    await host.controller.confirm();
    assert.equal(callsOf(host, "storage.set").length, 0);
  }
});

test("invalid edit cannot directly confirm the retained old draft or search with it", async () => {
  const host = await prepared();
  const writes = callsOf(host, "storage.set").length;
  host.controller.edit({ ...profile, topics: ["x".repeat(81)] });
  await host.controller.confirm();
  assert.equal(host.controller.state.confirmed, null);
  assert.match(host.controller.state.error, /valid profile/);
  await host.controller.search(true);
  assert.equal(host.paidCalls().length, 0);
  assert.equal(callsOf(host, "storage.set").length, writes);
  host.controller.edit({ ...profile, topics: ["valid replacement"] });
  await host.controller.confirm();
  assert.equal(
    host.controller.state.confirmed.profile.topics[0],
    "valid replacement",
  );
  assert.equal(callsOf(host, "storage.set").length, writes + 1);
});

test("unrelated discovered pages never cause fixed registry seeds to be fetched", async () => {
  const urls = [
    "https://discovery.vendor.dev/unrelated-one",
    "https://discovery.vendor.dev/unrelated-two",
  ];
  const host = await prepared({
    handlers: {
      "web.search": () => ({
        results: urls.map((url) => ({ url })),
        quota_consumed: 0.2,
      }),
      "llm.complete": (args) => {
        const pages = JSON.parse(args.messages[1].content.text).pages;
        return completion({
          opportunities: pages.map((page, index) => candidate(page.url, index)),
        });
      },
    },
  });
  const result = await host.controller.search(true);
  const fetched = callsOf(host, "web.fetch")[0].args.urls;
  assert.deepEqual(fetched, urls);
  assert.ok(
    TRUSTED_SOURCES.every((source) => !fetched.includes(source.entryUrl)),
  );
  assert.equal(result.matches.length, 0);
  assert.equal(result.leads.length, 2);
  assert.ok(result.leads.every((lead) => lead.name.level === "unverified"));
});

test("empty search results do not fall back to registry fetches or an extraction charge", async () => {
  const host = await prepared({
    handlers: { "web.search": () => ({ results: [], quota_consumed: 0.2 }) },
  });
  const result = await host.controller.search(true);
  assert.equal(callsOf(host, "web.search").length, 2);
  assert.equal(callsOf(host, "web.fetch").length, 0);
  assert.equal(callsOf(host, "llm.complete").length, 0);
  assert.equal(result.matches.length, 0);
  assert.equal(result.leads.length, 0);
  assert.equal(result.incomplete, true);
});
