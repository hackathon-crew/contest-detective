"""只读取公开网页。连接到核实过的 IP，避免校验后再次解析造成 DNS 重绑定。"""

import ipaddress
import socket
import time
from contextlib import nullcontext

import httpx
import trafilatura

MAX_BYTES = 1_048_576
TIMEOUT_SECONDS = 10


def _public_target(url: str, resolver) -> tuple[httpx.URL, httpx.URL]:
    try:
        target = httpx.URL(url)
        if target.scheme not in {'http', 'https'} or not target.host or target.userinfo:
            raise ValueError
        port = target.port or (443 if target.scheme == 'https' else 80)
        try:
            literal = ipaddress.ip_address(target.host)
        except ValueError:
            addresses = [row[4][0] for row in resolver(target.host, port, type=socket.SOCK_STREAM)]
        else:
            addresses = [str(literal)]
        parsed_addresses = [ipaddress.ip_address(address) for address in addresses]
        if not addresses or any(
            not address.is_global or address.is_multicast or address.is_reserved
            or getattr(address, 'is_site_local', False)
            for address in parsed_addresses
        ):
            raise ValueError
        pinned = target.copy_with(host=addresses[0], fragment='')
        return target, pinned
    except (httpx.InvalidURL, OSError, ValueError) as exc:
        raise ValueError('只能抓取公开的 HTTP(S) 网页') from exc


def fetch_page(url: str, *, client: httpx.Client | None = None, resolver=None) -> str:
    resolver = resolver or socket.getaddrinfo
    deadline = time.monotonic() + TIMEOUT_SECONDS
    context = nullcontext(client) if client else httpx.Client(
        trust_env=False, follow_redirects=False,
        limits=httpx.Limits(max_keepalive_connections=0),
    )
    with context as active_client:
        current = url
        for _ in range(6):
            original, pinned = _public_target(current, resolver)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise httpx.ReadTimeout('网页读取超时')
            # TLS 仍使用原站名校验证书；Host 不允许被改写为连接地址。
            host = original.netloc.decode('ascii')
            with active_client.stream(
                'GET', pinned, headers={
                    'Host': host, 'Accept-Encoding': 'identity',
                    'User-Agent': 'ContestDetective/0.1',
                }, timeout=remaining, follow_redirects=False,
                extensions={'sni_hostname': original.host},
            ) as response:
                if response.is_redirect:
                    location = response.headers.get('location')
                    if not location:
                        raise ValueError('网页重定向缺少目标')
                    current = str(original.join(location))
                    continue
                response.raise_for_status()
                media_type = response.headers.get('content-type', 'text/html').split(';', 1)[0].strip()
                if media_type not in {'text/html', 'application/xhtml+xml', 'text/plain'}:
                    raise ValueError('只支持读取网页或纯文本')
                if response.headers.get('content-encoding', 'identity').lower() not in {'', 'identity'}:
                    raise ValueError('不支持压缩的网页响应')
                try:
                    declared_size = int(response.headers.get('content-length', '0'))
                except ValueError:
                    declared_size = 0
                if declared_size > MAX_BYTES:
                    raise ValueError('网页过大')
                body = bytearray()
                for chunk in response.iter_bytes():
                    if len(body) + len(chunk) > MAX_BYTES:
                        raise ValueError('网页过大')
                    if time.monotonic() > deadline:
                        raise httpx.ReadTimeout('网页读取超时')
                    body.extend(chunk)
                if media_type == 'text/plain':
                    return bytes(body).decode(response.encoding or 'utf-8', errors='replace').strip()[:6000]
                return (trafilatura.extract(bytes(body), url=str(original), include_comments=False) or '')[:6000]
    raise ValueError('网页重定向次数过多')
