from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models.function import FunctionModel

from account_helpers import account_client, login
from agent_responses import answer_part
from contest_detective.agent.loop import Investigator
from contest_detective.bootstrap.api.agent import get_investigator, limiter


def saved_session(content='旧记录'):
    return {'id': 'browser-session', 'title': '旧比赛', 'createdAt': 1, 'updatedAt': 2,
            'turns': [{'id': 'browser-turn', 'question': '旧问题', 'content': content,
                       'trace': [], 'sources': [], 'status': 'completed'}]}


def test_import_is_account_owned_and_does_not_overwrite_server_messages(tmp_path):
    with account_client(tmp_path) as browser:
        login(browser)
        assert browser.post('/account/conversations/import', json={'sessions': [saved_session()]}).json().get('code') == 200
        assert browser.get('/account/conversations').headers.get('cache-control') == 'private, no-store'
        browser.post('/account/conversations/import', json={'sessions': [saved_session('覆盖正文')]})
        assert browser.get('/account/conversations/browser-session').json()['data']['turns'][0]['content'] == '旧记录'
        login(browser, 'other@example.com')
        assert browser.get('/account/conversations').json()['data'] == []
        assert browser.get('/account/conversations/browser-session').json()['code'] == 404
        browser.post('/account/conversations/import', json={'sessions': [saved_session('另一个账号')]})
        assert browser.get('/account/conversations/browser-session').json()['data']['turns'][0]['content'] == '另一个账号'
        login(browser)
        assert browser.get('/account/conversations/browser-session').json()['data']['turns'][0]['content'] == '旧记录'


def test_stream_saves_messages_for_an_independent_browser_and_account_export(tmp_path):
    # Use the real account/session boundary and a local deterministic model.
    limiter.reset()
    try:
        with account_client(tmp_path) as browser:
            login(browser)
            factory = browser.app.state.test_session_factory
            browser.app.dependency_overrides[get_investigator] = lambda: Investigator(
                FunctionModel(lambda *_: ModelResponse([answer_part('可以参加线上周末赛。')])), session_factory=factory)
            browser.put('/user/profile', json={'skills': ['Python']})
            response = browser.post('/agent/ask', json={'question': '帮我找线上比赛',
                'conversation_id': 'weekend', 'turn_id': 'first'})
            assert 'event: answer' in response.text
            remote = TestClient(browser.app)
            remote.post('/auth/login', json={'email': 'owner@example.com', 'password': 'long-password-123'})
            assert remote.get('/auth/me').json()['data']['profile']['skills'] == ['Python']
            history = remote.get('/account/conversations').json()
            assert history['code'] == 200
            sessions = history['data']
            assert len(sessions) == 1
            assert sessions[0]['id'] == 'weekend'
            assert sessions[0]['turns'][0]['question'] == '帮我找线上比赛'
            assert sessions[0]['turns'][0]['content'] == '可以参加线上周末赛。'
            assert sessions[0]['turns'][0]['status'] == 'completed'
            exported = remote.get('/account/export').json()['data']
            assert exported['conversations'] == sessions
            duplicate = browser.post('/agent/ask', json={'question': '帮我找线上比赛',
                'conversation_id': 'weekend', 'turn_id': 'first'})
            assert duplicate.json()['code'] == 409
            assert remote.request('DELETE', '/account', json={'email': 'owner@example.com'}).json()['code'] == 200
            login(browser, 'other@example.com')
            assert browser.get('/account/conversations/weekend').json()['code'] == 404
            with factory() as session:
                from sqlalchemy import select
                from contest_detective.agent.chat.models import ChatConversation, ChatTurn
                assert session.scalars(select(ChatConversation)).all() == []
                assert session.scalars(select(ChatTurn)).all() == []
    finally:
        limiter.reset()


def test_server_keeps_an_error_without_a_client_snapshot_upload(tmp_path):
    from contest_detective.agent.schemas import TraceEvent

    from contest_detective.framework.exceptions import BizException

    def fail(*_):
        raise BizException('请在账户设置中重新保存密钥。', data={'action': 'settings'})

    with account_client(tmp_path) as browser:
        login(browser)
        browser.app.dependency_overrides[get_investigator] = lambda: Investigator(FunctionModel(fail), session_factory=browser.app.state.test_session_factory)
        browser.post('/agent/ask', json={'question': '查比赛', 'conversation_id': 'failed', 'turn_id': 'one'})
        saved = browser.get('/account/conversations/failed').json()
        assert saved['code'] == 200
        turn = saved['data']['turns']
        assert len(turn) == 1
        assert turn[0]['status'] == 'error'
        assert turn[0]['error'] == '请在账户设置中重新保存密钥。'


def test_restart_marks_unfinished_saved_turns_as_interrupted(tmp_path):
    from contest_detective.agent.chat.service import SqlConversationStore

    with account_client(tmp_path) as browser:
        owner = login(browser)
        with browser.app.state.test_session_factory() as session:
            SqlConversationStore(session, owner).start('unfinished', 'one', '尚未完成的问题')
            session.commit()
    with account_client(tmp_path) as restarted:
        login(restarted)
        turn = restarted.get('/account/conversations/unfinished').json()['data']['turns'][0]
        assert turn['question'] == '尚未完成的问题'
        assert turn['status'] == 'stopped'


def test_saved_turn_keeps_public_sources_steps_and_recommendations(tmp_path):
    from contest_detective.agent.schemas import TraceEvent
    source = {'title': '规则', 'url': 'https://organizer.example/rules', 'site': '主办方', 'is_official': True}

    from contest_detective.agent.chat.service import SqlConversationStore
    events = [
        TraceEvent(type='step', payload={'tool': 'get_contest', 'label': '读取赛事规则'}),
        TraceEvent(type='observation', payload={'tool': 'get_contest', 'summary': '已找到报名规则', 'sources': [source]}),
        TraceEvent(type='answer', payload={'content': '可以参加。', 'sources': [source], 'recommendations': [{
            'contest': {'id': 'weekend', 'name': '周末赛', 'status': 'upcoming', 'fields': {}, 'cover_url': None, 'summary': None},
            'introduction': '线上参赛', 'reason': '时间适合',
        }]}),
    ]
    with account_client(tmp_path) as browser:
        owner = login(browser)
        with browser.app.state.test_session_factory() as session:
            store = SqlConversationStore(session, owner)
            store.start('sourced', 'one', '规则是什么')
            session.commit()
            for event in events:
                store.record('sourced', 'one', event)
                session.commit()
        turn = browser.get('/account/conversations/sourced').json()['data']['turns'][0]
        assert [step['type'] for step in turn['trace']] == ['step', 'observation']
        assert turn['sources'][0]['url'] == source['url']
        assert turn['recommendations'][0]['contest']['id'] == 'weekend'
        assert turn['recommendations'][0]['reason'] == '时间适合'


def test_preflight_failure_is_saved_as_a_failed_message(tmp_path):
    with account_client(tmp_path) as browser:
        login(browser)
        rejected = browser.post('/agent/ask', json={'question': '找比赛', 'conversation_id': 'preflight', 'turn_id': 'one'})
        assert rejected.json()['code'] == 503
        turn = browser.get('/account/conversations/preflight').json()['data']['turns'][0]
        assert turn['status'] == 'error'
        assert turn['error'] == rejected.json()['message']


def test_requests_without_client_ids_save_the_answer_under_one_conversation(tmp_path):
    with account_client(tmp_path) as browser:
        login(browser)
        browser.app.dependency_overrides[get_investigator] = lambda: Investigator(
            FunctionModel(lambda *_: ModelResponse([answer_part('服务端自动编号的回复。')])),
            session_factory=browser.app.state.test_session_factory)
        response = browser.post('/agent/ask', json={'question': '找比赛'})
        assert 'event: answer' in response.text
        sessions = browser.get('/account/conversations').json()['data']
        assert len(sessions) == 1
        assert sessions[0]['turns'][0]['status'] == 'completed'
        assert sessions[0]['turns'][0]['content'] == '服务端自动编号的回复。'


def test_account_deletion_before_stream_start_prevents_new_investigation_records(tmp_path):
    from sqlalchemy import select
    from contest_detective.agent.models import Investigation, TraceRecord
    from contest_detective.system.account.lifecycle import delete_account

    with account_client(tmp_path) as browser:
        owner = login(browser)
        factory = browser.app.state.test_session_factory

        def investigator_after_delete():
            with factory() as session:
                delete_account(session, owner, 'owner@example.com')
            return Investigator(FunctionModel(lambda *_: ModelResponse([answer_part('用户已删除后的答复')])), session_factory=factory)

        browser.app.dependency_overrides[get_investigator] = investigator_after_delete
        browser.post('/agent/ask', json={'question': '注销竞态中的私有问题', 'conversation_id': 'deleted', 'turn_id': 'one'})
        with factory() as session:
            assert session.scalars(select(Investigation)).all() == []
            assert session.scalars(select(TraceRecord)).all() == []


def test_account_deletion_during_a_model_run_prevents_orphan_trace_writes(tmp_path):
    from sqlalchemy import select
    from pydantic_ai.messages import ToolCallPart, ToolReturnPart
    from contest_detective.agent.models import Investigation, TraceRecord
    from contest_detective.system.account.lifecycle import delete_account

    with account_client(tmp_path) as browser:
        owner = login(browser)
        factory = browser.app.state.test_session_factory

        def respond(messages, _info):
            if not any(isinstance(part, ToolReturnPart) for message in messages for part in message.parts):
                return ModelResponse([ToolCallPart('search_contests', {})])
            with factory() as session:
                delete_account(session, owner, 'owner@example.com')
            return ModelResponse([answer_part('注销后不能写回的正文')])

        browser.app.dependency_overrides[get_investigator] = lambda: Investigator(FunctionModel(respond), session_factory=factory)
        try:
            browser.post('/agent/ask', json={'question': '比赛规则是什么', 'conversation_id': 'deleted', 'turn_id': 'one'})
        finally:
            with factory() as session:
                assert session.scalars(select(Investigation)).all() == []
                assert session.scalars(select(TraceRecord)).all() == []


def test_detached_run_persists_progress_and_answer_without_a_connected_browser(tmp_path):
    import asyncio
    from uuid import uuid4
    from pydantic_ai.messages import ToolCallPart
    from contest_detective.agent.chat.service import SqlConversationStore
    from contest_detective.agent.investigations import Investigations
    from contest_detective.agent.schemas import AskRequest

    with account_client(tmp_path) as browser:
        owner = login(browser)
        factory = browser.app.state.test_session_factory

        async def scenario():
            released = asyncio.Event()
            calls = 0

            async def fetch(_):
                await released.wait()
                return '报名截止为十月三十一日。'

            def respond(*_):
                nonlocal calls
                calls += 1
                return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules'})]
                                     if calls == 1 else [answer_part('报名截止为十月三十一日。')])

            body = AskRequest(investigation_id=uuid4(), question='查报名截止')
            with factory() as session:
                SqlConversationStore(session, owner).start('detached', 'one', body.question, investigation_id=str(body.investigation_id))
                session.commit()
            runs = Investigations(factory)
            investigation_id = runs.start(Investigator(FunctionModel(respond), session_factory=factory, fetch=fetch), body, owner, owner, require_owner=True)
            reader = runs.events(investigation_id, owner)
            assert (await anext(reader)).type == 'step'
            await reader.aclose()
            with factory() as session:
                turn = SqlConversationStore(session, owner).get('detached').turns[0]
                assert turn.status == 'running' and turn.lastSeq == 1
            released.set()
            await asyncio.gather(*list(runs.tasks.values()))

        asyncio.run(scenario())
        turn = browser.get('/account/conversations/detached').json()['data']['turns'][0]
        assert turn['status'] == 'completed'
        assert turn['content'] == '报名截止为十月三十一日。'
        assert turn['lastSeq'] == 3
        assert len(turn['trace']) == 2


def test_one_click_retry_replaces_only_the_failed_attempt_and_preserves_request(tmp_path):
    from uuid import uuid4
    with account_client(tmp_path) as browser:
        login(browser)
        original = str(uuid4())
        body = {'question': '查比赛', 'conversation_id': 'retry', 'turn_id': 'one', 'investigation_id': original,
                'profile': {'skills': ['Python']}}
        assert browser.post('/agent/ask', json=body).json()['code'] == 503
        browser.app.dependency_overrides[get_investigator] = lambda: Investigator(
            FunctionModel(lambda *_: ModelResponse([answer_part('这次完成了。')])), session_factory=browser.app.state.test_session_factory)
        retried = browser.post('/agent/ask', json={**body, 'retry_of': original, 'investigation_id': str(uuid4())})
        assert 'event: answer' in retried.text
        turns = browser.get('/account/conversations/retry').json()['data']['turns']
        assert len(turns) == 1 and turns[0]['content'] == '这次完成了。'
        assert turns[0]['request']['profile']['skills'] == ['Python']
        assert browser.post('/agent/ask', json={**body, 'retry_of': original, 'investigation_id': str(uuid4())}).json()['code'] == 409


def test_erased_run_cannot_write_or_interrupt_another_accounts_reused_id(tmp_path):
    import asyncio
    from uuid import uuid4
    from pydantic_ai.messages import ToolCallPart
    from contest_detective.agent.chat.service import SqlConversationStore
    from contest_detective.agent.investigations import Investigations
    from contest_detective.agent.schemas import AskRequest
    from contest_detective.system.account.lifecycle import delete_account

    with account_client(tmp_path) as browser:
        first = login(browser)
        second = login(browser, 'other@example.com')
        factory = browser.app.state.test_session_factory

        async def scenario():
            runs = Investigations(factory)
            old_release, new_release, new_started = asyncio.Event(), asyncio.Event(), asyncio.Event()
            run_id = uuid4()
            calls = 0

            async def fetch(_):
                await old_release.wait()
                return '旧账号的私有材料'

            def old_response(*_):
                nonlocal calls
                calls += 1
                return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://example.org/old'})]
                                     if calls == 1 else [answer_part('旧账号的私有答复')])

            async def new_response(*_):
                new_started.set()
                await new_release.wait()
                return ModelResponse([answer_part('新账号自己的答复')])

            def start(owner, model, fetcher=None):
                body = AskRequest(investigation_id=run_id, question='查比赛')
                with factory() as session:
                    SqlConversationStore(session, owner).start('same', 'one', body.question, investigation_id=str(run_id))
                    session.commit()
                runs.start(Investigator(model, session_factory=factory, fetch=fetcher), body, owner, owner, require_owner=True)

            start(first, FunctionModel(old_response), fetch)
            old_reader = runs.events(str(run_id), first)
            assert (await anext(old_reader)).type == 'step'
            old_tasks = list(runs.tasks.values())
            with factory() as session:
                delete_account(session, first, 'owner@example.com')
            start(second, FunctionModel(new_response))
            await new_started.wait()
            old_release.set()
            await asyncio.gather(*old_tasks, return_exceptions=True)
            with factory() as session:
                turn = SqlConversationStore(session, second).get('same').turns[0]
                assert turn.status == 'running' and turn.content == ''
            assert runs.tasks  # Finishing the erased task must not remove the new task.
            new_release.set()
            await asyncio.gather(*list(runs.tasks.values()))
            assert [event async for event in old_reader] == []

        asyncio.run(scenario())
        turn = browser.get('/account/conversations/same').json()['data']['turns'][0]
        assert turn['content'] == '新账号自己的答复'


def test_open_event_reader_does_not_follow_a_reused_id_to_a_different_account(session_factory):
    import asyncio
    from uuid import uuid4
    from sqlalchemy import delete
    from contest_detective.agent.investigations import Investigations
    from contest_detective.agent.models import Investigation, TraceRecord
    run_id = str(uuid4())

    async def scenario():
        with session_factory() as session:
            session.add(Investigation(id=run_id, question='旧问题', user_id='old-account', status='running'))
            session.add(TraceRecord(investigation_id=run_id, seq=1, type='step', payload={'tool': 'fetch_page', 'label': '读取网页'}))
            session.commit()
        reader = Investigations(session_factory).events(run_id, 'old-account')
        assert (await anext(reader)).type == 'step'
        with session_factory() as session:
            session.execute(delete(TraceRecord))
            session.execute(delete(Investigation))
            session.add(Investigation(id=run_id, question='新问题', user_id='new-account', status='completed'))
            session.add(TraceRecord(investigation_id=run_id, seq=2, type='answer', payload={'content': '新账号的私有答复'}))
            session.commit()
        assert [event async for event in reader] == []

    asyncio.run(scenario())
