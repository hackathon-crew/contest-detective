"""Stable contest text: fetched timestamps and source bookkeeping are not content."""
from hashlib import sha256

from .contracts import IndexDocument

MAX_INPUT_BYTES = 8000


def build_document(contest, details) -> IndexDocument:
    parts = [contest.name, details.summary or '', ' '.join(sorted(details.themes or []))]
    if details.introduction:
        parts.append(details.introduction.get('text', ''))
    for name, value in sorted((details.fields or {}).items()):
        if value.get('value') is not None:
            parts.append(f'{name}: {value["value"]}')
    latest = {}
    for document in details.documents or []:
        if document.get('kind') == 'search_snippet' or not document.get('body'):
            continue
        previous = latest.get(document['url'])
        rank = lambda item: (item.get('retrieved_at', ''), item.get('completeness') == 'full', len(item['body']))
        if previous is None or rank(document) >= rank(previous):
            latest[document['url']] = document
    parts.extend(latest[url]['body'] for url in sorted(latest))
    normalized = '\n'.join(dict.fromkeys(' '.join(part.split()) for part in parts if part.strip()))
    # One bounded input, never chunks. UTF-8 bytes also bound byte-fallback tokens
    # below BGE-M3's 8192-token context, including its special tokens.
    bounded = normalized.encode('utf-8')[:MAX_INPUT_BYTES].decode('utf-8', errors='ignore')
    return IndexDocument(contest.id, bounded, sha256(normalized.encode('utf-8')).hexdigest())
