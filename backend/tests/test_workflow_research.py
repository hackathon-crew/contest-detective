import asyncio
from uuid import uuid4

import httpx
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.config import LLMSettings
from contest_detective.agent.guest import GuestInvestigations
from contest_detective.agent.loop import Investigator
from contest_detective.agent.schemas import AskRequest
from contest_detective.agent.rag.retrieval import HybridRetriever
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft
from contest_detective.system.user.schemas import Profile
from test_workflow import seed

URL = 'https://events.example/rules'


def research(factory, question, intent, script, *, search=None, fetch=None, record=None,
             profile=None, contest_id=None, request_limit=20):
    calls = []
    prompts = []

    def respond(messages, info):
        prompts.append(str(messages))
        if info.output_tools[0].name == 'interpret_query':
            parsed = dict(intent)
            parsed.setdefault('requested_facts', [{'field': field, 'quote': question} for field in parsed.get('fields', [])])
            return ModelResponse([ToolCallPart('interpret_query', parsed)])
        if info.output_tools[0].name == 'final_result':
            return ModelResponse([ToolCallPart('final_result', {'name': '比较赛事', 'claims': [
                {'field': 'prize', 'value': '2000元', 'excerpt': '奖金2000元'}]})])
        if not info.function_tools:
            return ModelResponse([ToolCallPart('respond_to_user', {'content': '以下是根据来源整理的结果。'})])
        index = len(calls)
        if index >= len(script):
            return ModelResponse([TextPart('已有资料可供整理。')])
        tool, args = script[index]
        calls.append(tool)
        return ModelResponse([ToolCallPart(tool, args)])

    async def consume():
        investigator = Investigator(FunctionModel(respond), session_factory=factory,
            search=search, fetch=fetch, record=record,
            settings=LLMSettings(_env_file=None, workflow_enabled=True, request_limit=request_limit))
        runs = GuestInvestigations()
        body = AskRequest(investigation_id=uuid4(), question=question, profile=profile, contest_id=contest_id)
        run_id = runs.start(investigator, body, 'guest-research')
        return [event async for event in runs.events(run_id, 'guest-research')]

    events = asyncio.run(consume())
    assert sum(event.type in {'answer', 'error'} for event in events) == 1
    assert events[-1].type == 'answer', events[-1].payload
    assert all(word not in events[-1].payload['content'] for word in ('请稍后重试', '本次查询未完成', '预算', '停滞'))
    return events[-1].payload, calls, prompts, events


def test_empty_library_can_discover_and_save_a_new_contest(session_factory):
    def record(url, **kwargs):
        return seed(session_factory, '新发现的 AI 比赛')
    payload, calls, _, events = research(session_factory, '推荐一场比赛', {}, [
        ('web_search', {'query': 'AI 比赛 官网'}), ('fetch_page', {'url': URL}),
        ('record_page', {'url': URL}), ('web_search', {'query': '不要再执行这个查询'})],
        search=lambda *_, **__: [{'title': '新比赛', 'url': URL, 'site': '官网'}],
        fetch=lambda _: '新发现的 AI 比赛，线上参加，10月30日提交截止。', record=record)
    assert len(payload['recommendations']) == 1
    assert '新发现的 AI 比赛' in payload['content']
    assert calls == ['web_search', 'fetch_page', 'record_page']
    assert [event.payload['tool'] for event in events if event.type == 'step'][-1] == 'compose_answer'


def test_missing_named_detail_can_be_found_online_without_using_a_neighbor(session_factory, monkeypatch):
    monkeypatch.setattr(HybridRetriever, 'search', lambda self, session, query, **_: service.query(
        session, query.model_copy(update={'keyword': None})))
    seed(session_factory, 'Hack Storm')
    def record(url, **kwargs):
        return seed(session_factory, 'Neural Storm')
    payload, calls, _, _ = research(session_factory, '查 Neural Storm 的参赛形式和作品提交截止',
        {'kind': 'detail', 'keyword': 'Neural Storm', 'fields': ['mode', 'submission_deadline']}, [
        ('web_search', {'query': 'Neural Storm 官网'}), ('fetch_page', {'url': URL}),
        ('record_page', {'url': URL})],
        search=lambda *_, **__: [{'title': 'Neural Storm', 'url': URL, 'site': '官网'}],
        fetch=lambda _: 'Neural Storm 线上举办，10月30日作品提交截止。', record=record)
    assert [item['contest']['name'] for item in payload['recommendations']] == ['Neural Storm']
    assert 'Hack Storm' not in payload['content']
    assert calls == ['web_search', 'fetch_page', 'record_page']


def test_one_complete_contest_does_not_stop_a_request_for_more_options(session_factory):
    seed(session_factory, '已知比赛')
    def record(url, **kwargs):
        return seed(session_factory, '网络发现比赛')
    payload, calls, _, _ = research(session_factory, '推荐两场比赛', {}, [
        ('web_search', {'query': 'AI 新比赛'}), ('record_page', {'url': URL})],
        search=lambda *_, **__: [{'title': '新比赛', 'url': URL, 'site': '官网'}], record=record)
    assert len(payload['recommendations']) == 2
    assert calls == ['web_search', 'record_page']


def test_repeated_queries_replan_once_and_return_before_request_limit(session_factory):
    paid_searches = []
    def search(query, **kwargs):
        paid_searches.append(query)
        return []
    _, calls, prompts, _ = research(session_factory, '找比赛', {},
        [('web_search', {'query': 'AI 比赛'})] * 40, search=search)
    assert len(paid_searches) == 1
    assert len(calls) == 4
    assert any('改换' in prompt for prompt in prompts)


def test_changed_queries_with_identical_leads_are_not_fake_progress(session_factory):
    _, calls, _, _ = research(session_factory, '找比赛', {},
        [('web_search', {'query': f'AI 比赛 新说法{index}'}) for index in range(40)],
        search=lambda *_, **__: [{'title': '同一条未读线索', 'url': URL, 'site': '官网'}])
    assert len(calls) == 4


def test_new_segments_and_alternative_sources_survive_repeated_reads(session_factory):
    fetched = []
    def fetch(url):
        fetched.append(url)
        return '报名10月30日；决赛要求必须到场。'
    _, calls, _, _ = research(session_factory, '查比赛的远程参赛与决赛要求', {}, [
        ('web_search', {'query': '比赛 远程 决赛'}),
        ('fetch_page', {'url': URL, 'length': 8}),
        ('fetch_page', {'url': URL, 'length': 8}),
        ('fetch_page', {'url': URL, 'offset': 8}),
        ('fetch_page', {'url': URL + '-final'})],
        search=lambda *_, **__: [{'title': '规则', 'url': url, 'site': '官网'} for url in (URL, URL + '-final')], fetch=fetch)
    assert fetched == [URL, URL + '-final']
    assert calls.count('fetch_page') == 4


def test_counterevidence_refreshes_same_contest_and_removes_its_card(session_factory):
    target = seed(session_factory, 'AI 赛')
    def record(url, **kwargs):
        with session_factory() as session:
            return service.save(session, ContestDraft(name='AI 赛',
                page={'url': url, 'title': '新规则', 'site': '官网', 'is_official': True},
                claims=[{'field': 'eligibility', 'value': '仅限职场开发者', 'excerpt': '仅限职场开发者'}]),
                contest_id=target)
    payload, calls, prompts, _ = research(session_factory, '核实最新资格，推荐一场比赛',
        {'fresh': True, 'mode': 'online'}, [
        ('web_search', {'query': 'AI 赛 新资格'}), ('get_contest', {'contest_id': target, 'fields': ['eligibility']}),
        ('record_page', {'url': URL, 'contest_id': target}),
        ('get_contest', {'contest_id': target, 'fields': ['eligibility']})],
        search=lambda *_, **__: [{'title': '新规则', 'url': URL, 'site': '官网'}], record=record,
        profile=Profile(identity_kind='student'))
    assert not payload['recommendations']
    assert '仅限职场开发者' in prompts[-1]
    assert calls.count('get_contest') == 2


def test_forbidden_source_is_cached_and_other_source_is_tried(session_factory):
    fetched = []
    def fetch(url):
        fetched.append(url)
        if url == URL:
            raise httpx.HTTPStatusError('forbidden', request=httpx.Request('GET', url), response=httpx.Response(403))
        return '备用官方页面：线上参加，作品提交截止10月30日。'
    payload, _, _, _ = research(session_factory, '找比赛', {}, [
        ('web_search', {'query': 'AI 比赛'}), ('fetch_page', {'url': URL}),
        ('fetch_page', {'url': URL}), ('fetch_page', {'url': URL + '-backup'})],
        search=lambda *_, **__: [{'title': '规则', 'url': url, 'site': '官网'} for url in (URL, URL + '-backup')], fetch=fetch)
    assert fetched == [URL, URL + '-backup']
    assert URL + '-backup' in payload['content']


def test_covered_request_finishes_without_spending_on_search(session_factory):
    for name in ('甲', '乙', '丙'):
        seed(session_factory, name)
    def search(*_, **__):
        raise AssertionError('已够3场不应再发外部请求')
    payload, calls, _, _ = research(session_factory, '推荐比赛', {}, [('web_search', {'query': '继续找'})], search=search)
    assert len(payload['recommendations']) == 3
    assert not calls


def test_latest_request_does_not_claim_unverified_old_candidates_are_current(session_factory):
    seed(session_factory, '已有日期的比赛')
    payload, calls, _, _ = research(session_factory, '推荐一场最新核实的比赛', {'fresh': True},
        [('web_search', {'query': '最新比赛'})] * 10, search=lambda *_, **__: [])
    assert calls
    assert not payload['recommendations']
    assert '已有日期的比赛' in payload['content'] and '官网' in payload['content']


def test_final_round_attendance_counterevidence_overrides_old_online_mode(session_factory):
    target = seed(session_factory, 'AI 远程赛')
    def record(url, **kwargs):
        with session_factory() as session:
            return service.save(session, ContestDraft(name='AI 远程赛',
                page={'url': url, 'title': '决赛规则', 'site': '官网', 'is_official': True},
                claims=[{'field': 'entry_requirements', 'value': '决赛必须线下到场', 'excerpt': '决赛必须线下到场'}]),
                contest_id=target)
    payload, _, _, _ = research(session_factory, '推荐一场线上比赛，核实最新决赛要求',
        {'mode': 'online', 'fresh': True}, [
        ('web_search', {'query': 'AI 远程赛 决赛要求'}), ('fetch_page', {'url': URL}),
        ('record_page', {'url': URL, 'contest_id': target})],
        search=lambda *_, **__: [{'title': '决赛规则', 'url': URL, 'site': '官网'}],
        fetch=lambda _: 'AI 远程赛，决赛必须线下到场。', record=record)
    assert not payload['recommendations']
    assert '到场' in payload['content']


def test_comparison_pages_are_read_only_even_without_an_explicit_write_id(session_factory):
    main = seed(session_factory, '主赛事')
    comparison = seed(session_factory, '比较赛事')
    written = []
    main_url = 'https://events.example/主赛事'
    other_url = 'https://events.example/比较赛事'
    def record(url, contest_id=None, **kwargs):
        written.append((url, contest_id))
        return contest_id
    research(session_factory, '比较这两场最新规则', {'kind': 'comparison', 'fresh': True,
        'comparison_queries': ['比较赛事']}, [
        ('get_contest', {'contest_id': comparison, 'fields': ['mode']}),
        ('record_page', {'url': other_url}), ('record_page', {'url': main_url})],
        contest_id=main, record=record)
    assert written == [(main_url, main)]


def test_interpretation_research_and_answer_share_one_request_budget(session_factory):
    _, calls, prompts, _ = research(session_factory, '推荐比赛', {},
        [('web_search', {'query': f'比赛 {index}'}) for index in range(20)],
        search=lambda *_, **__: [], request_limit=4)
    assert calls == ['web_search']
    assert len(prompts) == 3


def test_fresh_related_official_leads_allow_research_to_continue(session_factory):
    index = [0]
    def search(*args, **kwargs):
        index[0] += 1
        return [{'title': 'AI 比赛官网', 'url': f'https://official{index[0]}.example/ai', 'site': '官网'}]
    payload, calls, _, _ = research(session_factory, '推荐一场 AI 比赛', {'keyword': 'AI'}, [
        *[('web_search', {'query': f'AI 比赛方向{number}'}) for number in range(4)],
        ('record_page', {'url': 'https://official4.example/ai'})], search=search,
        record=lambda *_, **__: seed(session_factory, 'AI 新比赛'))
    assert len(calls) == 5
    assert payload['recommendations']


def test_unrelated_new_pages_do_not_keep_an_ai_investigation_alive(session_factory):
    script = []
    for index in range(10):
        script += [('web_search', {'query': f'手工刺绣比赛 {index}'}),
                   ('fetch_page', {'url': f'https://craft{index}.example/rules'})]
    payload, calls, _, _ = research(session_factory, '推荐 AI 比赛', {'keyword': 'AI'}, script,
        search=lambda query, **_: [{'title': '手工刺绣比赛', 'url': f'https://craft{query.split()[-1]}.example/rules', 'site': '官网'}],
        fetch=lambda _: '手工刺绣比赛，只比较手工缝制的作品。')
    assert len(calls) == 4
    assert '手工刺绣' not in payload['content']


def test_new_comparison_announcement_is_not_saved_into_main(session_factory):
    main = seed(session_factory, '主赛事')
    seed(session_factory, '比较赛事')
    written = []
    research(session_factory, '比较最新公告', {'kind': 'comparison', 'fresh': True,
        'comparison_queries': ['比较赛事']}, [
        ('web_search', {'query': '比较赛事 最新公告'}), ('record_page', {'url': URL})],
        contest_id=main, search=lambda *_, **__: [{'title': '比较赛事新公告', 'url': URL, 'site': '官网'}],
        record=lambda *args, **kwargs: written.append(kwargs))
    assert not written


def test_comparison_updates_runtime_facts_and_cards_without_writing_database(session_factory):
    main = seed(session_factory, '主赛事', extra={'prize': '1000元'})
    comparison = seed(session_factory, '比较赛事')
    payload, calls, _, _ = research(session_factory, '比较两场的奖金',
        {'kind': 'comparison', 'comparison_queries': ['比较赛事'], 'fields': ['prize']}, [
        ('get_contest', {'contest_id': comparison, 'fields': ['prize']}),
        ('web_search', {'query': '比较赛事 奖金'}), ('fetch_page', {'url': URL}),
        ('get_contest', {'contest_id': comparison, 'fields': ['prize']}),
        ('web_search', {'query': '不该继续'})], contest_id=main,
        search=lambda *_, **__: [{'title': '比较赛事奖金公告', 'url': URL, 'site': '官网'}],
        fetch=lambda _: '比较赛事，奖金2000元。')
    assert calls == ['get_contest', 'web_search', 'fetch_page', 'get_contest']
    card = next(item for item in payload['recommendations'] if item['contest']['id'] == comparison)
    assert card['contest']['fields']['prize']['value'] == '2000元'
    assert card['contest']['fields']['prize']['sources'][0]['url'] == URL
    with session_factory() as session:
        assert service.get(session, comparison).fields['prize'].value is None


def test_extraction_identity_is_checked_before_saving_a_mixed_contest_page(session_factory):
    from contest_detective.research.record import run
    main = seed(session_factory, '主赛事', extra={'prize': '1000元'})
    seed(session_factory, '比较赛事')
    research(session_factory, '比较最新奖金规则', {'kind': 'comparison', 'fresh': True,
        'comparison_queries': ['比较赛事']}, [
        ('web_search', {'query': '比较赛事新公告'}), ('fetch_page', {'url': URL}),
        ('record_page', {'url': URL})], contest_id=main,
        search=lambda *_, **__: [{'title': '赛事公告', 'url': URL, 'site': '官网'}],
        fetch=lambda _: '比较赛事奖金2000元，与主赛事同期举行。', record=run)
    with session_factory() as session:
        prize = service.get(session, main).fields['prize']
        assert prize.value == '1000元'
        assert all(source.url != URL for source in prize.sources)


def test_optional_answer_gap_is_researched_without_removing_qualified_cards(session_factory):
    target = seed(session_factory, 'AI 比赛')
    payload, calls, _, _ = research(session_factory, '推荐一场比赛，奖金是多少', {'fields': ['prize']},
        [('web_search', {'query': 'AI 比赛 奖金'})] * 20, search=lambda *_, **__: [])
    assert calls
    assert [item['contest']['id'] for item in payload['recommendations']] == [target]
    assert '奖金' in payload['content']


def test_unasked_exploration_fields_cannot_force_extra_research(session_factory):
    for name in ('甲AI赛', '乙AI赛', '丙AI赛'):
        seed(session_factory, name)
    def search(*args, **kwargs):
        raise AssertionError('未问奖金和入口，不应为此额外研究')
    payload, calls, _, _ = research(session_factory, '推荐3场比赛',
        {'fields': ['prize', 'registration_url'], 'requested_facts': []},
        [('web_search', {'query': '额外奖金'})], search=search)
    assert len(payload['recommendations']) == 3
    assert not calls
