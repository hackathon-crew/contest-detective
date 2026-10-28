import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.db import get_session
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.models import LLMUsage
from contest_detective.system.auth import service as auth
from contest_detective.system.documents.schemas import MAX_QUESTION_BYTES
from contest_detective.bootstrap.api.companion import limiter
from contest_detective.bootstrap.api.mail import get_mailer
from contest_detective.bootstrap.app import create_app

from account_helpers import Mailbox, request_code
from test_document_contracts import grounded_answer, question_data
from test_document_lifecycle import provider


@pytest.fixture(autouse=True)
def clear_limits():
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def signed_in(client):
    client.app.dependency_overrides[auth.current] = lambda: 'test-user'
    return client


def test_unauthenticated_question_never_constructs_a_model(client, monkeypatch, session):
    clients, requests = provider(monkeypatch)
    response = client.post('/companion/documents/ask', json=question_data())
    assert response.status_code == 200
    assert response.json()['code'] == 401 and response.json()['data'] is None
    assert clients == requests == []
    assert session.scalars(select(LLMUsage)).all() == []


def test_signed_in_answer_uses_response_envelope(signed_in, monkeypatch):
    clients, requests = provider(monkeypatch)
    response = signed_in.post('/companion/documents/ask', json=question_data())
    assert response.status_code == 200
    assert response.json() == {'code': 200, 'message': 'success', 'data': grounded_answer()}
    assert len(requests) == 1 and clients[0].is_closed()


def test_minute_rate_limit_blocks_before_model_creation(signed_in, monkeypatch, session):
    clients, requests = provider(monkeypatch)
    for _ in range(5):
        assert signed_in.post('/companion/documents/ask', json=question_data()).json()['code'] == 200
    rejected = signed_in.post('/companion/documents/ask', json=question_data())
    assert rejected.status_code == 200 and rejected.json()['code'] == 429
    assert len(clients) == len(requests) == 5 and all(client.is_closed() for client in clients)
    assert len(session.scalars(select(LLMUsage)).all()) == 5


@pytest.mark.parametrize('patch', [
    {'question': ''}, {'question': 'x' * 1001}, {'passages': []},
    {'passages': question_data()['passages'] * 2},
])
def test_invalid_request_never_creates_provider_or_echoes_source(signed_in, monkeypatch, patch, caplog):
    clients, requests = provider(monkeypatch)
    response = signed_in.post('/companion/documents/ask', json=question_data() | patch)
    assert response.status_code == 200 and response.json()['code'] == 400
    assert clients == requests == []
    assert response.json()['data'] is None
    assert 'demonstration video' not in response.text + caplog.text


def test_raw_byte_bound_applies_even_to_json_whitespace(signed_in, monkeypatch):
    clients, requests = provider(monkeypatch)
    payload = json.dumps(question_data()).encode()
    response = signed_in.post('/companion/documents/ask', content=payload + b' ' * MAX_QUESTION_BYTES,
                              headers={'Content-Type': 'application/json'})
    assert response.status_code == 200 and response.json()['code'] == 400
    assert clients == requests == []


def test_chunked_body_is_bounded_without_content_length(signed_in, monkeypatch):
    clients, requests = provider(monkeypatch)
    chunks = (chunk for chunk in [b'{', b' ' * 12000, b' ' * 12000, b' ' * 1000])
    response = signed_in.post('/companion/documents/ask', content=chunks,
                              headers={'Content-Type': 'application/json'})
    assert 'content-length' not in response.request.headers
    assert response.status_code == 200 and response.json()['code'] == 400
    assert clients == requests == []


def test_exact_raw_limit_is_accepted(signed_in, monkeypatch):
    clients, requests = provider(monkeypatch)
    payload = json.dumps(question_data()).encode()
    response = signed_in.post('/companion/documents/ask',
        content=payload + b' ' * (MAX_QUESTION_BYTES - len(payload)),
        headers={'Content-Type': 'application/json'})
    assert response.json()['code'] == 200
    assert len(requests) == 1 and clients[0].is_closed()


def test_malformed_json_is_a_sanitized_business_error(signed_in, monkeypatch):
    clients, requests = provider(monkeypatch)
    response = signed_in.post('/companion/documents/ask', content=b'{"private-document-sentinel":',
                              headers={'Content-Type': 'application/json'})
    assert response.status_code == 200 and response.json()['code'] == 400
    assert response.json()['data'] is None and 'private-document-sentinel' not in response.text
    assert clients == requests == []


def test_disabled_model_is_an_explicit_business_failure(signed_in, monkeypatch):
    clients, requests = provider(monkeypatch, config=LLMSettings(_env_file=None, enabled=False))
    response = signed_in.post('/companion/documents/ask', json=question_data())
    assert response.status_code == 200 and response.json()['code'] == 503
    assert response.json()['data'] == {'action': 'settings'} and clients == requests == []


def test_authenticated_cookie_roundtrip_and_logout(tmp_path, monkeypatch):
    clients, requests = provider(monkeypatch)
    path = tmp_path / 'companion.db'
    engine = create_engine('sqlite:///' + str(path), connect_args={'check_same_thread': False})
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    async_factory = async_sessionmaker(create_async_engine('sqlite+aiosqlite:///' + str(path)), expire_on_commit=False)
    app = create_app(db_engine=engine, async_session_factory=async_factory)
    def session_override():
        with factory() as session:
            yield session
    app.dependency_overrides[get_session] = session_override
    mailbox = Mailbox()
    app.state.mailbox = mailbox
    app.dependency_overrides[get_mailer] = lambda: mailbox
    with TestClient(app) as browser:
        code = request_code(browser, 'reader@example.org')
        assert browser.post('/auth/register', json={'email': 'reader@example.org', 'password': 'password123', 'code': code}).json()['code'] == 200
        assert browser.post('/auth/login', json={'email': 'reader@example.org', 'password': 'password123'}).json()['code'] == 200
        assert 'cd_session' in browser.cookies
        assert browser.post('/companion/documents/ask', json=question_data()).json()['code'] == 200
        browser.post('/auth/logout')
        assert browser.post('/companion/documents/ask', json=question_data()).json()['code'] == 401
    assert len(requests) == 1 and clients[0].is_closed()
    engine.dispose()


def test_openapi_exposes_bounded_document_contract(client):
    schema = client.app.openapi()
    operation = schema['paths']['/companion/documents/ask']['post']
    assert operation['requestBody']['content']['application/json']['schema']['$ref'].endswith('/DocumentQuestion')
    assert 'Response_DocumentAnswer_' in operation['responses']['200']['content']['application/json']['schema']['$ref']
    question = schema['components']['schemas']['DocumentQuestion']
    assert question['properties']['question']['maxLength'] == 1000
    assert question['properties']['passages']['maxItems'] == 8
