import test from "node:test";
import assert from "node:assert/strict";
import {
  TRUSTED_SOURCES,
  isTrustedSourceUrl,
  trustedSourceFor,
} from "../src/sources.ts";
import { matchCandidates, validateCandidates } from "../src/domain.ts";
import { NOW, liveFixture, profile, raw } from "./fixtures/domain.mjs";

const imagineCup = "https://imaginecup.microsoft.com/en-us";
const gems =
  "https://www.drivendata.org/competitions/306/competition-doe-gems/";
const stanford = "https://longevity.stanford.edu/design-challenge/";
const additions = [
  {
    entryUrl: imagineCup,
    hostname: "imaginecup.microsoft.com",
    pathPrefix: "/en-us",
    organizer: "Microsoft for Startups",
    basisUrl:
      "https://www.microsoft.com/en-us/startups/blog/imagine-cup-2027-why-this-is-an-opportunity-for-early-stage-founders/",
  },
  {
    entryUrl: gems,
    hostname: "www.drivendata.org",
    pathPrefix: "/competitions/306/competition-doe-gems",
    organizer:
      "U.S. Department of Energy, Office of Geothermal; competition hosted by DrivenData",
    basisUrl:
      "https://www.energy.gov/hgeo/geothermal/articles/office-geothermal-announces-geologic-enhanced-mapping-system-gems-prize",
  },
];

test("the registry adds exactly two independently linked event identities and no fact fields", () => {
  assert.deepEqual(
    TRUSTED_SOURCES.map((source) => source.entryUrl),
    [
      "https://crash-this.github.io/",
      "https://eisociety.org/hackathon.php?slug=next-horizon-2026",
      "https://landing.mobileworldcapital.com/more-than-a-hack-2027",
      imagineCup,
      gems,
    ],
  );
  for (const expected of additions)
    assert.deepEqual(trustedSourceFor(expected.entryUrl), expected);
  for (const source of TRUSTED_SOURCES)
    assert.deepEqual(Object.keys(source).sort(), [
      "basisUrl",
      "entryUrl",
      "hostname",
      "organizer",
      "pathPrefix",
    ]);
});

test("Imagine Cup trusts only its en-us event subtree, including FAQ children", () => {
  for (const url of [
    imagineCup,
    `${imagineCup}/`,
    `${imagineCup}/Support/FAQ`,
    `${imagineCup}/Support/FAQ/`,
    `${imagineCup}/Support/FAQ#eligibility`,
    `${imagineCup}/Support/FAQ?view=all`,
  ]) {
    assert.equal(trustedSourceFor(url)?.entryUrl, imagineCup, url);
    assert.equal(isTrustedSourceUrl(url), true, url);
  }
  for (const url of [
    "https://imaginecup.microsoft.com/",
    "https://imaginecup.microsoft.com/en-gb",
    "https://imaginecup.microsoft.com/zh-cn/Support/FAQ",
    "https://imaginecup.microsoft.com/en-us-other",
    "https://imaginecup.microsoft.com/en-us-other/Support/FAQ",
    "https://imaginecup.microsoft.com/en-us/../another-contest",
    "https://imaginecup.microsoft.com/en-us%2fSupport/FAQ",
    "https://www.microsoft.com/en-us",
    "https://learn.microsoft.com/en-us",
    "https://imaginecup.microsoft.com.evil.example/en-us",
    additions[0].basisUrl,
  ]) {
    assert.equal(trustedSourceFor(url), null, url);
    assert.equal(isTrustedSourceUrl(url), false, url);
  }
});

test("DOE GEMS trusts its exact event path and children, not other DrivenData contests", () => {
  for (const url of [
    gems,
    gems.slice(0, -1),
    `${gems}rules/`,
    `${gems}data/`,
    `${gems}#overview`,
    `${gems}?view=overview`,
  ]) {
    assert.equal(trustedSourceFor(url)?.entryUrl, gems, url);
    assert.equal(isTrustedSourceUrl(url), true, url);
  }
  for (const url of [
    "https://www.drivendata.org/",
    "https://www.drivendata.org/competitions/",
    "https://www.drivendata.org/competitions/306/",
    "https://www.drivendata.org/competitions/306/another-contest/",
    "https://www.drivendata.org/competitions/307/competition-doe-gems/",
    "https://www.drivendata.org/competitions/306/competition-doe-gems-other/",
    "https://www.drivendata.org/competitions/306/competition-doe-gems%2frules/",
    `${gems}../another-contest/`,
    "https://drivendata.org/competitions/306/competition-doe-gems/",
    "https://www.drivendata.org.evil.example/competitions/306/competition-doe-gems/",
    additions[1].basisUrl,
  ]) {
    assert.equal(trustedSourceFor(url), null, url);
    assert.equal(isTrustedSourceUrl(url), false, url);
  }
});

test("new identities retain HTTPS, host, port and credential boundaries", () => {
  for (const entry of [imagineCup, gems]) {
    const parsed = new URL(entry);
    for (const url of [
      entry.replace("https:", "http:"),
      `https://user:password@${parsed.hostname}${parsed.pathname}`,
      `https://${parsed.hostname}:8443${parsed.pathname}`,
      `https://${parsed.hostname}.${parsed.pathname}`,
      `https://other.example${parsed.pathname}`,
    ])
      assert.equal(trustedSourceFor(url), null, url);
  }
});

test("encoded and double-encoded paths cannot escape registered event scopes", () => {
  const urls = [
    `${imagineCup}/%2e%2e%2Fzh-cn`,
    `${gems}%2e%2e%2f%2e%2e%2f307/other/`,
    `${imagineCup}/%252e%252e%252Fzh-cn`,
    `${gems}%252e%252e%252f%252e%252e%252f307/other/`,
  ];
  for (const source of TRUSTED_SOURCES) {
    for (const suffix of [
      "%2fother",
      "%2Fother",
      "%5cother",
      "%5Cother",
      "%252fother",
      "%255cother",
      "%2e%2e%5cother",
      "%252e%252e%255cother",
      "rules%20copy",
      "%72ules",
    ]) {
      const url = new URL(source.entryUrl);
      url.pathname = `${url.pathname.replace(/\/$/, "")}/${suffix}`;
      urls.push(url.href);
    }
  }
  for (const url of urls) {
    assert.equal(trustedSourceFor(url), null, url);
    assert.equal(isTrustedSourceUrl(url), false, url);
  }
});

test("path encoding rejection preserves allowed query and fragment semantics", () => {
  for (const source of TRUSTED_SOURCES) {
    const url = new URL(source.entryUrl);
    url.hash = "%2e%2e%2f%252f";
    assert.equal(trustedSourceFor(url.href)?.entryUrl, source.entryUrl);
    if (!url.search) {
      url.search = "?redirect=%2e%2e%2f%252f";
      assert.equal(trustedSourceFor(url.href)?.entryUrl, source.entryUrl);
    }
  }
  assert.equal(
    trustedSourceFor(
      "https://eisociety.org/hackathon.php?slug=next%2Dhorizon%2D2026",
    ),
    null,
  );
});

test("EIS requires the complete unique slug in its exact query scope", () => {
  const entry = "https://eisociety.org/hackathon.php?slug=next-horizon-2026";
  assert.equal(trustedSourceFor(entry)?.entryUrl, entry);
  assert.equal(isTrustedSourceUrl(entry), true);
  for (const query of [
    "slug=next-horizon-2026&slug=next-horizon-2026",
    "slug=next-horizon-2026&slug=another-event",
    "slug=another-event&slug=next-horizon-2026",
    "slug=next-horizon-2026-other",
    "slug=other-next-horizon-2026",
    "slug=next%2Dhorizon%2D2026",
    "slug=%6eext-horizon-2026",
    "slug=next%252Dhorizon%252D2026",
    "%73lug=next-horizon-2026",
    "slug=next-horizon-2026%26slug=another-event",
    "slug=another-event%26slug=next-horizon-2026",
    "slug=next-horizon-2026%2526slug=another-event",
    "slug=next-horizon-2026%26slug%3Dnext-horizon-2026",
    "slug=another-event",
  ]) {
    const url = `https://eisociety.org/hackathon.php?${query}`;
    assert.equal(trustedSourceFor(url), null, url);
    assert.equal(isTrustedSourceUrl(url), false, url);
  }
});

test("Stanford's mixed-year source stays outside the registry and remains an unverified lead", () => {
  for (const url of [
    stanford,
    `${stanford}rules/`,
    "https://longevity.stanford.edu/design-challenge-human-centered-robotics/",
    "https://longevity.stanford.edu/",
  ])
    assert.equal(trustedSourceFor(url), null, url);
  const fixture = liveFixture({ url: stanford });
  const [lead] = validateCandidates(
    raw(fixture.candidate),
    [fixture.page],
    NOW,
  );
  assert.equal(lead.name.level, "unverified");
  assert.equal(lead.name.evidence[0].officialBasis, null);
  const result = matchCandidates([lead], profile(), NOW);
  assert.equal(result.matches.length, 0);
  assert.deepEqual(result.leads, [lead]);
});

test("new source identities cannot fill missing live status, dates or eligibility", () => {
  for (const source of additions) {
    // Entirely synthetic page, not current facts about either named event.
    const fixture = liveFixture({ url: source.entryUrl });
    fixture.page.content = fixture.candidate.name.value;
    const [event] = validateCandidates(
      raw(fixture.candidate),
      [fixture.page],
      NOW,
    );
    assert.equal(event.name.level, "official");
    assert.equal(event.name.evidence[0].officialBasis, source.basisUrl);
    assert.equal(event.registration.value, null);
    assert.equal(event.deadline.value, null);
    assert.equal(event.eligibility.value, null);
    assert.equal(matchCandidates([event], profile(), NOW).matches.length, 0);
  }
});

test("runtime participation requirements remain sourced self-check warnings, never assumed eligibility", () => {
  for (const source of additions) {
    // These requirements are synthetic test input, not claims about either event.
    const eligibility =
      "Synthetic requirement: student status, a qualifying company, Azure usage and a U.S. entity must be checked.";
    const fixture = liveFixture({ url: source.entryUrl, eligibility });
    const [event] = validateCandidates(
      raw(fixture.candidate),
      [fixture.page],
      NOW,
    );
    assert.equal(event.eligibility.value, eligibility);
    assert.equal(event.eligibility.evidence[0].quote, eligibility);
    const result = matchCandidates([event], profile(), NOW);
    assert.equal(result.matches.length, 1);
    assert.ok(
      result.matches[0].warnings.includes(
        `Eligibility needs self-check: ${eligibility}`,
      ),
    );
    assert.equal(
      matchCandidates(
        [event],
        profile({ constraints: ["I must qualify without a company"] }),
        NOW,
      ).matches.length,
      0,
    );
  }
});
