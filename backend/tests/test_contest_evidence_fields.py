import asyncio

import pytest
from pydantic import ValidationError
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.extraction import create_page_extractor
from contest_detective.contest import service as contests
from contest_detective.contest.schemas import ClaimIn, ContestDraft, ContestQuery
from contest_detective.research import run

CASES = [
    ('venue', '上海市徐汇区示例会场'),
    ('eligibility', '仅限在校大学生'),
    ('team_size', '每队2至4人'),
    ('entry_fee', '参赛报名免费'),
    ('entry_requirements', '需连续到场两天，并提交可运行作品'),
    ('judging_criteria', '技术实现40%，创新性30%，完成度30%'),
    ('past_statistics', '上一届120支队伍参赛，12支获奖'),
]


def draft(field=None, value=None, *, url='https://organizer.example/rules', official=True):
    return ContestDraft(name='可核实的赛事', page={
        'url': url, 'site': '主办方' if official else '转载平台', 'title': '赛事规则', 'is_official': official,
    }, claims=[{'field': field, 'value': value, 'excerpt': value}] if field else [])


@pytest.mark.parametrize(('field', 'value'), CASES)
def test_participation_evidence_survives_save_query_and_detail_api(session, client, field, value):
    contest_id = contests.save(session, draft(field, value))
    items, total = contests.query(session, ContestQuery(ids=[contest_id]))
    assert total == 1
    assert (items[0].fields[field].value, items[0].fields[field].level) == (value, 'official')
    result = client.get(f'/contests/{contest_id}').json()
    assert result['code'] == 200
    evidence = result['data']['fields'][field]
    assert evidence['value'] == value and evidence['level'] == 'official'
    assert evidence['sources'][0]['url'] == 'https://organizer.example/rules'
    assert evidence['sources'][0]['excerpt'] == value


@pytest.mark.parametrize(('field', 'value'), CASES)
def test_new_fields_keep_aggregators_reposted_and_mark_overridden_evidence_stale(session, field, value):
    repost = draft(field, value, url='https://hackertrip.space/hackathon/example', official=True)
    contest_id = contests.save(session, repost)
    assert contests.get(session, contest_id).fields[field].level == 'reposted'
    official = '官方更新：' + value
    contests.save(session, draft(field, official), contest_id=contest_id)
    evidence = contests.get(session, contest_id).fields[field]
    assert evidence.value == official and evidence.level == 'official'
    assert next(source for source in evidence.sources if source.url.startswith('https://hackertrip.space/')).stale


def test_unknown_participation_evidence_remains_empty(session):
    contest_id = contests.save(session, draft())
    detail = contests.get(session, contest_id)
    for field, _ in CASES:
        evidence = detail.fields[field]
        assert evidence.value is None and evidence.level == 'not_found' and evidence.sources == []
    with pytest.raises(ValidationError):
        ClaimIn(field='difficulty', value='五星', excerpt='参赛难度五星')


def test_page_extraction_preserves_only_evidence_supported_by_source_text(session_factory):
    url = 'https://participation.devpost.com/'
    extracted = {'name': '参赛信息活动', 'page': {'url': url, 'site': '报名平台', 'title': '活动', 'is_official': False},
                 'claims': [
                     {'field': 'entry_fee', 'value': '免费报名', 'excerpt': '免费报名'},
                     {'field': 'team_size', 'value': '每队2人', 'excerpt': '每队2人'},
                 ]}
    model = FunctionModel(lambda _, info: ModelResponse([ToolCallPart(info.output_tools[0].name, extracted)]))
    contest_id = asyncio.run(run(url, extractor=create_page_extractor(model=model),
                                page_text='本次活动免费报名，欢迎参赛。', session_factory=session_factory))
    with session_factory() as session:
        detail = contests.get(session, contest_id)
        assert detail.fields['entry_fee'].value == '免费报名'
        assert detail.fields['entry_fee'].level == 'official'
        assert detail.fields['entry_fee'].sources[0].excerpt == '免费报名'
        assert detail.fields['team_size'].value is None
