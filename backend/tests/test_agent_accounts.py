from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from contest_detective.server.agent.loop import Investigator
from contest_detective.server.agent.models import Investigation
from contest_detective.server.user import service as users
from contest_detective.web.api.agent import get_investigator, limiter
from contest_detective.web.bootstrap.app import create_app


def test_cookie_identity_and_confirmed_profile_reach_the_investigation(tmp_path):
    database = tmp_path / 'investigations.db'
    sync = create_engine(f'sqlite:///{database}', connect_args={'check_same_thread': False})
    sessions = sessionmaker(bind=sync, expire_on_commit=False)
    async_engine = create_async_engine(f'sqlite+aiosqlite:///{database}')
    app = create_app(db_engine=sync, async_session_factory=async_sessionmaker(async_engine, expire_on_commit=False))
    instructions = []
    def respond(_, info):
        instructions.append(info.instructions)
        return ModelResponse([answer_part('库中暂未找到符合条件的比赛。')])
    def profile_reader(user_id):
        with sessions() as session:
            user = users.get(session, user_id)
            return user.profile.model_dump(mode='json') if user else None
    app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=sessions, profile_reader=profile_reader)
    limiter.reset()
    try:
        with TestClient(app) as client:
            credentials = {'email': 'researcher@example.com', 'password': 'long-password-123'}
            user_id = client.post('/auth/register', json=credentials).json()['data']['id']
            assert client.post('/auth/login', json=credentials).json()['code'] == 200
            assert client.put('/user/profile', json={'skills': ['Python'], 'city': '杭州'}).json()['code'] == 200
            assert 'event: answer' in client.post('/agent/ask', json={'question': '哪些比赛适合我'}).text
            client.post('/auth/logout')
            assert 'event: answer' in client.post('/agent/ask', json={'question': '找比赛'}).text
        with sessions() as session:
            records = session.scalars(select(Investigation).order_by(Investigation.started_at)).all()
            assert [record.user_id for record in records] == [user_id, None]
        assert 'Python' in instructions[0] and '杭州' in instructions[0]
        assert 'Python' not in instructions[1] and '杭州' not in instructions[1]
    finally:
        limiter.reset()
        sync.dispose()
