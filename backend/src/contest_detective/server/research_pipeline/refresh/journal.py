"""Row-scoped public-data rollback. Account and credential tables are never copied here."""

import json
from pathlib import Path

from sqlalchemy import create_engine

TABLES = ('contests', 'contest_details', 'contest_pages', 'contest_page_links', 'contest_claims',
          'content_refresh_runs', 'content_refresh_entries')


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def columns(connection, table):
    return [dict(row) for row in connection.exec_driver_sql(f'PRAGMA table_info({quote(table)})').mappings()]


def snapshot(connection):
    result = {}
    for table in TABLES:
        primary = [column['name'] for column in sorted(columns(connection, table), key=lambda row: row['pk']) if column['pk']]
        if not primary:
            raise ValueError('Database must be migrated before an offline refresh')
        rows = connection.exec_driver_sql(f'SELECT * FROM {quote(table)}').mappings()
        result[table] = {json.dumps({key: row[key] for key in primary}, sort_keys=True): dict(row) for row in rows}
    return result


def changes(before, after):
    return [{'table': table, 'key': json.loads(key), 'before': before[table].get(key), 'after': after[table].get(key)}
            for table in TABLES for key in sorted(before[table].keys() | after[table].keys())
            if before[table].get(key) != after[table].get(key)]


def where(key):
    return ' AND '.join(f'{quote(name)} = ?' for name in key), tuple(key.values())


def _check_dependents(connection, removals):
    tables = [row[0] for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")]
    for removal in removals:
        for child in tables:
            groups = {}
            for row in connection.exec_driver_sql(f'PRAGMA foreign_key_list({quote(child)})').mappings():
                if row['table'] == removal['table']:
                    groups.setdefault(row['id'], []).append(row)
            for group in groups.values():
                condition = {item['from']: removal['after'][item['to']] for item in group}
                clause, values = where(condition)
                if child not in TABLES:
                    if connection.exec_driver_sql(f'SELECT count(*) FROM {quote(child)} WHERE {clause}', values).scalar():
                        raise ValueError('Rollback would affect non-contest dependent data; review required')
                    continue
                referenced = list(connection.exec_driver_sql(f'SELECT * FROM {quote(child)} WHERE {clause}', values).mappings())
                allowed = [change['after'] for change in removals if change['table'] == child]
                if any(dict(row) not in allowed for row in referenced):
                    raise ValueError('Rollback would remove data referenced by later changes; review required')


def restore(*, database: Path, journal: Path) -> None:
    if not database.is_file():
        raise ValueError('Rollback requires an existing local database')
    payload = json.loads(journal.read_text())
    if payload.get('schema') != 'contest-refresh-journal-v1':
        raise ValueError('Unsupported refresh journal')
    edits = payload.get('changes', [])
    if any(change.get('table') not in TABLES for change in edits):
        raise ValueError('Journal cannot modify non-contest tables')
    engine = create_engine('sqlite:///' + str(database.resolve()))
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql('PRAGMA foreign_keys=ON')
            connection.exec_driver_sql('BEGIN IMMEDIATE')
            current = snapshot(connection)
            seen = set()
            for change in edits:
                schema = columns(connection, change['table'])
                primary = {column['name'] for column in schema if column['pk']}
                names = {column['name'] for column in schema}
                if set(change['key']) != primary or any(row is not None and set(row) != names
                                                       for row in (change['before'], change['after'])):
                    raise ValueError('Journal row does not match the current schema')
                if any(row is not None and {name: row[name] for name in primary} != change['key']
                       for row in (change['before'], change['after'])):
                    raise ValueError('Journal row identity differs from its declared key')
                key = json.dumps(change['key'], sort_keys=True)
                identity = (change['table'], key)
                if identity in seen:
                    raise ValueError('Journal contains duplicate row changes')
                seen.add(identity)
                if current[change['table']].get(key) != change['after']:
                    raise ValueError('Data changed after this import; rollback refused without overwriting it')
            removals = [change for change in edits if change['before'] is None and change['after'] is not None]
            _check_dependents(connection, removals)
            for table in reversed(TABLES):
                for change in (item for item in removals if item['table'] == table):
                    clause, values = where(change['key'])
                    connection.exec_driver_sql(f'DELETE FROM {quote(table)} WHERE {clause}', values)
            for table in TABLES:
                for change in (item for item in edits if item['table'] == table and item['before'] is not None):
                    row = change['before']
                    if change['after'] is None:
                        names = ','.join(quote(name) for name in row)
                        marks = ','.join('?' for _ in row)
                        connection.exec_driver_sql(f'INSERT INTO {quote(table)} ({names}) VALUES ({marks})', tuple(row.values()))
                    else:
                        clause, values = where(change['key'])
                        assignments = ','.join(f'{quote(name)} = ?' for name in row)
                        connection.exec_driver_sql(f'UPDATE {quote(table)} SET {assignments} WHERE {clause}', tuple(row.values()) + values)
            connection.commit()
    finally:
        engine.dispose()
