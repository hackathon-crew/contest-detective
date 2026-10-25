import asyncio
import socket
import httpx
import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RunUsage, UsageLimits
from contest_detective.server.agent.scope import classify_scope
from contest_detective.server.agent.public_pages import fetch_public_evidence
from contest_detective.server.agent.verification import scope_check, export_text, safe_evidence_url
from contest_detective.server.account.schemas import SearchPreferences


@pytest.mark.parametrize('text', [
    '推荐一个适合我的黑客松比赛，要求截止时间11点，线上。技术栈是AI应用，RAG&workflow&LLM agent。',
    '帮我找适合新手的活动',
    'https://example.devpost.com/rules',
])
def test_discovery_scope_needs_no_contest_name_or_extra_model_call(text):
    usage=RunUsage()
    def fail(*_):
        pytest.fail('ordinary discovery must reach the investigator without a scope model')
    decision=asyncio.run(classify_scope(FunctionModel(fail),text,usage=usage,usage_limits=UsageLimits(request_limit=None)))
    assert decision.outcome=='allowed_contest'
    assert usage.requests==0


@pytest.mark.parametrize('text', ['比赛 https://example.org/a?api_key=secret', '比赛 access_token=secret',
                                  '总\u200b统的恋情', '比赛 http://127.0.0.1/private'])
def test_scope_backstop_blocks_secrets_and_obfuscated_political_text(text):
    assert scope_check(text).outcome=='out_of_scope'


def test_sensitive_text_removed_from_blocked_exports():
    text=export_text('比赛 https://example.org/?token=do-not-export API_KEY=hide-me')
    assert 'do-not-export' not in text and 'hide-me' not in text
    assert safe_evidence_url('https://example.org/#access_token=secret') is None
    assert safe_evidence_url('https://good.example\\@localhost') is None


def dns(host, port, **kwargs):
    return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',port))]


@pytest.mark.parametrize('target',['http://127.0.0.1/private','https://other.example/?token=secret','https://blocked.example/rules'])
def test_public_redirect_is_checked_before_second_request(target):
    calls=[]
    def handle(request):
        calls.append(request)
        return httpx.Response(302,headers={'Location':target})
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ValueError):
            fetch_public_evidence('https://good.example/rules',client=client,resolver=dns,
                preferences=SearchPreferences(blocked_domains=['blocked.example']))
    assert len(calls)==1


def test_final_url_is_retained_and_does_not_inherit_redirecting_source_identity():
    calls=[]
    def handle(request):
        calls.append(request)
        if len(calls)==1:
            return httpx.Response(302,headers={'Location':'https://other.example/rules'})
        return httpx.Response(200,headers={'Content-Type':'text/plain'},text='公开赛事规则')
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        result=fetch_public_evidence('https://good.devpost.com/rules',client=client,resolver=dns)
    assert result=={'text':'公开赛事规则','url':'https://other.example/rules'}


@pytest.mark.parametrize('url',[
    'https://example.org/?X-Amz-Signature=secret',
    'https://example.org/?redirect=https%3A%2F%2Fother.org%2F%3Faccess_token%3Dsecret',
    'https://example.org/?next=http%3A%2F%2F127.0.0.1%2Fprivate',
])
def test_signed_or_nested_secret_redirect_links_never_export(url):
    assert safe_evidence_url(url) is None


@pytest.mark.parametrize('url',['https://example.org/?pwd=secret','https://example.org/?private_key=secret','https://example.org/#private-key=secret','https://example.org/?my-auth=secret'])
def test_all_frontend_sensitive_parameter_spellings_are_blocked_before_provider(url):
    assert safe_evidence_url(url) is None
    assert scope_check('比赛 '+url).outcome=='out_of_scope'


@pytest.mark.parametrize('site',['https://example.org/?token=secret','127.0.0.1','internal.local','https://user:pass@example.org','example.org/private/path'])
def test_site_filter_rejects_private_and_credential_targets(site):
    from contest_detective.server.agent.verification import public_search_site
    with pytest.raises(ValueError): public_search_site(site)


def test_site_filter_only_returns_public_hostname():
    from contest_detective.server.agent.verification import public_search_site
    assert public_search_site('https://www.example.org/')=='www.example.org'
    assert public_search_site('example.org')=='example.org'
