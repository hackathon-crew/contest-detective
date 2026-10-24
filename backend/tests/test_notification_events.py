from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from contest_detective.server.contest import service
from contest_detective.server.contest.models import ContestEvent
from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn


def draft(value='上海', excerpt='上海'):
    return ContestDraft(name='通知事务测试', page=PageIn(url='https://example.com/event', site='example', title='比赛', is_official=True),
                        claims=[ClaimIn(field='city', value=value, excerpt=excerpt)])


def test_events_commit_with_contests_and_ignore_source_wording(session):
    key = service.save(session, draft())
    events = session.scalars(select(ContestEvent)).all()
    assert len(events) == 1 and events[0].kind == 'created'
    service.save(session, draft(excerpt='上海市，标点补全'), contest_id=key)
    assert len(session.scalars(select(ContestEvent)).all()) == 1
    service.save(session, draft('北京'), contest_id=key, commit=False)
    session.rollback()
    assert len(session.scalars(select(ContestEvent)).all()) == 1
    assert service.get(session, key).fields['city'].value == '上海'
    service.save(session, draft('北京'), contest_id=key)
    assert session.scalars(select(ContestEvent).order_by(ContestEvent.id)).all()[-1].kind == 'updated'


def test_pipeline_can_suppress_notifications_without_skipping_storage(session, monkeypatch):
    import importlib
    from sqlalchemy.orm import sessionmaker
    from contest_detective.server.contest.models import Contest
    from contest_detective.server.research_pipeline.pipeline.models import ContestSyncOutput
    module = importlib.import_module('contest_detective.server.research_pipeline.pipeline.execute')
    calls = []
    async def write(*_):
        with sessionmaker(bind=session.get_bind())() as current:
            calls.append(service.save(current, draft('北京' if calls else '上海')))
        return ContestSyncOutput(records=[], saved=1)
    monkeypatch.setattr(module, '_run', write)
    module.run_pipeline(sessionmaker(bind=session.get_bind()), publish_notifications=False)
    assert session.scalar(select(Contest)) is not None
    assert session.scalar(select(ContestEvent)) is None
    module.run_pipeline(sessionmaker(bind=session.get_bind()), publish_notifications=True)
    assert session.scalar(select(ContestEvent)).kind == 'updated'


def test_multiple_sources_rollback_as_one_contest_transaction(session, monkeypatch):
    import importlib
    from sqlalchemy.orm import sessionmaker
    from contest_detective.server.contest.models import Contest
    from contest_detective.server.research_pipeline.pipeline.models import ContestRecord, ContestSyncContext, ContestSyncInput
    module = importlib.import_module('contest_detective.server.research_pipeline.pipeline.persist')
    original, calls = module.save, []
    def failing_save(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2: raise ValueError('second source failed')
        return original(*args, **kwargs)
    monkeypatch.setattr(module, 'save', failing_save)
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('AI',)), records=[ContestRecord(name='原子写入', fields={
        'city': {'value': '上海', 'level': 'official', 'sources': [
            {'url': 'https://example.com/one', 'site': 'one', 'title': 'one', 'is_official': True, 'value': '上海', 'excerpt': '上海'},
            {'url': 'https://example.com/two', 'site': 'two', 'title': 'two', 'is_official': True, 'value': '上海', 'excerpt': '上海'},
        ]}})])
    assert module.persist(sessionmaker(bind=session.get_bind()), ctx) == 0
    assert ctx.failed == 1
    assert session.scalar(select(Contest)) is None
    assert session.scalar(select(ContestEvent)) is None
