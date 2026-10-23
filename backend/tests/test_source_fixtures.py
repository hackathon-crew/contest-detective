import json
import re
from pathlib import Path

FIXTURES = Path(__file__).parent / 'fixtures'
WAYTO_FIELDS = {
    'id', 'title', 'date', 'endDate', 'deadline', 'eventMode', 'city', 'eventKind',
    'timeStatus', 'origin', 'externalRegUrl', 'cover', 'organizerName', 'description', 'venue',
}
OPERATIONAL_KEY = re.compile(r'(?:token|password|secret|authorization|checkin.*(?:key|code)|api[_-]?key)', re.I)


def _forbidden_paths(value, path='$'):
    if isinstance(value, dict):
        for key, child in value.items():
            location = f'{path}.{key}'
            if OPERATIONAL_KEY.search(key):
                yield location
            yield from _forbidden_paths(child, location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _forbidden_paths(child, f'{path}[{index}]')


def test_all_json_snapshots_reject_operational_credential_fields():
    violations = [f'{path.name}:{field}' for path in FIXTURES.rglob('*.json')
                  for field in _forbidden_paths(json.loads(path.read_text()))]
    assert not violations, '\n'.join(violations[:20])


def test_waytoagi_snapshots_only_contain_adapter_business_fields():
    listing = json.loads((FIXTURES / 'waytoagi.json').read_text())
    details = json.loads((FIXTURES / 'waytoagi_details.json').read_text())
    violations = []
    for label, event in [(f'list[{index}]', item) for index, item in enumerate(listing['items'])] + [
        (f'detail[{event_id}]', item['event']) for event_id, item in details.items()
    ]:
        violations.extend(f'{label}.{key}' for key in set(event) - WAYTO_FIELDS)
    assert not violations, '\n'.join(violations[:20])
