// Synthetic offline host responses. Nothing in this file is live opportunity data.
import { TRUSTED_SOURCES } from "../../src/sources.ts";
export const instant = "2026-11-09T10:00:00.000Z";
export const profile = {
  topics: ["AI"],
  skills: ["coding"],
  modes: ["online"],
  location: "",
  availability: "",
  constraints: [],
};
export const confirmed = {
  profile,
  revision: "fixture-revision",
  confirmedAt: instant,
};
export const saved = (overrides = {}) => ({
  version: 1,
  confirmedProfile: confirmed,
  bookmarks: [],
  ...overrides,
});
export const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
export const codedError = (code) =>
  Object.assign(new Error("Synthetic host failure"), { code });
export const completion = (value, extra = {}) => ({
  role: "assistant",
  content: { type: "text", text: JSON.stringify(value) },
  stopReason: "endTurn",
  _meta: { quotaConsumed: 0.7 },
  ...extra,
});
export const pageContent =
  "Synthetic fixture AI opportunity. AI and coding for a synthetic fixture. Attendance is online. Registration is open. Registration deadline: December 20, 2099 18:00 UTC. Open to all adults. No entry fee.";
export function candidate(url, index = 0) {
  const fact = (value, quote = value) => ({
    value,
    evidence: [{ page: index, quote }],
  });
  return {
    url,
    name: fact("Synthetic fixture AI opportunity"),
    description: fact("AI and coding for a synthetic fixture"),
    mode: fact("online", "Attendance is online."),
    location: null,
    deadline: {
      ...fact(
        "December 20, 2099 18:00 UTC",
        "Registration deadline: December 20, 2099 18:00 UTC.",
      ),
      kind: "registration",
    },
    registration: fact("open", "Registration is open."),
    eligibility: fact("Open to all adults"),
    terms: [fact("No entry fee")],
  };
}
export const fetchedPage = (url, extra = {}) => ({
  url,
  final_url: url,
  ok: true,
  content: pageContent,
  truncated: false,
  ...extra,
});
export function fakeRuntime(options = {}) {
  const calls = [];
  const handlers = options.handlers ?? {};
  let row =
    options.value === undefined
      ? null
      : { value: structuredClone(options.value), etag: "fixture-etag-1" };
  let etagCounter = 1;
  const invoke = async (name, args, callOptions, defaultFn) => {
    calls.push({ name, args: structuredClone(args), options: callOptions });
    if (handlers[name]) return handlers[name](args, callOptions);
    return defaultFn();
  };
  const runtime = {
    llm: {
      complete: (args, opts) =>
        invoke("llm.complete", args, opts, () => {
          if (args.maxTokens === 1200) return completion(profile);
          const pages = JSON.parse(args.messages[1].content.text).pages;
          const index = pages.findIndex(
            (page) => page.url === TRUSTED_SOURCES[0].entryUrl,
          );
          return completion({
            opportunities:
              index < 0 ? [] : [candidate(pages[index].finalUrl, index)],
          });
        }),
    },
    web: {
      search: (args) =>
        invoke("web.search", args, undefined, () => ({
          results: [
            ...TRUSTED_SOURCES.map((source) => ({ url: source.entryUrl })),
            {
              url: "https://discovery.vendor.dev/synthetic-call",
              content: "Search snippet is never evidence.",
            },
          ],
          quota_consumed: 0.2,
        })),
      fetch: (args, opts) =>
        invoke("web.fetch", args, opts, () => ({
          pages: args.urls.map((url) => fetchedPage(url)),
          quota_consumed: 0.1,
        })),
    },
    storage: {
      get: (args) =>
        invoke("storage.get", args, undefined, () =>
          row
            ? { key: args.key, exists: true, ...structuredClone(row) }
            : { value: null, exists: false },
        ),
      set: (args) =>
        invoke("storage.set", args, undefined, () => {
          if (args.if_match !== undefined && args.if_match !== row?.etag)
            throw codedError("precondition_failed");
          row = {
            value: structuredClone(args.value),
            etag: `fixture-etag-${++etagCounter}`,
          };
          return {
            etag: row.etag,
            generation: etagCounter,
            size_bytes: JSON.stringify(row.value).length,
          };
        }),
      delete: (args) =>
        invoke("storage.delete", args, undefined, () => {
          if (args.if_match !== row?.etag)
            throw codedError("precondition_failed");
          row = null;
          return { deleted: true };
        }),
    },
    chat: {
      append_artifact: (args) =>
        invoke("chat.append_artifact", args, undefined, () => ({
          accepted: true,
        })),
    },
  };
  return {
    runtime,
    calls,
    handlers,
    paidCalls: () => calls.filter((call) => /^(llm|web)\./.test(call.name)),
    stored: () => structuredClone(row),
    changeStored: (value, etag = "remote-etag") => {
      row = value === null ? null : { value: structuredClone(value), etag };
    },
  };
}
