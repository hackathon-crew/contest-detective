import re
import uuid
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet
from sqlalchemy import select

from account_helpers import account_client, login, register
from test_profile_matching import contest


def test_email_changes_only_after_single_use_verification(tmp_path):
    from contest_detective.bootstrap.api.account_settings import get_mailer
    from contest_detective.system.account.models import EmailChange, MailDelivery
    from contest_detective.system.notifications.ports import DeliveryReceipt
    from contest_detective.system.user.models import User

    messages = []

    class Mailer:
        def send(self, message):
            messages.append(message)
            return DeliveryReceipt(provider_id="verification-one")

    with account_client(tmp_path) as client:
        owner = login(client)
        client.app.dependency_overrides[get_mailer] = Mailer
        sent = client.post("/account/email", json={"email": "new@example.com"}).json()
        assert sent["code"] == 200
        assert client.get("/auth/me").json()["data"]["username"] == "owner@example.com"
        token = re.search(r"token=([\w-]+)", messages[0].text).group(1)
        with client.app.state.test_session_factory() as session:
            change = session.get(EmailChange, uuid.UUID(owner))
            assert change.token_hash != token and len(change.token_hash) == 64
            assert token not in str(
                session.scalars(select(MailDelivery)).one().__dict__
            )
        verified = client.get(
            "/account/email/verify", params={"token": token}, follow_redirects=False
        )
        assert verified.status_code == 303
        assert client.get("/auth/me").json()["data"]["username"] == "new@example.com"
        reused = client.get(
            "/account/email/verify", params={"token": token}, follow_redirects=False
        )
        assert reused.status_code == 303
        assert reused.headers["location"].endswith("/account/settings?email_verified=0")
        client.post("/account/email", json={"email": "expired@example.com"})
        expired = re.search(r"token=([\w-]+)", messages[-1].text).group(1)
        with client.app.state.test_session_factory() as session:
            session.get(EmailChange, uuid.UUID(owner)).expires_at = datetime.now(
                timezone.utc
            ) - timedelta(seconds=1)
            session.commit()
        stale = client.get(
            "/account/email/verify", params={"token": expired}, follow_redirects=False
        )
        assert stale.status_code == 303
        assert stale.headers["location"].endswith("/account/settings?email_verified=0")
        with client.app.state.test_session_factory() as session:
            assert session.get(User, uuid.UUID(owner)).email == "new@example.com"


def test_unverified_account_can_verify_its_current_email(tmp_path):
    from contest_detective.bootstrap.api.mail import get_mailer
    from contest_detective.system.notifications.ports import DeliveryReceipt

    messages = []

    class Mailer:
        def send(self, message):
            messages.append(message)
            return DeliveryReceipt(provider_id="verification-self")

    with account_client(tmp_path) as client:
        login(client, verified=False)
        assert client.get("/account/settings").json()["data"]["email_verified"] is False
        client.app.dependency_overrides[get_mailer] = Mailer
        assert client.post("/account/email/verification").json()["code"] == 200
        token = re.search(r"token=([\w-]+)", messages[0].text).group(1)
        verified = client.get(
            "/account/email/verify", params={"token": token}, follow_redirects=False
        )
        assert verified.status_code == 303
        assert verified.headers["location"].endswith(
            "/account/settings?email_verified=1"
        )
        assert client.get("/account/settings").json()["data"]["email_verified"] is True
        assert client.get("/account/push").json()["data"]["email_verified"] is True
        assert client.put("/account/push", json={"enabled": True}).json()["code"] == 200
        assert client.post("/account/email/verification").json()["code"] == 400


def test_password_change_revokes_other_sessions_and_keeps_current_session(tmp_path):
    with account_client(tmp_path) as client:
        owner = login(client)
        old = client.cookies.get("cd_session")
        client.post(
            "/auth/login",
            json={"email": "owner@example.com", "password": "long-password-123"},
        )
        current = client.cookies.get("cd_session")
        assert old != current
        body = {"current_password": "wrong", "new_password": "new-password-4826"}
        assert client.post("/account/password", json=body).json()["code"] == 400
        body["current_password"] = "long-password-123"
        assert client.post("/account/password", json=body).json()["code"] == 200
        assert client.get("/auth/me").json()["data"]["id"] == owner
        assert (
            client.get("/auth/me", headers={"cookie": "cd_session=" + old}).json()[
                "data"
            ]
            is None
        )
        assert (
            client.post(
                "/auth/login",
                json={"email": "owner@example.com", "password": "long-password-123"},
            ).json()["code"]
            == 401
        )
        assert (
            client.post(
                "/auth/login",
                json={"email": "owner@example.com", "password": body["new_password"]},
            ).json()["code"]
            == 200
        )
        assert (
            client.get("/account/settings").json()["data"]["password_changed_at"]
            is not None
        )
        secret = "do-not-echo-" + ("s" * 150)
        invalid = client.post(
            "/account/password",
            json={"current_password": secret, "new_password": secret},
        ).json()
        assert invalid["code"] == 400 and secret not in str(invalid)


def test_export_and_delete_are_owned_and_preserve_public_contests(
    tmp_path, monkeypatch
):
    from contest_detective.system.account.models import (
        Follow,
        Track,
        AccountSettings,
        PersonalToken,
    )
    from contest_detective.system.account.tokens import resolve_token
    from contest_detective.system.user.models import User
    from contest_detective.contest.models import Contest
    from contest_detective.agent.models import Investigation, TraceRecord

    monkeypatch.setenv(
        "DETECTIVE_ACCOUNT_ENCRYPTION_KEY", Fernet.generate_key().decode()
    )
    with account_client(tmp_path) as client:
        owner = login(client)
        with client.app.state.test_session_factory() as session:
            key = contest(session, "保留公共比赛")
            session.add(
                Track(
                    id="owned-track",
                    user_id=uuid.UUID(owner),
                    text="AI 比赛",
                    conditions={"keywords": ["AI"]},
                )
            )
            record = Investigation(
                id="private-investigation", user_id=owner, question="private question"
            )
            session.add(record)
            session.flush()
            session.add(
                TraceRecord(
                    investigation_id=record.id,
                    seq=1,
                    type="answer",
                    payload={"content": "private answer"},
                )
            )
            session.commit()
        other_id = register(
            client, "other@example.com", "other-password-123"
        )["data"]["id"]
        with client.app.state.test_session_factory() as session:
            session.add(
                AccountSettings(user_id=uuid.UUID(other_id), push={"enabled": True})
            )
            session.add(
                Track(
                    id="other-track",
                    user_id=uuid.UUID(other_id),
                    text="其他人的条件",
                    conditions={"keywords": ["web"]},
                )
            )
            session.commit()
        client.put("/account/follows/" + key, json={"reminders": False})
        client.put("/account/providers", json={"tavily_api_key": "do-not-export-ABCD"})
        token = client.post("/account/token/regenerate").json()["data"]["token"]
        data = client.get("/account/export").json()["data"]
        assert (
            data["email"] == "owner@example.com"
            and data["follows"][0]["contest_id"] == key
        )
        assert data["tracks"][0]["text"] == "AI 比赛"
        assert (
            "do-not-export" not in str(data)
            and token not in str(data)
            and "hashed_password" not in str(data)
        )
        assert (
            client.request(
                "DELETE", "/account", json={"email": "wrong@example.com"}
            ).json()["code"]
            == 400
        )
        assert (
            client.request(
                "DELETE", "/account", json={"email": "owner@example.com"}
            ).json()["code"]
            == 200
        )
        assert client.get("/auth/me").json()["data"] is None
        with client.app.state.test_session_factory() as session:
            assert session.get(User, uuid.UUID(owner)) is None
            for model in (
                Follow,
                PersonalToken,
                Investigation,
                TraceRecord,
            ):
                assert session.scalars(select(model)).all() == []
            assert session.get(AccountSettings, uuid.UUID(owner)) is None
            assert session.get(AccountSettings, uuid.UUID(other_id)).push == {
                "enabled": True
            }
            assert session.get(User, uuid.UUID(other_id)) is not None
            assert (
                session.get(Track, "owned-track") is None
                and session.get(Track, "other-track") is not None
            )
            assert resolve_token(session, token) is None
            assert session.get(Contest, key) is not None
