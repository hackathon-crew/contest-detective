// Synthetic offline browser fixture only. Never included in the production bundle.

const key = "anna-browser-fixture";
const initial = { saved: null, etag: null, generation: 0, calls: [] };
const local = () =>
  JSON.parse(localStorage.getItem(key) ?? JSON.stringify(initial));
const update = (fn) => {
  const s = local();
  fn(s);
  localStorage.setItem(key, JSON.stringify(s));
};
const call = (ns, args) => update((s) => s.calls.push({ ns, args }));
const events = {};
const theme = [],
  locale = [];
let fetched = [];
const profile = {
  topics: ["AI"],
  skills: ["Python"],
  modes: ["online"],
  location: "",
  availability: "",
  constraints: [],
};
const trusted = [
  "https://crash-this.github.io/",
  "https://eisociety.org/hackathon.php?slug=next-horizon-2026",
  "https://landing.mobileworldcapital.com/more-than-a-hack-2027",
];
const deadline =
  new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) +
  " 17:00 UTC";
const pieces = (url) => {
  const i = trusted.indexOf(url);
  const number = i + 1;
  const name = `Fixture ${number} · AI Builders Challenge`;
  const description = "Build an AI prototype with Python.";
  const mode = "Attendance: online.";
  const registration = "Registration is open.";
  const cutoff = `Registration deadline: ${deadline}.`;
  const eligibility = "Adults worldwide may participate.";
  const terms = "Participation is subject to the organizer's official rules.";
  return {
    name,
    description,
    mode,
    registration,
    cutoff,
    eligibility,
    terms,
    text: [
      name,
      description,
      mode,
      registration,
      cutoff,
      eligibility,
      terms,
    ].join("\n"),
  };
};
const fake = {
  entryPayload: { query: "Find online AI challenges for Python builders" },
  on: (event, handler) => {
    (events[event] ??= []).push(handler);
    return () => {};
  },
  onThemeChange: (handler) => {
    theme.push(handler);
    handler({
      theme: new URL(location.href).searchParams.get("theme") ?? "light",
    });
    return () => {};
  },
  onLocaleChange: (handler) => {
    locale.push(handler);
    handler({ lang: new URL(location.href).searchParams.get("lang") ?? "en" });
    return () => {};
  },
  storage: {
    get: async (args) => {
      call("storage.get", args);
      const s = local();
      return s.saved
        ? { exists: true, value: s.saved, etag: s.etag }
        : { exists: false, value: null, etag: null };
    },
    set: async (args) => {
      call("storage.set", args);
      const s = local();
      if (args.if_match !== undefined && args.if_match !== s.etag)
        throw Object.assign(new Error("conflict"), {
          code: "precondition_failed",
        });
      let etag;
      update((v) => {
        v.saved = args.value;
        v.generation++;
        v.etag = `etag-${v.generation}`;
        etag = v.etag;
      });
      return { etag };
    },
    delete: async (args) => {
      call("storage.delete", args);
      update((s) => {
        s.saved = null;
        s.etag = null;
      });
      return { deleted: true };
    },
  },
  web: {
    search: async (args) => {
      call("web.search", args);
      if (window.__deferSearch)
        await new Promise((resolve) => (window.__resolveSearch = resolve));
      return {
        results: trusted.map((url) => ({
          url,
          title: "Synthetic test result",
          snippet: "Fixture only",
        })),
        quota_consumed: 0,
      };
    },
    fetch: async (args) => {
      call("web.fetch", args);
      fetched = args.urls;
      return {
        pages: args.urls.map((url) => ({
          url,
          final_url: url,
          ok: true,
          content: pieces(url).text,
          truncated: false,
        })),
        quota_consumed: 0,
      };
    },
  },
  llm: {
    complete: async (args) => {
      call("llm.complete", args);
      let data = profile;
      if (args.maxTokens > 2000) {
        data = {
          opportunities: fetched.map((url, page) => {
            const p = pieces(url);
            const fact = (value, quote = value) => ({
              value,
              evidence: [{ page, quote }],
            });
            return {
              url,
              name: fact(p.name),
              description: fact(p.description),
              mode: fact("online", p.mode),
              location: null,
              deadline: { ...fact(deadline, p.cutoff), kind: "registration" },
              registration: fact("open", p.registration),
              eligibility: fact(p.eligibility),
              terms: [fact(p.terms)],
            };
          }),
        };
      }
      return {
        role: "assistant",
        content: { type: "text", text: JSON.stringify(data) },
        stopReason: "endTurn",
        _meta: { quotaConsumed: 0 },
      };
    },
  },
  chat: {
    append_artifact: async (args) => {
      call("chat.append_artifact", args);
      return { artifact_id: "fixture-transient" };
    },
  },
};
window.__annaFake = fake;
window.__fixture = {
  local,
  theme: (t) => theme.forEach((f) => f({ theme: t })),
  locale: (l) => locale.forEach((f) => f({ lang: l })),
  entry: (q) => (events.entry_payload ?? []).forEach((f) => f({ query: q })),
};
export const AnnaAppRuntime = { connect: async () => window.__annaFake };
