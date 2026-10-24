import asyncio

import pytest
from pydantic import ValidationError
from pydantic_ai.messages import ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.server.agent.loop import Investigator
from contest_detective.server.agent.schemas import AskRequest


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
        return ModelResponse([TextPart('我会继续保留大学生和线上这两个条件。')])

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
    from contest_detective.web.api.agent import get_investigator

    def respond(messages, _info):
        assert any(isinstance(part, UserPromptPart) and part.content == HISTORY[0]['content']
                   for message in messages for part in message.parts)
        return ModelResponse([TextPart('继续保留前面的参赛条件。')])

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
    [{'role': 'assistant', 'content': '没有用户消息'}],
    [{'role': 'user', 'content': '未完成的一轮'}],
    HISTORY * 7,
    [{'role': 'user', 'content': '问题'}, {'role': 'assistant', 'content': '测' * 4001}],
    [{'role': 'user', 'content': '测' * 3000}, {'role': 'assistant', 'content': '测' * 3000}],
])
def test_history_bounds_are_checked_before_model_calls(history):
    with pytest.raises(ValidationError):
        AskRequest(question='继续', history=history)
