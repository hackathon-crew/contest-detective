#!/usr/bin/env python3
"""Receive one release bundle on stdin and deploy the production service."""

import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.request import urlopen


APP = Path('/srv/contest-detective')
RELEASES = Path('/srv/contest-detective-releases')
BACKUPS = Path('/srv/contest-detective-backups')
DATABASE = Path('/var/lib/contest-detective/contest.db')
SERVICE = 'contest-detective'
MAINTENANCE = Path('/run/contest-detective-deploying')
MAX_BUNDLE = 256 * 1024 * 1024


def unpack(stream, destination):
    """Validate the whole archive before allowing any files onto disk."""
    with tarfile.open(fileobj=stream, mode='r:gz') as archive:
        members = archive.getmembers()
        names = set()
        total = 0
        for member in members:
            path = PurePosixPath(member.name)
            parts = path.parts
            allowed = (parts and parts[0] == 'backend') or (
                parts[:2] == ('frontend', 'dist')
            ) or member.name in ('frontend', 'RELEASE_COMMIT', 'RELEASE_TAG')
            forbidden = any(
                part in ('.git', '.venv', '__pycache__')
                or (part.startswith('.env') and part != '.env.example')
                for part in parts
            )
            total += member.size
            if (not allowed or path.is_absolute() or '..' in parts or forbidden
                    or not (member.isfile() or member.isdir())
                    or member.name in names or total > MAX_BUNDLE):
                raise ValueError(f'Invalid release member: {member.name}')
            names.add(member.name)
        required = {'backend/pyproject.toml', 'backend/uv.lock', 'backend/alembic.ini',
                    'frontend/dist/index.html', 'frontend/dist/version.json',
                    'RELEASE_COMMIT', 'RELEASE_TAG'}
        if not required <= names:
            raise ValueError('Incomplete release bundle')
        for name in required:
            if not archive.getmember(name).isfile():
                raise ValueError(f'Expected a regular file: {name}')
        tag = archive.extractfile('RELEASE_TAG').read().decode().strip()
        commit = archive.extractfile('RELEASE_COMMIT').read().decode().strip()
        version = json.load(archive.extractfile('frontend/dist/version.json'))
        if (not re.fullmatch(r'v\d+\.\d+\.\d+', tag)
                or not re.fullmatch(r'[0-9a-f]{40}', commit)
                or version != {'tag': tag, 'commit': commit}):
            raise ValueError('Invalid release identity')
        # Only regular files and directories survive validation. Ignore archive permissions.
        for member in members:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with archive.extractfile(member) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o644)
        return tag, commit


def snapshot_database(database, snapshot):
    # SQLite's backup API includes committed WAL data; copying just contest.db can lose it.
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as source:
        with sqlite3.connect(snapshot) as target:
            source.backup(target)
    snapshot.chmod(0o600)


def restore_database(snapshot, database):
    owner = database.stat()
    temporary = database.with_suffix('.restore')
    shutil.copyfile(snapshot, temporary)
    os.chown(temporary, owner.st_uid, owner.st_gid)
    temporary.chmod(owner.st_mode & 0o777)
    for suffix in ('-wal', '-shm'):
        Path(str(database) + suffix).unlink(missing_ok=True)
    os.replace(temporary, database)


def log(message):
    # A disconnected runner must not prevent recovery just because stdout has closed.
    try:
        os.write(1, (message + '\n').encode())
    except BrokenPipeError:
        pass


def interrupted(signum, frame):
    raise InterruptedError(f'Deployment interrupted by signal {signum}')


def run(*args, **kwargs):
    subprocess.run(args, check=True, timeout=600, **kwargs)


def point_to(directory):
    link = APP.with_name(APP.name + '.next')
    link.unlink(missing_ok=True)
    link.symlink_to(directory, target_is_directory=True)
    os.replace(link, APP)


def healthy(expected_commit=None):
    for attempt in range(30):
        try:
            with urlopen('http://127.0.0.1:8000/health', timeout=2) as response:
                if response.status != 200:
                    raise RuntimeError('Backend is unhealthy')
            with urlopen('http://127.0.0.1/api/health', timeout=2) as response:
                if response.status != 200:
                    raise RuntimeError('Proxy is unhealthy')
            with urlopen('http://127.0.0.1/', timeout=2) as response:
                if response.status != 200:
                    raise RuntimeError('Frontend is unhealthy')
            if expected_commit:
                with urlopen('http://127.0.0.1/version.json', timeout=2) as response:
                    if json.load(response).get('commit') != expected_commit:
                        raise RuntimeError('Frontend version does not match')
            return
        except Exception:
            if attempt == 29:
                raise
            time.sleep(1)


def deploy(stream):
    os.umask(0o022)
    RELEASES.mkdir(mode=0o755, exist_ok=True)
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='release-', dir=RELEASES))
    stage.chmod(0o755)
    stopped = False
    snapshot = None
    migration_unit = 'contest-detective-migrate-' + stage.name
    previous = APP.resolve()
    try:
        with tempfile.TemporaryFile() as bundle:
            size = 0
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BUNDLE:
                    raise ValueError('Release upload exceeds 256 MiB')
                bundle.write(chunk)
            bundle.seek(0)
            tag, commit = unpack(bundle, stage)
        log(f'Preparing {tag} ({commit})')
        run('/usr/local/bin/uv', 'sync', '--locked', '--no-dev', '--python', '3.12',
            cwd=stage / 'backend',
            env={**os.environ, 'UV_PYTHON_INSTALL_DIR': '/opt/contest-python',
                 'UV_LINK_MODE': 'copy'})
        # Keep the original directory on the first deployment. Later switches replace a symlink.
        backup = BACKUPS / stage.name
        backup.mkdir(mode=0o700)
        MAINTENANCE.touch(mode=0o644)
        stopped = True
        run('systemctl', 'stop', SERVICE)
        snapshot_database(DATABASE, backup / 'contest.db')
        snapshot = backup / 'contest.db'
        (backup / 'previous-release').write_text(str(previous) + '\n')
        if not APP.is_symlink():
            previous = RELEASES / ('legacy-' + stage.name)
            APP.rename(previous)
            (backup / 'previous-release').write_text(str(previous) + '\n')
            point_to(previous)
        # Migrations receive the same env file and Unix identity as the production service.
        run('systemd-run', '--wait', '--pipe', '--collect', f'--unit={migration_unit}',
            '--property=User=contest-detective', '--property=Group=contest-detective',
            '--property=EnvironmentFile=/etc/contest-detective.env',
            f'--property=WorkingDirectory={stage / "backend"}',
            str(stage / 'backend/.venv/bin/alembic'), 'upgrade', 'head')
        point_to(stage)
        run('systemctl', 'start', SERVICE)
        healthy(commit)
        MAINTENANCE.unlink()
        log(f'Deployed {tag} ({commit}); backup: {backup}')
    except BaseException:
        if stopped:
            log('Deployment failed; restoring the previous release')
            run('systemctl', 'stop', SERVICE)
            # A disconnected systemd-run client can leave its migration unit running.
            try:
                run('systemctl', 'stop', migration_unit)
            except subprocess.CalledProcessError as error:
                if error.returncode != 5:  # An already collected unit no longer exists.
                    raise
            if snapshot is not None:
                restore_database(snapshot, DATABASE)
            point_to(previous)
            run('systemctl', 'start', SERVICE)
            healthy()
            MAINTENANCE.unlink(missing_ok=True)
            log(f'Restored {previous}')
        if APP.resolve() != stage:
            shutil.rmtree(stage)
        raise


if __name__ == '__main__':
    if os.geteuid() != 0:
        sys.exit('Run through the restricted SSH deployment command as root')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    with open('/run/lock/contest-detective-deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy(sys.stdin.buffer)
