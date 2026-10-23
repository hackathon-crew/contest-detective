"""本地联调：uv run uvicorn --app-dir tests serve_fake:create_fake_app --factory --port 8000。

仅使用官方本地函数模型，查库和事件存储仍走真实服务；此入口不读取或构造任何模型供应商。
"""
from datetime import datetime, timedelta, timezone

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.framework.db import SessionLocal
from contest_detective.server.agent.loop import Investigator
from contest_detective.web.api.agent import get_investigator
from contest_detective.web.bootstrap.app import create_app


TZ = timezone(timedelta(hours=8))
NAMES = {'registration_deadline': '报名截止', 'submission_deadline': '作品提交截止',
         'deadline_unspecified': '截止（未注明类型）', 'start_at': '开赛时间', 'end_at': '结束时间'}


def respond(messages, info):
    question = next((part.content for message in messages for part in message.parts if isinstance(part, UserPromptPart)), '')
    results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
    if not results:
        args = {}
        if '线上' in question:
            args['mode'] = 'online'
        if '周末' in question:
            today = datetime.now(TZ)
            saturday = (today + timedelta(days=(5 - today.weekday()))).replace(hour=0, minute=0, second=0, microsecond=0)
            args.update(date_from=saturday.isoformat(), date_to=(saturday + timedelta(days=2, seconds=-1)).isoformat())
        return ModelResponse([ToolCallPart('search_contests', args, tool_call_id='list')])
    result = results[-1]
    if result.tool_name == 'search_contests':
        items = result.content['items']
        if not items:
            return ModelResponse([TextPart('比赛库中暂未找到符合条件的赛事。')])
        return ModelResponse([ToolCallPart('get_contest', {'contest_id': items[0]['id']}, tool_call_id='detail')])
    detail = result.content.get('contest')
    if not detail:
        return ModelResponse([TextPart('比赛资料未找到。')])
    lines = [detail['name']]
    for field, label in NAMES.items():
        value = detail['fields'].get(field, {})
        if value.get('value') and value.get('sources'):
            source = value['sources'][0]
            moment = datetime.fromisoformat(value['value'].replace('Z', '+00:00')).astimezone(TZ)
            lines.append(f"{label}：[{moment.strftime('%Y-%m-%d %H:%M')}（北京时间）]({source['url']})")
    if not detail['fields'].get('registration_deadline', {}).get('value'):
        lines.append('报名截止未找到，作品提交截止不能当作报名截止。')
    return ModelResponse([TextPart('\n\n'.join(lines))])


def create_fake_app(*, db_engine=None, session_factory=SessionLocal):
    app = create_app(db_engine=db_engine)
    app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=session_factory)
    return app
