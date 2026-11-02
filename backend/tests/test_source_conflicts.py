import asyncio

from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.loop import Investigator
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft


def test_ordinary_answer_binds_conflicts_to_read_sources_without_retrying_metadata(session_factory):
    with session_factory() as session:
        contest_id = service.save(session, ContestDraft(name='规则核对赛', page={
            'url': 'https://organizer.example/rules', 'site': '主办方', 'title': '本届规则', 'is_official': True,
        }, claims=[{'field': 'team_size', 'value': '最多6人', 'excerpt': '每队最多6人。'}]))
        service.save(session, ContestDraft(name='规则核对赛', page={
            'url': 'https://news.example/rules', 'site': '转载', 'title': '转载规则', 'is_official': False,
        }, claims=[{'field': 'team_size', 'value': '最多4人', 'excerpt': '每队最多4人。'}]), contest_id=contest_id)
    calls = []

    def respond(messages, _):
        calls.append(1)
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, 'fields': ['team_size']})])
        decision = {'statements': [
            {'text': '每队最多4人。', 'evidence_id': 'https://news.example/rules'},
            {'text': '每队最多6人。', 'evidence_id': 'https://organizer.example/rules'},
        ], 'accepted_statement': 1, 'reason': '本届规则明确公布6人上限。'}
        return ModelResponse([ToolCallPart('respond_to_user', {
            'content': '本届规则公布每队最多6人。', 'recommendations': [],
            'conflicts': [decision, {'broken': True}, {**decision, 'statements': [
                decision['statements'][0], {'text': '任意人数均可。', 'evidence_id': 'https://invented.example/rules'},
            ]}],
        })])

    async def consume():
        run = Investigator(FunctionModel(respond), session_factory=session_factory)
        return [event async for event in run.ask('核对比赛的队伍人数')]

    events = asyncio.run(consume())
    answer = events[-1].payload
    assert events[-1].type == 'answer'
    assert answer['content'] == '本届规则公布每队最多6人。'
    assert len(calls) == 2
    assert len(answer['conflicts']) == 1
    conflict = answer['conflicts'][0]
    assert conflict['accepted_statement'] == 1
    assert conflict['statements'][0]['evidence']['source_level'] == 'reposted'
    assert conflict['statements'][1]['evidence']['excerpt'] == '每队最多6人。'


def test_fetched_conflict_cannot_quote_unread_text_or_block_an_unresolved_claim():
    from contest_detective.agent.conflicts import build_conflicts, conflict_evidence
    from contest_detective.agent.schemas import ToolSource
    from contest_detective.agent.verification_contracts import ConflictDecision

    pages = {'https://one.example/rules': '每队最多4人。', 'https://two.example/rules': '每队最多6人。'}
    sources = {url: ToolSource(url=url, title='已读规则') for url in pages}
    receipts = conflict_evidence([], pages, sources)
    decision = ConflictDecision(statements=[
        {'text': '每队最多4人。', 'evidence_id': 'https://one.example/rules'},
        {'text': '每队最多6人。', 'evidence_id': 'https://two.example/rules'},
    ], reason='规则适用届次尚未确认。', blocks_participation=True)
    result = build_conflicts([decision], receipts)
    assert result[0].accepted_statement is None
    assert result[0].blocks_participation is False
    decision.statements[1].text = '未读取段落里的另一条规则。'
    assert build_conflicts([decision], receipts) == []
