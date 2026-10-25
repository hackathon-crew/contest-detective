"""Offline regressions for the observed date/answer precision mismatch."""
import copy

import pytest

from contest_detective.server.agent.answer_grounding import check_answer_precision
from contest_detective.server.contest.schemas import ContestSummary


def contest(key, name, value, *, precision='day', field='submission_deadline'):
    url = f'https://{key}.example/'
    return {
        'id': key, 'name': name, 'cover_url': None, 'status': 'upcoming',
        'fields': {field: {'value': value, 'precision': precision, 'level': 'official',
            'sources': [{'url': url, 'site': key, 'title': name, 'is_official': True,
                         'value': value, 'precision': precision, 'excerpt': '公开截止日期'}]}},
    }


@pytest.fixture
def observed():
    return {
        'codex': contest('codex', 'Codex x TwitchCon Hackathon', '2026-11-02T00:00:00Z'),
        'paypal': contest('paypal', 'PayPal AI Hackathon', '2026-11-12T00:00:00Z'),
        'ugreen': contest('ugreen', 'UGREEN Hackathon 2026 on AI NAS',
                          '2026-11-16T07:45:00Z', precision='datetime'),
    }


@pytest.mark.parametrize('claim', [
    '作品提交截止：2026 年 11 月 2 日 14:00 PST',
    '作品提交截止：2026-11-02T17:00:00-05:00',
    '作品提交截止：2026-11-02T00:00:00Z',
    'Submission deadline: November 2, 2026 at 2:00 PM PST.',
    '作品提交截止：11月2日下午2点。',
    '作品提交截止：2026.11.02 14:00 PST。',
    '作品提交截止：11月2号14:00 PST。',
    'Submit by November 2, 2026 at 2 PM PST.',
    '作品提交截止：2026-11-03（时刻未核实）。',
    '报名截止：2026-11-02。',
])
def test_day_evidence_rejects_added_precision_wrong_date_or_wrong_kind(observed, claim):
    errors = check_answer_precision('Codex x TwitchCon Hackathon\n' + claim, observed, {})
    assert errors and 'Codex' in errors[0]


def test_saved_query_one_pattern_rejects_only_unsupported_contests(observed):
    answer = '''1. Codex x TwitchCon Hackathon
报名截止：未找到
作品提交截止：2026 年 11 月 2 日 14:00 PST（对应 ISO 时间 2026-11-02T17:00:00-05:00）
2. PayPal AI Hackathon
报名截止：未找到
作品提交截止：2026 年 11 月 12 日 12:00 PST（对应 ISO 时间 2026-11-12T15:00:00-05:00）
3. UGREEN Hackathon 2026 on AI NAS
报名截止：未找到
作品提交截止：2026 年 11 月 15 日 23:45 PST（对应 UTC 时间 2026-11-16T07:45:00Z）'''
    errors = check_answer_precision(answer, observed, {})
    assert any('Codex' in error for error in errors)
    assert any('PayPal' in error for error in errors)
    assert not any('UGREEN' in error for error in errors)


@pytest.mark.parametrize('claim', [
    '作品提交截止：2026 年 11 月 15 日 23:45 PST。',
    '作品提交截止：2026-11-16T07:45:00Z。',
    '作品提交截止：2026-11-16 15:45（北京时间）。',
    '作品提交截止：2026-11-16 15:45。',
    'Submission deadline: Nov 15, 2026 at 11:45pm PST.',
    '作品提交截止：11月16日15点45分。',
])
def test_precise_source_supports_equivalent_timezones_and_existing_beijing_display(observed, claim):
    assert check_answer_precision('UGREEN\n' + claim, observed, {}) == []


def test_contest_acronyms_are_not_mistaken_for_timezone_prefixes(observed):
    answer = 'UGREEN Hackathon 2026 on AI NAS 作品提交截止2026-11-16 15:45。'
    assert check_answer_precision(answer, observed, {}) == []


@pytest.mark.parametrize('claim', [
    '作品提交截止：2026-11-16 07:45 PST。',
    '作品提交截止：2026-11-16 07:45 CST。',
    '作品提交截止：2026-11-16 15:45 JST。',
    '作品提交截止：2026-11-16 15:45 PT。',
    '作品提交截止：2026-11-16T07:46:00Z。',
    '作品提交截止：2027-11-16T07:45:00Z。',
    '报名截止：2026-11-16T07:45:00Z。',
])
def test_wrong_zone_clock_year_and_deadline_kind_are_not_grounded(observed, claim):
    assert check_answer_precision('UGREEN\n' + claim, observed, {})


def test_time_belonging_to_another_contest_cannot_authorize_answer(observed):
    assert check_answer_precision('PayPal AI Hackathon\n提交截止：2026-11-16T07:45:00Z。', observed, {})


def test_ambiguous_multi_contest_assertion_cannot_choose_convenient_evidence(observed):
    assert check_answer_precision('PayPal 和 UGREEN 的作品提交截止都是2026-11-16T07:45:00Z。', observed, {})


@pytest.mark.parametrize('answer', [
    'Codex\n作品提交截止：2026-11-02，时刻未核实。报名截止未找到。',
    'Codex\n作品提交截止为11月2日；16:00是否为报名截止，目前无法确认。',
    'Codex\n你问“11月2日14:00是否报名截止？”目前没有证据。',
    'Codex\n报名截止“2026-11-02 14:00 PST”尚未核实。',
    'Codex\n报名截止未知，不应假定与作品提交截止同步。',
    '按北京时间2026-10-24计算，明天是10月25日。\nCodex\n作品提交截止：11月2日。',
])
def test_uncertain_questions_and_non_deadline_dates_are_not_false_positives(observed, answer):
    assert check_answer_precision(answer, observed, {}) == []


def test_uncertainty_about_one_field_does_not_exempt_other_claims(observed):
    answer = 'Codex\n报名截止未找到，作品提交截止2026-11-02 14:00 PST。'
    assert check_answer_precision(answer, observed, {})


def test_mixed_kinds_with_uncertainty_do_not_silently_exempt_other_assertions(observed):
    assert check_answer_precision('Codex\n报名截止未找到 / 作品提交截止2026-11-02 14:00 PST。', observed, {})


def test_minute_expression_does_not_invent_source_seconds():
    observed = {'event': contest('event', 'Clock Contest', '2026-11-02T15:59:59Z', precision='datetime')}
    assert check_answer_precision('作品提交截止2026-11-02 23:59。', observed, {}) == []
    assert check_answer_precision('作品提交截止2026-11-02 23:59:00。', observed, {})


def test_time_uncertainty_does_not_exempt_wrong_day(observed):
    assert check_answer_precision('Codex\n作品提交截止2026-11-03（时刻未核实）。', observed, {})


def test_correct_date_but_time_uncertain_is_allowed(observed):
    assert check_answer_precision('Codex\n作品提交截止2026-11-02（时刻未核实）。', observed, {}) == []


def test_deadline_context_does_not_leak_into_next_non_deadline_sentence(observed):
    assert check_answer_precision('Codex\n作品提交截止2026-11-02。今天是2026-10-25。', observed, {}) == []


def test_date_in_link_target_is_not_an_asserted_deadline(observed):
    answer = 'Codex\n作品提交截止[11月2日](https://codex.example/archive/2025-10-01/12:30)，时刻未核实。'
    assert check_answer_precision(answer, observed, {}) == []


def test_missing_contest_does_not_silently_skip_concrete_deadline_claim():
    assert check_answer_precision('作品提交截止2026-11-02 14:00 PST。', {}, {})


def test_single_observed_contest_keeps_legacy_unheaded_answer_supported(observed):
    assert check_answer_precision('作品提交截止为2026-11-16 15:45。', {'ugreen': observed['ugreen']}, {}) == []


def test_unspecified_deadline_cannot_be_relabelled_submission_or_registration():
    observed = {'event': contest('event', 'Unknown Deadline Contest', '2026-11-02T00:00:00Z',
                                 field='deadline_unspecified')}
    assert check_answer_precision('截止2026-11-02，未注明类型。', observed, {}) == []
    assert check_answer_precision('作品提交截止2026-11-02。', observed, {})
    assert check_answer_precision('报名截止2026-11-02。', observed, {})


def test_conflicting_structured_field_does_not_prove_assertion(observed):
    observed['ugreen']['fields']['submission_deadline']['level'] = 'conflict'
    assert check_answer_precision('UGREEN\n作品提交截止2026-11-16T07:45:00Z。', observed, {})


def test_model_objects_and_mapping_snapshots_are_equivalent_and_not_mutated(observed):
    before = copy.deepcopy(observed)
    models = {key: ContestSummary.model_validate(value) for key, value in observed.items()}
    answer = 'Codex\n作品提交截止2026-11-02 14:00 PST。'
    assert check_answer_precision(answer, models, {}) == check_answer_precision(answer, observed, {})
    assert observed == before


def test_actual_fetched_same_contest_same_kind_text_can_supply_precision(observed):
    pages = {'https://codex.example/': 'Codex x TwitchCon Hackathon\nSubmission deadline: November 2, 2026 at 2:00 PM PST.'}
    assert check_answer_precision('Codex\n作品提交截止2026-11-02 14:00 PST。', observed, pages) == []


@pytest.mark.parametrize('pages', [
    {'https://ugreen.example/': 'UGREEN\nSubmission deadline: November 2, 2026 at 2:00 PM PST.'},
    {'https://codex.example/': 'Codex\nRegistration deadline: November 2, 2026 at 2:00 PM PST.'},
    {'https://codex.example/': 'Codex\nDeadline: November 2, 2026 at 2:00 PM PST.'},
    {'https://codex.example/': 'Codex\nSubmission deadline: November 2, 2026 at 2:00 PM PST, unverified.'},
    {'https://codex.example/': 'Codex\nWebinar: November 2, 2026 at 2:00 PM PST.'},
    {'https://unrelated.example/': 'Submission deadline: November 2, 2026 at 2:00 PM PST.'},
])
def test_fetched_text_is_not_a_global_time_or_deadline_kind_whitelist(observed, pages):
    assert check_answer_precision('Codex\n作品提交截止2026-11-02 14:00 PST。', observed, pages)


def test_markdown_link_and_table_keep_contest_and_deadline_context(observed):
    answer = '''| 比赛 | 作品提交截止 |
| --- | --- |
| [Codex x TwitchCon Hackathon](https://codex.example/) | 2026-11-02 14:00 PST |'''
    assert check_answer_precision(answer, observed, {})


def test_recommendation_fragments_can_be_scoped_to_selected_contest(observed):
    fragment = '适合 Python，作品提交截止为2026-11-16T07:45:00Z。'
    assert check_answer_precision('PayPal AI Hackathon\n' + fragment, {'paypal': observed['paypal']}, {})



def test_as_of_prefix_does_not_invent_an_event_deadline():
    assert check_answer_precision('截至2026-10-24，明天截止报名的赛事尚未核实。', {}, {}) == []


def test_quote_comparison_accepts_literal_dates_without_database_records():
    from contest_detective.server.agent.answer_grounding import check_evidence_precision
    assert check_evidence_precision('报名截止是10月25日。', ['报名10月25日截止']) == []
    assert check_evidence_precision('报名截止是10月25日14:00。', ['报名10月25日截止'])
    assert check_evidence_precision('报名截止是10月25日14:00 PST。', ['报名10月25日14:00截止'])
    assert check_evidence_precision('报名截止是10月25日。', ['作品提交10月25日截止'])
    assert check_evidence_precision('报名截止未核实。', []) == []


def test_refuted_comparison_distinguishes_disputed_date_from_replacement():
    from contest_detective.server.agent.answer_grounding import check_evidence_precision
    source=['报名截止10月26日']
    assert check_evidence_precision('报名截止不是10月25日，而是10月26日。',source)==[]
    assert check_evidence_precision('报名截止不是10月25日而是10月26日。',source)==[]
    assert check_evidence_precision('说法中的报名截止10月25日与官方原文不符；官方报名截止10月26日。',source)==[]
    assert check_evidence_precision('报名截止不是10月25日，而是10月26日14:00。',source)
    assert check_evidence_precision('报名截止10月25日。',['报名截止不是10月25日，而是10月26日。'])
