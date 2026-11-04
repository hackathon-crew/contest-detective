"""本地联调：uv run uvicorn --app-dir tests serve_fake:create_fake_app --factory --port 8000。

仅使用官方本地函数模型，查库和事件存储仍走真实服务；此入口不读取或构造任何模型供应商。
"""
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request

from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part

from contest_detective.framework.db import SessionLocal, get_session
from contest_detective.agent.loop import Investigator
from contest_detective.system.user import service as users
from contest_detective.bootstrap.api.agent import get_investigator, get_ask_request
from contest_detective.bootstrap.api.guest import get_guest_investigator
from contest_detective.agent.schemas import AskRequest
from contest_detective.bootstrap.app import create_app


TZ = timezone(timedelta(hours=8))
NAMES = {'registration_deadline': '报名截止', 'submission_deadline': '作品提交截止',
         'deadline_unspecified': '截止（未注明类型）', 'start_at': '开赛时间', 'end_at': '结束时间'}


def respond(messages, info):
    question = next((part.content for message in reversed(messages) for part in message.parts if isinstance(part, UserPromptPart)), '')
    results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
    if not results and question.strip() in {'你好', '谢谢'}:
        return ModelResponse([answer_part('你好。想查哪场比赛，写在下面。')])
    if not results:
        args = {'keyword': 'Rust'} if 'Rust' in info.instructions else {}
        if '水下摄影' in question:
            args['keyword'] = '水下摄影'
        if '线上' in question:
            args['mode'] = 'online'
        if '周末' in question:
            today = datetime.now(TZ)
            saturday = (today + timedelta(days=(5 - today.weekday()))).replace(hour=0, minute=0, second=0, microsecond=0)
            args.update(date_from=saturday.isoformat(), date_to=(saturday + timedelta(days=2, seconds=-1)).isoformat())
        return ModelResponse([ToolCallPart('search_contests', args, tool_call_id='list')])
    result = results[-1]
    search = next(part for part in results if part.tool_name == 'search_contests')
    items = search.content['items']
    if not items:
        return ModelResponse([answer_part('比赛库中暂未找到符合条件的赛事。')])
    wanted = items[:5 if '多场' in question else 1]
    details = [part.content['contest'] for part in results if part.tool_name == 'get_contest' and part.content.get('contest')]
    if len(details) < len(wanted):
        return ModelResponse([ToolCallPart('get_contest', {'contest_id': wanted[len(details)]['id']}, tool_call_id=f'detail-{len(details)}')])
    lines, choices = [], []
    for detail in details:
        lines.append(detail['name'])
        for field, label in NAMES.items():
            value = detail['fields'].get(field, {})
            if value.get('value') and value.get('sources'):
                source = value['sources'][0]
                # display_value 保留真实工具给出的 day/datetime 精度。
                lines.append(f"{label}：[{value['display_value']}]({source['url']})")
        if not detail['fields'].get('registration_deadline', {}).get('value'):
            lines.append('报名截止未找到，作品提交截止不能当作报名截止。')
        choices.append({'contest_id': detail['id'], 'introduction': '', 'reason': '来自本次读取的比赛资料。'})
    return ModelResponse([answer_part('\n\n'.join(lines), choices)])


def create_fake_app(*, db_engine=None, session_factory=SessionLocal):
    app = create_app(db_engine=db_engine)
    def session_override():
        with session_factory() as session:
            yield session
    app.dependency_overrides[get_session] = session_override
    def profile_reader(user_id):
        with session_factory() as session:
            user = users.get(session, user_id)
            return user.profile.model_dump(mode='json') if user else None
    app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=session_factory, profile_reader=profile_reader)
    def guest_investigator(request: Request, body: AskRequest = Depends(get_ask_request)):
        if request.app.state.guest_investigations.has(str(body.investigation_id)):
            return None
        return Investigator(FunctionModel(respond), session_factory=session_factory, profile_reader=profile_reader)
    app.dependency_overrides[get_guest_investigator] = guest_investigator
    return app
