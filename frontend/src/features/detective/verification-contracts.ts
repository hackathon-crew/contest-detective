/** Explicit modes are opt-in; omitted/null retains the ordinary mixed workflow. */
export type VerificationMode = 'database' | 'realtime' | 'deep'
export type LiveVerificationMode = 'realtime' | 'deep'

export interface ConfirmedClaim {
  id: string
  text: string
  origin: 'user' | 'screenshot'
}

export interface VerificationOptions {
  mode?: VerificationMode | null
  confirmed_claims?: ConfirmedClaim[]
}

export interface InvestigationPlan {
  mode: LiveVerificationMode
  steps: { id: string; purpose: string; query: string; claim_ids: string[] }[]
}

/** These receipts are supplied by execution, never accepted from model output. */
export interface SearchExecution {
  id: string
  step_id: string
  round: number
  query: string
  provider: string
  status: 'success' | 'failure'
  executed_at: string
  result_count: number
  error_code: string | null
}

export type SourceLevel = 'official' | 'reposted' | 'conflict' | 'not_found'

export interface ReportEvidence {
  id: string
  title: string
  url: string
  excerpt: string
  content_hash: string | null
  retrieved_at: string | null
  evidence_kind: 'search_snippet' | 'fetched_page' | 'database_record'
  provider: string | null
  query_ids: string[]
  source_level: SourceLevel
  source_lineage: string | null
  historical: boolean
}

export interface ClaimAssessment {
  id: string
  text: string
  verdict: 'supported' | 'refuted' | 'conflicting' | 'insufficient'
  source_level: SourceLevel
  evidence_ids: string[]
  comparison: string
  limitations: string[]
}

export interface InvestigationReport {
  version: 1
  mode: LiveVerificationMode
  status: 'complete' | 'incomplete' | 'blocked'
  generated_at: string
  plan: InvestigationPlan | null
  queries: SearchExecution[]
  claims: ClaimAssessment[]
  evidence: ReportEvidence[]
  limitations: string[]
}
