"""Deterministic content validation and safe public projections; no I/O."""

import hashlib
import ipaddress
import re
from urllib.parse import urlsplit

from .content import ContestDocument, ContestIntroduction, ContentCitation, PublicContestDocument

EXTRACTOR_VERSION = 'content-v1'
MAX_DOCUMENT_BYTES = 1_048_576


def normalized_text(text: str) -> str:
    return ' '.join(text.split())


def validate_public_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Evidence requires a public HTTP(S) URL without credentials')
    host = parsed.hostname.lower().rstrip('.')
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal', '.lan', '.home', '.localdomain')):
        raise ValueError('Private evidence URLs are not allowed')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        numeric_parts = host.split('.')
        if '.' not in host or all(re.fullmatch(r'(?:[0-9]+|0x[0-9a-f]+)', part, re.I) for part in numeric_parts):
            raise ValueError('Evidence URLs require a public DNS name or canonical public IP')
    else:
        if not address.is_global:
            raise ValueError('Private evidence URLs are not allowed')
    return url


def validate_document(document: ContestDocument) -> None:
    validate_public_url(document.url)
    raw = document.body.encode('utf-8')
    if len(raw) > MAX_DOCUMENT_BYTES:
        raise ValueError('Evidence document exceeds the size limit')
    if not normalized_text(document.body) or hashlib.sha256(raw).hexdigest() != document.content_hash:
        raise ValueError('Evidence document body/hash mismatch')
    if document.kind == 'search_snippet' and document.completeness != 'partial':
        raise ValueError('A search snippet cannot be a complete source document')
    if document.publication == 'full_text_allowed':
        if not document.publication_license_url:
            raise ValueError('Full-text publication requires an explicit source license URL')
        validate_public_url(document.publication_license_url)


def validate_citation(citation: ContentCitation, documents: list[ContestDocument]) -> None:
    validate_public_url(citation.url)
    excerpt = normalized_text(citation.excerpt)
    if not excerpt or not any(document.url == citation.url and document.content_hash == citation.content_hash
                              and excerpt in normalized_text(document.body) for document in documents):
        raise ValueError('Citation does not match the referenced source body and hash')


def _display(text: str) -> str:
    plain = normalized_text(text.replace('**', '').replace('__', '').replace('`', ''))
    return re.sub(r'(?<=[。！？])\s+', '', plain)


def validate_introduction(introduction: ContestIntroduction, documents: list[ContestDocument]) -> None:
    for citation in introduction.citations:
        validate_citation(citation, documents)
    if introduction.method == 'extractive' and _display(introduction.text) != _display(
            ' '.join(citation.excerpt for citation in introduction.citations)):
        raise ValueError('An extractive introduction must preserve the cited source text')


def build_introduction(document: ContestDocument) -> ContestIntroduction | None:
    """Select intact descriptive sentences, never invent text or truncate a tag/date stub."""
    validate_document(document)
    if document.kind == 'search_snippet':
        return None
    candidates = []
    for paragraph in re.split(r'\n\s*\n', document.body):
        if re.match(r'^\s*(?:#{1,6}\s|(?:主题|Themes?|提交区间|报名截止|比赛时间)\s*[:：])', paragraph, re.I):
            continue
        for sentence in re.split(r'(?<=[。！？])|(?<=[.!?])\s+', paragraph):
            sentence = sentence.strip()
            plain = _display(sentence)
            if not 24 <= len(plain) <= 300 or len(re.findall(r'https?://', sentence)) > 1:
                continue
            if re.search(r'privacy policy|cookie|all rights reserved|log in|sign in', plain, re.I):
                continue
            score = len(re.findall(r'黑客松|比赛|开发|围绕|面向|旨在|协作|作品|hackathon|competition|build|creat|student|develop|collaborat', plain, re.I))
            if score and not re.match(r'^\s*(?:[-|#>]|\d{1,2}[:：])', plain):
                candidates.append((score, len(candidates), sentence, plain))
    selected, length = [], 0
    for candidate in sorted(candidates, key=lambda item: (-item[0], item[1])):
        if length + len(candidate[3]) + bool(selected) <= 300:
            selected.append(candidate)
            length += len(candidate[3]) + (len(selected) > 1)
        if len(selected) == 3:
            break
    if not selected:
        return None
    selected.sort(key=lambda item: item[1])
    return ContestIntroduction(text=' '.join(item[3] for item in selected), citations=[
        ContentCitation(url=document.url, content_hash=document.content_hash, excerpt=item[2])
        for item in selected
    ])


def public_document(document: ContestDocument, excerpts: list[str]) -> PublicContestDocument:
    values = document.model_dump()
    if document.publication != 'full_text_allowed':
        values['body'] = None
    values['excerpts'] = list(dict.fromkeys(excerpt for excerpt in excerpts if excerpt.strip()))
    return PublicContestDocument(**values)
