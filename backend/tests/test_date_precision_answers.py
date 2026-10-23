import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.server.agent.loop import Investigator
from contest_detective.server.contest import service
from contest_detective.server.contest.schemas import ContestDraft

URL = 'https://events.waytoagi.com/events/mixed'


def ask(session_factory, claims, answer):
    with session_factory() as session:
        contest_id = service.save(session, ContestDraft(name='混合精度赛事', page={
            'url': URL, 'site': 'WaytoAGI', 'title': '赛事', 'is_official': True,
        }, claims=claims))
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id})] if calls == 1 else [TextPart(answer)])
    async def run():
        return [event async for event in Investigator(FunctionModel(respond), session_factory=session_factory).ask('何时开赛和截止？')]
    return asyncio.run(run())[-1]


@pytest.mark.parametrize('deadline,answer,expected', [
    ('2026-10-26T15:59:00Z', f'比赛于[2026-10-27 08:00]({URL})开赛。', 'error'),
    ('2026-10-26T15:59:00Z', f'比赛于[2026-10-27 23:59]({URL})开赛。', 'error'),
    ('2026-10-27T15:59:00Z', f'比赛于[2026-10-27 23:59]({URL})开赛。', 'error'),
    ('2026-10-26T15:59:00Z', f'[截止时刻为2026-10-26 23:59]({URL})，开赛具体时刻未公布。', 'answer'),
    ('2026-10-26T15:59:00Z', f'[比赛于2026-10-27开赛]({URL})，具体时刻未公布。', 'answer'),
])
def test_exact_deadline_on_a_page_cannot_authorize_a_day_only_start_time(session_factory, deadline, answer, expected):
    result = ask(session_factory, [
        {'field': 'start_at', 'value': '2026-10-27', 'precision': 'day', 'excerpt': '10月27日开赛'},
        {'field': 'deadline_unspecified', 'value': deadline, 'excerpt': '明确截止时刻'},
    ], answer)
    assert result.type == expected


@pytest.mark.parametrize('answer,expected', [
    (f'[来源]({URL})未公布具体时刻，16:00是报名截止还是提交截止，现有资料无法确认。', 'answer'),
    (f'[来源]({URL})具体时刻未公布，是否在16:00截止无法确认。', 'answer'),
    (f'[来源]({URL})报名在08:00截止，其他时刻未公布。', 'error'),
])
def test_uncertain_question_keeps_its_sentence_context_without_authorizing_a_statement(session_factory, answer, expected):
    result = ask(session_factory, [
        {'field': 'submission_deadline', 'value': '2026-10-27', 'precision': 'day', 'excerpt': '10月27日截止'},
    ], answer)
    assert result.type == expected


@pytest.mark.parametrize('answer,expected', [
    (f'报名于[2026-10-27 23:59]({URL})截止。', 'answer'),
    (f'报名截止并于[2026-10-27 23:59]({URL})开赛。', 'error'),
    (f'[2026-10-27 23:59]({URL})。', 'error'),
])
def test_mixed_precision_clock_needs_support_for_the_named_field(session_factory, answer, expected):
    result = ask(session_factory, [
        {'field': 'start_at', 'value': '2026-10-27', 'precision': 'day', 'excerpt': '10月27日开赛'},
        {'field': 'registration_deadline', 'value': '2026-10-27T15:59:00Z', 'excerpt': '10月27日23:59报名截止'},
    ], answer)
    assert result.type == expected


@pytest.mark.parametrize('answer,expected', [
    (f'开赛日期为[10月27日]({URL})且报名截止为[10月26日23:59]({URL})。', 'answer'),
    (f'报名截止为[10月26日23:59]({URL})并且开赛日期为[10月27日]({URL})。', 'answer'),
    (f'报名截止为[2026-10-26T23:59:00+08:00]({URL})。', 'answer'),
    (f'报名截止为[2026-10-26T15:59:00Z]({URL})。', 'answer'),
    (f'报名截止为[2026-10-26T23:59:00+09:00]({URL})。', 'error'),
])
def test_independent_field_statements_and_iso_offsets_keep_exact_time_semantics(session_factory, answer, expected):
    result = ask(session_factory, [
        {'field': 'start_at', 'value': '2026-10-27', 'precision': 'day', 'excerpt': '10月27日开赛'},
        {'field': 'registration_deadline', 'value': '2026-10-26T15:59:00Z', 'excerpt': '10月26日23:59报名截止'},
    ], answer)
    assert result.type == expected
