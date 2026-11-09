import { createController } from "./lib/service.js";
import { safePublicUrl, normalizeProfile } from "./lib/domain.js";

const dictionary = {
  en: {
    name: "Title",
    description: "Description",
    organizerProof: "Organizer identity source",
    reloadSaved: "Reload saved data",
    edition: "SOURCE-FIRST OPPORTUNITIES",
    eyebrow: "A LITTLE DIRECTION. A REAL OPPORTUNITY.",
    heading: "Find your next\nworthwhile challenge.",
    lead: "Tell us what you enjoy building. Review your profile, then explore opportunities with the evidence in view.",
    principle: "Your interests first.\nSources always.",
    privacy:
      "No resume, private accounts or device access. Only your confirmed profile and saved links are stored.",
    connecting: "Connecting to Anna…",
    connected: "Connected to Anna. Nothing runs until you choose to start.",
    connectionFailed:
      "Open Inkpaw from inside Anna to connect. You can read this page, but no model, search or storage calls will run here.",
    pending:
      "Anna sent a new request. Applying it requires a fresh profile confirmation.",
    applyEntry: "Use the new request",
    describe: "Describe your interests",
    queryLabel: "What would you like to find?",
    inputHint:
      "Use interests and practical constraints. Please leave out private or sensitive details.",
    modelConsent:
      "Use my Anna model quota for one profile draft. I can also fill the form below without AI.",
    draft: "Draft my profile",
    review: "Review & confirm",
    topics: "Interests",
    skills: "Skills",
    mode: "Participation",
    anyMode: "Any format",
    online: "Online only",
    offline: "In person only",
    hybrid: "Hybrid only",
    location: "Required location",
    availability: "Required schedule",
    constraints: "Other hard constraints",
    hardHint:
      "Hard constraints that cannot be verified exclude a match. Schedule and custom-condition verification are limited in this first version.",
    confirm: "Confirm this profile",
    confirmed: "Profile confirmed. You can now choose to search.",
    notConfirmed: "Please review and confirm. Changes need fresh confirmation.",
    explore: "Explore with evidence",
    sourceCoverage:
      "Initial verified sources: CRASH, EIS and Mobile World Capital. Other live discoveries appear separately as unverified leads. Only search hits are fetched. Extracted facts and eligibility still need your review; missing evidence can mean fewer or no matches.",
    searchConsent:
      "Start a search using my Anna quota: up to 2 basic searches, 8 fetched pages and 1 extraction-model call. Pricing varies by provider; no automatic retries.",
    search: "Find opportunities ↗",
    cancel: "Stop after current call",
    cancelHint:
      "Stopping prevents later steps. Requests already sent may still finish and consume quota.",
    emptyTitle: "Start with a profile.",
    emptyText:
      "Your shortlist will appear here, with what we know, what is uncertain and the source for each fact.",
    summary: "Send a brief source summary to Anna chat",
    summaryHint:
      "Chat summaries are transient and may disappear after refresh. Save individual links below to keep them.",
    saved: "Saved for later",
    bookmarkHint:
      "Saved links are dated snapshots, not a promise that registration is still open.",
    dataControls: "Your data",
    dataHelp:
      "Only the confirmed profile and links you save are persisted in your own Anna app storage. Search pages and unconfirmed drafts are not saved.",
    clear: "Clear my profile and saved links",
    clearYes: "Yes, clear my saved data",
    clearNo: "Keep my data",
    softDelete:
      "Anna uses soft deletion. Clearing the app does not promise permanent erasure from platform backups.",
    candidate: "Candidate build, not yet live-validated",
    license: "License",
    save: "Save link",
    remove: "Remove",
    viewSource: "Open source ↗",
    sources: "Inspect field-by-field evidence",
    unknown: "Not verified",
    checked: "Checked",
    observedCu: "Reported quota used",
    unknownCu:
      "Quota reporting unavailable or incomplete; this does not mean free.",
    verified: "Organizer source verified",
    unverified: "Unverified organizer",
    terms: "Important terms & limits",
    registration: "Registration",
    deadline: "Registration deadline",
    eligibility: "Eligibility",
    format: "Format",
    place: "Location",
    noSaved: "No links saved yet.",
    noMatches: "No source-backed candidates for this profile.",
    noMatchesHelp:
      "The app did not fill the list with guesses. Review the exclusions or adjust a hard constraint.",
    leads: "Unverified leads, not recommendations",
    leadsHelp:
      "These discovered pages contain quoted source text, but organizer identity has not been independently verified. Check the organizer and rules yourself before relying on them.",
    exclusions: "Excluded or not yet verified",
    clearConfirm:
      "Clear the confirmed profile and all saved links from this app? Anna soft deletion does not guarantee permanent erasure.",
    consentNeeded: "Select the quota consent box before starting this call.",
    fixture: "OFFLINE SIMULATION · No live search or quota usage",
    precision: "Precision",
    partial: "Some pages or facts could not be verified.",
    busy: "Working on your request…",
    uncertain:
      "A request may still be running. Check Anna activity and usage before reopening and starting another.",
    ready: "Ready",
    savedAt: "Saved",
    unverifiedEvidence:
      "Unverified source; quoted text is not proof of organizer identity.",
  },
  zh: {
    name: "名称",
    description: "说明",
    organizerProof: "主办身份依据",
    reloadSaved: "重新读取已保存数据",
    edition: "机会有出处",
    eyebrow: "一点方向，一个值得投入的机会。",
    heading: "找到下一场\n值得你的挑战。",
    lead: "说说你喜欢做什么，亲自确认画像，再带着证据探索适合的机会。",
    principle: "先理解你，\n再核实来源。",
    privacy:
      "无需简历、私人账号或本机权限。仅保存你确认的画像和主动收藏的链接。",
    connecting: "正在连接 Anna…",
    connected: "已连接 Anna。只有你主动启动，才会调用模型或检索。",
    connectionFailed:
      "请从 Anna 内打开 Inkpaw。当前页面可阅读，但不会调用模型、搜索或存储。",
    pending: "Anna 带来了一条新需求。应用后需要重新确认画像。",
    applyEntry: "使用这条新需求",
    describe: "说说你的兴趣",
    queryLabel: "你想寻找什么机会？",
    inputHint: "填写兴趣和实际条件即可，请勿放入私人或敏感信息。",
    modelConsent:
      "使用我的 Anna 模型额度生成一次画像草稿。我也可以直接手填下方表单。",
    draft: "帮我整理画像",
    review: "检查并确认",
    topics: "兴趣方向",
    skills: "技能",
    mode: "参与形式",
    anyMode: "不限形式",
    online: "仅线上",
    offline: "仅线下",
    hybrid: "仅混合形式",
    location: "必须符合的地点",
    availability: "必须符合的时间安排",
    constraints: "其他硬性条件",
    hardHint:
      "无法核实的硬性条件会排除候选。首版对时间安排及自定义条件的核实能力有限。",
    confirm: "确认这份画像",
    confirmed: "画像已确认，可以选择开始检索。",
    notConfirmed: "请检查并确认；修改后需要再次确认。",
    explore: "带着证据找机会",
    sourceCoverage:
      "首批已核实主办来源：CRASH、EIS、Mobile World Capital。其他实时发现单列为未核实线索。只抓取实际搜索命中的页面。抽取事实与资格仍需亲自复核，证据不足时可能少于三项或没有结果。",
    searchConsent:
      "使用我的 Anna 额度开始检索：最多两次基础搜索、八个网页、一次抽取模型调用。实际价格随服务方变化，不自动重试。",
    search: "寻找机会 ↗",
    cancel: "本次调用后停止",
    cancelHint: "停止会阻止后续步骤。已经发送的请求仍可能完成并消耗额度。",
    emptyTitle: "从一份画像开始。",
    emptyText: "这里将列出候选机会，以及已知事实、未核实部分和每项事实的来源。",
    summary: "把简短来源摘要发到 Anna 对话",
    summaryHint:
      "对话摘要是即时卡片，刷新后可能消失。需要保留的链接请单独收藏。",
    saved: "留待之后看看",
    bookmarkHint: "收藏是带日期的快照，不保证报名仍开放。",
    dataControls: "你的数据",
    dataHelp:
      "只有确认画像和你主动收藏的链接保存在本人 Anna 应用空间。网页全文和未确认草稿不会保存。",
    clear: "清除我的画像和收藏",
    clearYes: "确认清除已保存数据",
    clearNo: "保留数据",
    softDelete:
      "Anna 采用软删除。清除应用数据不代表平台备份中的记录已永久抹除。",
    candidate: "候选版本，尚未完成真实 Anna 验证",
    license: "许可协议",
    save: "收藏链接",
    remove: "移除",
    viewSource: "打开来源 ↗",
    sources: "逐项查看证据",
    unknown: "未核实",
    checked: "核验时间",
    observedCu: "已报告额度消耗",
    unknownCu: "计费信息缺失或不完整，不代表免费。",
    verified: "主办来源已核实",
    unverified: "主办身份未核实",
    terms: "重要条款与限制",
    registration: "报名状态",
    deadline: "报名截止",
    eligibility: "参赛资格",
    format: "形式",
    place: "地点",
    noSaved: "还没有收藏。",
    noMatches: "这份画像暂无有来源支持的候选。",
    noMatchesHelp: "没有用猜测填满列表。可以查看排除原因，或调整一项硬性条件。",
    leads: "未核实线索，不作为推荐",
    leadsHelp:
      "这些发现的网页包含可追溯引文，但尚未独立核实主办身份。请先自行确认主办方和规则，再依赖其中信息。",
    exclusions: "已排除或尚未核实",
    clearConfirm:
      "清除本应用里的确认画像及全部收藏？Anna 的软删除不保证永久抹除。",
    consentNeeded: "请先勾选额度使用说明，再开始这次调用。",
    fixture: "离线模拟 · 没有实时检索或额度消耗",
    precision: "时间精度",
    partial: "部分页面或事实未能核实。",
    busy: "正在处理你的需求…",
    uncertain:
      "一个请求可能仍在运行。请先查看 Anna 活动和用量，确认完成后再重新打开并开始。",
    ready: "就绪",
    savedAt: "收藏时间",
    unverifiedEvidence: "来源身份未核实，引文存在不等于主办身份可信。",
  },
};
let lang = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
const byId = (id) => document.getElementById(id);
const tr = (key) => dictionary[lang][key] ?? key;
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (className) n.className = className;
  return n;
};
const link = (text, url) => {
  const a = node("a", text);
  const safe = safePublicUrl(url);
  if (safe) {
    a.href = safe;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
};
const dateLabel = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? tr("unknown")
    : d.toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", {
        timeZoneName: "short",
      });
};
let controller = null,
  lastQuery = null,
  lastResult = null,
  lastLocale = null;

function localize() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document
    .querySelectorAll("[data-i18n]")
    .forEach((n) => (n.textContent = tr(n.dataset.i18n)));
  if (controller) render(controller.state);
}
function setInput(id, value) {
  const el = byId(id);
  if (document.activeElement !== el && el.value !== value) el.value = value;
}
function readProfile() {
  const list = (id) =>
    byId(id)
      .value.split(/[,，\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    topics: list("topics"),
    skills: list("skills"),
    modes: Array.from(byId("mode").selectedOptions).map((o) => o.value),
    location: byId("location").value.trim(),
    availability: byId("availability").value.trim(),
    constraints: byId("constraints")
      .value.split(/\n/)
      .map((x) => x.trim())
      .filter(Boolean),
  };
}
function factValue(f) {
  if (!f || f.value == null) return tr("unknown");
  if (typeof f.value === "object") return f.value.raw ?? tr("unknown");
  return String(f.value);
}
function evidenceDetails(o) {
  const details = node("details", null, "sources");
  details.append(node("summary", tr("sources")));
  for (const [key, fact] of [
    ["name", o.name],
    ["description", o.description],
    ["format", o.mode],
    ["place", o.location],
    ["deadline", o.deadline],
    ["registration", o.registration],
    ["eligibility", o.eligibility],
    ...(o.terms ?? []).map((t) => ["terms", t]),
  ]) {
    if (!fact?.evidence?.length) continue;
    for (const e of fact.evidence) {
      const row = node("div", null, "source-line");
      row.append(
        node("strong", tr(key)),
        node("p", e.quote),
        link(tr("viewSource"), e.url),
        node(
          "p",
          `${e.level} · ${tr("checked")}: ${dateLabel(e.fetchedAt)}`,
          "source-meta",
        ),
      );
      if (e.officialBasis)
        row.append(link(tr("organizerProof"), e.officialBasis));
      if (fact.uncertainty)
        row.append(node("p", fact.uncertainty, "source-meta"));
      details.append(row);
    }
  }
  return details;
}
function card(o, match = null) {
  const article = node("article", null, "opportunity");
  const verified = !!match;
  article.append(
    node("span", tr(verified ? "verified" : "unverified"), "badge"),
    node("h3", factValue(o.name)),
  );
  if (o.description?.value)
    article.append(node("p", o.description.value, "card-description"));
  if (match?.reasons?.length) {
    const reasons = node("ul", null, "reasons");
    match.reasons.forEach((r) => reasons.append(node("li", r)));
    article.append(reasons);
  }
  const dl = node("dl", null, "facts");
  for (const [label, fact] of [
    ["registration", o.registration],
    ["deadline", o.deadline],
    ["format", o.mode],
    ["place", o.location],
    ["eligibility", o.eligibility],
  ]) {
    dl.append(node("dt", tr(label)), node("dd", factValue(fact)));
  }
  article.append(dl);
  const warnings = [
    ...(match?.warnings ?? []),
    ...(o.terms ?? []).filter((f) => f.value).map((f) => String(f.value)),
  ];
  if (!verified) warnings.unshift(tr("unverifiedEvidence"));
  if (warnings.length) {
    const box = node("div", null, "warnings");
    box.append(node("strong", tr("terms")));
    const ul = node("ul");
    [...new Set(warnings)].forEach((w) => ul.append(node("li", w)));
    box.append(ul);
    article.append(box);
  }
  article.append(evidenceDetails(o));
  const actions = node("div", null, "card-actions");
  const url = o.name?.evidence?.[0]?.url;
  if (url) actions.append(link(tr("viewSource"), url));
  if (match) {
    const save = node("button", tr("save"), "secondary");
    save.type = "button";
    save.addEventListener("click", () => act(() => controller.bookmark(match)));
    actions.append(save);
  }
  article.append(
    actions,
    node("p", `${tr("checked")}: ${dateLabel(o.checkedAt)}`, "source-meta"),
  );
  return article;
}
function renderResults(result) {
  const box = byId("results");
  box.replaceChildren();
  if (!result) {
    const empty = node("div", null, "empty");
    empty.append(
      node("span", "✳", "empty-symbol"),
      node("h3", tr("emptyTitle")),
      node("p", tr("emptyText")),
    );
    box.append(empty);
    return;
  }
  if (!result.matches.length) {
    const empty = node("div", null, "empty");
    empty.append(node("h3", tr("noMatches")), node("p", tr("noMatchesHelp")));
    box.append(empty);
  }
  result.matches.forEach((m) => box.append(card(m.opportunity, m)));
  if (result.leads?.length) {
    box.append(node("h3", tr("leads")), node("p", tr("leadsHelp"), "hint"));
    result.leads.forEach((o) => box.append(card(o)));
  }
  if (result.incomplete) box.append(node("p", tr("partial"), "hint"));
  if (result.notices?.length) {
    const ul = node("ul", null, "notices");
    result.notices.forEach((n) => ul.append(node("li", n)));
    box.append(ul);
  }
  if (result.excluded?.length) {
    const d = node("details", null, "sources");
    d.append(
      node("summary", `${tr("exclusions")} (${result.excluded.length})`),
    );
    const ul = node("ul", null, "notices");
    result.excluded.forEach((e) => ul.append(node("li", e.reason)));
    d.append(ul);
    box.append(d);
  }
}
function render(state) {
  const p = state.draft;
  if (p) {
    setInput("topics", p.topics.join(", "));
    setInput("skills", p.skills.join(", "));
    if (document.activeElement !== byId("mode"))
      Array.from(byId("mode").options).forEach(
        (o) => (o.selected = p.modes.includes(o.value)),
      );
    setInput("location", p.location);
    setInput("availability", p.availability);
    setInput("constraints", p.constraints.join("\n"));
  }
  if (lastQuery !== state.query) {
    setInput("query", state.query);
    lastQuery = state.query;
  }
  byId("pending").hidden = !state.pendingEntry;
  byId("confirmed").textContent = tr(
    state.confirmed ? "confirmed" : "notConfirmed",
  );
  for (const id of [
    "draft",
    "confirm",
    "clear",
    "clear-yes",
    "apply-entry",
    "reload-saved",
  ]) {
    byId(id).disabled = state.busy || state.uncertain;
  }
  byId("search").disabled = !state.confirmed || state.busy || state.uncertain;
  byId("cancel").hidden = !state.busy;
  byId("error").hidden = !state.error;
  byId("error").textContent = state.error ?? "";
  byId("status").textContent = [
    state.uncertain ? tr("uncertain") : state.busy ? tr("busy") : "",
    state.notice,
  ]
    .filter(Boolean)
    .join("\n");
  byId("usage").textContent =
    state.observedCu == null
      ? tr("unknownCu")
      : `${tr("observedCu")}: ${Number(state.observedCu).toFixed(2)} CU`;
  if (lastResult !== state.result || lastLocale !== lang) {
    renderResults(state.result);
    lastResult = state.result;
    lastLocale = lang;
  }
  const bookmarks = byId("bookmarks");
  bookmarks.replaceChildren();
  if (!state.bookmarks?.length)
    bookmarks.append(node("p", tr("noSaved"), "hint"));
  for (const b of state.bookmarks ?? []) {
    const row = node("div", null, "saved-item");
    const content = node("div");
    content.append(
      link(b.name, b.url),
      node(
        "small",
        `${tr("checked")}: ${dateLabel(b.checkedAt)} · ${tr("savedAt")}: ${dateLabel(b.savedAt)}`,
      ),
    );
    const remove = node("button", tr("remove"), "text-button");
    remove.disabled = state.busy;
    remove.addEventListener("click", () =>
      act(() => controller.removeBookmark(b.id)),
    );
    row.append(content, remove);
    bookmarks.append(row);
  }
  const hasResults = !!state.result?.matches?.length;
  byId("summary").hidden = !hasResults;
  byId("summary-hint").hidden = !hasResults;
  byId("summary").disabled = state.busy;
}
async function act(fn) {
  if (!controller) return;
  try {
    await fn();
  } catch (error) {
    byId("error").hidden = false;
    byId("error").textContent = error?.message ?? String(error);
  }
}
function requireConsent(id, fn) {
  if (!byId(id).checked) {
    byId("error").hidden = false;
    byId("error").textContent = tr("consentNeeded");
    byId(id).focus();
    return;
  }
  act(fn);
}
localize();
for (const id of [
  "draft",
  "confirm",
  "search",
  "clear",
  "apply-entry",
  "reload-saved",
])
  byId(id).disabled = true;
try {
  const { AnnaAppRuntime } = await import(
    "/static/anna-apps/_sdk/latest/index.js"
  );
  const anna = await AnnaAppRuntime.connect();
  controller = createController(anna, render);
  byId("connection").textContent = tr("connected");
  if (anna.onThemeChange)
    anna.onThemeChange(({ theme }) => {
      if (theme === "light" || theme === "dark")
        document.documentElement.dataset.theme = theme;
    });
  if (anna.onLocaleChange)
    anna.onLocaleChange(({ lang: hostLang }) => {
      lang = String(hostLang).toLowerCase().startsWith("zh") ? "zh" : "en";
      localize();
      byId("connection").textContent = tr("connected");
    });
  for (const id of [
    "topics",
    "skills",
    "mode",
    "location",
    "availability",
    "constraints",
  ])
    byId(id).addEventListener("input", () =>
      act(() => controller.edit(readProfile())),
    );
  byId("query").addEventListener("input", () =>
    act(() => controller.setQuery(byId("query").value)),
  );
  byId("draft").addEventListener("click", () =>
    requireConsent("model-consent", () =>
      controller.draftFromText(byId("query").value, true),
    ),
  );
  byId("confirm").addEventListener("click", () =>
    act(async () => {
      controller.edit(normalizeProfile(readProfile()));
      await controller.confirm();
    }),
  );
  byId("search").addEventListener("click", () =>
    requireConsent("search-consent", () => controller.search(true)),
  );
  byId("cancel").addEventListener("click", () => controller.cancel());
  byId("apply-entry").addEventListener("click", () => {
    controller.applyPendingEntry();
    byId("query").focus();
  });
  byId("reload-saved").addEventListener("click", () =>
    act(() => controller.initialize()),
  );
  const hideClearConfirmation = () => {
    byId("clear-confirmation").hidden = true;
    byId("clear").focus();
  };
  byId("clear").addEventListener("click", () => {
    byId("clear-confirmation").hidden = false;
    byId("clear-no").focus();
  });
  byId("clear-no").addEventListener("click", hideClearConfirmation);
  byId("clear-confirmation").addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideClearConfirmation();
  });
  byId("clear-yes").addEventListener("click", () => {
    hideClearConfirmation();
    act(() => controller.clearPersonalData());
  });
  byId("summary").addEventListener("click", () =>
    act(() => controller.appendSummary()),
  );
  anna.on?.("entry_payload", (payload) => controller.receiveEntry(payload));
  anna.on?.("close", () => controller.dispose());
  window.addEventListener("beforeunload", () => controller.dispose());
  await controller.initialize();
  if (anna.entryPayload) controller.receiveEntry(anna.entryPayload);
  render(controller.state);
} catch {
  byId("connection").textContent = tr("connectionFailed");
}
