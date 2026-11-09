export const NOW = new Date("2026-11-09T12:00:00.000Z");
export const URLS = {
  crash: "https://crash-this.github.io/",
  eis: "https://eisociety.org/hackathon.php?slug=next-horizon-2026",
  mobile: "https://landing.mobileworldcapital.com/more-than-a-hack-2027",
};
export function profile(overrides = {}) {
  return {
    profile: {
      topics: ["AI"],
      skills: ["Python"],
      modes: ["online"],
      location: "",
      availability: "",
      constraints: [],
      ...overrides,
    },
    revision: "fixture-revision",
    confirmedAt: NOW.toISOString(),
  };
}
// Entirely synthetic test text. These are not assertions about the named organizers.
export function fixture({
  url = URLS.crash,
  name = "Synthetic AI Challenge",
  description = "Build an AI prototype with Python.",
  mode = "online",
  deadline = "10 November 2026, 23:59 CET",
  registration = "Registration is open.",
  eligibility = "Adults worldwide may participate.",
  terms = [],
  provenance = "fixture",
  fetchedAt = NOW.toISOString(),
  page = 0,
} = {}) {
  const modeLine =
    mode === "online"
      ? "Attendance: online."
      : mode === "offline"
        ? "Attendance: in-person."
        : "Attendance: hybrid.";
  const deadlineLine = `Registration deadline: ${deadline}.`;
  const location = "Graz, Austria";
  const fact = (value, quote = value) => ({
    value,
    evidence: [{ page, quote }],
  });
  const candidate = {
    url,
    name: fact(name),
    description: fact(description),
    mode: fact(mode, modeLine),
    location: fact(location),
    deadline: { ...fact(deadline, deadlineLine), kind: "registration" },
    registration: fact(
      registration.includes("closed") ? "closed" : "open",
      registration,
    ),
    eligibility: fact(eligibility),
    terms: terms.map((value) => fact(value)),
  };
  return {
    candidate,
    page: {
      url,
      finalUrl: url,
      fetchedAt,
      content: [
        name,
        description,
        modeLine,
        location,
        deadlineLine,
        registration,
        eligibility,
        ...terms,
      ].join("\n"),
      truncated: false,
      provenance,
    },
  };
}
export function liveFixture(options = {}) {
  return fixture({ ...options, provenance: "live" });
}
export function raw(...candidates) {
  return { opportunities: candidates };
}
export function reply(value, stopReason = "endTurn") {
  return { content: { type: "text", text: JSON.stringify(value) }, stopReason };
}
