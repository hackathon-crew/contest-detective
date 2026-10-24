import uuid

from cryptography.fernet import Fernet
import pytest
from sqlalchemy import select

from account_helpers import account_client, login


def test_personal_token_is_hashed_masked_and_invalidated_by_rotation(tmp_path):
    from contest_detective.server.account.models import PersonalToken
    from contest_detective.server.account.tokens import resolve_token

    with account_client(tmp_path) as client:
        user_id = login(client)
        assert client.get("/account/token").json()["data"] is None
        first = client.post("/account/token/regenerate").json()["data"]
        assert first["token"].startswith("ink_pt_")
        assert client.get("/account/token").json()["data"] == first["metadata"]
        with client.app.state.test_session_factory() as session:
            row = session.get(PersonalToken, uuid.UUID(user_id))
            assert first["token"] not in str(row.__dict__)
            assert len(row.token_hash) == 64
            assert str(resolve_token(session, first["token"]).id) == user_id
        second = client.post("/account/token/regenerate").json()["data"]
        with client.app.state.test_session_factory() as session:
            assert resolve_token(session, first["token"]) is None
            assert str(resolve_token(session, second["token"]).id) == user_id
        assert second["token"] not in str(client.get("/account/token").json())


def test_provider_keys_are_encrypted_and_used_only_for_the_owner(tmp_path, monkeypatch):
    from contest_detective.server.account.models import AccountSettings
    from contest_detective.server.account.providers import runtime_for

    monkeypatch.setenv(
        "DETECTIVE_ACCOUNT_ENCRYPTION_KEY", Fernet.generate_key().decode()
    )
    with account_client(tmp_path) as client:
        owner_id = login(client)
        body = {
            "llm_vendor": "openai",
            "llm_base_url": "https://gateway.example/v1",
            "llm_model": "owner-model",
            "llm_api_key": "private-model-ABCD",
            "tavily_api_key": "private-search-WXYZ",
        }
        saved = client.put("/account/providers", json=body).json()
        assert saved["code"] == 200
        assert saved["data"]["secrets"]["llm_api_key"]["last_four"] == "ABCD"
        assert body["llm_api_key"] not in str(saved)
        with client.app.state.test_session_factory() as session:
            row = session.get(AccountSettings, uuid.UUID(owner_id))
            assert body["llm_api_key"] not in str(row.providers)
            assert body["tavily_api_key"] not in str(row.providers)
            runtime = runtime_for(session, owner_id)
            assert runtime.llm.api_key.get_secret_value() == body["llm_api_key"]
            assert runtime.llm.model == "owner-model"
            assert (
                runtime.search.tavily_api_key.get_secret_value()
                == body["tavily_api_key"]
            )
        other_id = login(client, "other@example.com")
        assert client.get("/account/providers").json()["data"]["secrets"] == {}
        with client.app.state.test_session_factory() as session:
            assert runtime_for(session, other_id).llm is None


def test_provider_validation_does_not_echo_secrets_or_retarget_platform_keys(
    tmp_path, monkeypatch
):
    from contest_detective.server.account.providers import runtime_for

    monkeypatch.setenv(
        "DETECTIVE_ACCOUNT_ENCRYPTION_KEY", Fernet.generate_key().decode()
    )
    with account_client(tmp_path) as client:
        user_id = login(client)
        response = client.put(
            "/account/providers", json={"llm_api_key": "secret-" + ("s" * 5000)}
        ).json()
        assert response["code"] == 400
        assert "secret-" not in str(response)
        assert (
            client.put(
                "/account/providers", json={"llm_base_url": "https://custom.example/v1"}
            ).json()["code"]
            == 200
        )
        with client.app.state.test_session_factory() as session:
            assert runtime_for(session, user_id).llm is None
