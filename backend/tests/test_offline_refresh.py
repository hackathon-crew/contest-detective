from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from contest_detective.framework.db import init_db
from contest_detective.server.contest import service
from contest_detective.server.contest.content import ContestDocument
from contest_detective.server.contest.content_service import build_introduction
from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.server.research_pipeline.refresh.contracts import RefreshDocument, RefreshEntry, RefreshManifest
from contest_detective.server.research_pipeline.refresh.importer import OfflineImporter, public_fingerprint
from contest_detective.server.research_pipeline.refresh.journal import restore

NOW = datetime(2026, 10, 24, tzinfo=timezone.utc)


def document(body='Student developers build useful open-source projects together. Teams have 2 to 4 members.', url='https://organizer.example/event'):
    return ContestDocument(url=url, site='Organizer', title='Public builder event', is_official=True,
        body=body, content_hash=sha256(body.encode()).hexdigest(), retrieved_at=NOW,
        extractor_version='content-v1', fetch_method='http', completeness='full')


def manifest(contest_id=None, *, name='Public builder event', body=None):
    doc = document() if body is None else document(body)
    return RefreshManifest(manifest_id='fixture-v1', extractor_version='content-v1', created_at=NOW,
        scope='One synthetic public event', entries=[RefreshEntry(key='fixture-event', name=name,
            contest_id=contest_id, introduction=build_introduction(doc),
            documents=[RefreshDocument(document=doc, claims=[ClaimIn(field='team_size',
                value='2 to 4 members', excerpt='Teams have 2 to 4 members.')])])])


@pytest.fixture
def database(tmp_path):
    path = tmp_path / 'contest.db'
    engine = create_engine('sqlite:///' + str(path))
    init_db(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE private_marker (id INTEGER PRIMARY KEY, value TEXT)')
        connection.exec_driver_sql("INSERT INTO private_marker VALUES (1, 'must remain untouched')")
    engine.dispose()
    return path


def detail(database, contest_id):
    engine = create_engine('sqlite:///' + str(database))
    try:
        with Session(engine) as session:
            return service.get(session, contest_id)
    finally:
        engine.dispose()


def seed(database):
    engine = create_engine('sqlite:///' + str(database))
    try:
        with Session(engine) as session:
            return service.save(session, ContestDraft(name='Public builder event', summary='Historical body stays complete.',
                page=PageIn(url='https://organizer.example/event', site='Organizer', title='Event', is_official=True),
                claims=[ClaimIn(field='prize', value='Book vouchers', excerpt='Book vouchers')]))
    finally:
        engine.dispose()


def test_dry_run_is_offline_and_does_not_mutate_target(database, tmp_path, monkeypatch):
    import socket
    monkeypatch.setattr(socket.socket, 'connect', lambda *_: pytest.fail('Network must not be used'))
    before = database.read_bytes()
    report = OfflineImporter().run(manifest(), database=database, output_directory=tmp_path / 'reports')
    assert report.dry_run and report.created == 1 and report.failed == 0
    assert database.read_bytes() == before
    assert report.backup_path is None and report.journal_path is None


def test_apply_preserves_old_body_claims_accounts_and_is_idempotent(database, tmp_path):
    contest_id = seed(database)
    package = manifest(contest_id)
    package.entries[0].expected_fingerprint = public_fingerprint(detail(database, contest_id))
    importer = OfflineImporter()
    report = importer.run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert (report.created, report.updated, report.failed) == (0, 1, 0)
    assert Path(report.backup_path).is_file() and Path(report.journal_path).is_file()
    result = detail(database, contest_id)
    assert result.summary == 'Historical body stays complete.'
    assert result.fields['prize'].value == 'Book vouchers'
    assert result.fields['team_size'].value == '2 to 4 members'
    assert result.introduction and result.documents[0].body is None
    assert result.documents[0].excerpts
    second = importer.run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert (second.unchanged, second.updated, second.failed) == (1, 0, 0)
    with sqlite3.connect(database) as connection:
        assert connection.execute('SELECT value FROM private_marker').fetchone()[0] == 'must remain untouched'
        stored = json.loads(connection.execute('SELECT documents FROM contest_details').fetchone()[0])
        assert stored[0]['body'] == document().body


def test_rollback_restores_only_import_changes_and_refuses_later_edits(database, tmp_path):
    contest_id = seed(database)
    before = detail(database, contest_id)
    report = OfflineImporter().run(manifest(contest_id), database=database, dry_run=False, output_directory=tmp_path / 'reports')
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE private_marker SET value='later unrelated edit'")
    restore(database=database, journal=Path(report.journal_path))
    assert public_fingerprint(detail(database, contest_id)) == public_fingerprint(before)
    with sqlite3.connect(database) as connection:
        assert connection.execute('SELECT value FROM private_marker').fetchone()[0] == 'later unrelated edit'
    report = OfflineImporter().run(manifest(contest_id), database=database, dry_run=False, output_directory=tmp_path / 'reports')
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE contest_details SET summary='later contest edit'")
    with pytest.raises(ValueError, match='changed after'):
        restore(database=database, journal=Path(report.journal_path))
    assert detail(database, contest_id).summary == 'later contest edit'


def test_bad_evidence_isolated_and_partial_import_never_erases_history(database, tmp_path):
    contest_id = seed(database)
    package = manifest(contest_id)
    package.entries[0].documents[0].document.completeness = 'partial'
    bad = package.entries[0].model_copy(deep=True)
    bad.key = 'bad-hash'
    bad.documents[0].document.content_hash = '0' * 64
    package.entries.append(bad)
    report = OfflineImporter().run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert (report.updated, report.failed) == (1, 1)
    assert report.failures[0].stage == 'validate'
    assert detail(database, contest_id).fields['prize'].value == 'Book vouchers'


def test_same_page_and_official_conflicts_survive(database, tmp_path):
    package = manifest()
    body = 'Student developers build useful projects together. End time 18:00. End time 19:02.'
    doc = document(body)
    package.entries[0].introduction = build_introduction(doc)
    package.entries[0].documents = [RefreshDocument(document=doc, claims=[
        ClaimIn(field='end_at', value='2026-10-25T18:00:00+08:00', excerpt='End time 18:00.'),
        ClaimIn(field='end_at', value='2026-10-25T19:02:00+08:00', excerpt='End time 19:02.'),
    ])]
    report = OfflineImporter().run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert report.created == 1 and report.failed == 0
    with sqlite3.connect(database) as connection:
        contest_id = connection.execute('SELECT id FROM contests').fetchone()[0]
    field = detail(database, contest_id).fields['end_at']
    assert field.level == 'conflict' and len(field.sources) == 2


def test_stale_public_fingerprint_and_generic_cross_edition_merge_are_rejected(database, tmp_path):
    contest_id = seed(database)
    package = manifest(contest_id)
    package.entries[0].expected_fingerprint = '0' * 64
    report = OfflineImporter().run(package, database=database, output_directory=tmp_path / 'reports')
    assert report.updated == 0 and report.failed == 1
    package.entries[0].expected_fingerprint = None
    package.entries[0].name = 'Public builder event 14.0'
    engine = create_engine('sqlite:///' + str(database))
    with engine.begin() as connection:
        connection.execute(text("UPDATE contests SET name='Public builder event 13.0'"))
    engine.dispose()
    report = OfflineImporter().run(package, database=database, output_directory=tmp_path / 'reports')
    assert report.failed == 1 and 'editions' in report.failures[0].reason


def test_cli_never_reads_dotenv_or_instantiates_a_model(database, tmp_path):
    package = tmp_path / 'package.json'
    package.write_text(manifest().model_dump_json())
    code = '''
import pathlib, socket, sys
class ForbiddenProviders:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.startswith(('contest_detective.server.agent',
                'contest_detective.server.research_pipeline.search',
                'contest_detective.server.research_pipeline.scheduler',
                'contest_detective.web.bootstrap.app')):
            raise AssertionError('provider/application import forbidden: ' + fullname)
sys.meta_path.insert(0, ForbiddenProviders())
from pydantic_settings.sources.providers.dotenv import DotEnvSettingsSource
old = DotEnvSettingsSource._read_env_files
def guard(self):
    assert self.env_file is None, 'dotenv must not be read'
    return old(self)
DotEnvSettingsSource._read_env_files = guard
socket.socket.connect = lambda *a, **k: (_ for _ in ()).throw(AssertionError('network forbidden'))
from contest_detective.web.bootstrap.offline_refresh import main
main()
assert 'contest_detective.server.agent.normalization' not in sys.modules
assert 'contest_detective.server.research_pipeline.scheduler' not in sys.modules
'''
    result = subprocess.run([sys.executable, '-c', code, '--manifest', str(package), '--database', str(database),
        '--output-directory', str(tmp_path / 'reports')], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)['dry_run'] is True


def test_auto_match_enforces_baseline_and_later_edition_dates(database, tmp_path):
    contest_id = seed(database)
    package = manifest()
    package.entries[0].expected_fingerprint = '0' * 64
    report = OfflineImporter().run(package, database=database, output_directory=tmp_path / 'reports')
    assert report.failed == 1 and 'baseline changed' in report.failures[0].reason
    package = manifest(contest_id)
    old = document('Student developers build useful projects. Starts 2026-10-30.')
    engine = create_engine('sqlite:///' + str(database))
    with Session(engine) as session:
        service.save(session, ContestDraft(name='Public builder event', page=PageIn(
            url=old.url, site=old.site, title=old.title, is_official=True), claims=[
                ClaimIn(field='start_at', value='2026-10-30', precision='day', excerpt='Starts 2026-10-30.')]),
            contest_id=contest_id)
    engine.dispose()
    doc = document('Student developers build useful projects. Starts 2027-10-30.')
    package.entries[0].documents = [RefreshDocument(document=doc, claims=[
        ClaimIn(field='start_at', value='2027-10-30', precision='day', excerpt='Starts 2027-10-30.')])]
    package.entries[0].introduction = build_introduction(doc)
    report = OfflineImporter().run(package, database=database, output_directory=tmp_path / 'reports')
    assert report.failed == 1 and 'dates' in report.failures[0].reason


def test_exact_mapping_correction_is_audited_and_reversible(database, tmp_path):
    from contest_detective.server.contest.content import ContentCitation
    from contest_detective.server.research_pipeline.refresh.contracts import ClaimRetirement
    contest_id = seed(database)
    engine = create_engine('sqlite:///' + str(database))
    with Session(engine) as session:
        service.save(session, ContestDraft(name='Public builder event', page=PageIn(
            url='https://organizer.example/event', site='Organizer', title='Event', is_official=True), claims=[
                ClaimIn(field='city', value='Harbor Hall', excerpt='location: Harbor Hall')]), contest_id=contest_id)
    engine.dispose()
    before = detail(database, contest_id)
    package = manifest(contest_id)
    doc = document('Student developers build useful projects together. Harbor Hall is in Bay City.')
    package.entries[0].documents = [RefreshDocument(document=doc, claims=[
        ClaimIn(field='city', value='Bay City', excerpt='Harbor Hall is in Bay City.')])]
    package.entries[0].introduction = build_introduction(doc)
    package.entries[0].expected_fingerprint = public_fingerprint(before)
    package.entries[0].retire_claims = [ClaimRetirement(url=doc.url, field='city', value='Harbor Hall',
        excerpt='location: Harbor Hall', reason='The old adapter treated a venue as a city.',
        citations=[ContentCitation(url=doc.url, content_hash=doc.content_hash, excerpt='Harbor Hall is in Bay City.')])]
    report = OfflineImporter().run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert report.failed == 0 and detail(database, contest_id).fields['city'].value == 'Bay City'
    audit = json.loads(Path(report.journal_path).read_text())
    assert any(change['before'] and change['before'].get('excerpt') == 'location: Harbor Hall'
               for change in audit['changes'])
    restore(database=database, journal=Path(report.journal_path))
    assert public_fingerprint(detail(database, contest_id)) == public_fingerprint(before)


def test_rollback_new_contest_never_cascades_into_later_private_data(database, tmp_path):
    report = OfflineImporter().run(manifest(), database=database, dry_run=False, output_directory=tmp_path / 'reports')
    with sqlite3.connect(database) as connection:
        contest_id = connection.execute('SELECT id FROM contests').fetchone()[0]
        connection.execute('CREATE TABLE private_follow (id TEXT PRIMARY KEY, contest_id TEXT REFERENCES contests(id) ON DELETE CASCADE)')
        connection.execute('INSERT INTO private_follow VALUES (?,?)', ('private-reference', contest_id))
    with pytest.raises(ValueError, match='non-contest dependent'):
        restore(database=database, journal=Path(report.journal_path))
    with sqlite3.connect(database) as connection:
        assert connection.execute('SELECT count(*) FROM private_follow').fetchone()[0] == 1
        connection.execute('DELETE FROM private_follow')
    restore(database=database, journal=Path(report.journal_path))
    with sqlite3.connect(database) as connection:
        assert connection.execute('SELECT count(*) FROM contests').fetchone()[0] == 0


def test_partial_evidence_cannot_claim_absence_or_reuse_changed_manifest_id(database, tmp_path):
    from contest_detective.server.contest.content import CoverageObservation
    package = manifest()
    doc = package.entries[0].documents[0].document
    doc.completeness = 'partial'
    package.entries[0].coverage.fields['eligibility'] = CoverageObservation(
        state='not_found_in_source', urls=[doc.url])
    importer = OfflineImporter()
    report = importer.run(package, database=database, output_directory=tmp_path / 'reports')
    assert report.failed == 1 and 'Partial evidence' in report.failures[0].reason
    package.entries[0].coverage.fields.clear()
    report = importer.run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert report.created == 1
    package.scope = 'Changed immutable manifest'
    with pytest.raises(ValueError, match='manifest_id'):
        importer.run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')


def test_reassertion_preserves_historical_excerpt_and_exact_midnight_precision(database, tmp_path):
    contest_id = seed(database)
    engine = create_engine('sqlite:///' + str(database))
    with Session(engine) as session:
        service.save(session, ContestDraft(name='Public builder event', page=PageIn(
            url='https://organizer.example/event', site='Organizer', title='Event', is_official=True), claims=[
                ClaimIn(field='end_at', value='2026-10-25T00:00:00Z', excerpt='Ends exactly at midnight UTC.'),
                ClaimIn(field='prize', value='Books', excerpt='Historical prize is Books.')]), contest_id=contest_id)
    engine.dispose()
    package = manifest(contest_id)
    doc = document('Student developers build useful projects together. Ends October 25. New prize is Books.')
    package.entries[0].documents = [RefreshDocument(document=doc, claims=[
        ClaimIn(field='end_at', value='2026-10-25', precision='day', excerpt='Ends October 25.'),
        ClaimIn(field='prize', value='Books', excerpt='New prize is Books.')])]
    package.entries[0].introduction = build_introduction(doc)
    report = OfflineImporter().run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert report.failed == 0
    result = detail(database, contest_id)
    assert result.fields['end_at'].precision == 'datetime'
    assert result.fields['end_at'].sources[0].excerpt == 'Ends exactly at midnight UTC.'
    assert result.fields['prize'].sources[0].excerpt == 'Historical prize is Books.'


def test_additive_refresh_cannot_reclassify_shared_historical_source(database, tmp_path):
    contest_id = seed(database)
    engine = create_engine('sqlite:///' + str(database))
    with Session(engine) as session:
        from contest_detective.server.contest.models import Contest
        from contest_detective.server.contest.identity import normalized_name
        other = Contest(id='other-edition', name='Earlier builder event', normalized_name=normalized_name('Earlier builder event'))
        session.add(other)
        session.flush()
        service.save(session, ContestDraft(name=other.name, page=PageIn(url='https://organizer.example/event',
            site='Original site', title='Historical title', is_official=True), claims=[
                ClaimIn(field='prize', value='Old award', excerpt='Old award')]), contest_id=other.id)
    engine.dispose()
    before = detail(database, 'other-edition')
    package = manifest(contest_id)
    report = OfflineImporter().run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert report.updated == 1 and report.failed == 0
    assert public_fingerprint(detail(database, 'other-edition')) == public_fingerprint(before)
    package.manifest_id = 'authority-change'
    package.entries[0].documents[0].document.is_official = False
    report = OfflineImporter().run(package, database=database, dry_run=False, output_directory=tmp_path / 'reports')
    assert report.failed == 1 and 'authority' in report.failures[0].reason
    assert public_fingerprint(detail(database, 'other-edition')) == public_fingerprint(before)


def test_corrupt_rollback_identity_and_duplicate_changes_are_rejected(database, tmp_path):
    report = OfflineImporter().run(manifest(), database=database, dry_run=False, output_directory=tmp_path / 'reports')
    original = json.loads(Path(report.journal_path).read_text())
    altered = json.loads(json.dumps(original))
    edit = next(change for change in altered['changes'] if change['table'] == 'contests')
    edit['after']['id'] = 'different-identity'
    bad = tmp_path / 'bad-journal.json'
    bad.write_text(json.dumps(altered))
    with pytest.raises(ValueError, match='identity'):
        restore(database=database, journal=bad)
    altered = json.loads(json.dumps(original))
    altered['changes'].append(altered['changes'][0])
    bad.write_text(json.dumps(altered))
    with pytest.raises(ValueError, match='duplicate'):
        restore(database=database, journal=bad)
    restore(database=database, journal=Path(report.journal_path))


def test_integer_edition_change_is_not_merged_on_reused_url(database, tmp_path):
    contest_id = seed(database)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE contests SET name='Builder Cup 13'")
    package = manifest(contest_id, name='Builder Cup 14')
    report = OfflineImporter().run(package, database=database, output_directory=tmp_path / 'reports')
    assert report.failed == 1 and 'editions' in report.failures[0].reason


def test_offline_import_does_not_publish_runtime_notifications(database, tmp_path):
    OfflineImporter().run(manifest(), database=database, dry_run=False,
                          output_directory=tmp_path / 'reports')
    with sqlite3.connect(database) as connection:
        assert connection.execute('SELECT count(*) FROM contests').fetchone()[0] == 1
        assert connection.execute('SELECT count(*) FROM contest_events').fetchone()[0] == 0
