import asyncio

import pytest

from contest_detective.server.contest.schemas import ContestDraft, ContestQuery
from contest_detective.server.contest.service import get, query


def extracted(*, claims=None):
    return ContestDraft(name='公开周末赛',
        page={'url': 'https://invented.example/not-evidence', 'site': 'invented',
              'title': 'invented', 'is_official': True, 'published_at': '2099-01-01T00:00:00Z'},
        claims=claims if claims is not None else [
            {'field': 'city', 'value': '上海', 'excerpt': '地点： 上海'},
            {'field': 'prize', 'value': '十万元', 'excerpt': '没有这段原文'},
            {'field': 'mode', 'value': 'offline', 'excerpt': ''},
        ])


def test_record_page_keeps_only_supported_excerpts_and_fixes_source_identity(session_factory):
    from contest_detective.server.research_pipeline import run

    async def extractor(url, text):
        return extracted()

    contest_id = asyncio.run(run('https://organizer.example/rules', extractor=extractor,
        session_factory=session_factory, page_text='公开周末赛\n地点：\n  上海\n周末到场',
        registration_url='https://organizer.example/register'))
    with session_factory() as session:
        detail = get(session, contest_id)
    assert detail.fields['city'].value == '上海'
    assert detail.fields['city'].level == 'official'
    assert detail.fields['prize'].level == 'not_found'
    assert detail.fields['mode'].level == 'not_found'
    source, = detail.fields['city'].sources
    assert source.url == 'https://organizer.example/rules'
    assert source.site == 'organizer.example'
    assert source.published_at is None
    assert source.title == '公开周末赛'


def test_record_page_does_not_take_official_context_from_extracted_registration_claim(session_factory):
    from contest_detective.server.research_pipeline.service import run

    async def extractor(url, text):
        return extracted(claims=[{'field': 'registration_url', 'value': url, 'excerpt': '报名链接'}])

    contest_id = asyncio.run(run('https://unknown.example/rules', extractor=extractor,
        session_factory=session_factory, page_text='报名链接'))
    with session_factory() as session:
        assert get(session, contest_id).fields['registration_url'].level == 'reposted'


def test_record_page_with_no_supported_evidence_does_not_save(session_factory):
    from contest_detective.server.research_pipeline.service import run

    async def extractor(url, text):
        return extracted()

    assert asyncio.run(run('https://events.example/rules', extractor=extractor,
        session_factory=session_factory, page_text='没有任何已抽取的字段')) is None
    with session_factory() as session:
        assert query(session, ContestQuery())[1] == 0


def test_record_page_refuses_excerpts_beyond_the_body_limit(session_factory):
    from contest_detective.server.research_pipeline.service import run

    async def extractor(url, text):
        return extracted(claims=[{'field': 'city', 'value': '上海', 'excerpt': '地点：上海'}])

    assert asyncio.run(run('https://events.example/rules', extractor=extractor,
        session_factory=session_factory, page_text='x' * 6000 + '地点：上海')) is None
    with session_factory() as session:
        assert query(session, ContestQuery())[1] == 0


def test_record_page_propagates_extraction_failure_without_saving(session_factory):
    from contest_detective.server.research_pipeline.service import run

    async def extractor(url, text):
        raise ValueError('抽取失败')

    with pytest.raises(ValueError, match='抽取失败'):
        asyncio.run(run('https://events.example/rules', extractor=extractor,
            session_factory=session_factory, page_text='公开正文'))
    with session_factory() as session:
        assert query(session, ContestQuery())[1] == 0


def test_record_page_fetches_a_public_body_before_extraction(session_factory, monkeypatch):
    import httpx
    from contest_detective.server.research_pipeline import record
    from contest_detective.server.research_pipeline.pages import fetch_page

    async def extractor(url, text):
        return extracted()

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, text='公开周末赛 地点： 上海', headers={'content-type': 'text/plain'},
    ))) as client:
        monkeypatch.setattr(record, 'fetch_page', lambda url: fetch_page(
            url, client=client, resolver=lambda *_args, **_kwargs: [(None, None, None, None, ('8.8.8.8', 443))],
        ))
        contest_id = asyncio.run(record.run('https://host.devpost.com/rules',
            extractor=extractor, session_factory=session_factory))
    with session_factory() as session:
        assert get(session, contest_id).fields['city'].level == 'official'
