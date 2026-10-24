from contextlib import asynccontextmanager
from types import SimpleNamespace

from cryptography.fernet import Fernet

from account_helpers import account_client, login


def test_interactive_query_builds_only_the_current_users_provider_settings(
    tmp_path, monkeypatch
):
    from contest_detective.web.api import agent
    from contest_detective.server.agent.schemas import TraceEvent

    monkeypatch.setenv(
        "DETECTIVE_ACCOUNT_ENCRYPTION_KEY", Fernet.generate_key().decode()
    )
    calls = []

    class Scope:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

    class Investigator:
        agent = Scope()

        async def ask(self, *_, **__):
            yield TraceEvent(type="answer", payload={"content": "ok"})

    def factory(**kwargs):
        calls.append(kwargs)
        return Investigator()

    monkeypatch.setattr(agent, "create_investigator", factory)
    with account_client(tmp_path) as client:
        login(client)
        client.put(
            "/account/providers",
            json={
                "llm_api_key": "owner-model-ABCD",
                "tavily_api_key": "owner-search-WXYZ",
            },
        )
        assert client.post("/agent/ask", json={"question": "查比赛"}).status_code == 200
        assert (
            calls[-1]["model_settings"].api_key.get_secret_value() == "owner-model-ABCD"
        )
        assert (
            calls[-1]["search_settings"].tavily_api_key.get_secret_value()
            == "owner-search-WXYZ"
        )
        login(client, "other@example.com")
        client.post("/agent/ask", json={"question": "查比赛"})
        assert calls[-1]["model_settings"] is None


def test_query_preferences_filter_deadlines_and_blocked_subdomains():
    from types import SimpleNamespace
    from contest_detective.server.agent.tools import ToolDeps
    from contest_detective.server.account.schemas import SearchPreferences

    deps = ToolDeps(
        None, None, preferences=SearchPreferences(blocked_domains=["csdn.net"])
    )
    assert not deps.allows_url("https://blog.csdn.net/article/one")
    assert deps.allows_url("https://notcsdn.net/contest")
    past = SimpleNamespace(value="2000-01-01T00:00:00Z", precision="day", sources=[])
    contest = SimpleNamespace(status="ongoing", fields={"registration_deadline": past})
    assert not deps.allows_contest(contest)
    deps.preferences = SearchPreferences(exclude_ended=False)
    assert deps.allows_contest(contest)
