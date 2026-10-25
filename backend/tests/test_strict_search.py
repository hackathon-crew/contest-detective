import pytest
from contest_detective.framework.config.search import SearchSettings
from contest_detective.server import research_pipeline
from contest_detective.server.research_pipeline.search.base import SearchHit


def config(**kwargs):
    return SearchSettings(_env_file=None, **kwargs)


@pytest.mark.parametrize('values', [{}, {'yuanbao_secret_id': 'fake'}, {'tavily_api_key': 'fake'}])
def test_strict_search_requires_complete_yuanbao_configuration(values):
    with pytest.raises(ValueError, match='元宝'):
        research_pipeline.search_web('黑客松规则', config=config(**values), require_yuanbao=True)


def test_strict_search_never_uses_tavily_even_after_yuanbao_failure(monkeypatch):
    calls = []
    class Yuanbao:
        def __init__(self, **kwargs): pass
        def search(self, *args, **kwargs):
            calls.append('yuanbao')
            raise ValueError('元宝暂不可用')
    class Tavily:
        def __init__(self, **kwargs): calls.append('tavily-created')
    monkeypatch.setattr(research_pipeline, 'YuanbaoSearch', Yuanbao)
    monkeypatch.setattr(research_pipeline, 'TavilySearch', Tavily)
    with pytest.raises(ValueError):
        research_pipeline.search_web('黑客松规则', config=config(yuanbao_secret_id='fake',
            yuanbao_secret_key='fake', tavily_api_key='fake'), require_yuanbao=True)
    assert calls == ['yuanbao']


def test_successful_empty_yuanbao_search_is_not_a_tavily_fallback(monkeypatch):
    class Yuanbao:
        def __init__(self, **kwargs): pass
        def search(self, *args, **kwargs): return []
    monkeypatch.setattr(research_pipeline, 'YuanbaoSearch', Yuanbao)
    assert research_pipeline.search_web('黑客松规则', config=config(yuanbao_secret_id='fake',
        yuanbao_secret_key='fake'), require_yuanbao=True) == []


def test_strict_result_does_not_accept_a_forged_different_provider(monkeypatch):
    class Wrong:
        def __init__(self, **kwargs): pass
        def search(self, *args, **kwargs):
            return [SearchHit(title='规则', url='https://example.org', site='example.org',
                              snippet='test', provider='tavily')]
    monkeypatch.setattr(research_pipeline, 'YuanbaoSearch', Wrong)
    with pytest.raises(ValueError, match='元宝'):
        research_pipeline.search_web('黑客松规则', config=config(yuanbao_secret_id='fake',
            yuanbao_secret_key='fake'), require_yuanbao=True)
