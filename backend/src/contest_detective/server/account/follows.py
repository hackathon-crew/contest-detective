from datetime import datetime, timedelta, timezone
import secrets
from zoneinfo import ZoneInfo

from sqlalchemy import select

from contest_detective.common.exceptions import BizException
from contest_detective.server.contest import service as contests
from contest_detective.server.contest.models import ContestEvent
from contest_detective.server.contest.schemas import DEADLINE_FIELDS, calendar_date
from contest_detective.server.notifications.config import get_account_runtime_settings
from contest_detective.server.notifications.service import fingerprint
from contest_detective.server.notifications.tracking import deadline
from .models import Follow
from .store import settings_for


def followed(session, user_id):
    result = []
    for row in session.scalars(select(Follow).where(Follow.user_id == user_id).order_by(Follow.created_at, Follow.contest_id)):
        item = contests.get(session, row.contest_id)
        if item is not None: result.append((row, item))
    return result


def active_count(session, user_id):
    now = datetime.now(timezone.utc)
    today = now.astimezone(ZoneInfo('Asia/Shanghai')).date()
    return sum(item.status != 'ended' and (due is None or calendar_date(due[1].value, due[1].precision) >= today)
               for _, item in followed(session, user_id) for due in [deadline(item, now)])


def add_follow(session, user_id, contest_id, reminders=None):
    item = contests.get(session, contest_id)
    if item is None: raise BizException('比赛不存在', code=404)
    row = session.get(Follow, (user_id, contest_id))
    if row is None:
        row = Follow(user_id=user_id, contest_id=contest_id, reminders=True if reminders is None else reminders, last_fingerprint=fingerprint(item))
        session.add(row)
    elif reminders is not None:
        row.reminders = reminders
    return row, item


def calendar_url(session, user_id):
    row = settings_for(session, user_id)
    if not row.calendar_secret:
        row.calendar_secret = secrets.token_urlsafe(32)
        session.commit()
    base = get_account_runtime_settings().public_base_url.rstrip('/')
    return base.replace('https://', 'webcal://', 1).replace('http://', 'webcal://', 1)+'/api/calendar/'+row.calendar_secret+'.ics'


def _escape(value):
    return str(value).replace('\\', '\\\\').replace('\r', '').replace('\n', '\\n').replace(';', '\\;').replace(',', '\\,')


def _fold(line):
    chunks, current = [], ''
    for char in line:
        if len((current+char).encode()) > 75:
            chunks.append(current)
            current = ' '
        current += char
    return '\r\n'.join([*chunks, current])


def calendar_feed(session, user_id):
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Inkpaw//Account Calendar//ZH',
             'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:关注的比赛', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H']
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    labels = {'registration_deadline':'报名截止','submission_deadline':'作品提交截止','deadline_unspecified':'截止'}
    base = get_account_runtime_settings().public_base_url.rstrip('/')
    for row, item in followed(session, user_id):
        event_id = session.scalar(select(ContestEvent.id).where(ContestEvent.contest_id == item.id).order_by(ContestEvent.id.desc()).limit(1)) or 0
        for field in DEADLINE_FIELDS:
            value = item.fields.get(field)
            if value is None or not value.value: continue
            lines += ['BEGIN:VEVENT', 'UID:'+item.id+'-'+field+'@inkpaw', 'DTSTAMP:'+stamp, 'SEQUENCE:'+str(event_id),
                      'SUMMARY:'+_escape(item.name+' · '+labels[field]), 'URL:'+_escape(base+'/contests/'+item.id)]
            if value.sources:
                lines.append('DESCRIPTION:'+_escape('原文：'+value.sources[0].url))
            if value.precision == 'day':
                day = calendar_date(value.value, 'day')
                lines += ['DTSTART;VALUE=DATE:'+day.strftime('%Y%m%d'), 'DTEND;VALUE=DATE:'+(day+timedelta(days=1)).strftime('%Y%m%d')]
            else:
                lines.append('DTSTART:'+datetime.fromisoformat(value.value).astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
            lines.append('END:VEVENT')
    return '\r\n'.join(_fold(line) for line in [*lines, 'END:VCALENDAR'])+'\r\n'
