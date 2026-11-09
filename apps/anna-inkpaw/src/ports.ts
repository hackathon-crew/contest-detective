import type { ConfirmedProfile, Match, Opportunity, ProfileDraft, RunBudget, SavedState, SearchResult, SourcePage } from "./contracts.js";

/** Only these calls are needed. No credentials, local-device tools or cross-app scope. */
export interface AnnaHost {
  complete(request: { messages: { role: "user" | "system"; content: { type: "text"; text: string } }[]; maxTokens: number; thinking: false }, options?: { timeoutMs: number }): Promise<unknown>;
  search(request: { query: string; max_results: number; search_depth: "basic" }): Promise<unknown>;
  fetch(request: { urls: string[]; format: "text"; max_chars: number; timeout_ms: number }, options?: { timeoutMs: number }): Promise<unknown>;
  storageGet(request: { key: string; scope: "app" }): Promise<unknown>;
  storageSet(request: { key: string; scope: "app"; value: SavedState; if_match?: string }): Promise<unknown>;
  storageDelete(request: { key: string; scope: "app"; if_match?: string }): Promise<unknown>;
}
export interface ProfileInterpreter { draft(text: string): Promise<ProfileDraft> }
export interface OpportunityDiscovery { discover(profile: ConfirmedProfile, budget: RunBudget, signal: AbortSignal): Promise<{ raw: unknown; pages: SourcePage[]; observedCu: number | null }> }
export interface EvidenceValidator { validate(raw: unknown, pages: SourcePage[], now: Date): Opportunity[] }
export interface Matcher { match(opportunities: Opportunity[], profile: ConfirmedProfile, now: Date): { matches: Match[]; excluded: SearchResult["excluded"] } }
export interface PersonalStore {
  load(): Promise<{ value: SavedState | null; etag?: string }>;
  save(value: SavedState, etag?: string): Promise<{ etag?: string }>;
  clear(etag?: string): Promise<void>;
}
export interface AnnaEntryPayload { query?: string }
export interface AppController {
  receiveEntry(payload: AnnaEntryPayload): void;
  draft(text: string): Promise<void>;
  edit(profile: ProfileDraft): void;
  confirm(): Promise<void>;
  search(): Promise<SearchResult>;
  cancel(): void;
  clearPersonalData(): Promise<void>;
}
