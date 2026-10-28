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
    def systemd(self, root, *services):
        directory = root / 'systemd'
        directory.mkdir()
        for service in services or (release.SERVICE,):
            (directory / f'{service}.service').write_text('[Service]\n')
        return directory

    def bundle(self, entries=None, *, mcp=False, configuration=False):
        files = {
            'backend/pyproject.toml': b'[project]',
            'backend/uv.lock': b'version = 1',
            'backend/alembic.ini': b'[alembic]',
            'backend/src/contest_detective/bootstrap/app.py': b'# FastAPI app',
            'frontend/dist/index.html': b'<html></html>',
            'frontend/dist/version.json': json.dumps({'commit': SHA, 'tag': TAG}).encode(),
            'RELEASE_COMMIT': SHA.encode(),
            'RELEASE_TAG': TAG.encode(),
        }
        if mcp:
            files['backend/src/contest_detective/bootstrap/mcp_http.py'] = b'# HTTP transport'
        if configuration:
            files['deploy/server.env.example'] = (
                b'DETECTIVE_LLM_MODEL=must-not-overwrite\n'
                b'DETECTIVE_LLM_NORMALIZATION_PROMPT_PATH=templates/contest_normalization.jinja2\n'
            )
            files['backend/src/contest_detective/agent/normalization_prompts.py'] = b'# Prompt loader'
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
                        'SYSTEMD': self.systemd(root),
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
                        'SYSTEMD': self.systemd(root),
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
        for previous_layout, fail in [(None, False), (None, True), ('bootstrap', True), ('web/bootstrap', True)]:
            with self.subTest(previous_layout=previous_layout, fail=fail), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                app = root / 'app'
                app.mkdir()
                (app / 'old-code').touch()
                if previous_layout:
                    module = app / 'backend/src/contest_detective' / previous_layout / 'mcp_http.py'
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
                        'SYSTEMD': self.systemd(root, release.SERVICE, release.MCP_SERVICE),
                    }.items():
                        patches.enter_context(patch.object(release, name, value))
                    if fail:
                        with self.assertRaisesRegex(RuntimeError, 'MCP is unhealthy'):
                            release.deploy(self.bundle(mcp=True))
                    else:
                        release.deploy(self.bundle(mcp=True))
                transitions = [call for call in calls
                               if call[:2] in (('systemctl', 'start'), ('systemctl', 'stop'))]
                self.assertEqual(transitions[0], ('systemctl', 'stop', release.SERVICE, 'contest-detective-mcp'))
                self.assertEqual(transitions[1], ('systemctl', 'start', release.SERVICE, 'contest-detective-mcp'))
                if fail:
                    self.assertEqual(transitions[2], ('systemctl', 'stop', release.SERVICE, 'contest-detective-mcp'))
                    expected = (release.SERVICE, 'contest-detective-mcp') if previous_layout else (release.SERVICE,)
                    self.assertEqual(transitions[-1], ('systemctl', 'start', *expected))
                    self.assertTrue((app / 'old-code').exists())
                else:
                    self.assertEqual((app / 'RELEASE_COMMIT').read_text(), SHA)

    def test_release_services_recognizes_the_pre_split_entrypoint(self):
        for relative in ('bootstrap/mcp_http.py', 'web/bootstrap/mcp_http.py'):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder)
                module = directory / 'backend/src/contest_detective' / relative
                module.parent.mkdir(parents=True)
                module.touch()
                self.assertEqual(release.release_services(directory),
                                 (release.SERVICE, release.MCP_SERVICE))

    def test_service_command_covers_both_package_layouts(self):
        expected = {
            'bootstrap/app.py': ('contest_detective.bootstrap.app:app', 8000, ()),
            'web/bootstrap/app.py': ('contest_detective.web.bootstrap.app:app', 8000, ()),
            'bootstrap/mcp_http.py': ('contest_detective.bootstrap.mcp_http:create_app', 8001, ('--factory',)),
            'web/bootstrap/mcp_http.py': ('contest_detective.web.bootstrap.mcp_http:create_app', 8001, ('--factory',)),
        }
        for relative, (module, port, flags) in expected.items():
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder)
                source = directory / 'backend/src/contest_detective' / relative
                source.parent.mkdir(parents=True)
                source.touch()
                service = release.MCP_SERVICE if 'mcp_http' in relative else release.SERVICE
                self.assertEqual(
                    release.service_command(directory, service),
                    ' '.join((release.UVICORN, module, *flags, '--host', '127.0.0.1',
                              '--port', str(port), '--workers', '1', '--proxy-headers',
                              '--forwarded-allow-ips=127.0.0.1')))

    def test_installed_units_get_the_release_entrypoint(self):
        for relative, unit in [('bootstrap/app.py', 'contest-detective.service'),
                               ('bootstrap/mcp_http.py', 'contest-detective-mcp.service')]:
            with self.subTest(unit=unit), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                directory = root / 'release'
                source = directory / 'backend/src/contest_detective' / relative
                source.parent.mkdir(parents=True)
                source.touch()
                systemd = self.systemd(root, unit.removesuffix('.service'))
                calls = []
                with patch.object(release, 'SYSTEMD', systemd), \
                        patch.object(release, 'run', lambda *args: calls.append(args)):
                    release.configure_services(directory, release.release_services(directory))
                exec_start = next(line for line in (SCRIPT.parent / unit).read_text().splitlines()
                                  if line.startswith('ExecStart='))
                self.assertEqual((systemd / (unit + '.d') / 'release.conf').read_text(),
                                 f'[Service]\nExecStart=\n{exec_start}\n')
                self.assertEqual(calls, [('systemctl', 'daemon-reload')])

    def test_readiness_requires_mcp_initialization_when_transport_is_present(self):
        for relative in ('bootstrap/mcp_http.py', 'web/bootstrap/mcp_http.py'):
            for mcp_reply, succeeds in [({'result': {'serverInfo': {'name': '比赛侦探'}}}, True),
                                        ({'error': {'message': 'unavailable'}}, False)]:
                with self.subTest(layout=relative, succeeds=succeeds), tempfile.TemporaryDirectory() as folder:
                    app = Path(folder)
                    module = app / 'backend/src/contest_detective' / relative
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


    def test_database_target_recognizes_sqlite_postgres_and_mixed_settings(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'server.env'
            path.write_text('DETECTIVE_DB_URL=sqlite:////var/lib/contest-detective/contest.db\n')
            self.assertEqual(release.database_target(release.environment_values(path)).backend, 'sqlite')
            path.write_text(
                'DETECTIVE_DB_HOST=127.0.0.1\n'
                'DETECTIVE_DB_PORT=5432\n'
                'DETECTIVE_DB_NAME=contest_detective\n'
                'DETECTIVE_DB_USER=contest_detective\n'
                'DETECTIVE_DB_PASSWORD=secret\n'
            )
            target = release.database_target(release.environment_values(path))
            self.assertEqual(target.backend, 'postgresql')
            self.assertEqual(target.database, 'contest_detective')
            self.assertEqual(target.env['PGHOST'], '127.0.0.1')
            self.assertEqual(target.env['PGPASSWORD'], 'secret')
            path.write_text('DETECTIVE_DB_URL=postgresql+psycopg://u:p@db:5432/app\n')
            target = release.database_target(release.environment_values(path))
            self.assertEqual(target.url, 'postgresql://u:p@db:5432/app')
            path.write_text('DETECTIVE_DB_URL=sqlite:///local.db\nDETECTIVE_DB_HOST=db\n')
            with self.assertRaises(ValueError):
                release.database_target(release.environment_values(path))

    def test_postgres_release_backs_up_and_restores_the_dump(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = root / 'app'
            app.mkdir()
            (app / 'old-code').write_text('previous release')
            environment = root / 'server.env'
            environment.write_text(
                'DETECTIVE_DB_HOST=127.0.0.1\n'
                'DETECTIVE_DB_PORT=5432\n'
                'DETECTIVE_DB_NAME=contest_detective\n'
                'DETECTIVE_DB_USER=contest_detective\n'
                'DETECTIVE_DB_PASSWORD=secret\n'
            )
            maintenance = root / 'maintenance'
            calls = []

            def command(*args, **kwargs):
                calls.append((args, kwargs))
                if args[0] == 'pg_dump':
                    Path(args[args.index('--file') + 1]).write_bytes(b'custom dump')
                if args[0] == 'systemd-run':
                    raise RuntimeError('migration failed')

            def readiness(expected_commit=None):
                self.assertTrue(maintenance.exists())

            with ExitStack() as patches:
                for name, value in {
                    'APP': app, 'RELEASES': root / 'releases', 'BACKUPS': root / 'backups',
                    'MAINTENANCE': maintenance, 'run': command, 'healthy': readiness,
                    'ENVIRONMENT_FILE': environment, 'SYSTEMD': self.systemd(root),
                }.items():
                    patches.enter_context(patch.object(release, name, value))
                with self.assertRaisesRegex(RuntimeError, 'migration failed'):
                    release.deploy(self.bundle())

            self.assertFalse(maintenance.exists())
            self.assertTrue(app.is_symlink())
            self.assertEqual((app / 'old-code').read_text(), 'previous release')
            dumps = list((root / 'backups').glob('*/contest.dump'))
            self.assertEqual(len(dumps), 1)
            dump = dumps[0]
            self.assertEqual(dump.read_bytes(), b'custom dump')
            dump_call = next((args, kwargs) for args, kwargs in calls if args[0] == 'pg_dump')
            self.assertIn('--format=custom', dump_call[0])
            self.assertEqual(dump_call[0][dump_call[0].index('--file') + 1], str(dump))
            self.assertEqual(dump_call[0][dump_call[0].index('--dbname') + 1], 'contest_detective')
            self.assertEqual(dump_call[1]['env']['PGHOST'], '127.0.0.1')
            self.assertEqual(dump_call[1]['env']['PGPASSWORD'], 'secret')
            commands = [args for args, _ in calls]
            self.assertTrue(any(args[0] == 'psql' and 'DROP SCHEMA' in ' '.join(args) for args in commands))
            restore = next(args for args in commands if args[0] == 'pg_restore')
            self.assertIn('--exit-on-error', restore)
            self.assertIn('--no-owner', restore)
            self.assertIn(str(dump), restore)
            self.assertIn('contest_detective', restore)


if __name__ == '__main__':
    unittest.main()
