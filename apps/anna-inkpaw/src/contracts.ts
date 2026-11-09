/** Domain data only. Product behavior is added after the skeleton merges. */
export type Mode = "online" | "offline" | "hybrid";
export type Verification = "official" | "reposted" | "conflict" | "unverified";
export interface ProfileDraft {
  topics: string[];
  skills: string[];
  modes: Mode[];
  location: string;
  availability: string;
  constraints: string[];
}
export interface ConfirmedProfile {
  profile: ProfileDraft;
  revision: string;
  confirmedAt: string;
}
export interface SourcePage {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  content: string;
  truncated: boolean;
  provenance: "live" | "fixture";
}
export interface Evidence {
  url: string;
  fetchedAt: string;
  quote: string;
  level: Verification;
  /** Host/domain alone is not proof; retain the organizer relationship evidence. */
  officialBasis: string | null;
}
export interface SourcedFact<T = string> {
  value: T | null;
  evidence: Evidence[];
  level: Verification;
  uncertainty: string | null;
}
export type Deadline =
  | { precision: "instant"; value: string; raw: string }
  | { precision: "day"; value: string; raw: string; timezone: string | null }
  | { precision: "text"; value: null; raw: string };
export interface Opportunity {
  id: string;
  name: SourcedFact;
  description: SourcedFact;
  mode: SourcedFact<Mode>;
  location: SourcedFact;
  deadline: SourcedFact<Deadline>;
  registration: SourcedFact<"open" | "closed" | "unknown">;
  eligibility: SourcedFact;
  terms: SourcedFact[];
  checkedAt: string;
  provenance: "live" | "fixture";
}
export interface Match {
  opportunity: Opportunity;
  score: number;
  reasons: string[];
  warnings: string[];
}
export interface SearchResult {
  matches: Match[];
  /** Quoted public leads with unverified organizer identity, not verified matches. */
  leads: Opportunity[];
  excluded: { id: string; reason: string }[];
  incomplete: boolean;
  notices: string[];
  /** null means unknown, never substitute zero. */
  observedCu: number | null;
  checkedAt: string;
}
export type RunPhase =
  | "idle"
  | "profiling"
  | "reviewing"
  | "searching"
  | "results"
  | "cancelled"
  | "failed";
export interface RunState {
  phase: RunPhase;
  revision: number;
  draft: ProfileDraft | null;
  confirmed: ConfirmedProfile | null;
  result: SearchResult | null;
  error: string | null;
}
export interface RunBudget {
  profileLlmCalls: 1;
  searchCalls: 2;
  fetchUrls: 8;
  extractionLlmCalls: 1;
  searchDepth: "basic";
}
export interface Bookmark {
  id: string;
  name: string;
  url: string;
  savedAt: string;
  /** A bookmark is a dated snapshot, not a claim that registration remains open. */
  checkedAt: string;
}
export interface SavedState {
  version: 1;
  confirmedProfile: ConfirmedProfile | null;
  bookmarks: Bookmark[];
}
