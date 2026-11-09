import type { AppController, EvidenceValidator, Matcher, OpportunityDiscovery, PersonalStore, ProfileInterpreter } from "./ports.js";

/** Factory signature only: no side effects and no hidden fallback implementation. */
export function createApp(_ports: {
  interpreter: ProfileInterpreter;
  discovery: OpportunityDiscovery;
  validator: EvidenceValidator;
  matcher: Matcher;
  store: PersonalStore;
}): AppController {
  throw new Error("Anna app implementation is not available in the architecture skeleton.");
}
