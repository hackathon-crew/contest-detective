import pytest
from contest_detective.server.agent.verification import VerificationState, safe_evidence_url, scope_check
from contest_detective.server.agent.verification_contracts import ClaimAssessment, InvestigationPlan
from contest_detective.server.research_pipeline.contracts import SearchExecution


def receipt(n=1, query='黑客松官方规则', step='s1', status='success'):
    return SearchExecution(id=f'q{n}', step_id=step, round=n, query=query, provider='yuanbao',
                           status=status, executed_at='2026-10-25T05:00:00Z', result_count=1)


def state(mode='deep'):
    result = VerificationState(mode, '核实黑客松作品提交截止', [])
    result.set_plan(InvestigationPlan(mode=mode, steps=[
        {'id': 's1', 'purpose': '核对官方规则', 'query': '黑客松官方规则', 'claim_ids': ['c1']},
        {'id': 's2', 'purpose': '核对延期公告', 'query': '黑客松延期公告', 'claim_ids': ['c1']},
    ]))
    return result


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'http://127.0.0.1/a', 'http://[::1]/a',
    'https://user:pass@example.org/a', 'https://example.org/?access_token=secret',
    'https://example.org/?%61pi_key=secret', 'http://internal.local/a'])
def test_private_or_secret_urls_never_enter_exported_evidence(url):
    assert safe_evidence_url(url) is None


def test_scope_rejects_political_and_personal_news_without_confusing_contest_preferences():
    for text in ['调查选举新闻', '黑客松主办人的私人恋情', '政 治 人物 新闻', 'hackathon celebrity gossip']:
        assert scope_check(text).outcome == 'out_of_scope'
    for text in ['我想个人参赛的黑客松', '核对参赛政策', 'hackathon official rules']:
        assert scope_check(text).outcome == 'allowed_contest'
    assert scope_check('这是真的吗').outcome == 'needs_clarification'


def test_quotes_must_exist_in_read_text_and_sources_cannot_be_forged():
    result = state()
    url = 'https://sample.devpost.com/rules'
    with pytest.raises(ValueError): result.cite(url, '提交截止 16:00')
    result.remember_page(url, '作品提交截止 10 月 25 日，未注明时刻。')
    with pytest.raises(ValueError): result.cite(url, '提交截止 16:00')
    evidence = result.cite(url, '作品提交截止 10 月 25 日')
    assert evidence.source_level == 'official'
    claim = ClaimAssessment(id='c1', text='ignored', verdict='supported', source_level='official',
                            evidence_ids=['forged'], comparison='测试')
    assert result.validate_assessments([claim])


def test_queries_are_necessary_but_not_sufficient_for_complete_deep_report():
    result = state()
    result.remember_search([], receipt())
    result.remember_search([], receipt(2, query='黑客松延期公告', step='s2'))
    report = result.build([])
    assert report.status == 'incomplete' and report.claims[0].verdict == 'insufficient'


def test_no_actual_yuanbao_execution_is_blocked():
    assert state().build([]).status == 'blocked'


def test_mirrored_content_does_not_count_as_independent_cross_check():
    result = state()
    for n, url in enumerate(['https://sample.devpost.com/rules', 'https://mirror.example/rules'], 1):
        result.remember_search([{'url': url, 'title': '规则', 'snippet': '摘要', 'provider': 'yuanbao'}],
                               receipt(n, query=f'黑客松规则{n}', step=f's{n}'))
        result.remember_page(url, '作品提交截止 10 月 25 日。相同公告。')
    ids = [result.cite(url, '作品提交截止 10 月 25 日').id for url in result.fetched_pages]
    claim = ClaimAssessment(id='c1', text='ignored', verdict='supported', source_level='official',
                            evidence_ids=ids, comparison='原文给出了日期，未给出时刻。')
    assert result.build([claim]).status == 'incomplete'


def test_current_independent_sources_complete_a_covered_report_and_keep_claim_text():
    result = state()
    result.remember_contest({'id': 'contest-1', 'name': '黑客松', 'fields': {'registration_url': {'value': 'https://organizer.example/register', 'level': 'official', 'sources': []}}})
    for n, (url, text) in enumerate([
        ('https://sample.devpost.com/rules', '官方规则：作品提交截止 10 月 25 日。'),
        ('https://organizer.example/announcement', '主办方公告更新：作品提交截止 10 月 25 日，请及时提交。'),
    ], 1):
        result.remember_search([{'url': url, 'title': '规则', 'snippet': '摘要', 'provider': 'yuanbao'}],
                               receipt(n, query=f'黑客松规则{n}', step=f's{n}'))
        result.remember_page(url, text)
    ids = [result.cite(url, '作品提交截止 10 月 25 日').id for url in result.fetched_pages]
    claim = ClaimAssessment(id='c1', text='model must not rewrite claim', verdict='supported',
                            source_level='official', evidence_ids=ids, comparison='两份原文均给日期，不含时刻。')
    report = result.build([claim])
    assert report.status == 'complete'
    assert report.claims[0].text == '核实黑客松作品提交截止'
    assert result.build([claim], interrupted=True).status == 'incomplete'


def test_only_search_snippets_cannot_support_a_claim():
    result = state('realtime')
    result.remember_search([{'url': 'https://sample.devpost.com/rules', 'title': '规则',
                            'snippet': '作品提交截止 10 月 25 日', 'provider': 'yuanbao'}], receipt())
    claim = ClaimAssessment(id='c1', text='ignored', verdict='supported', source_level='official',
                            evidence_ids=list(result.evidence), comparison='搜索摘要')
    assert result.validate_assessments([claim])


def test_mirror_hash_uses_whole_fetched_page_not_selected_offsets():
    state = VerificationState('deep', '比赛规则', [])
    body='比赛规则报名10月25日截止。其他公开规则。'
    state.remember_page('https://one.devpost.com/rules','比赛规则报名10月25日截止。',full_text=body)
    state.remember_page('https://two.devpost.com/rules','报名10月25日截止。其他公开规则。',full_text=body)
    one=state.cite('https://one.devpost.com/rules','报名10月25日截止')
    two=state.cite('https://two.devpost.com/rules','报名10月25日截止')
    assert one.content_hash==two.content_hash


def test_model_markdown_and_sensitive_links_are_not_exported_as_active_markup():
    from contest_detective.server.agent.verification import render_report
    state=VerificationState('realtime','比赛 **[点这里](javascript:alert(1))** https://example.org/?token=secret',[])
    text=render_report(state.build([]))
    assert 'secret' not in text
    assert '\\[' in text and '\\*' in text


def test_same_model_node_is_not_multiple_search_rounds():
    result=state()
    assert result.search_round(2)==1
    assert result.search_round(2)==1
    assert result.search_round(4)==2


def test_rejected_redirect_url_cannot_survive_in_exported_evidence():
    result=state('realtime')
    url='https://sample.devpost.com/rules'
    hit={'url':url,'title':'规则','snippet':'公开摘要','provider':'yuanbao'}
    result.remember_search([hit],receipt())
    assert result.evidence
    result.reject_url(url)
    result.remember_search([hit],receipt(2))
    assert not result.evidence
    with pytest.raises(ValueError): result.cite(url,'公开摘要')


def test_unverified_registration_url_cannot_assign_official_identity():
    result=state()
    result.remember_contest({'id':'x','name':'比赛','fields':{'registration_url':{'value':'https://unverified.example/register','level':'reposted','sources':[]}}})
    result.remember_page('https://unverified.example/rules','公开规则')
    assert result.cite('https://unverified.example/rules','公开规则').source_level=='reposted'


def test_successful_public_redirect_keeps_query_chain_not_official_identity():
    result=state('realtime')
    original='https://example.devpost.com/rules'
    final='https://other.example/rules'
    result.remember_search([{'url':original,'title':'规则','provider':'yuanbao'}],receipt())
    result.remember_redirect(original,final)
    result.remember_page(final,'报名10月25日截止')
    evidence=result.cite(final,'报名10月25日截止')
    assert evidence.query_ids==['q1'] and evidence.provider=='yuanbao'
    assert evidence.source_level=='reposted' and evidence.source_lineage is None


@pytest.mark.parametrize('marker',['Originally published at https://one.devpost.com/rules','转载自 https://one.devpost.com/rules'])
def test_reprint_marker_in_unselected_full_page_blocks_independent_lineage(marker):
    result=state()
    url='https://two.devpost.com/rules'
    result.remember_page(url,'报名10月25日截止',full_text='公告。'+marker+'。报名10月25日截止')
    evidence=result.cite(url,'报名10月25日截止')
    assert evidence.source_level=='official'
    assert evidence.source_lineage is None


def test_contract_reference_lists_are_unique_before_frontend_serialization():
    result=state('realtime')
    result.set_plan({'mode':'realtime','steps':[{'id':'s1','purpose':'查规则','query':'比赛规则','claim_ids':['c1','c1']}]})
    assert result.plan.steps[0].claim_ids==['c1']
    url='https://event.devpost.com/rules'
    hit={'url':url,'title':'规则','provider':'yuanbao'}
    result.remember_search([hit,hit],receipt())
    result.remember_page(url,'报名10月25日截止')
    evidence=result.cite(url,'报名10月25日截止')
    assert evidence.query_ids==['q1']
    assessment=ClaimAssessment(id='c1',text='ignored',verdict='supported',source_level='official',evidence_ids=[evidence.id,evidence.id],comparison='官方日期')
    assert result.validate_assessments([assessment])


def test_blank_model_limitations_do_not_break_report_contract():
    result=state('realtime')
    claim=ClaimAssessment(id='c1',text='ignored',verdict='insufficient',source_level='not_found',comparison='未知',limitations=['','  ','缺少证据'])
    assert result.build([claim]).claims[0].limitations==['缺少证据']
