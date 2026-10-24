"""Explicit offline import of reviewed public evidence. No providers, network, or scheduler."""

import hashlib
import json
from pathlib import Path
from datetime import date
import re
import sqlite3
import tempfile
from typing import get_args
from urllib.parse import urlsplit
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from contest_detective.server.contest.content_service import (
    normalized_text, validate_citation, validate_document, validate_introduction, validate_public_url,
)
from contest_detective.server.contest.schemas import ContestField, DATE_FIELDS, ClaimIn, ContestDraft, PageIn, calendar_date
from .contracts import RefreshEntry, RefreshFailure, RefreshManifest, RefreshReport
from .journal import changes, snapshot

MAX_MANIFEST_BYTES = 32 * 1024 * 1024


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def public_fingerprint(detail) -> str:
    """Stable across clock/status changes and additive content fields in the new API."""
    data = detail.model_dump(mode='json') if hasattr(detail, 'model_dump') else detail
    fields = {}
    for field in get_args(ContestField):
        item = data.get('fields', {}).get(field, {})
        sources = [{key: source.get(key, default) for key, default in (
            ('url', ''), ('site', ''), ('title', ''), ('published_at', None), ('is_official', False),
            ('value', ''), ('excerpt', ''), ('precision', 'datetime'),
        )} for source in item.get('sources', [])]
        fields[field] = {'value': item.get('value'), 'level': item.get('level', 'not_found'),
                         'precision': item.get('precision', 'datetime'),
                         'sources': sorted(sources, key=lambda row: (row['url'], row['value'], row['excerpt']))}
    documents = sorted(({key: item.get(key) for key in ('url', 'content_hash', 'extractor_version', 'kind', 'completeness', 'publication')} for item in data.get('documents', [])), key=lambda item: (item['url'], item['content_hash'], item['extractor_version']))
    return digest({key: data.get(key) for key in ('id', 'name', 'cover_url', 'summary')} | {
        'fields': fields, 'introduction': data.get('introduction'), 'documents': documents})


def validate_entry(entry: RefreshEntry, version: str) -> None:
    if len(entry.documents) > 20 or sum(len(item.claims) for item in entry.documents) > 200:
        raise ValueError('Entry exceeds the bounded document/claim limit')
    documents = [item.document for item in entry.documents]
    authority = {}
    for item in entry.documents:
        document = item.document
        validate_document(document)
        if document.url in authority and authority[document.url] != document.is_official:
            raise ValueError('One URL cannot have contradictory source authority in an import')
        authority[document.url] = document.is_official
        if document.extractor_version != version:
            raise ValueError('Document and manifest extractor versions differ')
        for claim in item.claims:
            if not normalized_text(claim.excerpt) or normalized_text(claim.excerpt) not in normalized_text(document.body):
                raise ValueError('Claim excerpt is absent from its own source document')
            if claim.field == 'registration_url':
                validate_public_url(claim.value)
    if entry.cover_url:
        validate_public_url(entry.cover_url)
    if entry.introduction:
        validate_introduction(entry.introduction, documents)
    for name in entry.coverage.fields:
        if name not in get_args(ContestField):
            raise ValueError('Unknown coverage field')
    for observation in [entry.coverage.introduction, *entry.coverage.fields.values(), *entry.coverage.sources.values()]:
        for url in observation.urls:
            validate_public_url(url)
        for citation in observation.citations:
            validate_citation(citation, documents)
        if observation.state == 'not_found_in_source' and not any(
                document.url in observation.urls and document.completeness == 'full'
                for document in documents):
            raise ValueError('Partial evidence cannot establish absence in a complete source')
    if entry.retire_claims and not entry.expected_fingerprint:
        raise ValueError('An explicit correction requires the expected public fingerprint')
    for retirement in entry.retire_claims:
        validate_public_url(retirement.url)
        for citation in retirement.citations:
            validate_citation(citation, documents)


def _edition(name):
    return set(re.findall(r'(?<!\d)(?:20\d{2}|\d{1,3}(?:\.\d+)?)(?!\d)', name))


def _checked_identity(session, entry, contest):
    from contest_detective.server.contest.service import get
    starts = {calendar_date(claim.value, claim.precision).isoformat()
              for item in entry.documents for claim in item.claims if claim.field == 'start_at'}
    if starts and contest.start_date and any(
            abs((date.fromisoformat(start) - date.fromisoformat(contest.start_date)).days) > 31
            for start in starts):
        raise ValueError('Materially different event dates require identity review before merging')
    if entry.expected_fingerprint and public_fingerprint(get(session, contest.id)) != entry.expected_fingerprint:
        raise ValueError('Public baseline changed; refresh the dry-run before applying')
    return contest


def _identity(session, entry):
    from contest_detective.server.contest.models import Contest, ContestPage, ContestPageLink
    from contest_detective.server.contest.identity import normalized_name

    claims = [claim for item in entry.documents for claim in item.claims]
    starts = {calendar_date(claim.value, claim.precision).isoformat() for claim in claims if claim.field == 'start_at'}
    urls = {item.document.url for item in entry.documents}
    if entry.contest_id:
        contest = session.get(Contest, entry.contest_id)
        if contest is None:
            raise ValueError('Explicit contest_id does not exist in the target database')
        known = set(session.scalars(select(ContestPage.url).join(ContestPageLink).where(ContestPageLink.contest_id == contest.id)))
        if normalized_name(contest.name) != normalized_name(entry.name) and not known.intersection(urls):
            raise ValueError('Existing contest identity does not match its name or sources')
        if _edition(contest.name) and _edition(entry.name) and _edition(contest.name) != _edition(entry.name):
            raise ValueError('Different event editions require review, not automatic merging')
        return _checked_identity(session, entry, contest)
    candidates = list(session.scalars(select(Contest).where(Contest.normalized_name == normalized_name(entry.name))))
    matched = [item for item in candidates if starts and item.start_date in starts]
    if len(matched) == 1:
        return _checked_identity(session, entry, matched[0])
    # An event-specific page plus identical name is usable; a generic organizer homepage alone is not.
    specific = {url for url in urls if len(urlsplit(url).path.strip('/')) > 1
                or (urlsplit(url).hostname or '').endswith('.devpost.com')}
    linked = list(session.scalars(select(Contest).join(ContestPageLink).join(ContestPage).where(
        ContestPage.url.in_(specific), Contest.normalized_name == normalized_name(entry.name))).unique()) if specific else []
    linked = [item for item in linked if not starts or not item.start_date or item.start_date in starts]
    if len(linked) == 1:
        return _checked_identity(session, entry, linked[0])
    if candidates or linked:
        raise ValueError('Ambiguous or incompatible event dates/identity require review')
    return None


def _apply_entry(session, entry, manifest_id, entry_hash):
    from contest_detective.server.contest.models import Contest, ContestClaim, ContestPage
    from contest_detective.server.contest import service
    from contest_detective.server.contest.identity import normalized_name
    from .models import ContentRefreshEntry

    contest = _identity(session, entry)
    created = contest is None
    if created and (entry.retire_claims or entry.expected_fingerprint):
        raise ValueError('Expected baseline/corrections require an existing contest')
    if created:
        contest = Contest(id=str(uuid4()), name=entry.name, normalized_name=normalized_name(entry.name))
        session.add(contest)
        session.flush()
    retirements = {(item.url, item.field, item.value, item.excerpt): item for item in entry.retire_claims}
    for key in retirements:
        url, field, value, excerpt = key
        page = session.scalar(select(ContestPage).where(ContestPage.url == url))
        claim = session.get(ContestClaim, (contest.id, page.id, field, value)) if page else None
        if claim is None or claim.excerpt != excerpt:
            raise ValueError('Correction no longer matches the exact historical assertion')
        session.delete(claim)
    session.flush()
    grouped = {}
    for item in entry.documents:
        grouped.setdefault(item.document.url, []).append(item)
    for url, items in grouped.items():
        document = items[0].document
        carried = [ClaimIn(field=field, value=source.value, excerpt=source.excerpt, precision=source.precision)
                   for field, source in service.claim_sources(session, contest.id) if source.url == url]
        incoming = [claim for item in items for claim in item.claims]
        # Reasserting the same value cannot silently replace historical evidence.
        # A reviewed retirement is the explicit path for correcting that assertion.
        claims = list({(claim.field, claim.value): claim for claim in [*incoming, *carried]}.values())
        existing_page = session.scalar(select(ContestPage).where(ContestPage.url == url))
        if existing_page and existing_page.is_official != document.is_official:
            raise ValueError('Changing historical source authority requires a separately reviewed correction')
        # Page metadata is shared by all linked editions. An additive import must not
        # silently reclassify historical assertions or touch another contest's baseline.
        page = PageIn(url=url, site=existing_page.site, title=existing_page.title,
            is_official=existing_page.is_official, published_at=existing_page.published_at) if existing_page else PageIn(
                url=url, site=document.site, title=document.title,
                is_official=document.is_official, published_at=document.published_at)
        draft = ContestDraft(name=entry.name, cover_url=entry.cover_url,
            summary=entry.introduction.text if created and entry.introduction else None,
            introduction=entry.introduction, documents=[item.document for item in entry.documents],
            coverage=entry.coverage, page=page, claims=claims)
        service.save(session, draft, contest_id=contest.id, commit=False)
    session.flush()
    fingerprint = public_fingerprint(service.get(session, contest.id))
    session.add(ContentRefreshEntry(manifest_id=manifest_id, entry_key=entry.key, entry_hash=entry_hash,
                                   contest_id=contest.id, after_fingerprint=fingerprint))
    return created, contest.id


def _copy_database(source: Path, destination: Path):
    with sqlite3.connect(f'file:{source.resolve()}?mode=ro', uri=True) as original:
        with sqlite3.connect(destination) as target:
            original.backup(target)
    destination.chmod(0o600)


class OfflineImporter:
    def run(self, manifest: RefreshManifest, *, database: Path, dry_run: bool = True,
            output_directory: Path) -> RefreshReport:
        if not database.is_file():
            raise ValueError('Select an existing local database explicitly; no default database is used')
        encoded = manifest.model_dump(mode='json')
        if len(json.dumps(encoded).encode()) > MAX_MANIFEST_BYTES or len(manifest.entries) > 5000:
            raise ValueError('Refresh manifest exceeds the size limit')
        if len({entry.key for entry in manifest.entries}) != len(manifest.entries):
            raise ValueError('Refresh entry keys must be unique')
        report = RefreshReport(manifest_id=manifest.manifest_id, dry_run=dry_run,
            attempted=len(manifest.entries), inventory=manifest.inventory)
        valid = []
        for entry in manifest.entries:
            try:
                validate_entry(entry, manifest.extractor_version)
            except (ValueError, TypeError) as error:
                report.failures.append(RefreshFailure(key=entry.key, stage='validate', reason=str(error)))
            else:
                report.validated += 1
                valid.append(entry)
        report.failed = len(report.failures)
        output_directory.mkdir(parents=True, exist_ok=True)
        run_directory = Path(tempfile.mkdtemp(prefix='refresh-', dir=output_directory))
        run_directory.chmod(0o700)
        if not valid:
            (run_directory / 'report.json').write_text(report.model_dump_json(indent=2))
            return report
        with tempfile.TemporaryDirectory(prefix='refresh-dry-run-') as temporary:
            target = Path(temporary) / 'contest.db' if dry_run else database
            if dry_run:
                _copy_database(database, target)
            engine = create_engine('sqlite:///' + str(target.resolve()), connect_args={'timeout': 30})
            try:
                # Import here, only after the CLI bound its explicit database without dotenv.
                from .models import ContentRefreshEntry, ContentRefreshRun
                with engine.connect() as connection:
                    connection.exec_driver_sql('PRAGMA foreign_keys=ON')
                    connection.exec_driver_sql('BEGIN IMMEDIATE')
                    before = snapshot(connection)
                    with Session(bind=connection, expire_on_commit=False) as session:
                        previous = session.get(ContentRefreshRun, manifest.manifest_id)
                        manifest_hash = digest(encoded)
                        if previous and previous.manifest_hash != manifest_hash:
                            raise ValueError('A manifest_id cannot be reused for changed content')
                        if previous is None:
                            session.add(ContentRefreshRun(manifest_id=manifest.manifest_id, manifest_hash=manifest_hash))
                            session.flush()
                        pending = [entry for entry in valid if session.get(ContentRefreshEntry, (manifest.manifest_id, entry.key)) is None]
                        report.unchanged = len(valid) - len(pending)
                        if pending and not dry_run:
                            backup = run_directory / 'before.sqlite'
                            _copy_database(database, backup)
                            report.backup_path = str(backup)
                        created_ids, updated_ids = set(), set()
                        for entry in pending:
                            try:
                                with session.begin_nested():
                                    created, contest_id = _apply_entry(session, entry, manifest.manifest_id, digest(entry.model_dump(mode='json')))
                                    session.flush()
                            except Exception as error:
                                report.failures.append(RefreshFailure(key=entry.key, stage='persist', reason=str(error), retryable=False))
                            else:
                                (created_ids if created else updated_ids).add(contest_id)
                                report.applied_entries += 1
                        report.created = len(created_ids)
                        report.updated = len(updated_ids - created_ids)
                        session.flush()
                        after = snapshot(connection)
                        if not dry_run:
                            journal = run_directory / 'changes.json'
                            journal.write_text(json.dumps({'schema': 'contest-refresh-journal-v1',
                                'manifest_id': manifest.manifest_id, 'manifest_hash': manifest_hash,
                                'extractor_version': manifest.extractor_version,
                                'corrections': [{'key': entry.key, 'expected_fingerprint': entry.expected_fingerprint,
                                    'retire_claims': [item.model_dump(mode='json') for item in entry.retire_claims]}
                                    for entry in pending if entry.retire_claims],
                                'changes': changes(before, after)},
                                ensure_ascii=False, indent=2))
                            journal.chmod(0o600)
                            report.journal_path = str(journal)
                        connection.commit()
            finally:
                engine.dispose()
        report.failed = len(report.failures)
        (run_directory / 'report.json').write_text(report.model_dump_json(indent=2))
        return report
