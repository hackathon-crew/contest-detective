import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


DEPLOY = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('incremental_release', DEPLOY / 'release.py')
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
SHA = 'b' * 40
TAG = 'v1.1.1'


def files():
    return {
        'backend/pyproject.toml': b'[project]',
        'backend/uv.lock': b'version = 1',
        'backend/alembic.ini': b'[alembic]',
        'backend/src/app.py': b'new code',
        'frontend/dist/index.html': b'<html>new</html>',
        'frontend/dist/ocr/core.wasm': b'unchanged wasm' * 1000,
        'frontend/dist/version.json': json.dumps({'commit': SHA, 'tag': TAG}).encode(),
        'RELEASE_COMMIT': SHA.encode(),
        'RELEASE_TAG': TAG.encode(),
    }


def write_tree(root, entries):
    for name, content in entries.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


def manifest(entries):
    return {'version': 1, 'files': {name: {
        'sha256': hashlib.sha256(content).hexdigest(), 'size': len(content),
    } for name, content in entries.items()}}


def delta(entries, changed, document=None):
    output = io.BytesIO()
    payload = {'RELEASE_MANIFEST.json': json.dumps(document or manifest(entries)).encode(),
               **{name: entries[name] for name in changed}}
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, content in payload.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    output.seek(0)
    return output


class IncrementalReleaseTests(unittest.TestCase):
    def test_reuses_unchanged_files_without_carrying_deleted_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base, target = root / 'base', root / 'target'
            target.mkdir()
            expected = files()
            previous = {**expected, 'backend/src/app.py': b'old code',
                        'backend/src/deleted.py': b'obsolete'}
            write_tree(base, previous)
            with patch.object(release, 'APP', base):
                self.assertEqual(release.unpack(delta(expected, ['backend/src/app.py']), target), (TAG, SHA))
            actual = {str(p.relative_to(target)): p.read_bytes() for p in target.rglob('*') if p.is_file()}
            self.assertEqual(actual, expected)
            self.assertEqual((base / 'backend/src/app.py').read_bytes(), b'old code')
            self.assertFalse((target / 'backend/src/deleted.py').exists())

    def test_rejects_missing_or_changed_reuse_files_before_extracting(self):
        for missing in (False, True):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                base, target = root / 'base', root / 'target'
                target.mkdir()
                expected = files()
                write_tree(base, expected)
                asset = base / 'frontend/dist/ocr/core.wasm'
                asset.unlink() if missing else asset.write_bytes(b'changed after planning')
                with patch.object(release, 'APP', base), self.assertRaises(ValueError):
                    release.unpack(delta(expected, ['backend/src/app.py']), target)
                self.assertEqual(list(target.iterdir()), [])

    def test_rejects_changed_payload_hash_and_unsafe_manifest_paths(self):
        for name in ('backend/src/app.py', '../outside', 'backend/.env', 'backend/.venv/bin/python'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                base, target = root / 'base', root / 'target'
                target.mkdir()
                expected = files()
                write_tree(base, expected)
                document = manifest(expected)
                document['files'][name] = {'sha256': '0' * 64, 'size': 1}
                with patch.object(release, 'APP', base), self.assertRaises(ValueError):
                    release.unpack(delta(expected, ['backend/src/app.py'], document), target)
                self.assertEqual(list(target.iterdir()), [])

    def test_manifest_request_excludes_runtime_files_and_does_not_deploy(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            expected = files()
            write_tree(root, {**expected, 'backend/.env': b'private',
                              'backend/.venv/bin/python': b'runtime',
                              'backend/src/__pycache__/app.pyc': b'cache'})
            output = io.StringIO()
            handler = getattr(release, 'dispatch', None)
            self.assertIsNotNone(handler, 'restricted manifest protocol is not implemented')
            with patch.object(release, 'APP', root), patch.object(release, 'deploy') as deploy:
                handler(io.BytesIO(b'INKPAW_RELEASE_MANIFEST_V1\n'), output)
            self.assertEqual(json.loads(output.getvalue()), manifest(expected))
            deploy.assert_not_called()

    def test_builder_sends_only_changed_files_and_uses_target_for_deletions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            candidate = root / 'candidate'
            expected = files()
            write_tree(candidate, expected)
            baseline = {**expected, 'backend/src/app.py': b'old code',
                        'frontend/dist/removed.js': b'removed'}
            base_file, output = root / 'base.json', root / 'delta.tar.gz'
            base_file.write_text(json.dumps(manifest(baseline)))
            result = subprocess.run([sys.executable, str(DEPLOY / 'bundle.py'),
                '--root', str(candidate), '--base', str(base_file), '--output', str(output)],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            with tarfile.open(output, mode='r:gz') as archive:
                self.assertEqual(set(archive.getnames()), {'RELEASE_MANIFEST.json', 'backend/src/app.py'})
                self.assertEqual(json.load(archive.extractfile('RELEASE_MANIFEST.json')), manifest(expected))
            self.assertIn('changed=1', result.stdout)
            self.assertIn('reused=8', result.stdout)

    def test_missing_baseline_does_not_enable_full_transfer(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            candidate, base_file, output = root / 'candidate', root / 'base.json', root / 'delta.tar.gz'
            write_tree(candidate, files())
            base_file.write_text(json.dumps(manifest({})))
            result = subprocess.run([sys.executable, str(DEPLOY / 'bundle.py'),
                '--root', str(candidate), '--base', str(base_file), '--output', str(output)],
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())

    def test_manifest_request_requires_a_complete_existing_release(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(release, 'APP', Path(folder)):
            with self.assertRaises(ValueError):
                release.dispatch(io.BytesIO(b'INKPAW_RELEASE_MANIFEST_V1\n'), io.StringIO())

    def test_incremental_deploy_preserves_existing_switch_and_rollback(self):
        for failure in (None, 'migration', 'readiness'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                app, database = root / 'app', root / 'contest.db'
                expected = files()
                write_tree(app, {**expected, 'backend/src/app.py': b'old code'})
                with sqlite3.connect(database) as connection:
                    connection.execute('CREATE TABLE marker (value TEXT)')
                    connection.execute("INSERT INTO marker VALUES ('original')")

                def command(*args, **kwargs):
                    if args[0] == 'systemd-run':
                        with sqlite3.connect(database) as connection:
                            connection.execute("UPDATE marker SET value='migrated'")
                        if failure == 'migration':
                            raise RuntimeError('migration failed')

                def readiness(commit=None):
                    if commit and failure == 'readiness':
                        raise RuntimeError('readiness failed')

                from contextlib import ExitStack
                with ExitStack() as patches:
                    for name, value in {
                        'APP': app, 'RELEASES': root / 'releases', 'BACKUPS': root / 'backups',
                        'DATABASE': database, 'MAINTENANCE': root / 'maintenance',
                        'run': command, 'healthy': readiness,
                    }.items():
                        patches.enter_context(patch.object(release, name, value))
                    if failure:
                        with self.assertRaisesRegex(RuntimeError, failure):
                            release.dispatch(delta(expected, ['backend/src/app.py']))
                    else:
                        release.dispatch(delta(expected, ['backend/src/app.py']))
                self.assertEqual((app / 'backend/src/app.py').read_bytes(),
                                 b'old code' if failure else b'new code')
                self.assertFalse((root / 'maintenance').exists())
                with sqlite3.connect(database) as connection:
                    self.assertEqual(connection.execute('SELECT value FROM marker').fetchone()[0],
                                     'original' if failure else 'migrated')


if __name__ == '__main__':
    unittest.main()
