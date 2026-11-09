import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const bundle = path.join(packageRoot, "dist/bundle");
const output =
  process.env.ANNA_SCREENSHOT_DIR ?? path.join(packageRoot, "test-results");
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const route = new URL(req.url, "http://localhost").pathname;
    if (route === "/host") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><body style="margin:0"><iframe id="app" title="Offline Anna sandbox" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" src="/" style="display:block;width:100%;height:100vh;border:0"></iframe></body></html>',
      );
      return;
    }
    const rel =
      route === "/" ? "index.html" : decodeURIComponent(route.slice(1));
    const file = path.resolve(bundle, rel);
    if (!file.startsWith(bundle + path.sep)) throw new Error("path");
    const types = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".txt": "text/plain",
    };
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] ?? "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
let passed = 0;
let currentPage = null;
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  await context.route("**/static/anna-apps/_sdk/latest/index.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "export const AnnaAppRuntime={connect:async()=>globalThis.__annaFake};",
    }),
  );
  await context.addInitScript(() => {
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
      const terms =
        "Participation is subject to the organizer's official rules.";
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
        handler({ theme: "light" });
        return () => {};
      },
      onLocaleChange: (handler) => {
        locale.push(handler);
        handler({ lang: "en" });
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
                  deadline: {
                    ...fact(deadline, p.cutoff),
                    kind: "registration",
                  },
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
      entry: (q) =>
        (events.entry_payload ?? []).forEach((f) => f({ query: q })),
    };
  });
  const hostPage = await context.newPage();
  currentPage = hostPage;
  hostPage.on("pageerror", (e) => errors.push(e.message));
  await hostPage.goto(base + "/host");
  let page = hostPage.frames().find((f) => f.parentFrame());
  assert.ok(page, "app runs inside the same modal-free sandbox as Anna");
  await page.waitForFunction(
    () => !document.getElementById("confirm").disabled,
  );
  await page.evaluate(() => {
    const n = document.createElement("div");
    n.id = "simulation-banner";
    n.textContent =
      "OFFLINE SIMULATION / 离线模拟 · Synthetic facts, no live calls";
    n.style.cssText =
      "position:sticky;top:0;z-index:99;background:#7b1f17;color:white;padding:8px;text-align:center;font:12px system-ui";
    document.body.prepend(n);
  });
  assert.equal(
    await page.locator("#query").inputValue(),
    "Find online AI challenges for Python builders",
  );
  assert.equal(
    await page.evaluate(
      () =>
        __fixture.local().calls.filter((x) => /web\.|llm\./.test(x.ns)).length,
    ),
    0,
  );
  passed++;
  await page.locator("#draft").click();
  assert.equal(
    await page.evaluate(
      () =>
        __fixture.local().calls.filter((x) => x.ns === "llm.complete").length,
    ),
    0,
  );
  passed++;
  await page.locator("#model-consent").check();
  await page.locator("#draft").click();
  await page.waitForFunction(
    () => document.getElementById("topics").value === "AI",
  );
  assert.equal(await page.locator("#search").isDisabled(), true);
  await page.locator("#skills").fill("Python, design");
  await page.locator("#confirm").click();
  await page.waitForFunction(() => !document.getElementById("search").disabled);
  passed++;
  // Invalid visible text must revoke confirmation and cannot confirm old fields.
  const savesBeforeInvalid = await page.evaluate(
    () => __fixture.local().calls.filter((x) => x.ns === "storage.set").length,
  );
  await page.locator("#skills").fill("x".repeat(81));
  assert.equal(await page.locator("#search").isDisabled(), true);
  await page.locator("#confirm").click();
  assert.equal(await page.locator("#error").isVisible(), true);
  assert.equal(await page.locator("#search").isDisabled(), true);
  assert.equal(
    await page.evaluate(
      () =>
        __fixture.local().calls.filter((x) => x.ns === "storage.set").length,
    ),
    savesBeforeInvalid,
  );
  await page.locator("#skills").fill("Python, design");
  await page.locator("#confirm").click();
  await page.waitForFunction(() => !document.getElementById("search").disabled);
  passed++;
  await page.locator("#search-consent").check();
  await page.locator("#search").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".opportunity").length === 3,
  );
  assert.equal(await page.locator(".opportunity").count(), 3);
  passed++;
  await page
    .locator(".opportunity")
    .first()
    .getByRole("button", { name: "Save link" })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".saved-item").length === 1,
  );
  await page.locator("#summary").click();
  await page.waitForFunction(() =>
    __fixture.local().calls.some((x) => x.ns === "chat.append_artifact"),
  );
  passed++;
  assert.equal(
    await page.evaluate(
      () => __fixture.local().calls.filter((x) => x.ns === "web.search").length,
    ),
    2,
  );
  assert.equal(
    await page.evaluate(
      () => __fixture.local().calls.filter((x) => x.ns === "web.fetch").length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(
      () =>
        __fixture.local().calls.filter((x) => x.ns === "llm.complete").length,
    ),
    2,
  );
  passed++;
  const shots = [];
  for (const width of [320, 390, 1024, 1440])
    for (const theme of ["light", "dark"]) {
      await hostPage.setViewportSize({ width, height: 1000 });
      await page.evaluate(
        ({ theme }) => {
          __fixture.theme(theme);
          __fixture.locale(theme === "light" ? "en" : "zh-CN");
        },
        { theme },
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
      const filename = `anna-${width}-${theme}.png`;
      const appHeight = await page.evaluate(
        () => document.body.scrollHeight + 32,
      );
      await hostPage
        .locator("#app")
        .evaluate(
          (element, height) => (element.style.height = `${height}px`),
          appHeight,
        );
      await hostPage.screenshot({
        path: path.join(output, filename),
        fullPage: true,
      });
      await hostPage
        .locator("#app")
        .evaluate((element) => (element.style.height = "100vh"));
      shots.push(filename);
      passed++;
    }
  // A changed native entry stages an explicit decision and never starts paid work.
  const before = await page.evaluate(() => __fixture.local().calls.length);
  await page.evaluate(() =>
    __fixture.entry("A new robotics challenge request"),
  );
  assert.equal(await page.locator("#pending").isVisible(), true);
  assert.equal(
    await page.evaluate(() => __fixture.local().calls.length),
    before,
  );
  await page.locator("#apply-entry").click();
  assert.equal(await page.locator("#search").isDisabled(), true);
  passed++;
  // Reopening restores profile/bookmark storage without paid work.
  const paidBefore = await page.evaluate(
    () =>
      __fixture.local().calls.filter((x) => /web\.|llm\./.test(x.ns)).length,
  );
  await hostPage.reload();
  page = hostPage.frames().find((f) => f.parentFrame());
  await page.waitForFunction(
    () => document.querySelectorAll(".saved-item").length === 1,
  );
  assert.equal(
    await page.evaluate(
      () =>
        __fixture.local().calls.filter((x) => /web\.|llm\./.test(x.ns)).length,
    ),
    paidBefore,
  );
  passed++;
  // A pending request keeps its lock while cancelling; no following fetch is scheduled.
  await page.locator("#search-consent").check();
  await page.evaluate(() => (window.__deferSearch = true));
  await page.locator("#search").click();
  await page.waitForFunction(() => !!window.__resolveSearch);
  await page.locator("#cancel").click();
  assert.equal(await page.locator("#search").isDisabled(), true);
  await page.evaluate(() => {
    window.__deferSearch = false;
    window.__resolveSearch();
  });
  await page.waitForFunction(() => document.getElementById("cancel").hidden);
  assert.equal(
    await page.evaluate(
      () => __fixture.local().calls.filter((x) => x.ns === "web.fetch").length,
    ),
    1,
  );
  passed++;
  await page.locator(".privacy-controls summary").click();
  await page.locator("#clear").click();
  assert.equal(await page.locator("#clear-confirmation").isVisible(), true);
  assert.equal(await page.locator(".saved-item").count(), 1);
  await page.locator("#clear-no").press("Escape");
  assert.equal(await page.locator("#clear-confirmation").isHidden(), true);
  assert.equal(await page.locator(".saved-item").count(), 1);
  await page.locator("#clear").click();
  await page.locator("#clear-yes").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".saved-item").length === 0,
  );
  passed++;
  assert.deepEqual(errors, []);
  await context.close();
  const report = {
    passed,
    failed: 0,
    errors,
    screenshots: shots,
    mode: "offline browser simulation only",
    liveAnnaValidated: false,
    sandbox:
      "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
  };
  await writeFile(
    path.join(output, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (currentPage) {
    await currentPage
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(output, "failure.json"),
      JSON.stringify(
        {
          passed,
          error: String(error),
          pageErrors: errors,
          body: await (
            currentPage.frames().find((f) => f.parentFrame()) ?? currentPage
          )
            .locator("body")
            .innerText()
            .catch(() => ""),
        },
        null,
        2,
      ),
    );
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
