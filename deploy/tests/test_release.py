from contextlib import ExitStack
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'release.py'
SPEC = importlib.util.spec_from_file_location('release', SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
SHA = 'a' * 40
TAG = 'v0.1.2'


class ReleaseTests(unittest.TestCase):
    def bundle(self, entries=None, *, mcp=False, configuration=False):
        files = {
            'backend/pyproject.toml': b'[project]',
            'backend/uv.lock': b'version = 1',
            'backend/alembic.ini': b'[alembic]',
            'frontend/dist/index.html': b'<html></html>',
            'frontend/dist/version.json': json.dumps({'commit': SHA, 'tag': TAG}).encode(),
            'RELEASE_COMMIT': SHA.encode(),
            'RELEASE_TAG': TAG.encode(),
        }
        if mcp:
            files['backend/src/contest_detective/web/bootstrap/mcp_http.py'] = b'# HTTP transport'
        if configuration:
            files['deploy/server.env.example'] = (
                b'DETECTIVE_LLM_MODEL=must-not-overwrite\n'
                b'DETECTIVE_LLM_NORMALIZATION_PROMPT_PATH=templates/contest_normalization.jinja2\n'
            )
            files['backend/src/contest_detective/server/agent/normalization_prompts.py'] = b'# Prompt loader'
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            if configuration:
                directory = tarfile.TarInfo('deploy')
                directory.type = tarfile.DIRTYPE
                archive.addfile(directory)
            for name, content in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
            for member, content in entries or []:
                archive.addfile(member, io.BytesIO(content))
        stream.seek(0)
        return stream

    def test_extracts_release_with_matching_frontend_version(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(release.unpack(self.bundle(), Path(folder)), (TAG, SHA))
            self.assertTrue((Path(folder) / 'frontend/dist/index.html').is_file())

    def test_rejects_paths_links_secrets_and_duplicate_entries_before_extraction(self):
        for name, kind in [
            ('../escape', tarfile.REGTYPE),
            ('/etc/passwd', tarfile.REGTYPE),
            ('backend/../../escape', tarfile.REGTYPE),
            ('backend/link', tarfile.SYMTYPE),
            ('backend/link', tarfile.LNKTYPE),
            ('backend/.env', tarfile.REGTYPE),
            ('backend/.venv/bin/python', tarfile.REGTYPE),
            ('RELEASE_COMMIT', tarfile.REGTYPE),
            ('deploy/release.py', tarfile.REGTYPE),
            ('deploy/other.env', tarfile.REGTYPE),
            ('deploy/server.env.example', tarfile.DIRTYPE),
        ]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as folder:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = '/etc'
                with self.assertRaises(ValueError):
                    release.unpack(self.bundle([(member, b'')]), Path(folder))
                self.assertEqual(list(Path(folder).iterdir()), [])

    def test_extracts_the_release_configuration_example(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(release.unpack(self.bundle(configuration=True), Path(folder)), (TAG, SHA))
            self.assertTrue((Path(folder) / 'deploy/server.env.example').is_file())

    def test_configuration_is_preserved_validated_and_restored_with_the_release(self):
        key = 'DETECTIVE_LLM_NORMALIZATION_PROMPT_PATH'
        for scenario in ('missing', 'custom', 'preflight', 'migration', 'readiness'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                app = root / 'app'
                app.mkdir()
                (app / 'old-code').touch()
                environment = root / 'server.env'
                original = b'# Existing production values\nDETECTIVE_LLM_MODEL="existing"\nDETECTIVE_LLM_API_KEY="fixture-only"'
                if scenario == 'custom':
                    original += f'\n{key}="/custom prompt.jinja2"\n'.encode()
                environment.write_bytes(original)
                environment.chmod(0o600)
                database = root / 'contest.db'
                with sqlite3.connect(database) as connection:
                    connection.execute('CREATE TABLE marker (value TEXT)')
                    connection.execute("INSERT INTO marker VALUES ('original')")
                maintenance = root / 'maintenance'
                calls = []
                preflight = []

                def command(*args, **kwargs):
                    calls.append(args)
                    if args[0] == 'systemd-run' and '-c' in args:
                        preflight.append(args)
                        self.assertFalse(maintenance.exists())
                        self.assertTrue((app / 'old-code').exists())
                        self.assertIn('--property=User=contest-detective', args)
                        self.assertIn(f'--property=EnvironmentFile={environment}', args)
                        if scenario == 'preflight':
                            raise RuntimeError('template preflight failed')
                    elif args[0] == 'systemd-run':
                        self.assertTrue(maintenance.exists())
                        with sqlite3.connect(database) as connection:
                            connection.execute("UPDATE marker SET value = 'migrated'")
                        if scenario == 'migration':
                            raise RuntimeError('migration failed')

                def readiness(expected_commit=None):
                    if expected_commit and scenario == 'readiness':
                        raise RuntimeError('readiness failed')
                    if expected_commit is None:
                        self.assertEqual(environment.read_bytes(), original)

                with ExitStack() as patches:
                    for name, value in {
                        'APP': app, 'RELEASES': root / 'releases', 'BACKUPS': root / 'backups',
                        'DATABASE': database, 'MAINTENANCE': maintenance,
                        'run': command, 'healthy': readiness, 'ENVIRONMENT_FILE': environment,
                    }.items():
                        patches.enter_context(patch.object(release, name, value, create=True))
                    if scenario in ('preflight', 'migration', 'readiness'):
                        with self.assertRaisesRegex(RuntimeError, 'failed'):
                            release.deploy(self.bundle(configuration=True))
                        self.assertEqual(environment.read_bytes(), original)
                        self.assertTrue((app / 'old-code').exists())
                        with sqlite3.connect(database) as connection:
                            self.assertEqual(connection.execute('SELECT value FROM marker').fetchall(), [('original',)])
                    else:
                        release.deploy(self.bundle(configuration=True))
                        expected = original if scenario == 'custom' else original + (
                            f'\n{key}=templates/contest_normalization.jinja2\n'.encode()
                        )
                        self.assertEqual(environment.read_bytes(), expected)
                    self.assertEqual(len(preflight), 1)
                self.assertFalse(maintenance.exists())
                self.assertEqual(environment.stat().st_mode & 0o777, 0o600)
                snapshots = list((root / 'backups').glob('*/environment'))
                self.assertEqual(len(snapshots), 0 if scenario == 'custom' else 1)
                for snapshot in snapshots:
                    self.assertEqual(snapshot.read_bytes(), original)
                    self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)
                if scenario == 'preflight':
                    self.assertFalse(any(call[0] == 'systemctl' for call in calls))

    def test_rejects_missing_metadata_and_mismatched_version(self):
        for name, data in [('RELEASE_TAG', b'not-a-release'),
                           ('frontend/dist/version.json', b'{}')]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                stream = self.bundle()
                output = io.BytesIO()
                with tarfile.open(fileobj=stream) as source, tarfile.open(fileobj=output, mode='w:gz') as target:
                    for member in source:
                        content = data if member.name == name else source.extractfile(member).read()
                        member.size = len(content)
                        target.addfile(member, io.BytesIO(content))
                output.seek(0)
                with self.assertRaises(ValueError):
                    release.unpack(output, Path(folder))

    def test_database_snapshot_and_restore_include_committed_wal_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / 'contest.db'
            snapshot = Path(folder) / 'backup.db'
            with sqlite3.connect(database) as connection:
                connection.execute('PRAGMA journal_mode=WAL')
                connection.execute('CREATE TABLE users (name TEXT)')
                connection.execute("INSERT INTO users VALUES ('original')")
                connection.commit()
                release.snapshot_database(database, snapshot)
                connection.execute("INSERT INTO users VALUES ('later')")
                connection.commit()
            release.restore_database(snapshot, database)
            with sqlite3.connect(database) as restored:
                self.assertEqual(restored.execute('SELECT name FROM users').fetchall(), [('original',)])
            self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)


    def test_failed_migration_or_readiness_restores_real_database_and_previous_code(self):
        for failure in ('migration', 'readiness'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                app = root / 'app'
                app.mkdir()
                (app / 'old-code').write_text('previous release')
                database = root / 'contest.db'
                with sqlite3.connect(database) as connection:
                    connection.execute('CREATE TABLE users (name TEXT)')
                    connection.execute("INSERT INTO users VALUES ('original')")
                maintenance = root / 'maintenance'
                calls = []

                def command(*args, **kwargs):
                    calls.append(args)
                    if args[0] == 'systemd-run':
                        self.assertTrue(maintenance.exists())
                        with sqlite3.connect(database) as connection:
                            connection.execute("UPDATE users SET name = 'migrated'")
                        if failure == 'migration':
                            raise RuntimeError('migration failed')

                def readiness(expected_commit=None):
                    self.assertTrue(maintenance.exists())
                    if expected_commit is not None:
                        self.assertEqual((app / 'RELEASE_COMMIT').read_text(), SHA)
                        raise RuntimeError('readiness failed')
                    self.assertEqual((app / 'old-code').read_text(), 'previous release')

                with ExitStack() as patches:
                    for name, value in {
                        'APP': app, 'RELEASES': root / 'releases',
                        'BACKUPS': root / 'backups', 'DATABASE': database,
                        'MAINTENANCE': maintenance, 'run': command, 'healthy': readiness,
                    }.items():
                        patches.enter_context(patch.object(release, name, value))
                    with self.assertRaisesRegex(RuntimeError, 'failed'):
                        release.deploy(self.bundle())
                self.assertFalse(maintenance.exists())
                self.assertTrue(app.is_symlink())
                self.assertEqual((app / 'old-code').read_text(), 'previous release')
                with sqlite3.connect(database) as connection:
                    self.assertEqual(connection.execute('SELECT name FROM users').fetchall(), [('original',)])
                self.assertEqual(calls[-3], ('systemctl', 'stop', release.SERVICE))
                self.assertEqual(calls[-2][:2], ('systemctl', 'stop'))
                self.assertTrue(calls[-2][2].startswith('contest-detective-migrate-'))
                self.assertEqual(calls[-1], ('systemctl', 'start', release.SERVICE))

    def test_http_service_follows_release_switch_and_rollback(self):
        for previous_mcp, fail in [(False, False), (False, True), (True, True)]:
            with self.subTest(previous_mcp=previous_mcp, fail=fail), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                app = root / 'app'
                app.mkdir()
                (app / 'old-code').touch()
                if previous_mcp:
                    module = app / 'backend/src/contest_detective/web/bootstrap/mcp_http.py'
                    module.parent.mkdir(parents=True)
                    module.touch()
                database = root / 'contest.db'
                with sqlite3.connect(database) as connection:
                    connection.execute('CREATE TABLE marker (value TEXT)')
                calls = []

                def command(*args, **kwargs):
                    calls.append(args)

                def readiness(expected_commit=None):
                    if expected_commit and fail:
                        raise RuntimeError('MCP is unhealthy')

                with ExitStack() as patches:
                    for name, value in {
                        'APP': app, 'RELEASES': root / 'releases', 'BACKUPS': root / 'backups',
                        'DATABASE': database, 'MAINTENANCE': root / 'maintenance',
                        'run': command, 'healthy': readiness,
                    }.items():
                        patches.enter_context(patch.object(release, name, value))
                    if fail:
                        with self.assertRaisesRegex(RuntimeError, 'MCP is unhealthy'):
                            release.deploy(self.bundle(mcp=True))
                    else:
                        release.deploy(self.bundle(mcp=True))
                service_calls = [call for call in calls if call[:1] == ('systemctl',)]
                self.assertEqual(service_calls[0], ('systemctl', 'stop', release.SERVICE, 'contest-detective-mcp'))
                self.assertEqual(service_calls[1], ('systemctl', 'start', release.SERVICE, 'contest-detective-mcp'))
                if fail:
                    self.assertEqual(service_calls[2], ('systemctl', 'stop', release.SERVICE, 'contest-detective-mcp'))
                    expected = (release.SERVICE, 'contest-detective-mcp') if previous_mcp else (release.SERVICE,)
                    self.assertEqual(service_calls[-1], ('systemctl', 'start', *expected))
                    self.assertTrue((app / 'old-code').exists())
                else:
                    self.assertEqual((app / 'RELEASE_COMMIT').read_text(), SHA)

    def test_readiness_requires_mcp_initialization_when_transport_is_present(self):
        for mcp_reply, succeeds in [({'result': {'serverInfo': {'name': '比赛侦探'}}}, True),
                                    ({'error': {'message': 'unavailable'}}, False)]:
            with self.subTest(succeeds=succeeds), tempfile.TemporaryDirectory() as folder:
                app = Path(folder)
                module = app / 'backend/src/contest_detective/web/bootstrap/mcp_http.py'
                module.parent.mkdir(parents=True)
                module.touch()

                def response(request, timeout):
                    content = mcp_reply if isinstance(request, release.Request) else {}
                    result = io.BytesIO(json.dumps(content).encode())
                    result.status = 200
                    return result

                with patch.object(release, 'APP', app), patch.object(release, 'urlopen', response), \
                        patch.object(release.time, 'sleep'):
                    if succeeds:
                        release.healthy()
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'MCP initialization failed'):
                            release.healthy()


if __name__ == '__main__':
    unittest.main()
