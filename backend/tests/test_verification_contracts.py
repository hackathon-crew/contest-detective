import pytest
from pydantic import ValidationError

from contest_detective.agent.verification_contracts import (
    ClaimAssessment, ConfirmedClaim, InvestigationReport, VerificationRequestFields,
)
from contest_detective.research.contracts import SearchExecution


def test_omitted_mode_preserves_legacy_selection_without_enabling_new_behavior():
    request = VerificationRequestFields()
    assert request.mode is None and request.confirmed_claims == []


@pytest.mark.parametrize('mode', ['database', 'realtime', 'deep'])
def test_explicit_modes_round_trip(mode):
    request = VerificationRequestFields(mode=mode, confirmed_claims=[
        ConfirmedClaim(id='c1', text='作品提交截至 10 月 25 日', origin='screenshot'),
    ])
    assert VerificationRequestFields.model_validate_json(request.model_dump_json()) == request


@pytest.mark.parametrize('value', [
    {'mode': 'automatic'},
    {'confirmed_claims': [{'id': 'c1', 'text': '说法', 'origin': 'video_frame'}]},
    {'confirmed_claims': [{'id': 'c1', 'text': '', 'origin': 'screenshot'}]},
])
def test_invalid_modes_and_unsupported_claim_inputs_are_rejected(value):
    with pytest.raises(ValidationError):
        VerificationRequestFields.model_validate(value)


def test_official_evidence_can_refute_a_claim_without_becoming_a_truth_label():
    claim = ClaimAssessment(id='c1', text='报名在 16:00 截止', verdict='refuted',
                            source_level='official', evidence_ids=['e1'],
                            comparison='原文 16:00 指作品提交，报名没有该时刻。')
    assert claim.verdict == 'refuted' and claim.source_level == 'official'
    with pytest.raises(ValidationError):
        ClaimAssessment.model_validate(claim.model_dump() | {'verdict': 'official'})


def test_search_execution_and_incomplete_report_round_trip():
    query = SearchExecution(id='q1', step_id='s1', round=1, query='黑客松 官方规则',
                            provider='yuanbao', status='success',
                            executed_at='2026-10-25T05:00:00Z', result_count=0)
    report = InvestigationReport(mode='deep', status='incomplete',
                                  generated_at='2026-10-25T05:00:01Z', queries=[query],
                                  limitations=['尚无证据，执行成功不是事实已核实。'])
    assert InvestigationReport.model_validate_json(report.model_dump_json()) == report
    assert report.status == 'incomplete' and report.evidence == []


@pytest.mark.parametrize('override', [{'round': 0}, {'result_count': -1}, {'status': 'verified'}])
def test_execution_receipt_rejects_invalid_state(override):
    fields = dict(id='q1', step_id='s1', round=1, query='比赛', provider='yuanbao',
                  status='success', executed_at='2026-10-25T05:00:00Z', result_count=0)
    with pytest.raises(ValidationError):
        SearchExecution.model_validate(fields | override)


def test_report_builder_accepts_only_reportable_modes():
    from typing import get_type_hints
    from contest_detective.agent.verification_contracts import EvidenceReportBuilder, LiveVerificationMode
    assert get_type_hints(EvidenceReportBuilder.build)["mode"] == LiveVerificationMode
