import asyncio

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from account_helpers import account_client, login


def test_remote_mcp_token_scopes_private_tools_and_rotation(tmp_path):
    from contest_detective.bootstrap.mcp_http import create_app

    with account_client(tmp_path) as web:
        login(web)
        web.put("/user/profile", json={"skills": ["Python"], "city": "上海"})
        token = web.post("/account/token/regenerate").json()["data"]["token"]

        def mcp_app():
            return create_app(
                database_url=f"sqlite:///{tmp_path / 'account-center.db'}"
            )

        async def read(headers):
            app = mcp_app()
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), headers=headers
                ) as http:
                    async with streamable_http_client(
                        "http://127.0.0.1/mcp", http_client=http
                    ) as (reader, writer, _):
                        async with ClientSession(reader, writer) as client:
                            await client.initialize()
                            names = {
                                tool.name for tool in (await client.list_tools()).tools
                            }
                            if headers:
                                profile = await client.call_tool("get_my_profile", {})
                                assert profile.structuredContent["skills"] == ["Python"]
                            return names

        assert "get_my_profile" not in asyncio.run(read({}))
        assert {"get_my_profile", "get_my_follows", "get_my_tracking"} <= asyncio.run(
            read({"Authorization": "Bearer " + token})
        )
        web.post("/account/token/regenerate")

        async def invalid():
            app = mcp_app()
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app)
                ) as client:
                    response = await client.post(
                        "http://127.0.0.1/mcp",
                        headers={"Authorization": "Bearer " + token},
                        json={},
                    )
                    assert response.status_code == 401

        asyncio.run(invalid())
