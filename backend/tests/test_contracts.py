from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from contest_detective.contest.schemas import ContestDraft, ContestQuery


@pytest.fixture
def client(authenticated_client):
    return authenticated_client


def test_draft_preserves_deadline_kind():
    draft = ContestDraft(name='Hack', page={'url':'https://example.com','site':'主办方','title':'规则','published_at':None,'is_official':True}, claims=[{'field':'submission_deadline','value':'2026-10-25T08:00:00Z','excerpt':'16:00 提交截止'}])
    assert draft.claims[0].field == 'submission_deadline'
    assert draft.cover_url is None


def test_query_rejects_invalid_bounds():
    with pytest.raises(ValidationError):
        ContestQuery(page=0)
    with pytest.raises(ValidationError):
        ContestQuery(date_from=datetime(2026,11,1,tzinfo=timezone.utc),date_to=datetime(2026,10,1,tzinfo=timezone.utc))


def test_question_is_validated_before_stream_opens(client):
    for value in ['', ' '*4]:
        response=client.post('/agent/ask',json={'question':value})
        assert response.json()['code'] == 400
        assert response.headers['content-type'].startswith('application/json')


def test_contracts_are_exported(client):
    schema=client.get('/openapi.json').json()
    assert '/contests' in schema['paths']
    assert 'text/event-stream' in schema['paths']['/agent/ask']['post']['responses']['200']['content']


def test_event_payload_matches_event_type():
    from contest_detective.agent.schemas import TraceEvent
    event=TraceEvent(type='answer',payload={'content':'[日期](https://example.com)'})
    assert event.payload['sources'] == []
    with pytest.raises(ValidationError):
        TraceEvent(type='step',payload={'content':'wrong payload'})
