import type { InvestigationReport } from './verification-contracts'

export function reportFixture(): InvestigationReport {
  return {
    version: 1,
    mode: 'deep',
    status: 'complete',
    generated_at: '2026-10-25T05:00:00Z',
    plan: {
      mode: 'deep',
      steps: [
        {
          id: 'step-1',
          purpose: '查找官方资格要求',
          query: 'Example 比赛 学生资格',
          claim_ids: ['claim-1'],
        },
      ],
    },
    queries: [
      {
        id: 'query-1',
        step_id: 'step-1',
        round: 1,
        query: 'Example 比赛 学生资格',
        provider: 'yuanbao',
        status: 'success',
        executed_at: '2026-10-25T04:59:00Z',
        result_count: 2,
        error_code: null,
      },
    ],
    claims: [
      {
        id: 'claim-1',
        text: '只有大学生可以参加。',
        verdict: 'refuted',
        source_level: 'official',
        evidence_ids: ['evidence-1'],
        comparison: '官网明确接受所有年满十八岁的参赛者，不限在校身份。',
        limitations: [],
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        title: 'Example 官方参赛规则',
        url: 'https://example.org/rules',
        excerpt: '所有年满十八岁的参赛者均可报名。',
        content_hash: 'sha256:example',
        retrieved_at: '2026-10-25T04:59:30Z',
        evidence_kind: 'fetched_page',
        provider: 'yuanbao',
        query_ids: ['query-1'],
        source_level: 'official',
        source_lineage: 'https://example.org',
        historical: false,
      },
    ],
    limitations: [],
  }
}
