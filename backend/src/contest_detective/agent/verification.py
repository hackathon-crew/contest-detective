"""Run-local evidence receipts and conservative report construction.

Search snippets remain leads. A model may select and compare observed quotes,
but cannot assign execution provenance, source identity or report completeness.
"""
import hashlib
import ipaddress
import re
import unicodedata
from datetime import datetime, timezone
from urllib.parse import parse_qsl, quote, unquote, urlsplit

from pydantic import BaseModel

from contest_detective.research.official import is_official_page
from contest_detective.research.contracts import SearchExecution
from .verification_contracts import (
    ClaimAssessment, ConfirmedClaim, InvestigationPlan, InvestigationReport,
    ReportEvidence, ScopeDecision,
)


def _plain(value):
    return value.model_dump(mode='json') if isinstance(value, BaseModel) else dict(value)


def _compact(value):
    normalized = unicodedata.normalize('NFKC', value)
    return ''.join(char for char in normalized if not char.isspace() and unicodedata.category(char) != 'Cf').casefold()


_SENSITIVE_PARAMETER = re.compile(r'(?:^|[-_])(auth|authorization|token|secret|password|passwd|pwd|credential|session|signature|sig|api[-_]?key|access[-_]?key|private[-_]?key|code)(?:$|[-_])', re.I)


def safe_evidence_url(url: str, _depth: int = 0) -> str | None:
    try:
        if _depth > 2:
            return None
        if any(ord(char) <= 32 or char in '\\<>[]"`' for char in url):
            return None
        parsed = urlsplit(url)
        host = (parsed.hostname or '').lower().rstrip('.')
        if parsed.scheme not in {'http', 'https'} or not host or parsed.username or parsed.password:
            return None
        if host == 'localhost' or '.' not in host or host.endswith(('.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.test', '.invalid', '.onion')):
            return None
        if parsed.port not in (None, 443 if parsed.scheme == 'https' else 80):
            return None
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            return None
        for name, value in parse_qsl(parsed.query, keep_blank_values=True) + parse_qsl(parsed.fragment, keep_blank_values=True):
            key = re.sub(r'[^a-z0-9]', '', name.casefold())
            if _SENSITIVE_PARAMETER.search(name) or key in {'key', 'apikey', 'accesskey', 'secret', 'clientsecret', 'token', 'accesstoken',
                       'refreshtoken', 'password', 'passwd', 'authorization', 'auth', 'session',
                       'sessionid', 'signature', 'sig', 'credential', 'credentials', 'authcode', 'jwt', 'code', 'pwd', 'privatekey'} or key.startswith(('xamz', 'xgoog')) or key.endswith(('token', 'secret', 'signature', 'credential', 'password', 'apikey', 'sessionid')):
                return None
            decoded = unquote(value)
            if re.search(r'https?://', decoded, re.I) and not safe_evidence_url(decoded, _depth + 1):
                return None
        return url
    except (TypeError, ValueError):
        return None


def public_search_site(site):
    if site is None:
        return None
    target = site if '://' in site else 'https://' + site
    if not safe_evidence_url(target):
        raise ValueError('搜索站点必须为公开域名，不含凭据或敏感参数')
    parsed = urlsplit(target)
    if parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('搜索站点只接受域名，不接受路径或参数')
    if scope_check(parsed.hostname, require_contest=False).outcome != 'allowed_contest':
        raise ValueError('搜索站点超出公开赛事核验范围')
    return parsed.hostname


_URL = re.compile(r'https?://[^\s<>"\[\]]+', re.I)
_SECRET = re.compile(r'(?i)(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|password|passwd|pwd|authorization)\s*[:=]\s*[^\s,;]+')


def contains_sensitive_link(text):
    return bool(_SECRET.search(text)) or any(not safe_evidence_url(match[0].rstrip('。，,;')) for match in _URL.finditer(text))


def export_text(text):
    """Whitelist report prose, not runtime settings/profile or credential-bearing links."""
    text = _SECRET.sub('[敏感参数已移除]', text)
    return _URL.sub(lambda match: match[0] if safe_evidence_url(match[0].rstrip('。，,;')) else '[非公开或敏感链接已移除]', text)


def public_payload(value):
    """Strip credential-bearing prose/URLs before strict tool data reaches a model or trace."""
    if isinstance(value, str):
        return export_text(value)
    if isinstance(value, list):
        return [public_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: public_payload(item) for key, item in value.items()}
    return value


def markdown_text(text):
    return re.sub(r'([\\`*_{}\[\]()<>#!|])', r'\\\1', export_text(text))


def scope_check(text: str, *, require_contest: bool = True, context_question: str = '') -> ScopeDecision:
    # Deterministic backstop; the live-mode planning stage also classifies scope.
    value = _compact(text)
    if contains_sensitive_link(text):
        return ScopeDecision(outcome='out_of_scope', message='请移除凭据、敏感参数或非公开链接后再核验公开赛事。')
    forbidden = ('时政', '政治', '政党', '选举', '总统', '政治人物', '私人恋情', '恋情', '绯闻',
                 '八卦', '个人消息', '私人消息', '个人新闻', '私生活', '家庭住址', '身份证号',
                 'politic', 'election', 'president', 'celebritygossip', 'privatelife', 'personalgossip',
                 'homeaddress', 'doxxing')
    if any(word in value for word in forbidden):
        return ScopeDecision(outcome='out_of_scope', message='这里只核验公开赛事信息，不调查时政或涉及个人的消息。')
    contest_words = ('黑客松', '比赛', '赛事', '竞赛', '参赛', '报名', '作品提交', 'hackathon', 'contest', 'competition')
    context = _compact(context_question)
    if require_contest and not any(word in value or word in context for word in contest_words):
        return ScopeDecision(outcome='needs_clarification', message='请补充要核验的赛事名称和公开规则、截止日期或参赛说法。')
    return ScopeDecision(outcome='allowed_contest', message='公开赛事核验')


class VerificationState:
    def __init__(self, mode, question, confirmed_claims):
        self.mode = mode
        self.question = question
        self.claims = [ConfirmedClaim.model_validate(item) for item in confirmed_claims] or [
            ConfirmedClaim(id='c1', text=question, origin='user')]
        if len({item.id for item in self.claims}) != len(self.claims):
            raise ValueError('核验说法 ID 不能重复')
        self.plan = None
        self.queries: list[SearchExecution] = []
        self.evidence: dict[str, ReportEvidence] = {}
        self.observed_contests = {}
        self.fetched_pages: dict[str, str] = {}
        self._segments = {}
        self._page_queries = {}
        self._official_urls = set()
        self._registration_urls = set()
        self.rejected_urls = set()
        self._search_rounds = {}

    def set_plan(self, plan):
        plan = InvestigationPlan.model_validate(plan)
        plan = plan.model_copy(update={'steps': [step.model_copy(update={'claim_ids': list(dict.fromkeys(step.claim_ids))}) for step in plan.steps]})
        targets = {item.id for item in self.claims}
        if plan.mode != self.mode or not plan.steps:
            raise ValueError('调查计划必须匹配当前模式且包含步骤')
        ids = [item.id for item in plan.steps]
        if any(not re.fullmatch(r'[A-Za-z0-9_.:-]+', value) for value in ids) or len(set(ids)) != len(ids):
            raise ValueError('计划步骤 ID 必须非空且不重复')
        covered = set()
        for step in plan.steps:
            if contains_sensitive_link(step.purpose) or contains_sensitive_link(step.query):
                raise ValueError('调查计划不能包含敏感参数或非公开链接')
            if not step.purpose.strip() or not step.query.strip():
                raise ValueError('计划步骤需有目的和查询')
            if scope_check(step.query, require_contest=False, context_question=self.question).outcome != 'allowed_contest':
                raise ValueError('计划超出公开赛事核验范围')
            if not set(step.claim_ids) <= targets:
                raise ValueError('计划引用了不存在的核验说法')
            covered.update(step.claim_ids)
        if covered != targets:
            raise ValueError('计划需覆盖每条核验说法')
        if self.queries:
            raise ValueError('执行后不能改写原计划；可在原步骤内继续查询')
        self.plan = plan
        return plan

    def check_step(self, step_id):
        if self.plan is None:
            raise ValueError('请先给出调查计划再执行搜索')
        if step_id not in {item.id for item in self.plan.steps}:
            raise ValueError('搜索必须关联实际计划步骤')

    def remember_contest(self, contest, *, current=False):
        data = _plain(contest)
        self.observed_contests[data['id']] = data
        for name, field in data.get('fields', {}).items():
            if name == 'registration_url' and field.get('level') == 'official' and safe_evidence_url(field.get('value') or ''):
                self._registration_urls.add(field['value'])
            for source in field.get('sources', []):
                url = safe_evidence_url(source.get('url', ''))
                if not url:
                    continue
                if source.get('is_official'):
                    self._official_urls.add(url)
                excerpt = source.get('excerpt') or ''
                key = self._id(url, name, source.get('value') or '', excerpt)
                self.evidence[key] = ReportEvidence(id=key, title=export_text(source.get('title') or data['name']),
                    url=url, excerpt=export_text(excerpt), evidence_kind='database_record',
                    source_level='official' if source.get('is_official') else 'reposted', historical=not current,
                    source_lineage=urlsplit(url).hostname if source.get('is_official') else None)

    @staticmethod
    def _id(*values):
        return 'e-' + hashlib.sha256('\0'.join(values).encode()).hexdigest()[:20]

    def search_round(self, node_round):
        # Multiple tool calls in one model response do not become multiple rounds.
        return self._search_rounds.setdefault(node_round, len(self._search_rounds) + 1)

    def remember_search(self, hits, receipt):
        receipt = SearchExecution.model_validate(receipt)
        self.queries.append(receipt)
        for value in hits:
            hit = _plain(value)
            url = safe_evidence_url(hit.get('url', ''))
            if not url or url in self.rejected_urls:
                continue
            self._page_queries.setdefault(url, []).append(receipt.id)
            excerpt = hit.get('snippet') or ''
            key = self._id(url, excerpt, receipt.id)
            self.evidence[key] = ReportEvidence(id=key, title=export_text(hit.get('title') or url),
                url=url, excerpt=export_text(excerpt), retrieved_at=receipt.executed_at, evidence_kind='search_snippet',
                provider=receipt.provider, query_ids=[receipt.id], source_level='not_found')

    def remember_redirect(self, requested_url, final_url):
        # Follow the actual fetch chain, not the redirector's official identity.
        if not safe_evidence_url(final_url) or final_url in self.rejected_urls:
            raise ValueError('重定向目标不能作为公开证据')
        self._page_queries[final_url] = list(dict.fromkeys([
            *self._page_queries.get(final_url, []), *self._page_queries.get(requested_url, [])]))

    def reject_url(self, url):
        """A public-looking URL that redirected to a prohibited target is not exportable."""
        self.rejected_urls.add(url)
        self.evidence = {key: value for key, value in self.evidence.items() if value.url != url}
        self._segments.pop(url, None)
        self.fetched_pages.pop(url, None)

    def remember_page(self, url, text, *, full_text=None):
        if not safe_evidence_url(url):
            raise ValueError('该链接不能作为可导出的证据')
        normalized = _compact(full_text if full_text is not None else text)
        self._segments.setdefault(url, []).append({
            'text': text, 'content_hash': hashlib.sha256(normalized.encode()).hexdigest(),
            'retrieved_at': datetime.now(timezone.utc),
            'reprinted': any(marker in normalized for marker in (
                '转载自', '转自', '来源:', 'originallypublished', 'reprintedfrom', 'republishedfrom', 'reproducedfrom')),
        })
        self.fetched_pages[url] = '\n\n'.join(value['text'] for value in self._segments[url])

    def cite(self, url, excerpt):
        if not safe_evidence_url(url) or url in self.rejected_urls or not excerpt.strip() or contains_sensitive_link(excerpt):
            raise ValueError('证据需要安全链接与非空原文摘录')
        matched = next((value for value in reversed(self._segments.get(url, []))
                        if _compact(excerpt) in _compact(value['text'])), None)
        if matched is None:
            raise ValueError('摘录不在本轮已读取的网页正文中')
        content_hash = matched['content_hash']
        official = url in self._official_urls or is_official_page(url) or any(
            is_official_page(url, registration_url=value) for value in self._registration_urls)
        query_ids = list(dict.fromkeys(self._page_queries.get(url, [])))
        # Directly read official pages may follow a search hit's sibling path.
        if not query_ids:
            query_ids = list(dict.fromkeys(qid for known, values in self._page_queries.items()
                if urlsplit(known).hostname == urlsplit(url).hostname for qid in values))
        provider = 'yuanbao' if any(query.id in query_ids and query.provider == 'yuanbao'
                                  and query.status == 'success' for query in self.queries) else None
        key = self._id(url, excerpt, content_hash)
        evidence = ReportEvidence(id=key, title=urlsplit(url).hostname or url, url=url, excerpt=excerpt,
            content_hash=content_hash, retrieved_at=matched['retrieved_at'], evidence_kind='fetched_page',
            provider=provider, query_ids=query_ids, source_level='official' if official else 'reposted',
            source_lineage=urlsplit(url).hostname if official and not matched['reprinted'] else None)
        self.evidence[key] = evidence
        return evidence

    def validate_assessments(self, assessments):
        errors = []
        targets = {item.id for item in self.claims}
        seen = set()
        for item in assessments:
            item = ClaimAssessment.model_validate(item)
            if item.id not in targets or item.id in seen:
                errors.append('核验结论需使用唯一且已确认的说法 ID')
            seen.add(item.id)
            if len(item.evidence_ids) != len(set(item.evidence_ids)):
                errors.append('同一说法不能重复引用相同证据 ID')
            selected = [self.evidence.get(key) for key in item.evidence_ids]
            if any(value is None for value in selected):
                errors.append('结论引用了不存在的证据 ID')
                continue
            fresh = [value for value in selected if value.evidence_kind == 'fetched_page' and not value.historical]
            if not item.comparison.strip():
                errors.append('每条说法必须解释证据比对结果或不足')
            if contains_sensitive_link(item.comparison) or any(contains_sensitive_link(value) for value in item.limitations):
                errors.append('结论不得包含敏感参数或非公开链接')
            if item.verdict != 'insufficient' and not fresh:
                errors.append('支持、反驳或冲突结论必须引用本轮已读取的原文证据，不能只用搜索摘要或历史记录')
            if item.verdict == 'conflicting' and len({value.content_hash for value in fresh}) < 2:
                errors.append('冲突结论需要至少两个不同正文版本的原文证据')
        return errors

    def build(self, assessments, *, interrupted=False):
        parsed = [ClaimAssessment.model_validate(item) for item in assessments]
        errors = self.validate_assessments(parsed)
        by_id = {item.id: item for item in parsed} if not errors else {}
        claims = []
        limitations = list(dict.fromkeys(errors))
        for target in self.claims:
            item = by_id.get(target.id)
            if item is None:
                item = ClaimAssessment(id=target.id, text=export_text(target.text), verdict='insufficient',
                    source_level='not_found', comparison='尚未取得足够原文证据，不能确认这条说法。')
            else:
                evidence = [self.evidence[key] for key in item.evidence_ids]
                level = ('conflict' if item.verdict == 'conflicting' else
                         'official' if any(value.source_level == 'official' for value in evidence) else
                         'reposted' if any(value.source_level == 'reposted' for value in evidence) else 'not_found')
                item = item.model_copy(update={'text': export_text(target.text), 'source_level': level,
                    'comparison': export_text(item.comparison), 'limitations': [export_text(value) for value in item.limitations if value.strip()]})
            claims.append(item)
        successful = [query for query in self.queries if query.provider == 'yuanbao' and query.status == 'success']
        status = 'complete'
        if not successful:
            status = 'blocked'
            limitations.append('本轮没有成功执行元宝搜索，未完成实时核验。')
        for item in claims:
            linked = {query.id for query in successful
                      if self.plan and any(step.id == query.step_id and item.id in step.claim_ids for step in self.plan.steps)}
            fresh = [self.evidence[key] for key in item.evidence_ids if key in self.evidence
                     and self.evidence[key].evidence_kind == 'fetched_page']
            if not any(linked.intersection(value.query_ids) for value in fresh):
                if status != 'blocked': status = 'incomplete'
                limitations.append(f'{item.id} 尚未建立元宝查询、读取原文与该说法的完整证据链。')
        if any(item.verdict == 'conflicting' for item in claims):
            limitations.append('来源仍有冲突，不构成已确认事实；调查完成不等于说法已获证实。')
        if any(item.verdict == 'insufficient' for item in claims):
            if status != 'blocked': status = 'incomplete'
            limitations.append('部分核验目标仍缺少已读取的原文支持。')
        if self.plan is None:
            if status != 'blocked': status = 'incomplete'
            limitations.append('调查计划尚未完成。')
        elif self.mode == 'deep':
            done_steps = {query.step_id for query in successful}
            if len({_compact(query.query) for query in successful}) < 2 or len({query.round for query in successful}) < 2:
                if status != 'blocked': status = 'incomplete'
                limitations.append('深度调查尚未完成不同查询的多轮元宝检索。')
            if not {step.id for step in self.plan.steps} <= done_steps:
                if status != 'blocked': status = 'incomplete'
                limitations.append('仍有计划步骤未完成实际搜索。')
            for item in claims:
                evidence = [self.evidence[key] for key in item.evidence_ids if key in self.evidence]
                fresh = [value for value in evidence if value.evidence_kind == 'fetched_page' and not value.historical]
                lineages = {value.source_lineage for value in fresh if value.source_lineage}
                hashes = {value.content_hash for value in fresh if value.content_hash}
                if len(lineages) < 2 or len(hashes) < 2:
                    if status != 'blocked': status = 'incomplete'
                    limitations.append(f'{item.id} 尚无两个已识别原始来源的交叉比对；转载或镜像不计独立证据。')
        if interrupted:
            if status != 'blocked': status = 'incomplete'
            limitations.append('调查被中断，已取得资料仅为部分结果。')
        selected_ids = set(key for item in claims for key in item.evidence_ids)
        evidence = [item for key, item in self.evidence.items() if key in selected_ids]
        return InvestigationReport(mode=self.mode, status=status, generated_at=datetime.now(timezone.utc),
            plan=self.plan, queries=self.queries, claims=claims, evidence=evidence,
            limitations=list(dict.fromkeys(limitations)))


def render_report(report):
    labels = {'supported': '证据支持', 'refuted': '证据反驳', 'conflicting': '来源冲突', 'insufficient': '尚未核实'}
    status = {'complete': '已完成', 'incomplete': '部分完成', 'blocked': '未完成'}[report.status]
    lines = [f'{"深度调查" if report.mode == "deep" else "实时核验"}：{status}']
    for item in report.claims:
        lines.extend(['', markdown_text(item.text), f'{labels[item.verdict]}：{markdown_text(item.comparison)}'])
        for key in item.evidence_ids:
            evidence = next((value for value in report.evidence if value.id == key), None)
            if evidence:
                lines.append(f'- 原文：{markdown_text(evidence.excerpt)}\n  [{markdown_text(evidence.title)}]({quote(evidence.url, safe=":/?&=#%+;,@~.-_")})')
    if report.limitations:
        lines.extend(['', '尚待确认：', *('- ' + markdown_text(value) for value in report.limitations)])
    successful = sum(query.provider == 'yuanbao' and query.status == 'success' for query in report.queries)
    lines.extend(['', f'本轮实际元宝搜索成功 {successful} 次；执行轨迹与证据见调查报告。'])
    return '\n'.join(lines)
