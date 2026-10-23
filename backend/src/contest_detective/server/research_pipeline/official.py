from urllib.parse import urlsplit


def _host(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {'http', 'https'} or parsed.username or parsed.password:
            return None
        return (parsed.hostname or '').lower().rstrip('.') or None
    except ValueError:
        return None


def is_official_page(url: str, *, registration_url: str | None = None,
                     origin: str | None = None, external_registration: bool = False) -> bool:
    """只接受调用方核实的报名与 origin 上下文，不使用抽取结果自报的官方身份。"""
    host = _host(url)
    if host is None:
        return False
    path = urlsplit(url).path
    if any(host == name or host.endswith('.' + name)
           for name in ('hackertrip.space', 'hackathonradar.com')):
        return False
    if host == 'events.waytoagi.com':
        return origin == 'hosted' and not external_registration
    if host.endswith('.devpost.com'):
        return True
    if host in {'huodongxing.com', 'www.huodongxing.com'} and path.startswith('/event/'):
        return bool(path.removeprefix('/event/').strip('/'))
    if host in {'ethglobal.com', 'www.ethglobal.com'} and path.startswith('/events/'):
        return bool(path.removeprefix('/events/').strip('/'))
    return host == _host(registration_url)
