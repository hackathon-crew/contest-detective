#!/usr/bin/env python3
"""Receive one release bundle on stdin and deploy the production service."""

import fcntl
import hashlib
import io
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
from typing import Dict, NamedTuple, Optional
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import Request, urlopen


APP = Path('/srv/contest-detective')
RELEASES = Path('/srv/contest-detective-releases')
BACKUPS = Path('/srv/contest-detective-backups')
DATABASE = Path('/var/lib/contest-detective/contest.db')
ENVIRONMENT_FILE = Path('/etc/contest-detective.env')
SERVICE = 'contest-detective'
MCP_SERVICE = 'contest-detective-mcp'
SYSTEMD = Path('/etc/systemd/system')
UVICORN = '/srv/contest-detective/backend/.venv/bin/uvicorn'
# Unit files are installed by hand during first setup, so every release writes the ExecStart it
# needs. The current layout comes first; the pre-refactor layout stays usable for rollbacks.
ENTRYPOINTS = {
    SERVICE: (
        ('bootstrap/app.py', 'contest_detective.bootstrap.app:app', ()),
        ('web/bootstrap/app.py', 'contest_detective.web.bootstrap.app:app', ()),
    ),
    MCP_SERVICE: (
        ('bootstrap/mcp_http.py', 'contest_detective.bootstrap.mcp_http:create_app', ('--factory',)),
        ('web/bootstrap/mcp_http.py', 'contest_detective.web.bootstrap.mcp_http:create_app', ('--factory',)),
    ),
}
PORTS = {SERVICE: 8000, MCP_SERVICE: 8001}
MAINTENANCE = Path('/run/contest-detective-deploying')
MAX_BUNDLE = 256 * 1024 * 1024
MANIFEST_NAME = 'RELEASE_MANIFEST.json'
MANIFEST_REQUEST = b'INKPAW_RELEASE_MANIFEST_V1\n'
REQUIRED_FILES = {'backend/pyproject.toml', 'backend/uv.lock', 'backend/alembic.ini',
                  'frontend/dist/index.html', 'frontend/dist/version.json',
                  'RELEASE_COMMIT', 'RELEASE_TAG'}


class DatabaseTarget(NamedTuple):
    backend: str
    sqlite_path: Optional[Path] = None
    env: Optional[Dict[str, str]] = None
    database: Optional[str] = None


def allowed_file(name):
    path = PurePosixPath(name)
    parts = path.parts
    return (bool(parts) and path.as_posix() == name and not path.is_absolute()
            and '..' not in parts
            and not any(part in ('.git', '.venv', '__pycache__')
                        or (part.startswith('.env') and part != '.env.example') for part in parts)
            and ((parts[0] == 'backend' and len(parts) > 1)
                 or (parts[:2] == ('frontend', 'dist') and len(parts) > 2)
                 or name in ('RELEASE_COMMIT', 'RELEASE_TAG', 'deploy/server.env.example')))


def file_record(path):
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            size += len(chunk)
            digest.update(chunk)
    return {'sha256': digest.hexdigest(), 'size': size}


def validate_manifest(document):
    if (not isinstance(document, dict) or document.get('version') != 1
            or not isinstance(document.get('files'), dict)):
        raise ValueError('Invalid release manifest')
    total = 0
    for name, value in document['files'].items():
        if (not isinstance(name, str) or not allowed_file(name)
                or not isinstance(value, dict) or set(value) != {'sha256', 'size'}
                or not isinstance(value['sha256'], str)
                or not re.fullmatch(r'[0-9a-f]{64}', value['sha256'])
                or type(value['size']) is not int or value['size'] < 0):
            raise ValueError(f'Invalid manifest entry: {name}')
        total += value['size']
    names = set(document['files'])
    if total > MAX_BUNDLE or any(str(parent) in names for name in names
                                 for parent in PurePosixPath(name).parents):
        raise ValueError('Invalid manifest size or overlapping paths')
    return document


def release_manifest(directory):
    files = {}
    for relative in ('backend', 'frontend/dist', 'deploy'):
        for parent, directories, names in os.walk(directory / relative, followlinks=False):
            directories[:] = [name for name in directories
                              if name not in ('.git', '.venv', '__pycache__')
                              and not (Path(parent) / name).is_symlink()]
            for name in names:
                path = Path(parent) / name
                relative_name = path.relative_to(directory).as_posix()
                if allowed_file(relative_name) and path.is_file() and not path.is_symlink():
                    files[relative_name] = file_record(path)
    for name in ('RELEASE_COMMIT', 'RELEASE_TAG'):
        path = directory / name
        if path.is_file() and not path.is_symlink():
            files[name] = file_record(path)
    return validate_manifest({'version': 1, 'files': files})


def incremental_unpack(archive, destination):
    control = archive.getmember(MANIFEST_NAME)
    if control.size > 4 * 1024 * 1024:
        raise ValueError('Release manifest exceeds 4 MiB')
    document = validate_manifest(json.load(archive.extractfile(control)))
    files = document['files']
    uploaded = {member.name for member in archive.getmembers()
                if member.isfile() and member.name != MANIFEST_NAME}
    if not REQUIRED_FILES <= files.keys() or not uploaded <= files.keys():
        raise ValueError('Incomplete incremental release or unexpected payload')
    base = APP.resolve()
    sources = {}
    # Verify every byte source before extracting or stopping any production service.
    for name, expected in files.items():
        if name in uploaded:
            member = archive.getmember(name)
            with archive.extractfile(member) as source:
                digest = hashlib.sha256()
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
            actual = {'sha256': digest.hexdigest(), 'size': member.size}
        else:
            source = base / name
            if (not source.is_file() or source.is_symlink()
                    or not source.resolve().is_relative_to(base)):
                raise ValueError(f'Missing reusable file: {name}')
            actual = file_record(source)
            sources[name] = source
        if actual != expected:
            raise ValueError(f'Release file hash mismatch: {name}')

    def read(name):
        return archive.extractfile(name).read() if name in uploaded else sources[name].read_bytes()

    tag, commit = read('RELEASE_TAG').decode().strip(), read('RELEASE_COMMIT').decode().strip()
    if (not re.fullmatch(r'v\d+\.\d+\.\d+', tag)
            or not re.fullmatch(r'[0-9a-f]{40}', commit)
            or json.loads(read('frontend/dist/version.json')) != {'tag': tag, 'commit': commit}):
        raise ValueError('Invalid release identity')
    for name, expected in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        if name in uploaded:
            with archive.extractfile(name) as source, target.open('wb') as output:
                shutil.copyfileobj(source, output)
        else:
            shutil.copyfile(sources[name], target)
        target.chmod(0o644)
        if file_record(target) != expected:
            raise ValueError(f'Release file changed while assembling: {name}')
    log(f'Incremental files: changed={len(uploaded)} reused={len(files) - len(uploaded)}')
    return tag, commit


def dispatch(stream, output=None):
    buffered = stream if hasattr(stream, 'peek') else io.BufferedReader(stream)
    if buffered.peek(1)[:1] == b'\x1f':
        return deploy(buffered)
    if buffered.readline(128) != MANIFEST_REQUEST or buffered.read(1):
        raise ValueError('Unknown deployment request')
    document = release_manifest(APP)
    if not REQUIRED_FILES <= document['files'].keys():
        raise ValueError('No complete deployed release for incremental transfer')
    output = sys.stdout if output is None else output
    output.write(json.dumps(document, sort_keys=True) + '\n')
    output.flush()


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
            ) or member.name in ('frontend', 'RELEASE_COMMIT', 'RELEASE_TAG') or (
                member.name == MANIFEST_NAME and member.isfile()
            ) or (
                member.name == 'deploy' and member.isdir()
            ) or (
                member.name == 'deploy/server.env.example' and member.isfile()
            )
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
        if MANIFEST_NAME in names:
            return incremental_unpack(archive, destination)
        required = REQUIRED_FILES
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


def environment_values(path=None):
    path = path or ENVIRONMENT_FILE
    values = {}
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except FileNotFoundError:
        return values
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def sqlite_path(url):
    parsed = urlsplit(url)
    path = unquote(parsed.path)
    target = Path(path[1:]) if path.startswith('/') else Path(path)
    if not target.parts:
        raise ValueError('SQLite URL must point to a database file')
    if not target.is_absolute():
        target = APP / 'backend' / target
    return target.resolve()


def postgres_environment(url):
    normalized = url.replace('postgresql+psycopg://', 'postgresql://', 1)
    normalized = normalized.replace('postgres+psycopg://', 'postgresql://', 1)
    normalized = normalized.replace('postgres://', 'postgresql://', 1)
    parsed = urlsplit(normalized)
    database = unquote(parsed.path.lstrip('/'))
    if not database:
        raise ValueError('PostgreSQL URL must include a database name')
    environment = dict(os.environ)
    if parsed.hostname:
        environment['PGHOST'] = parsed.hostname
    if parsed.port:
        environment['PGPORT'] = str(parsed.port)
    if parsed.username:
        environment['PGUSER'] = unquote(parsed.username)
    if parsed.password is not None:
        environment['PGPASSWORD'] = unquote(parsed.password)
    environment['PGDATABASE'] = database
    query = parse_qs(parsed.query)
    for key, pg_key in (
        ('sslmode', 'PGSSLMODE'),
        ('connect_timeout', 'PGCONNECT_TIMEOUT'),
        ('application_name', 'PGAPPNAME'),
        ('options', 'PGOPTIONS'),
    ):
        if query.get(key):
            environment[pg_key] = query[key][0]
    return environment, database


def database_target(values=None):
    values = environment_values() if values is None else values
    url = values.get('DETECTIVE_DB_URL', '').strip()
    host = values.get('DETECTIVE_DB_HOST', '').strip()
    name = values.get('DETECTIVE_DB_NAME', '').strip()
    user = values.get('DETECTIVE_DB_USER', '').strip()
    password = values.get('DETECTIVE_DB_PASSWORD', '').strip()
    if url and host:
        raise ValueError('DETECTIVE_DB_URL 与 DETECTIVE_DB_HOST 只能设置一个')
    if not host and any((name, user, password)):
        raise ValueError('DETECTIVE_DB_NAME/USER/PASSWORD 需要与 DETECTIVE_DB_HOST 一起设置')
    if host:
        if not name or not user:
            raise ValueError('DETECTIVE_DB_HOST 需要同时设置 DETECTIVE_DB_NAME 和 DETECTIVE_DB_USER')
        environment = dict(os.environ)
        for key, pg_key in (
            ('DETECTIVE_DB_HOST', 'PGHOST'),
            ('DETECTIVE_DB_PORT', 'PGPORT'),
            ('DETECTIVE_DB_NAME', 'PGDATABASE'),
            ('DETECTIVE_DB_USER', 'PGUSER'),
            ('DETECTIVE_DB_PASSWORD', 'PGPASSWORD'),
        ):
            value = values.get(key, '').strip()
            if value:
                environment[pg_key] = value
        return DatabaseTarget('postgresql', env=environment, database=name)
    if url.startswith(('postgresql://', 'postgresql+psycopg://', 'postgres://', 'postgres+psycopg://')):
        environment, database = postgres_environment(url)
        return DatabaseTarget('postgresql', env=environment, database=database)
    if url.startswith(('sqlite://', 'sqlite+pysqlite://')):
        return DatabaseTarget('sqlite', sqlite_path=sqlite_path(url))
    if url:
        raise ValueError('只支持 SQLite 或 PostgreSQL 数据库地址')
    return DatabaseTarget('sqlite', sqlite_path=DATABASE)


def preflight_database(target):
    if target.backend == 'sqlite':
        if not target.sqlite_path.is_file():
            raise ValueError(f'SQLite database does not exist: {target.sqlite_path}')
        return
    for command in ('pg_dump', 'psql', 'pg_restore'):
        if shutil.which(command) is None:
            raise ValueError(f'{command} is required for PostgreSQL releases')
    run('psql', '--dbname', target.database, '--set', 'ON_ERROR_STOP=1',
        '--command', 'select 1', env=target.env)


def postgres_snapshot(target, snapshot):
    temporary = snapshot.with_name(snapshot.name + '.tmp')
    temporary.unlink(missing_ok=True)
    try:
        run('pg_dump', '--format=custom', '--file', str(temporary),
            '--dbname', target.database, env=target.env, timeout=3600)
        temporary.chmod(0o600)
        os.replace(temporary, snapshot)
    finally:
        temporary.unlink(missing_ok=True)


def postgres_restore(target, snapshot):
    run('psql', '--dbname', target.database, '--set', 'ON_ERROR_STOP=1', '--command',
        'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;', env=target.env)
    run('pg_restore', '--dbname', target.database, '--no-owner', '--no-privileges',
        '--single-transaction', '--exit-on-error', str(snapshot), env=target.env, timeout=3600)


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


def run(*args, timeout=600, **kwargs):
    subprocess.run(args, check=True, timeout=timeout, **kwargs)


def point_to(directory):
    link = APP.with_name(APP.name + '.next')
    link.unlink(missing_ok=True)
    link.symlink_to(directory, target_is_directory=True)
    os.replace(link, APP)


def service_command(directory, service):
    package = directory / 'backend/src/contest_detective'
    for relative, module, flags in ENTRYPOINTS[service]:
        if (package / relative).is_file():
            return ' '.join((UVICORN, module, *flags, '--host', '127.0.0.1',
                             '--port', str(PORTS[service]), '--workers', '1',
                             '--proxy-headers', '--forwarded-allow-ips=127.0.0.1'))
    return None


def release_services(directory):
    return (SERVICE, MCP_SERVICE) if service_command(directory, MCP_SERVICE) else (SERVICE,)


def configure_services(directory, services):
    """Point the installed units at the entrypoints this release provides.

    Rewriting the drop-in before every start also covers a rollback to a release with the older
    package layout, whose ExecStart differs from what is installed on the host.
    """
    changed = False
    for service in services:
        command = service_command(directory, service)
        if command is None or not (SYSTEMD / (service + '.service')).is_file():
            continue
        drop_in = SYSTEMD / (service + '.service.d') / 'release.conf'
        drop_in.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        content = f'[Service]\nExecStart=\nExecStart={command}\n'
        if not drop_in.is_file() or drop_in.read_text() != content:
            drop_in.write_text(content)
            drop_in.chmod(0o644)
            changed = True
    if changed:
        run('systemctl', 'daemon-reload')


def replace_environment(content):
    owner = ENVIRONMENT_FILE.stat()
    descriptor, name = tempfile.mkstemp(prefix=ENVIRONMENT_FILE.name + '.', dir=ENVIRONMENT_FILE.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(content)
        os.chown(temporary, owner.st_uid, owner.st_gid)
        temporary.chmod(owner.st_mode & 0o777)
        os.replace(temporary, ENVIRONMENT_FILE)
    finally:
        temporary.unlink(missing_ok=True)


def configure_environment(directory, snapshot):
    example = directory / 'deploy/server.env.example'
    if not example.is_file():  # Older published bundles do not carry deployment defaults.
        return
    key = b'DETECTIVE_LLM_NORMALIZATION_PROMPT_PATH'
    original = ENVIRONMENT_FILE.read_bytes()
    if re.search(rb'(?m)^[ \t]*' + key + rb'[ \t]*=', original):
        return
    # Only this new field is migrated. Example credentials and schedules are not runtime defaults.
    defaults = [line for line in example.read_bytes().splitlines() if line.startswith(key + b'=')]
    if len(defaults) > 1:
        raise ValueError('Duplicate normalization prompt default')
    if defaults:
        shutil.copy2(ENVIRONMENT_FILE, snapshot)
        snapshot.chmod(0o600)
        separator = b'' if not original or original.endswith(b'\n') else b'\n'
        replace_environment(original + separator + defaults[0] + b'\n')
        log('Added the missing normalization prompt setting')


def validate_configuration(directory, unit):
    module = directory / 'backend/src/contest_detective/agent/normalization_prompts.py'
    if not module.is_file():
        return
    # Load settings and render the template without constructing a model or starting the application.
    check = (
        'from contest_detective.agent.config import get_llm_settings; '
        'from contest_detective.agent.normalization_prompts import load_prompt; '
        'assert load_prompt(get_llm_settings().normalization_prompt_path).render().strip(); '
        'print("Normalization prompt configuration validated")'
    )
    run('systemd-run', '--wait', '--pipe', '--collect', f'--unit={unit}',
        '--property=User=contest-detective', '--property=Group=contest-detective',
        f'--property=EnvironmentFile={ENVIRONMENT_FILE}',
        f'--property=WorkingDirectory={directory / "backend"}',
        str(directory / 'backend/.venv/bin/python'), '-c', check)


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
            if MCP_SERVICE in release_services(APP):
                request = Request('http://127.0.0.1/mcp', headers={
                    'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
                }, data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
                    'protocolVersion': '2025-11-25', 'capabilities': {},
                    'clientInfo': {'name': 'release-health', 'version': '1.0'},
                }}).encode())
                with urlopen(request, timeout=2) as response:
                    if 'serverInfo' not in json.load(response).get('result', {}):
                        raise RuntimeError('MCP initialization failed')
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
    database = None
    environment_snapshot = None
    migration_unit = 'contest-detective-migrate-' + stage.name
    previous = APP.resolve()
    previous_services = release_services(previous)
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
        target_services = release_services(stage)
        managed_services = tuple(dict.fromkeys(previous_services + target_services))
        run('/usr/local/bin/uv', 'sync', '--locked', '--no-dev', '--python', '3.12',
            cwd=stage / 'backend',
            env={**os.environ, 'UV_PYTHON_INSTALL_DIR': '/opt/contest-python',
                 'UV_LINK_MODE': 'copy'})
        # Keep the original directory on the first deployment. Later switches replace a symlink.
        backup = BACKUPS / stage.name
        backup.mkdir(mode=0o700)
        environment_snapshot = backup / 'environment'
        configure_environment(stage, environment_snapshot)
        validate_configuration(stage, 'contest-detective-config-' + stage.name)
        database = database_target()
        preflight_database(database)
        MAINTENANCE.touch(mode=0o644)
        stopped = True
        run('systemctl', 'stop', *managed_services)
        snapshot_path = backup / ('contest.db' if database.backend == 'sqlite' else 'contest.dump')
        if database.backend == 'sqlite':
            snapshot_database(database.sqlite_path, snapshot_path)
        else:
            postgres_snapshot(database, snapshot_path)
        snapshot = snapshot_path
        (backup / 'previous-release').write_text(str(previous) + '\n')
        if not APP.is_symlink():
            previous = RELEASES / ('legacy-' + stage.name)
            APP.rename(previous)
            (backup / 'previous-release').write_text(str(previous) + '\n')
            point_to(previous)
        # Migrations receive the same env file and Unix identity as the production service.
        run('systemd-run', '--wait', '--pipe', '--collect', f'--unit={migration_unit}',
            '--property=User=contest-detective', '--property=Group=contest-detective',
            f'--property=EnvironmentFile={ENVIRONMENT_FILE}',
            f'--property=WorkingDirectory={stage / "backend"}',
            str(stage / 'backend/.venv/bin/alembic'), 'upgrade', 'head')
        point_to(stage)
        configure_services(stage, target_services)
        run('systemctl', 'start', *target_services)
        healthy(commit)
        MAINTENANCE.unlink()
        log(f'Deployed {tag} ({commit}); backup: {backup}')
    except BaseException:
        if environment_snapshot is not None and environment_snapshot.is_file():
            replace_environment(environment_snapshot.read_bytes())
        if stopped:
            log('Deployment failed; restoring the previous release')
            run('systemctl', 'stop', *managed_services)
            # A disconnected systemd-run client can leave its migration unit running.
            try:
                run('systemctl', 'stop', migration_unit)
            except subprocess.CalledProcessError as error:
                if error.returncode != 5:  # An already collected unit no longer exists.
                    raise
            if snapshot is not None and database is not None:
                try:
                    if database.backend == 'sqlite':
                        restore_database(snapshot, database.sqlite_path)
                    else:
                        postgres_restore(database, snapshot)
                except Exception as error:
                    log(f'Database restore failed: {type(error).__name__}: {error}')
            point_to(previous)
            configure_services(previous, previous_services)
            run('systemctl', 'start', *previous_services)
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
        dispatch(sys.stdin.buffer)
