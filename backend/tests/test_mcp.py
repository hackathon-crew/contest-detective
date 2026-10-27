import asyncio
from datetime import timedelta
import json
import os
from pathlib import Path
import re
import sys

import httpx
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.db import Base, init_db
from contest_detective.contest.schemas import ContestDraft
from contest_detective.contest.service import save


def seed(factory):
    with factory() as session:
        return save(session, ContestDraft(name='Python 黑客松', page={
            'url': 'https://event.devpost.com/', 'site': 'Devpost', 'title': 'Python 黑客松', 'is_official': True,
        }, claims=[
            {'field': 'start_at', 'value': '2099-11-01', 'precision': 'day', 'excerpt': '2099年11月1日'},
            {'field': 'mode', 'value': 'online', 'excerpt': '线上参赛'},
        ]))


def counts(bind):
    with bind.connect() as connection:
        return {table.name: connection.scalar(select(func.count()).select_from(table))
                for table in Base.metadata.sorted_tables}


def test_tools_have_read_only_annotations_and_exact_input_boundaries(session_factory):
    from contest_detective.bootstrap.mcp import create_server

    tools = {tool.name: tool for tool in asyncio.run(create_server(session_factory=session_factory).list_tools())}
    assert set(tools) == {'search_contests', 'get_contest', 'match_contests'}
    for tool in tools.values():
        assert tool.annotations.readOnlyHint is True
        assert tool.annotations.destructiveHint is False
        assert tool.annotations.openWorldHint is False
    assert set(tools['search_contests'].inputSchema['properties']) == {
        'keyword', 'status', 'mode', 'date_from', 'date_to', 'ids', 'sort', 'page', 'page_size',
    }
    assert tools['match_contests'].inputSchema['required'] == ['profile']
    assert tools['get_contest'].inputSchema['required'] == ['id']


def test_tools_reuse_local_data_without_writes_network_models_or_login_queries(session_factory, monkeypatch):
    from contest_detective.bootstrap.mcp import create_server
    from contest_detective.agent import llm

    contest_id = seed(session_factory)
    bind = session_factory.kw['bind']
    before = counts(bind)
    statements = []
    event.listen(bind, 'before_cursor_execute', lambda _c, _u, statement, *_: statements.append(statement.lower()))
    def forbidden(*_args, **_kwargs):
        raise AssertionError('Read-only tools must not use a provider')
    monkeypatch.setattr(httpx.Client, 'send', forbidden)
    monkeypatch.setattr(httpx.AsyncClient, 'send', forbidden)
    monkeypatch.setattr(llm, 'create_model', forbidden)
    server = create_server(session_factory=session_factory)
    async def read():
        _, results = await server.call_tool('search_contests', {'keyword': 'Python', 'mode': 'online', 'page_size': 1})
        _, detail = await server.call_tool('get_contest', {'id': contest_id})
        _, matches = await server.call_tool('match_contests', {'profile': {'skills': ['Python'], 'github': 'public-person'}})
        return results, detail, matches
    results, detail, matches = asyncio.run(read())
    assert results['total'] == 1 and results['items'][0]['id'] == contest_id
    assert detail['fields']['start_at']['precision'] == 'day'
    assert matches['items'][0]['contest']['id'] == contest_id
    json.dumps([results, detail, matches], ensure_ascii=False)
    assert not any(statement.lstrip().startswith(('insert', 'update', 'delete', 'create', 'alter', 'drop')) for statement in statements)
    assert not any(re.search(r'\b(?:from|join)\s+(?:users|sessions|auth_sessions)\b', statement) for statement in statements)
    assert counts(bind) == before


@pytest.mark.parametrize(('name', 'arguments'), [
    ('search_contests', {'page': 0}),
    ('search_contests', {'date_from': '2099-11-02T00:00:00Z', 'date_to': '2099-11-01T00:00:00Z'}),
    ('get_contest', {'id': 'missing'}),
    ('match_contests', {}),
    ('match_contests', {'profile': {'skills': ['']}}),
])
def test_invalid_arguments_and_missing_contests_are_tool_errors(session_factory, name, arguments):
    from contest_detective.bootstrap.mcp import create_server

    before = counts(session_factory.kw['bind'])
    with pytest.raises(ToolError):
        asyncio.run(create_server(session_factory=session_factory).call_tool(name, arguments))
    assert counts(session_factory.kw['bind']) == before


def test_configured_engine_uses_an_existing_sqlite_file_in_read_only_mode(tmp_path):
    from contest_detective.bootstrap.mcp import readonly_engine

    path = tmp_path / 'event store.db'
    bind = create_engine(f'sqlite:///{path}')
    with bind.begin() as connection:
        connection.execute(text('create table marker (value text)'))
    bind.dispose()
    read_only = readonly_engine(f'sqlite:///{path}')
    try:
        with read_only.connect() as connection:
            assert connection.scalar(text('select count(*) from marker')) == 0
            with pytest.raises(OperationalError, match='readonly'):
                connection.execute(text("insert into marker values ('blocked')"))
    finally:
        read_only.dispose()
    missing = tmp_path / 'missing.db'
    absent = readonly_engine(f'sqlite:///{missing}')
    try:
        with pytest.raises(OperationalError):
            absent.connect()
        assert not missing.exists()
    finally:
        absent.dispose()


def test_real_stdio_handshake_queries_errors_and_clean_process_shutdown(tmp_path):
    path = tmp_path / 'stdio.db'
    bind = create_engine(f'sqlite:///{path}')
    init_db(bind)
    factory = sessionmaker(bind=bind, expire_on_commit=False)
    contest_id = seed(factory)
    before = counts(bind)
    guard = tmp_path / 'guard'
    guard.mkdir()
    pid_file, network_file = tmp_path / 'pid', tmp_path / 'network'
    (guard / 'sitecustomize.py').write_text(
        'import os, pathlib, sys\n'
        f'pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n'
        'def guard(event, args):\n'
        '    if event in {"socket.connect", "socket.getaddrinfo"}:\n'
        f'        pathlib.Path({str(network_file)!r}).write_text(event)\n'
        '        raise RuntimeError("Network access is forbidden in this test")\n'
        'sys.addaudithook(guard)\n'
    )
    params = StdioServerParameters(command=str(Path(sys.executable).with_name('contest-detective-mcp')),
        cwd=str(Path(__file__).parents[1]), env={
            'DETECTIVE_DB_URL': f'sqlite:///{path}', 'DETECTIVE_LLM_ENABLED': 'false',
            'PYTHONPATH': str(guard),
        })
    async def exercise():
        with (tmp_path / 'stderr').open('w') as errors:
            async with stdio_client(params, errlog=errors) as (reader, writer):
                async with ClientSession(reader, writer, read_timeout_seconds=timedelta(seconds=10)) as client:
                    initialized = await client.initialize()
                    assert initialized.serverInfo.name == '比赛侦探'
                    tools = await client.list_tools()
                    assert {tool.name for tool in tools.tools} == {'search_contests', 'get_contest', 'match_contests'}
                    search = await client.call_tool('search_contests', {'ids': [contest_id], 'page': 1})
                    detail = await client.call_tool('get_contest', {'id': contest_id})
                    matches = await client.call_tool('match_contests', {'profile': {'skills': ['Python']}})
                    invalid = await client.call_tool('search_contests', {'page': 0})
                    missing = await client.call_tool('get_contest', {'id': 'missing'})
                    assert search.structuredContent['items'][0]['id'] == contest_id
                    assert detail.structuredContent['id'] == contest_id
                    assert matches.structuredContent['items'][0]['contest']['id'] == contest_id
                    assert not search.isError and not detail.isError and not matches.isError
                    assert invalid.isError and missing.isError
    try:
        asyncio.run(asyncio.wait_for(exercise(), timeout=20))
        assert counts(bind) == before
        assert not network_file.exists()
        with pytest.raises(ProcessLookupError):
            os.kill(int(pid_file.read_text()), 0)
    finally:
        bind.dispose()
