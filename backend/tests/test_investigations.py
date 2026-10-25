import asyncio
import json

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part
from sqlalchemy import select

from contest_detective.server.agent.loop import Investigator
from contest_detective.server.agent.models import Investigation, TraceRecord
from contest_detective.server.contest.schemas import ContestDraft
from contest_detective.server.contest.service import save


def seed(session_factory):
    with session_factory() as session:
        contest_id = save(session, ContestDraft(name='周末开源黑客松', page={
            'url': 'https://organizer.example/rules', 'site': '主办方', 'title': '比赛规则', 'is_official': True,
        }, claims=[
            {'field': 'submission_deadline', 'value': '2026-10-25T08:00:00Z', 'excerpt': '10月25日16:00 提交截止'},
            {'field': 'mode', 'value': 'online', 'excerpt': '线上参赛'},
        ]))
        session.commit()
    return contest_id


def run(investigator, question='16:00 是报名截止吗？', user_id=None):
    async def consume():
        return [event async for event in investigator.ask(question, user_id=user_id)]
    return asyncio.run(consume())


def test_two_tools_stream_real_database_results_in_order(session_factory):
    contest_id = seed(session_factory)
    calls = 0
    def respond(messages, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('search_contests', {'keyword': '周末'}, tool_call_id='search')])
        if calls == 2:
            parts = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
            assert parts[-1].content['items'][0]['id'] == contest_id
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id}, tool_call_id='detail')])
        return ModelResponse([answer_part('这是作品提交截止：[10月25日16:00](https://organizer.example/rules)，报名截止未找到。')])
    investigator = Investigator(FunctionModel(respond), session_factory=session_factory)
    events = run(investigator)
    assert [event.type for event in events] == ['step', 'observation', 'step', 'observation', 'answer']
    assert events[-1].payload['sources'][0]['url'] == 'https://organizer.example/rules'
    with session_factory() as session:
        record = session.scalars(select(Investigation)).one()
        assert record.status == 'completed' and record.finished_at is not None
        assert '作品提交截止' in record.answer
        traces = session.scalars(select(TraceRecord).order_by(TraceRecord.seq)).all()
        assert [item.seq for item in traces] == [1, 2, 3, 4, 5]
        assert [item.type for item in traces] == [event.type for event in events]
        assert all(item.investigation_id == record.id for item in traces)


def test_ten_contest_query_can_read_every_source_before_answering(session_factory):
    urls = {f'https://organizer.example/student-{i}' for i in range(10)}
    with session_factory() as session:
        for i, url in enumerate(sorted(urls)):
            save(session, ContestDraft(name=f'大学生黑客松 {i}', page={
                'url': url, 'site': '主办方', 'title': '参赛规则', 'is_official': True,
            }, claims=[{'field': 'eligibility', 'value': '在校大学生', 'excerpt': '在校大学生可参加'}]))
        session.commit()

    def respond(messages, info):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('search_contests', {'keyword': '大学生'})])
        items = results[0].content['items']
        details = [part.content for part in results if part.tool_name == 'get_contest']
        if len(details) < len(items):
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': items[len(details)]['id']},
                                               tool_call_id=f'detail-{len(details)}')])
        return ModelResponse([answer_part('\n'.join(
            f"{detail['contest']['name']}：[参赛规则]({detail['sources'][0]['url']})" for detail in details
        ))])

    events = run(Investigator(FunctionModel(respond), session_factory=session_factory), '适合大学生的黑客松')
    assert events[-1].type == 'answer', events[-1].payload
    assert {source['url'] for source in events[-1].payload['sources']} == urls
    assert sum(event.type == 'observation' for event in events) == 11
    with session_factory() as session:
        record = session.scalars(select(Investigation)).one()
        assert record.status == 'completed' and record.answer == events[-1].payload['content']


@pytest.mark.parametrize('corrected', [True, False])
def test_tool_argument_corrections_allow_a_real_match_but_stop_after_three_retries(session_factory, corrected):
    contest_id = seed(session_factory)
    calls = 0
    def respond(messages, info):
        nonlocal calls
        calls += 1
        if calls <= 3 or not corrected:
            return ModelResponse([ToolCallPart('match_contests', {'profile': {'identity_kind': '大学生'}},
                                               tool_call_id=f'bad-{calls}')])
        if calls == 4:
            return ModelResponse([ToolCallPart('match_contests', {'profile': {'identity_kind': 'student'}})])
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        assert results[-1].content['items'][0]['contest']['id'] == contest_id
        return ModelResponse([answer_part('已按在校生条件筛选赛事。')])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory), '适合大学生的黑客松')
    assert events[-1].type == ('answer' if corrected else 'error'), events[-1].payload
    assert calls == (5 if corrected else 4)


def test_investigation_can_continue_beyond_sixty_four_requests(session_factory):
    calls = 0
    def respond(*_):
        nonlocal calls
        calls += 1
        return ModelResponse([ToolCallPart('search_contests', {}, tool_call_id=f'call-{calls}')]
                             if calls <= 65 else [answer_part('已完成查证。')])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory))
    assert calls == 66
    assert events[-1].type == 'answer'
    with session_factory() as session:
        assert session.scalars(select(Investigation)).one().status == 'completed'


def test_unexpected_errors_are_safe_for_client_and_stored(session_factory):
    def broken(*_):
        raise RuntimeError('provider secret must not be sent to clients')
    events = run(Investigator(FunctionModel(broken), session_factory=session_factory))
    assert events[-1].payload == {'message': '本次查证未取得结果，请稍后重试'}
    with session_factory() as session:
        assert session.scalars(select(Investigation)).one().status == 'failed'
        assert 'secret' not in json.dumps(session.scalars(select(TraceRecord)).one().payload)


def test_web_search_is_hidden_without_provider_and_fetch_preserves_text(session_factory):
    calls = 0
    async def fetch(url):
        assert url == 'https://organizer.example/rules'
        return '测' * 8000
    def respond(messages, info):
        nonlocal calls
        calls += 1
        assert 'web_search' not in {tool.name for tool in info.function_tools}
        if calls == 1:
            return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules'})])
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        assert len(results[-1].content['text']) == 8000
        return ModelResponse([answer_part('网页未注明报名截止。')])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, fetch=fetch))
    assert events[-1].type == 'answer'


@pytest.mark.parametrize('answer', [
    '截至2026-10-24，明天截止报名的赛事尚未核实。',
    '[报名页](https://organizer.example/registration)尚未读取，截止日期未核实。',
])
def test_no_verified_matches_can_still_return_an_uncertain_answer(session_factory, answer):
    events = run(Investigator(FunctionModel(lambda *_: ModelResponse([answer_part(answer)])), session_factory=session_factory))
    assert events[-1].type == 'answer' and events[-1].payload['content'] == answer
    assert events[-1].payload['sources'] == []
    with session_factory() as session:
        record = session.scalars(select(Investigation)).one()
        assert record.status == 'completed' and record.answer == answer


def test_early_client_close_marks_investigation_cancelled(session_factory):
    def repeat(*_):
        return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules'})])
    async def read_page(url):
        return '公开规则'
    async def consume_one():
        stream = Investigator(FunctionModel(repeat), session_factory=session_factory, fetch=read_page).ask('找比赛')
        first = await anext(stream)
        assert first.type == 'step'
        await stream.aclose()
    asyncio.run(consume_one())
    with session_factory() as session:
        record = session.scalars(select(Investigation)).one()
        assert record.status == 'cancelled' and record.finished_at is not None


def test_confirmed_profile_is_supplied_only_for_identified_user(session_factory):
    seen = []
    def respond(_, info):
        seen.append(info.instructions)
        return ModelResponse([answer_part('未找到合适比赛。')])
    reader = lambda user_id: {'skills': ['Python'], 'city': '杭州'}
    investigator = Investigator(FunctionModel(respond), session_factory=session_factory, profile_reader=reader)
    run(investigator, user_id='known-user')
    run(investigator)
    assert 'Python' in seen[0] and '杭州' in seen[0]
    assert 'Python' not in seen[1]
    with session_factory() as session:
        assert [record.user_id for record in session.scalars(select(Investigation).order_by(Investigation.started_at))] == ['known-user', None]


def test_local_server_factory_uses_database_and_stream_for_both_questions(session_factory, monkeypatch):
    from fastapi.testclient import TestClient
    from serve_fake import create_fake_app
    import serve_fake
    from datetime import datetime
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 24, 8, tzinfo=serve_fake.TZ)
    monkeypatch.setattr(serve_fake, 'datetime', FixedDateTime)
    seed(session_factory)
    app = create_fake_app(db_engine=session_factory.kw['bind'], session_factory=session_factory)
    # The library-backed limiter is shared by routes, so fixtures reset only in tests.
    from contest_detective.web.api.agent import limiter
    limiter.reset()
    with TestClient(app) as client:
        for question in ['这周末能线上参加的黑客松', '某场比赛的16:00是不是报名截止']:
            response = client.post('/agent/ask', json={'question': question})
            assert response.headers['content-type'].startswith('text/event-stream')
            assert response.text.count('event: step') == 2
            assert 'event: answer' in response.text
            assert 'https://organizer.example/rules' in response.text
    limiter.reset()


def test_record_page_extracts_through_the_same_guarded_model(session_factory):
    from decimal import Decimal
    from contest_detective.server.agent.budget import Budget
    from contest_detective.server.agent.config import LLMSettings
    from contest_detective.server.agent.llm import GuardedModel
    from contest_detective.server.agent.models import LLMUsage
    from pydantic_ai.usage import RequestUsage
    calls = 0
    url = 'https://organizer.example/new'
    draft = {'name': '新赛事', 'page': {'url': url, 'site': '主办方', 'title': '公开规则', 'is_official': True},
             'claims': [{'field': 'city', 'value': '杭州', 'excerpt': '在杭州举办'}]}
    async def record(page_url, *, extractor, session_factory):
        extracted = await extractor(page_url, '在杭州举办')
        with session_factory() as session:
            contest_id = save(session, extracted)
            session.commit()
            return contest_id
    def respond(_, info):
        nonlocal calls
        calls += 1
        if info.output_tools and info.output_tools[0].name != 'respond_to_user':
            parts = [ToolCallPart(info.output_tools[0].name, draft)]
        elif calls == 1:
            parts = [ToolCallPart('record_page', {'url': url})]
        else:
            parts = [answer_part('新赛事已入库。')]
        return ModelResponse(parts, usage=RequestUsage(input_tokens=100, output_tokens=20))
    async def enough():
        return Decimal('100')
    config = LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    model = GuardedModel(FunctionModel(respond), Budget(session_factory, config), balance_reader=enough)
    events = run(Investigator(model, session_factory=session_factory, record=record))
    assert events[-1].type == 'answer'
    assert events[1].payload['summary'] == '赛事已写回比赛库'
    assert events[-1].payload['sources'][0]['url'] == url
    with session_factory() as session:
        rows = session.scalars(select(LLMUsage)).all()
        assert len(rows) == 3 and all(row.status == 'settled' for row in rows)
        assert sum(row.cost_cny for row in rows) == Decimal('0.00108')


def test_unconfigured_optional_tools_do_not_open_network_connections(session_factory):
    from pydantic_ai.models.test import TestModel
    model = TestModel(call_tools=['fetch_page', 'record_page', 'get_contest'], custom_output_args={'content': '暂无可核对资料。', 'recommendations': []})
    events = run(Investigator(model, session_factory=session_factory))
    assert events[-1].type == 'answer'
    summaries = [event.payload['summary'] for event in events if event.type == 'observation']
    assert '网页读取暂未配置' in summaries
    assert '页面保存暂未配置' in summaries
    assert '比赛未找到' in summaries


def test_page_extraction_can_follow_seven_detail_lookups(session_factory):
    contest_id = seed(session_factory)
    calls, extracted = 0, []
    url = 'https://organizer.example/new-rules'

    async def record(page_url, *, extractor, session_factory):
        extracted.append(await extractor(page_url, '公开规则，暂未公布截止日期。'))
        return None

    def respond(_, info):
        nonlocal calls
        calls += 1
        if info.output_tools and info.output_tools[0].name != 'respond_to_user':
            return ModelResponse([ToolCallPart(info.output_tools[0].name, {'name': '网页赛事', 'claims': []})])
        if calls <= 7:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id}, tool_call_id=f'detail-{calls}')])
        if calls == 8:
            return ModelResponse([ToolCallPart('record_page', {'url': url})])
        return ModelResponse([answer_part('已核对公开规则，未找到新的截止日期。')])

    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, record=record))
    assert events[-1].type == 'answer', events[-1].payload
    assert calls == 10
    assert len(extracted) == 1 and extracted[0].page.url == url


def test_page_extraction_and_investigation_can_continue_beyond_the_old_shared_limit(session_factory):
    calls = 0
    async def record(page_url, *, extractor, session_factory):
        await extractor(page_url, '未注明截止时间')
        return None
    def respond(_, info):
        nonlocal calls
        calls += 1
        if info.output_tools and info.output_tools[0].name != 'respond_to_user':
            return ModelResponse([ToolCallPart(info.output_tools[0].name, {'name': '待核对赛事', 'claims': []})])
        if calls > 65:
            return ModelResponse([answer_part('已完成查证，截止日期尚未核实。')])
        return ModelResponse([ToolCallPart('record_page', {'url': 'https://organizer.example/rules'})])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, record=record))
    assert calls == 67 and events[-1].type == 'answer'


def test_record_page_uses_registration_context_from_existing_contest(session_factory):
    with session_factory() as session:
        contest_id = save(session, ContestDraft(name='主办方活动', page={
            'url': 'https://directory.example/events/event', 'site': '活动汇总', 'title': '活动条目', 'is_official': False,
        }, claims=[{'field': 'registration_url', 'value': 'https://organizer.example/register', 'excerpt': '报名页面'}]))
        # A directory link is only a lead; separately verified registration context
        # establishes the organizer domain before a later page can inherit it.
        save(session, ContestDraft(name='主办方活动', page={
            'url': 'https://organizer.example/register', 'site': '主办方', 'title': '官方报名页', 'is_official': True,
        }, claims=[{'field': 'registration_url', 'value': 'https://organizer.example/register', 'excerpt': '官方报名页面'}]), contest_id=contest_id)
        session.commit()
    recorded = []
    async def record(url, *, extractor, session_factory, registration_url=None, contest_id=None):
        recorded.append((url, registration_url, contest_id))
        return None
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('record_page', {
                'url': 'https://organizer.example/rules', 'contest_id': contest_id,
            })])
        return ModelResponse([answer_part('未找到可写回的字段。')])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, record=record))
    assert events[-1].type == 'answer'
    assert recorded == [('https://organizer.example/rules', 'https://organizer.example/register', contest_id)]


def test_a_single_response_can_dispatch_more_than_sixty_four_tools(session_factory):
    fetched = []
    async def fetch(url):
        fetched.append(url)
        return '公开规则'
    calls = 0
    def respond(*_):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('fetch_page', {'url': f'https://organizer.example/{i}'}, tool_call_id=str(i))
                                  for i in range(65)])
        return ModelResponse([answer_part('未找到明确资料。')])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, fetch=fetch))
    assert events[-1].type == 'answer'
    assert len(fetched) == 65


def test_empty_account_profile_is_not_described_as_confirmed(session_factory):
    instructions = []
    def respond(_, info):
        instructions.append(info.instructions)
        return ModelResponse([answer_part('请先确认你的画像。')])
    empty = {'skills': [], 'identity': None, 'available_time': None, 'city': None, 'github': None}
    investigator = Investigator(FunctionModel(respond), session_factory=session_factory,
                                profile_reader=lambda _: empty)
    run(investigator, user_id='new-account')
    assert '用户已确认的画像' not in instructions[0]


def test_research_tool_uses_real_page_validation_and_storage(session_factory, monkeypatch):
    from decimal import Decimal
    from importlib import import_module
    from pydantic_ai.usage import RequestUsage
    from contest_detective.server.agent.budget import Budget
    from contest_detective.server.agent.config import LLMSettings
    from contest_detective.server.agent.llm import GuardedModel
    from contest_detective.server.agent.models import LLMUsage
    from contest_detective.server.contest.schemas import ContestQuery
    from contest_detective.server.contest import service as contests
    from contest_detective.server.research_pipeline import run as record_page
    recording = import_module('contest_detective.server.research_pipeline.record')
    url = 'https://weekend.devpost.com/'
    monkeypatch.setattr(recording, 'fetch_page', lambda _: '网页活动，作品提交截止 11月1日16:00，线上举行。')
    draft = {'name': '网页活动', 'page': {'url': 'https://untrusted.example/', 'site': '错误页面', 'title': '页面', 'is_official': False},
             'claims': [
                 {'field': 'submission_deadline', 'value': '2026-11-01T08:00:00Z', 'excerpt': '作品提交截止 11月1日16:00'},
                 {'field': 'registration_deadline', 'value': '2026-10-28T08:00:00Z', 'excerpt': '报名截止10月28日'},
             ]}
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        if info.output_tools and info.output_tools[0].name != 'respond_to_user':
            parts = [ToolCallPart(info.output_tools[0].name, draft)]
        elif calls == 1:
            parts = [ToolCallPart('record_page', {'url': url})]
        else:
            parts = [answer_part(f'作品提交截止：[11月1日16:00]({url})，报名截止未找到。')]
        return ModelResponse(parts, usage=RequestUsage(input_tokens=100, output_tokens=20))
    async def enough():
        return Decimal('100')
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    guarded = GuardedModel(FunctionModel(respond), Budget(session_factory, settings), balance_reader=enough)
    events = run(Investigator(guarded, session_factory=session_factory, record=record_page))
    assert events[-1].type == 'answer'
    with session_factory() as session:
        items, total = contests.query(session, ContestQuery(keyword='网页活动'))
        assert total == 1
        detail = contests.get(session, items[0].id)
        submission = detail.fields['submission_deadline']
        assert submission.level == 'official' and submission.sources[0].url == url
        assert detail.fields['registration_deadline'].value is None
        usage = session.scalars(select(LLMUsage)).all()
        assert len(usage) == 3 and all(row.status == 'settled' for row in usage)


def test_existing_contest_is_verified_in_place_through_real_recording(session_factory, monkeypatch):
    from importlib import import_module
    from contest_detective.server.contest import service as contests
    from contest_detective.server.contest.schemas import ContestQuery
    from contest_detective.server.research_pipeline import run as record_page
    with session_factory() as session:
        contest_id = save(session, ContestDraft(name='转载中的旧活动名', page={
            'url': 'https://directory.example/event', 'site': '活动汇总', 'title': '转载活动', 'is_official': False,
        }, claims=[
            {'field': 'start_at', 'value': '2026-11-10T01:00:00Z', 'excerpt': '11月10日开赛'},
            {'field': 'registration_url', 'value': 'https://organizer.example/register', 'excerpt': '报名页面'},
        ]))
        # Keep the stale directory evidence, but establish the registration URL
        # through a separate verified organizer page before updating in place.
        save(session, ContestDraft(name='转载中的旧活动名', page={
            'url': 'https://organizer.example/register', 'site': '主办方', 'title': '官方报名页', 'is_official': True,
        }, claims=[{'field': 'registration_url', 'value': 'https://organizer.example/register', 'excerpt': '官方报名页面'}]), contest_id=contest_id)
        session.commit()
    url = 'https://organizer.example/rules'
    recording = import_module('contest_detective.server.research_pipeline.record')
    monkeypatch.setattr(recording, 'fetch_page', lambda _: '官方活动完整名称，开赛延期至12月6日9:00。')
    draft = {'name': '官方活动完整名称', 'page': {'url': url, 'site': '主办方', 'title': '活动', 'is_official': False},
             'claims': [{'field': 'start_at', 'value': '2026-12-06T01:00:00Z', 'excerpt': '开赛延期至12月6日9:00'}]}
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        if info.output_tools and info.output_tools[0].name != 'respond_to_user':
            return ModelResponse([ToolCallPart(info.output_tools[0].name, draft)])
        if calls == 1:
            return ModelResponse([ToolCallPart('record_page', {'url': url, 'contest_id': contest_id})])
        return ModelResponse([answer_part('已核实赛事。')])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, record=record_page))
    assert events[-1].type == 'answer'
    with session_factory() as session:
        assert contests.query(session, ContestQuery())[1] == 1
        start = contests.get(session, contest_id).fields['start_at']
        assert start.value == '2026-12-06T01:00:00Z' and start.level == 'official'
        assert next(source for source in start.sources if source.url == 'https://directory.example/event').stale
