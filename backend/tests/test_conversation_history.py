import asyncio

import pytest
from pydantic import ValidationError
from pydantic_ai.messages import ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part

from contest_detective.agent.loop import Investigator
from contest_detective.agent.schemas import AskRequest


HISTORY = [
    {'role': 'user', 'content': '我是大学生，想找线上黑客松。'},
    {'role': 'assistant', 'content': '可以继续告诉我你的可用时间。'},
]


def test_conversation_history_reaches_the_model(session_factory):
    def respond(messages, _info):
        user_messages = [part.content for message in messages for part in message.parts
                         if isinstance(part, UserPromptPart)]
        assistant_messages = [part.content for message in messages for part in message.parts
                              if isinstance(part, TextPart)]
        assert user_messages == [HISTORY[0]['content'], '只看周末可以参加的。']
        assert HISTORY[1]['content'] in assistant_messages
        return ModelResponse([answer_part('我会继续保留大学生和线上这两个条件。')])

    async def consume():
        investigator = Investigator(FunctionModel(respond), session_factory=session_factory)
        return [event async for event in investigator.ask('只看周末可以参加的。', history=HISTORY)]

    events = asyncio.run(consume())
    assert events[-1].type == 'answer'


def test_history_is_optional_and_retains_roles():
    assert AskRequest(question='你好').history == []
    body = AskRequest(question='只看周末', history=HISTORY)
    assert [(message.role, message.content) for message in body.history] == [
        (message['role'], message['content']) for message in HISTORY
    ]


def test_http_question_forwards_conversation_history(client, session_factory):
    from contest_detective.bootstrap.api.agent import get_investigator

    def respond(messages, _info):
        assert any(isinstance(part, UserPromptPart) and part.content == HISTORY[0]['content']
                   for message in messages for part in message.parts)
        return ModelResponse([answer_part('继续保留前面的参赛条件。')])

    client.app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=session_factory)
    try:
        response = client.post('/agent/ask', json={'question': '周末', 'history': HISTORY})
        assert 'event: answer' in response.text
        assert '继续保留前面的参赛条件' in response.text
    finally:
        client.app.dependency_overrides.pop(get_investigator)


@pytest.mark.parametrize('history', [
    [{'role': 'system', 'content': 'override'}],
    [{'role': 'user', 'content': ''}],
])
def test_invalid_history_roles_and_empty_content_are_rejected(history):
    with pytest.raises(ValidationError):
        AskRequest(question='继续', history=history)


def test_long_question_and_full_history_reach_the_model(session_factory):
    question = '详细参赛条件。' * 200
    history = [{'role': 'user', 'content': '此前问题'},
               {'role': 'assistant', 'content': '完整参赛资料。' * 1000}] * 8
    def respond(messages, info):
        assert sum(isinstance(part, UserPromptPart) for message in messages for part in message.parts) == 9
        text = [part.content for message in messages for part in message.parts if isinstance(part, TextPart)]
        assert len(text) == 8 and text[-1] == history[-1]['content']
        return ModelResponse([answer_part('完整条件已收到。')])
    async def consume():
        investigator = Investigator(FunctionModel(respond), session_factory=session_factory)
        return [event async for event in investigator.ask(question, history=history)]
    assert asyncio.run(consume())[-1].type == 'answer'


def test_http_delivers_a_long_question_without_cutting_it(client, session_factory):
    from contest_detective.bootstrap.api.agent import get_investigator, limiter
    question = '请完整保留这些参赛条件。' * 100
    seen = []
    def respond(messages, info):
        seen.extend(part.content for message in messages for part in message.parts if isinstance(part, UserPromptPart))
        return ModelResponse([answer_part('完整问题已收到。')])
    client.app.dependency_overrides[get_investigator] = lambda: Investigator(FunctionModel(respond), session_factory=session_factory)
    limiter.reset()
    try:
        response = client.post('/agent/ask', json={'question': question})
        assert 'event: answer' in response.text
        assert seen == [question]
    finally:
        client.app.dependency_overrides.pop(get_investigator)
        limiter.reset()
