import asyncio
import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from sqlalchemy import select

from agent_responses import answer_part
from contest_detective.server.agent.loop import Investigator
from contest_detective.server.agent.models import TraceRecord
from contest_detective.server.contest.schemas import ContestDraft
from contest_detective.server.contest.service import save
from contest_detective.server.user.schemas import Profile


def seed(factory, name, slug):
    with factory() as session:
        return save(session, ContestDraft(
            name=name, summary='两天完成一个可演示的应用。',
            cover_url=f'https://events.example/{slug}.jpg',
            page={'url': f'https://events.example/{slug}', 'site': '主办方',
                  'title': name, 'is_official': True},
            claims=[
                {'field': 'prize', 'value': '¥20,000', 'excerpt': '奖金两万元'},
                {'field': 'submission_deadline', 'value': '2026-11-10',
                 'precision': 'day', 'excerpt': '11月10日提交截止'},
            ],
        ))


@pytest.mark.parametrize('profile', [None, Profile(skills=['Python'])])
def test_answer_combines_text_with_only_the_model_selected_contest(session_factory, profile):
    seed(session_factory, '候选甲', 'first')
    chosen = seed(session_factory, '候选乙', 'second')

    def respond(messages, info):
        results = [part for message in messages for part in message.parts
                   if isinstance(part, ToolReturnPart) and part.tool_name == 'search_contests']
        if not results:
            return ModelResponse([ToolCallPart('search_contests', {})])
        assert len(results[-1].content['items']) == 2
        return ModelResponse([answer_part('建议参加候选乙，下面是比赛卡片。', [{
            'contest_id': chosen, 'introduction': '面向应用开发的周末比赛。',
            'reason': '可以从已有 Python 项目开始。',
        }])])

    async def consume():
        investigator = Investigator(FunctionModel(respond), session_factory=session_factory)
        return [event async for event in investigator.ask('推荐一场比赛', profile=profile)]

    events = asyncio.run(consume())
    assert events[-1].type == 'answer', events[-1].payload
    payload = events[-1].payload
    assert payload['content'] == '建议参加候选乙，下面是比赛卡片。'
    assert [event.type for event in events] == ['step', 'observation', 'answer']
    assert len(payload['recommendations']) == 1
    recommendation = payload['recommendations'][0]
    assert recommendation['reason'] == '可以从已有 Python 项目开始。'
    assert recommendation['introduction'] == '面向应用开发的周末比赛。'
    assert recommendation['contest']['id'] == chosen
    assert recommendation['contest']['cover_url'] == 'https://events.example/second.jpg'
    deadline = recommendation['contest']['fields']['submission_deadline']
    assert deadline['precision'] == 'day'
    assert deadline['sources'][0]['url'] == 'https://events.example/second'
    with session_factory() as session:
        stored = session.scalars(select(TraceRecord).where(TraceRecord.type == 'answer')).one()
        assert stored.payload['recommendations'] == payload['recommendations']


def test_old_answer_resolves_referenced_contests_without_running_a_model(client, session_factory):
    first = seed(session_factory, '候选甲', 'first')
    second = seed(session_factory, '候选乙', 'second')
    seed(session_factory, '未被推荐的候选', 'other')
    response = client.post('/agent/recommendations/resolve', json={
        'content': '先看 [候选乙](https://events.example/second)，再看 [候选甲](https://events.example/first)。',
        'sources': [{'title': '其他搜索线索', 'url': 'https://events.example/other', 'site': '主办方'}],
    })
    assert response.status_code == 200
    assert response.json()['code'] == 200
    items = response.json()['data']
    assert [item['contest']['id'] for item in items] == [second, first]
    assert items[0]['introduction'] == '两天完成一个可演示的应用。'
    assert items[0]['reason'] == ''


def test_old_answer_does_not_turn_unmentioned_sources_into_recommendations(client, session_factory):
    seed(session_factory, '候选甲', 'first')
    response = client.post('/agent/recommendations/resolve', json={
        'content': '暂时没有合适的推荐。',
        'sources': [{'title': '查询过的比赛', 'url': 'https://events.example/first', 'site': '主办方'}],
    })
    assert response.status_code == 200
    assert response.json()['data'] == []


def test_unobserved_card_cannot_block_the_reply(session_factory):
    chosen = seed(session_factory, '候选甲', 'first')
    calls = []

    def respond(messages, info):
        calls.append(info)
        return ModelResponse([answer_part('推荐候选甲。', [{
            'contest_id': chosen, 'introduction': '面向应用开发。', 'reason': '适合现有项目。',
        }])])

    async def consume():
        investigator = Investigator(FunctionModel(respond), session_factory=session_factory)
        return [event async for event in investigator.ask('推荐候选甲')]

    events = asyncio.run(consume())
    assert events[-1].type == 'answer', events[-1].payload
    assert events[-1].payload['content'] == '推荐候选甲。'
    assert events[-1].payload['recommendations'] == []
    assert len(calls) == 1


def test_shared_registration_page_does_not_recommend_every_linked_contest(client, session_factory):
    from contest_detective.server.contest import service
    first = seed(session_factory, '候选甲', 'first')
    second = seed(session_factory, '候选乙', 'second')
    for contest_id, name in [(first, '候选甲'), (second, '候选乙')]:
        with session_factory() as session:
            service.save(session, ContestDraft(name=name, page={
                'url': 'https://events.example/shared', 'site': '主办方',
                'title': '共同报名页', 'is_official': True,
            }, claims=[]), contest_id=contest_id)
    response = client.post('/agent/recommendations/resolve', json={
        'content': '推荐候选乙：[报名](https://events.example/shared)。',
    })
    assert [item['contest']['id'] for item in response.json()['data']] == [second]
