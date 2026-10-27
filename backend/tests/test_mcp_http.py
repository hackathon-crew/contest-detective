import asyncio
import json
import re

import httpx
import pytest
from fastapi.testclient import TestClient
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import create_engine, event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.db import get_session, init_db
from contest_detective.bootstrap.mcp import create_server
from test_mcp import counts, seed


@pytest.fixture
def database(tmp_path):
    path = tmp_path / 'http contests.db'
    bind = create_engine(f'sqlite:///{path}')
    init_db(bind)
    factory = sessionmaker(bind=bind, expire_on_commit=False)
    contest_id = seed(factory)
    yield f'sqlite:///{path}', bind, factory, contest_id
    bind.dispose()


def test_http_sdk_reads_the_same_evidence_as_stdio_and_web_without_side_effects(database, monkeypatch):
    from contest_detective.agent import llm
    from contest_detective.bootstrap.app import create_app as create_web_app
    from contest_detective.bootstrap.mcp_http import create_app

    url, bind, factory, contest_id = database
    before = counts(bind)
    web_app = create_web_app(db_engine=bind)

    def web_session():
        with factory() as session:
            yield session

    web_app.dependency_overrides[get_session] = web_session
    with TestClient(web_app) as web:
        response = web.get(f'/contests/{contest_id}').json()
        assert response['code'] == 200
        web_detail = response['data']
    app = create_app(database_url=url)
    statements = []
    event.listen(app.state.db_engine, 'before_cursor_execute',
                 lambda _c, _u, statement, *_: statements.append(statement.lower()))

    def forbidden(*_args, **_kwargs):
        raise AssertionError('HTTP tools must not invoke providers')

    monkeypatch.setattr(httpx.Client, 'send', forbidden)
    monkeypatch.setattr(llm, 'create_model', forbidden)
    original_send = httpx.AsyncClient.send

    async def local_only(client, request, *args, **kwargs):
        assert isinstance(client._transport, httpx.ASGITransport), 'Outbound HTTP is forbidden'
        return await original_send(client, request, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, 'send', local_only)

    async def exercise():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as http:
                async with streamable_http_client('http://127.0.0.1/mcp', http_client=http) as (reader, writer, session_id):
                    async with ClientSession(reader, writer) as client:
                        initialized = await client.initialize()
                        assert initialized.serverInfo.name == '比赛侦探'
                        assert session_id() is None
                        tools = await client.list_tools()
                        assert {tool.name for tool in tools.tools} == {'search_contests', 'get_contest', 'match_contests'}
                        for tool in tools.tools:
                            assert tool.annotations.readOnlyHint is True
                            assert tool.annotations.destructiveHint is False
                            assert tool.annotations.openWorldHint is False
                        arguments = [
                            ('search_contests', {'ids': [contest_id], 'page_size': 1}),
                            ('get_contest', {'id': contest_id}),
                            ('match_contests', {'profile': {'skills': ['Python'], 'github': 'public-person'}}),
                        ]
                        stdio = create_server(session_factory=factory)
                        for name, params in arguments:
                            result = await client.call_tool(name, params)
                            _, expected = await stdio.call_tool(name, params)
                            assert not result.isError
                            assert result.structuredContent == expected
                            if name == 'get_contest':
                                assert result.structuredContent == web_detail
                                field = result.structuredContent['fields']['start_at']
                                assert field['precision'] == 'day'
                                assert field['level'] == 'official'
                                assert field['sources'][0]['url'] == 'https://event.devpost.com/'
                        invalid = await client.call_tool('search_contests', {'page': 0})
                        missing = await client.call_tool('get_contest', {'id': 'missing'})
                        assert invalid.isError and missing.isError
                        assert counts(bind) == before
                        with app.state.db_engine.connect() as connection:
                            with pytest.raises(OperationalError, match='readonly'):
                                connection.exec_driver_sql('delete from contests')

    asyncio.run(asyncio.wait_for(exercise(), timeout=20))
    assert not any(re.search(r'\b(?:from|join)\s+(?:users|sessions|auth_sessions|llm_usage)\b', sql) for sql in statements)
    assert not any(sql.lstrip().startswith(('insert', 'update', 'create', 'alter', 'drop')) for sql in statements)
    assert counts(bind) == before


def initialize(client, headers=None):
    return client.post('/mcp', headers={
        'Accept': 'application/json, text/event-stream', **(headers or {}),
    }, json={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
        'protocolVersion': '2025-11-25', 'capabilities': {},
        'clientInfo': {'name': 'remote-test', 'version': '1.0'},
    }})


@pytest.mark.parametrize(('headers', 'status'), [
    ({'Host': '43.142.60.212'}, 200),
    ({'Host': '43.142.60.212:80', 'Origin': 'http://43.142.60.212'}, 200),
    ({'Host': 'untrusted.example'}, 421),
    ({'Origin': 'https://untrusted.example'}, 403),
    ({'Origin': 'null'}, 403),
])
def test_http_enforces_public_host_and_origin_allowlists(database, headers, status):
    from contest_detective.bootstrap.mcp_http import create_app

    with TestClient(create_app(database_url=database[0]), base_url='http://127.0.0.1') as client:
        assert initialize(client, headers).status_code == status


def test_http_bounds_request_size_and_does_not_keep_browser_sessions(database):
    from contest_detective.bootstrap.mcp_http import create_app

    with TestClient(create_app(database_url=database[0]), base_url='http://127.0.0.1') as client:
        initialized = initialize(client)
        assert initialized.status_code == 200
        assert 'mcp-session-id' not in initialized.headers
        assert 'set-cookie' not in initialized.headers
        oversized = client.post('/mcp', headers={'Accept': 'application/json, text/event-stream',
                                                 'Content-Type': 'application/json'},
                                content=json.dumps({'padding': 'x' * 65536}))
        assert oversized.status_code == 413


def test_missing_database_fails_startup_without_creating_a_file(tmp_path):
    from contest_detective.bootstrap.mcp_http import create_app

    path = tmp_path / 'absent.db'
    with pytest.raises(OperationalError), TestClient(create_app(database_url=f'sqlite:///{path}')):
        pass
    assert not path.exists()
