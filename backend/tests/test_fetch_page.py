import socket

import httpx
import pytest


def public_dns(host, port, **kwargs):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', port))]


def test_fetch_page_extracts_article_with_pinned_public_address():
    from contest_detective.server.research_pipeline.pages import fetch_page

    article = '比赛将于2026年11月1日开始。报名截止为10月31日，作品提交时间请查看主办方公告。' * 20

    def handle(request):
        assert request.url.host == '93.184.216.34'
        assert request.headers['host'] == 'example.org'
        assert request.extensions['sni_hostname'] == 'example.org'
        assert request.extensions['timeout']['read'] <= 10
        return httpx.Response(200, headers={'Content-Type': 'text/html'}, text=(
            f'<html><body><nav>网页导航</nav><article><p>{article}</p></article>'
            '<script>secret_script()</script></body></html>'
        ))

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        content = fetch_page('https://example.org/contest', client=client, resolver=public_dns)

    assert '比赛将于2026年11月1日开始' in content
    assert 'secret_script' not in content
    assert '网页导航' not in content


def test_fetch_page_preserves_the_full_extracted_text():
    from contest_detective.server.research_pipeline.pages import fetch_page

    body = '<html><body><article><p>' + '公开赛事正文。' * 2000 + '</p></article></body></html>'
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, headers={'Content-Type': 'text/html'}, text=body,
    ))) as client:
        content = fetch_page('https://example.org/contest', client=client, resolver=public_dns)
    assert content.count('公开赛事正文。') == 2000


@pytest.mark.parametrize('url', [
    'file:///etc/passwd', 'ftp://example.org/file', 'http://127.0.0.1/',
    'http://[::1]/', 'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/', 'http://100.64.0.1/', 'https://user:password@example.org/',
])
def test_fetch_page_rejects_unsafe_targets_before_connecting(url):
    from contest_detective.server.research_pipeline.pages import fetch_page

    with pytest.raises(ValueError):
        fetch_page(url, resolver=public_dns)


def test_fetch_page_rejects_a_hostname_that_resolves_to_private_address():
    from contest_detective.server.research_pipeline.pages import fetch_page

    def private_dns(host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', port))]

    with pytest.raises(ValueError):
        fetch_page('https://internal.example.org', resolver=private_dns)


def test_fetch_page_rechecks_redirects_before_following_them():
    from contest_detective.server.research_pipeline.pages import fetch_page

    calls = []

    def handle(request):
        calls.append(request.url)
        return httpx.Response(302, headers={'Location': 'http://169.254.169.254/latest/meta-data/'})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ValueError):
            fetch_page('https://example.org/redirect', client=client, resolver=public_dns)
    assert len(calls) == 1


def test_fetch_page_stops_when_the_download_exceeds_the_limit():
    from contest_detective.server.research_pipeline.pages import fetch_page

    response = lambda _: httpx.Response(200, headers={'Content-Type': 'text/html'}, content=b'x' * 1_048_577)
    with httpx.Client(transport=httpx.MockTransport(response)) as client:
        with pytest.raises(ValueError, match='网页过大'):
            fetch_page('https://example.org/large', client=client, resolver=public_dns)


def test_fetch_page_honors_legacy_html_encoding():
    from contest_detective.server.research_pipeline.pages import fetch_page

    html = '<html><head><meta charset="gbk"></head><body><article><p>' + '公开赛事介绍。' * 20 + '</p></article></body></html>'
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, headers={'Content-Type': 'text/html'}, content=html.encode('gbk'),
    ))) as client:
        content = fetch_page('https://example.org/contest', client=client, resolver=public_dns)
    assert '公开赛事介绍。' in content


def test_fetch_page_limits_a_stream_without_content_length():
    from contest_detective.server.research_pipeline.pages import fetch_page

    class LargeBody(httpx.SyncByteStream):
        def __iter__(self):
            yield b'x' * 700_000
            yield b'x' * 700_000

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, headers={'Content-Type': 'text/html'}, stream=LargeBody(),
    ))) as client:
        with pytest.raises(ValueError, match='网页过大'):
            fetch_page('https://example.org/large', client=client, resolver=public_dns)


def test_fetch_page_rejects_mixed_public_and_private_dns_answers():
    from contest_detective.server.research_pipeline.pages import fetch_page

    def mixed_dns(host, port, **kwargs):
        return [*public_dns(host, port),
                (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.0.0.1', port))]

    with pytest.raises(ValueError):
        fetch_page('https://example.org', resolver=mixed_dns)


def test_fetch_page_follows_a_safe_relative_redirect():
    from contest_detective.server.research_pipeline.pages import fetch_page

    def handle(request):
        if request.url.path == '/start':
            return httpx.Response(302, headers={'Location': '/final'})
        return httpx.Response(200, headers={'Content-Type': 'text/plain'}, text='公开正文')

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        assert fetch_page('https://example.org/start', client=client, resolver=public_dns) == '公开正文'


@pytest.mark.parametrize('url', ['http://224.0.0.1/', 'http://[ff02::1]/', 'http://[fec0::1]/'])
def test_fetch_page_rejects_multicast_and_site_local_targets(url):
    from contest_detective.server.research_pipeline.pages import fetch_page

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, headers={'Content-Type': 'text/plain'}, text='not public',
    ))) as client:
        with pytest.raises(ValueError):
            fetch_page(url, client=client, resolver=public_dns)


def test_fetch_page_accepts_gzip_and_preserves_a_deadline_after_six_thousand_chars():
    import gzip
    from contest_detective.server.research_pipeline.pages import fetch_page
    text = '公开介绍。' * 1600 + '报名截止：10月25日。'
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, headers={'Content-Type': 'text/plain; charset=utf-8', 'Content-Encoding': 'gzip'},
        content=gzip.compress(text.encode()),
    ))) as client:
        assert fetch_page('https://example.org/rules', client=client, resolver=public_dns) == text


def test_gzip_response_still_obeys_the_decoded_download_limit():
    import gzip
    from contest_detective.server.research_pipeline.pages import fetch_page
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, headers={'Content-Type': 'text/plain', 'Content-Encoding': 'gzip'},
        content=gzip.compress(b'x' * 1_048_577),
    ))) as client:
        with pytest.raises(ValueError, match='网页过大'):
            fetch_page('https://example.org/large', client=client, resolver=public_dns)
