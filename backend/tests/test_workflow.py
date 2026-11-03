import asyncio
from uuid import uuid4

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.exceptions import ModelConnectionError

from contest_detective.agent.config import LLMSettings
from contest_detective.agent.loop import Investigator
from contest_detective.agent.guest import GuestInvestigations
from contest_detective.agent.schemas import AskRequest
from contest_detective.contest.schemas import ContestDraft
from contest_detective.contest import service
from contest_detective.system.user.schemas import Profile


def seed(factory, name, *, mode='online', deadline='2026-10-30', summary='AI 应用比赛', extra=None):
    with factory() as session:
        return service.save(session, ContestDraft(name=name, summary=summary,
            page={'url': f'https://events.example/{name}', 'title': name, 'site': '官网', 'is_official': True},
            claims=[{'field': field, 'value': value, 'excerpt': value,
                     'precision': 'day' if field.endswith('_at') or field.endswith('deadline') else 'datetime'}
                    for field, value in {'mode': mode, **({'submission_deadline': deadline} if deadline else {}), **(extra or {})}.items()]))


def run(factory, question, intent=None, *, profile=None, contest_id=None, fail=False):
    def respond(messages, info):
        if fail is True or (fail == 'writer' and info.output_tools[0].name == 'respond_to_user'):
            raise ModelConnectionError('test', 'provider unavailable')
        name = info.output_tools[0].name
        if name == 'interpret_query':
            parsed = dict(intent or {})
            parsed.setdefault('requested_facts', [{'field': field, 'quote': question} for field in parsed.get('fields', [])])
            return ModelResponse([ToolCallPart(name, parsed)])
        return ModelResponse([ToolCallPart(name, {'content': '已按参赛条件整理，来源见各项。'})])

    async def consume():
        investigator = Investigator(FunctionModel(respond), session_factory=factory, mode='database',
                                    settings=LLMSettings(_env_file=None, workflow_enabled=True))
        runs = GuestInvestigations()
        body = AskRequest(investigation_id=uuid4(), question=question, profile=profile,
                          contest_id=contest_id, mode='database')
        run_id = runs.start(investigator, body, 'guest-test')
        return [event async for event in runs.events(run_id, 'guest-test')]
    events = asyncio.run(consume())
    assert events[-1].type == 'answer', events[-1].payload
    return events[-1].payload


def test_explicit_mode_overrides_preference_but_identity_still_applies(session_factory):
    target = seed(session_factory, '线下 AI 周末赛', mode='offline')
    seed(session_factory, '职业开发者 AI 专场', mode='offline', summary='仅限职场开发者参加')
    seed(session_factory, '线上 AI 赛')
    result = run(session_factory, '找线下 AI 比赛', {'mode': 'offline'},
                 profile=Profile(preferred_modes=['online'], identity_kind='student'))
    assert [item['contest']['id'] for item in result['recommendations']] == [target]
    assert '职业开发者 AI 专场' in result['content']
    assert '资格' in result['content']


@pytest.mark.parametrize(('question', 'count'), [('找比赛', 3), ('多找几个比赛', 5), ('找 7 场比赛', 7),
    ('我们3个人组队，推荐5场比赛', 5), ('找七场比赛', 7), ('找四五场比赛', 5)])
def test_recommendation_count_is_a_product_rule(session_factory, question, count):
    for index in range(9):
        seed(session_factory, f'AI 比赛{index}')
    result = run(session_factory, question)
    assert len(result['recommendations']) == count


def test_missing_mode_is_prose_only_and_keeps_usable_sources(session_factory):
    seed(session_factory, '形式待确认', mode='online')
    with session_factory() as session:
        unknown = service.save(session, ContestDraft(name='新 AI 挑战',
            page={'url': 'https://events.example/new', 'title': '公告', 'site': '官网', 'is_official': True},
            claims=[{'field': 'submission_deadline', 'value': '2026-10-30', 'precision': 'day', 'excerpt': '10月30日截止'}]))
    result = run(session_factory, '推荐比赛')
    assert unknown not in [item['contest']['id'] for item in result['recommendations']]
    assert '新 AI 挑战' in result['content']
    assert '形式' in result['content']
    assert 'https://events.example/new' in result['content']


def test_expands_past_first_hundred_ineligible_candidates(session_factory):
    for index in range(101):
        seed(session_factory, f'AI {index:03}', summary='仅限职场开发者参加')
    target = seed(session_factory, 'AI 999 学生公开赛')
    result = run(session_factory, '找比赛', profile=Profile(identity_kind='student'))
    assert [item['contest']['id'] for item in result['recommendations']] == [target]


def test_deadline_question_does_not_match_event_start_date(session_factory):
    target = seed(session_factory, '本周截止')
    seed(session_factory, '仅开赛日期匹配', deadline='2026-12-20', extra={'start_at': '2026-10-29'})
    result = run(session_factory, '两周内截止', {'date_from': '2026-10-24T00:00:00Z',
        'date_to': '2026-11-07T00:00:00Z', 'date_kind': 'deadline'})
    assert [item['contest']['id'] for item in result['recommendations']] == [target]


def test_bound_contest_can_read_comparison_without_changing_main(session_factory):
    main = seed(session_factory, '原赛事')
    other = seed(session_factory, '比较赛事')
    result = run(session_factory, '和比较赛事比较', {'kind': 'comparison', 'comparison_queries': ['比较赛事']}, contest_id=main)
    assert main in [item['contest']['id'] for item in result['recommendations']]
    assert other in [item['contest']['id'] for item in result['recommendations']]


@pytest.mark.parametrize('question', ['两周内截止的线上 AI 比赛', '两周内截止的线上AI比赛'])
def test_model_failure_still_returns_facts_cards_and_next_action(session_factory, question):
    target = seed(session_factory, 'AI 公开赛')
    seed(session_factory, '手工雕刻赛', summary='传统手工雕刻作品竞赛')
    result = run(session_factory, question, fail=True)
    assert [item['contest']['id'] for item in result['recommendations']] == [target]
    assert 'AI 公开赛' in result['content'] and '2026-10-30' in result['content']
    assert 'https://events.example/' in result['content']
    assert all(word not in result['content'] for word in ['重试', '预算', '停滞', '工具', '未完成'])


def test_specific_contest_with_several_unknowns_stays_in_fallback(session_factory):
    main = seed(session_factory, '具体赛事', extra={'start_at': '2026-11-01'})
    result = run(session_factory, '这场比赛何时开始，奖金和场地呢',
        {'kind': 'detail', 'fields': ['start_at', 'prize', 'venue']}, contest_id=main, fail='writer')
    assert '具体赛事' in result['content'] and '2026-11-01' in result['content']
    assert 'T00:00' not in result['content']
    assert '奖金' in result['content'] and '场地' in result['content']


def test_specific_contest_does_not_force_an_ineligible_recommendation(session_factory):
    main = seed(session_factory, '学生专场', extra={'eligibility': '仅限在校生'})
    result = run(session_factory, '我能参加这场吗', {'kind': 'detail', 'fields': ['eligibility']},
        contest_id=main, profile=Profile(identity_kind='professional'))
    assert result['recommendations'] == []
    assert '学生专场' in result['content']


def test_unresolved_eligibility_sources_never_become_qualified_cards(session_factory):
    main = seed(session_factory, '资格待确认', extra={'eligibility': '仅限在校生'})
    with session_factory() as session:
        service.save(session, ContestDraft(name='资格待确认',
            page={'url': 'https://events.example/rules', 'title': '规则', 'site': '官网', 'is_official': True},
            claims=[{'field': 'eligibility', 'value': '仅限职场开发者', 'excerpt': '仅限职场开发者'}]), contest_id=main)
    result = run(session_factory, '找比赛', profile=Profile(identity_kind='student'))
    assert result['recommendations'] == []
    assert '资格待确认' in result['content'] and '资格' in result['content']


def test_unverified_candidate_with_several_missing_fields_stays_in_prose(session_factory):
    with session_factory() as session:
        service.save(session, ContestDraft(name='待核实新赛',
            page={'url': 'https://events.example/pending', 'title': '赛事公告', 'site': '官网', 'is_official': True},
            claims=[{'field': 'prize', 'value': '2000元', 'excerpt': '奖金2000元'}]))
    result = run(session_factory, '推荐比赛')
    assert not result['recommendations']
    assert '待核实新赛' in result['content'] and '形式' in result['content'] and '截止' in result['content']


def test_interpreter_cannot_turn_unasked_bonus_fields_into_participation_gates(session_factory):
    for name in ('甲AI赛', '乙AI赛', '丙AI赛'):
        seed(session_factory, name)
    result = run(session_factory, '两周内截止的线上AI比赛，推荐3场', {'mode': 'online',
        'fields': ['registration_deadline', 'prize', 'venue', 'registration_url', 'start_at', 'end_at'], 'requested_facts': []})
    assert len(result['recommendations']) == 3


def test_explicit_free_condition_excludes_paid_and_unverified_fees(session_factory):
    free = seed(session_factory, '免费AI赛', extra={'entry_fee': '免费'})
    seed(session_factory, '收费AI赛', extra={'entry_fee': '100元'})
    seed(session_factory, '费用未知AI赛')
    result = run(session_factory, '只推荐免费参赛的比赛', {'conditions': [
        {'field': 'entry_fee', 'operator': 'equals', 'value': 0, 'quote': '免费'}]})
    assert [item['contest']['id'] for item in result['recommendations']] == [free]
    assert '报名费用' in result['content']


def test_explicit_prize_threshold_is_checked_against_sourced_numbers(session_factory):
    target = seed(session_factory, '有奖AI赛', extra={'prize': '2万元'})
    seed(session_factory, '小奖AI赛', extra={'prize': '5000元'})
    seed(session_factory, '奖金未知AI赛')
    result = run(session_factory, '奖金至少1万元，推荐比赛', {'conditions': [
        {'field': 'prize', 'operator': 'minimum', 'value': 10000, 'currency': 'CNY', 'quote': '奖金至少1万元'}]})
    assert [item['contest']['id'] for item in result['recommendations']] == [target]


def test_free_condition_survives_model_interpretation_failure(session_factory):
    target = seed(session_factory, '免费AI赛', extra={'entry_fee': '免费'})
    seed(session_factory, '收费AI赛', extra={'entry_fee': '100元'})
    result = run(session_factory, '只找免费的AI比赛', fail=True)
    assert [item['contest']['id'] for item in result['recommendations']] == [target]


@pytest.mark.parametrize(('fee', 'operator', 'limit', 'question'), [
    ('不免费', 'equals', 0, '只要免费参赛的比赛'),
    ('100元起', 'maximum', 100, '报名费不超过100元，推荐比赛'),
])
def test_fee_negation_and_open_upper_bound_do_not_pass_hard_conditions(session_factory, fee, operator, limit, question):
    seed(session_factory, '费用需留意', extra={'entry_fee': fee})
    result = run(session_factory, question, {'conditions': [
        {'field': 'entry_fee', 'operator': operator, 'value': limit, 'quote': question}]})
    assert not result['recommendations']


def test_known_prize_lower_bound_can_satisfy_a_minimum_requirement(session_factory):
    target = seed(session_factory, '奖金下限已知', extra={'prize': '10000元起'})
    result = run(session_factory, '奖金至少10000元的比赛', {'conditions': [
        {'field': 'prize', 'operator': 'minimum', 'value': 10000, 'quote': '奖金至少10000元'}]})
    assert [item['contest']['id'] for item in result['recommendations']] == [target]
