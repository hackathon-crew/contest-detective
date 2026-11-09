import type {
  ConfirmedProfile,
  Match,
  Opportunity,
  ProfileDraft,
  RunBudget,
  SavedState,
  SearchResult,
  SourcePage,
} from "./contracts.js";

/** Only these calls are needed. No credentials, local-device tools or cross-app scope. */
export interface AnnaHost {
  complete(
    request: {
      messages: {
        role: "user" | "system";
        content: { type: "text"; text: string };
      }[];
      maxTokens: number;
      thinking: false;
    },
    options?: { timeoutMs: number },
  ): Promise<unknown>;
  search(request: {
    query: string;
    max_results: number;
    search_depth: "basic";
  }): Promise<unknown>;
  fetch(
    request: {
      urls: string[];
      format: "text";
      max_chars: number;
      timeout_ms: number;
    },
    options?: { timeoutMs: number },
  ): Promise<unknown>;
  storageGet(request: { key: string; scope: "app" }): Promise<unknown>;
  storageSet(request: {
    key: string;
    scope: "app";
    value: SavedState;
    if_match?: string;
  }): Promise<unknown>;
  storageDelete(request: {
    key: string;
    scope: "app";
    if_match?: string;
  }): Promise<unknown>;
}
export interface ProfileInterpreter {
  draft(text: string): Promise<ProfileDraft>;
}
export interface OpportunityDiscovery {
  discover(
    profile: ConfirmedProfile,
    budget: RunBudget,
    signal: AbortSignal,
  ): Promise<{ raw: unknown; pages: SourcePage[]; observedCu: number | null }>;
}
export interface EvidenceValidator {
  validate(raw: unknown, pages: SourcePage[], now: Date): Opportunity[];
}
export interface Matcher {
  match(
    opportunities: Opportunity[],
    profile: ConfirmedProfile,
    now: Date,
  ): {
    matches: Match[];
    leads: Opportunity[];
    excluded: SearchResult["excluded"];
  };
}
export interface PersonalStore {
  load(): Promise<{ value: SavedState | null; etag?: string }>;
  save(value: SavedState, etag?: string): Promise<{ etag?: string }>;
  clear(etag?: string): Promise<void>;
}
export interface AnnaEntryPayload {
  query?: string;
}
export interface AppController {
  initialize(): Promise<void>;
  receiveEntry(payload: unknown): void;
  applyPendingEntry(): void;
  setQuery(text: string): void;
  draftFromText(text: string, consent: boolean): Promise<void>;
  edit(profile: ProfileDraft): void;
  confirm(): Promise<void>;
  search(consent: boolean): Promise<SearchResult | null>;
  cancel(): void;
  bookmark(match: Match): Promise<void>;
  removeBookmark(id: string): Promise<void>;
  clearPersonalData(): Promise<void>;
  appendSummary(): Promise<void>;
  dispose(): void;
}
