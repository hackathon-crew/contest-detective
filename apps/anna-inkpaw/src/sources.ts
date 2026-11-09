/** Organizer identity only. This registry contains no event dates or eligibility. */
export interface TrustedSource {
  readonly entryUrl: string;
  readonly hostname: string;
  readonly pathPrefix: string;
  readonly organizer: string;
  readonly basisUrl: string;
}

export const TRUSTED_SOURCES: readonly TrustedSource[] = Object.freeze([
  {
    entryUrl: "https://crash-this.github.io/",
    hostname: "crash-this.github.io",
    pathPrefix: "/",
    organizer: "CRASH organizing team",
    basisUrl:
      "https://www.uni-graz.at/de/veranstaltungen/crash-the-cultural-heritage-advanced-search-hackathon-1/",
  },
  {
    entryUrl: "https://eisociety.org/hackathon.php?slug=next-horizon-2026",
    hostname: "eisociety.org",
    pathPrefix: "/hackathon.php",
    organizer: "International Enterprise & Innovation Society",
    basisUrl: "https://eisociety.org/hackathon.php?slug=next-horizon-2026",
  },
  {
    entryUrl: "https://landing.mobileworldcapital.com/more-than-a-hack-2027",
    hostname: "landing.mobileworldcapital.com",
    pathPrefix: "/more-than-a-hack-2027",
    organizer: "Mobile World Capital",
    basisUrl: "https://landing.mobileworldcapital.com/more-than-a-hack-2027",
  },
]);

/** Exact organizer/event scope: redirects do not expand the approved registry. */
export function trustedSourceFor(url: string): TrustedSource | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  )
    return null;
  return (
    TRUSTED_SOURCES.find((source) => {
      if (parsed.hostname !== source.hostname) return false;
      const entry = new URL(source.entryUrl);
      if (entry.search)
        return (
          parsed.pathname === entry.pathname && parsed.search === entry.search
        );
      return (
        parsed.pathname === source.pathPrefix ||
        parsed.pathname.startsWith(
          source.pathPrefix.endsWith("/")
            ? source.pathPrefix
            : `${source.pathPrefix}/`,
        )
      );
    }) ?? null
  );
}

export function isTrustedSourceUrl(url: string): boolean {
  return trustedSourceFor(url) !== null;
}
