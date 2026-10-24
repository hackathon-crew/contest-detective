from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import inspect, select

from contest_detective.framework import db
from contest_detective.server.contest import service
from contest_detective.server.contest.models import Contest, ContestDetails
from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn


def migrate(engine, revision, *, downgrade=False):
    config = Config()
    config.set_main_option('script_location', str(Path(db.__file__).parent / 'migrations'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        (command.downgrade if downgrade else command.upgrade)(config, revision)


def test_legacy_content_roundtrips_upgrade_and_empty_content_downgrade(session_factory):
    engine = session_factory.kw['bind']
    with session_factory() as session:
        cid = service.save(session, ContestDraft(name='Legacy event', summary='Complete historical text.',
            page=PageIn(url='https://organizer.example/event', site='Organizer', title='Legacy event', is_official=True),
            claims=[ClaimIn(field='city', value='Shanghai', excerpt='City: Shanghai')]))
    migrate(engine, '0010_account_center', downgrade=True)
    assert 'documents' not in {column['name'] for column in inspect(engine).get_columns('contest_details')}
    assert inspect(engine).get_pk_constraint('contest_claims')['constrained_columns'] == ['contest_id', 'page_id', 'field']
    migrate(engine, 'head')
    with session_factory() as session:
        detail = service.get(session, cid)
        assert detail.summary == 'Complete historical text.'
        assert detail.fields['city'].value == 'Shanghai'
        assert detail.introduction is None and detail.documents == []
    assert inspect(engine).get_pk_constraint('contest_claims')['constrained_columns'] == ['contest_id', 'page_id', 'field', 'value']


def test_get_missing_legacy_details_is_pure_and_does_not_create_rows(session_factory):
    with session_factory() as session:
        session.add(Contest(id='legacy-no-details', name='Legacy record', normalized_name='legacyrecord', fields={}))
        session.commit()
        assert session.scalar(select(ContestDetails)) is None
        result = service.get(session, 'legacy-no-details')
        assert result.introduction is None and result.coverage.introduction.state == 'not_fetched'
        assert session.scalar(select(ContestDetails)) is None
        assert not session.new and not session.dirty


def test_downgrade_refuses_to_discard_new_conflict_evidence(session_factory):
    engine = session_factory.kw['bind']
    with session_factory() as session:
        service.save(session, ContestDraft(name='Conflicting event', page=PageIn(
            url='https://organizer.example/event', site='Organizer', title='Conflicting event', is_official=True), claims=[
                ClaimIn(field='team_size', value='1 to 4', excerpt='Solo or up to four.'),
                ClaimIn(field='team_size', value='2 to 4', excerpt='Teams must have at least two.')]))
    with pytest.raises(ValueError, match='conflict'):
        migrate(engine, '0010_account_center', downgrade=True)
