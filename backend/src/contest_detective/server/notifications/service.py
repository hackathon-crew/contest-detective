from datetime import datetime, time, timedelta, timezone
from hashlib import sha256
from html import escape
import json
from zoneinfo import ZoneInfo

from sqlalchemy import select, text

from contest_detective.common.exceptions import BizException
from contest_detective.server.user.models import User
from contest_detective.server.user.schemas import Profile
from contest_detective.server.user.matching import match
from contest_detective.server.contest import service as contests
from contest_detective.server.contest.models import Contest, ContestEvent
from contest_detective.server.contest.schemas import DEADLINE_FIELDS, calendar_date, date_bounds
from .config import get_account_runtime_settings
from contest_detective.server.account.models import AccountSettings, Follow, MailDelivery, Track
from contest_detective.server.account.schemas import MailPreview, PushSettings, TrackingConditions
from contest_detective.server.account.store import settings_for
from .tracking import matching_contests, deadline
from .models import PendingNotification, SeenNotification
from .ports import OutgoingMail
from .quota import mail_used

BEIJING = ZoneInfo('Asia/Shanghai')


def next_send(settings, now):
    if not settings.enabled or settings.frequency == 'instant':
        return None
    local = now.astimezone(BEIJING)
    at = datetime.combine(local.date(), time.fromisoformat(settings.time), BEIJING)
    if settings.frequency == 'weekly':
        at += timedelta(days=(settings.weekday-local.weekday()) % 7)
        if at <= local: at += timedelta(days=7)
    elif at <= local: at += timedelta(days=1)
    return at


def fingerprint(item):
    data = {field: {'value': item.fields[field].value, 'precision': item.fields[field].precision, 'level': item.fields[field].level} for field in (*DEADLINE_FIELDS, 'city', 'prize') if field in item.fields}
    for field in data:
        data[field]['alternatives'] = sorted({(source.value, source.precision) for source in item.fields[field].sources})
    return sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def picks(session, user, settings, row, now):
    chosen = {}
    local = now.astimezone(BEIJING)
    start = datetime.combine(local.date(), time(), BEIJING)
    if settings.frequency == 'weekly': start -= timedelta(days=local.weekday())
    new_ids = set(session.scalars(select(ContestEvent.contest_id).where(ContestEvent.kind == 'created', ContestEvent.occurred_at >= start.astimezone(timezone.utc), ContestEvent.occurred_at <= now)))
    followed = set(session.scalars(select(Follow.contest_id).where(Follow.user_id == user.id)))
    seen = set((row.push or {}).get('_seen_matches', []))
    if settings.new_matches:
        for found in match(session, Profile.model_validate(user.profile or {}), limit=None):
            if found.contest.id in new_ids and found.contest.id not in seen and found.contest.id not in followed:
                chosen[found.contest.id] = (found.contest, found.reason)
    tracks = []
    if settings.tracking:
        for track in session.scalars(select(Track).where(Track.user_id == user.id, Track.enabled.is_(True))):
            items = matching_contests(session, TrackingConditions.model_validate(track.conditions), now, user_id=user.id)
            fresh = [item for item in items if item.id in new_ids and item.id not in set(track.seen_contests or [])]
            tracks.append((track, fresh))
            for item in fresh:
                chosen.setdefault(item.id, (item, '符合追踪条件「'+track.text+'」'))
    return list(chosen.values()), tracks


def soon_follows(session, user, settings, now):
    if not settings.deadline_reminders: return []
    result = []
    today = now.astimezone(BEIJING).date()
    for follow in session.scalars(select(Follow).where(Follow.user_id == user.id, Follow.reminders.is_(True))):
        item = contests.get(session, follow.contest_id)
        if item is None or item.status == 'ended': continue
        due = deadline(item, now)
        if due and 0 <= (calendar_date(due[1].value, due[1].precision)-today).days <= 7:
            result.append((item, ''))
    return result


def _mail_item(item, reason, now, base):
    due = deadline(item, now)
    value = due[1] if due else None
    if value:
        day = calendar_date(value.value, value.precision)
        kind = {'registration_deadline':'报名截止','submission_deadline':'作品提交截止'}.get(due[0],'截止')
        due_text = f'{day.month}月{day.day}日{kind}'
    else: due_text = '没写截止时间'
    get = lambda field: item.fields[field].value if field in item.fields else None
    mode = {'online':'线上','offline':'线下','hybrid':'线上+线下'}.get(get('mode'))
    meta = ' · '.join(str(v) for v in (mode, get('city') if mode != '线上' else None, get('prize'), due_text) if v)
    url = base+'/contests/'+item.id
    image = '<img src="'+escape(item.cover_url, quote=True)+'" alt="">' if item.cover_url and item.cover_url.startswith('https://') else '<span class="m-cover"></span>'
    html = '<div class="m-item">'+image+'<div><b><a href="'+escape(url, quote=True)+'">'+escape(item.name)+'</a></b><p>'+escape(meta)+'</p>'+(('<div class="m-why"><span>'+escape(reason)+'</span></div>') if reason else '')+'</div></div>'
    return html, item.name+' · '+meta+'\n'+reason+'\n'+url


def render_mail(user, items, now, *, subject=None, intro=None, soon=None, period='weekly'):
    config = get_account_runtime_settings()
    base = config.public_base_url.rstrip('/')
    period_word = {'weekly':'本周','daily':'今天','instant':'新收录'}.get(period,'本周')
    subject = subject or f'{period_word} {len(items)} 场适合你的新比赛'
    intro = intro or f'按你的画像，从{ {"weekly":"这周","daily":"今天","instant":"刚刚"}.get(period,"这周")}新收录的比赛里挑了 {len(items)} 场。'
    if soon: intro += f'你关注的比赛里，有 {len(soon)} 场 7 天内截止。'
    plain, sections = [intro], []
    for title, entries in [('适合你的新比赛', items), ('你关注的，快截止了', soon or [])]:
        if not entries and title != '适合你的新比赛': continue
        body = []
        for item, reason in entries:
            html, text = _mail_item(item, reason, now, base)
            body.append(html); plain.append(text)
        sections.append('<div class="m-sec"><h4>'+title+'</h4>'+''.join(body)+'</div>')
    brand = '<div class="m-brand"><img class="px" src="'+escape(base, quote=True)+'/brand/inkpaw-mark-32.png" width="30" height="26" alt=""><span>Inkpaw</span></div>'
    foot = '<p class="m-foot">每场比赛的截止时间、地点和奖金，在赛事库里都附了原文链接。<br>这封邮件按你在 Inkpaw 的推送设置发出。<a href="'+escape(base, quote=True)+'/account/push">调整推送</a> · <a href="'+escape(base, quote=True)+'/account/push">不再接收</a></p>'
    html = brand+'<p class="m-hi">'+escape(intro)+'</p>'+''.join(sections)+foot
    return MailPreview(subject=subject, html=html, text='\n\n'.join(plain)+'\n\n推送设置：'+base+'/account/push', sender=config.mail_sender or 'Inkpaw', recipient=user.email)


def preview(session, user, now=None):
    now = now or datetime.now(timezone.utc)
    row = settings_for(session, user.id)
    settings = PushSettings.model_validate(row.push or {})
    items, _ = picks(session, user, settings, row, now)
    return render_mail(user, items, now, soon=soon_follows(session,user,settings,now), period=settings.frequency)


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def deliver(session, user, mailer, message, *, key, kind, now, sensitive=False):
    config = get_account_runtime_settings()
    session.commit()
    # SQLite 写锁只保护额度与投递认领，网络调用放在事务之外。
    session.execute(text('BEGIN IMMEDIATE'))
    row = session.scalar(select(MailDelivery).where(MailDelivery.user_id == user.id, MailDelivery.message_key == key))
    if row is not None:
        if row.status in {'sent', 'delivered', 'bounced'} or row.attempts >= 5 or now-_utc(row.created_at) >= timedelta(hours=23):
            session.rollback()
            return False
        if row.retry_at and now < _utc(row.retry_at):
            session.rollback()
            return False
        if row.status == 'sending' and now-_utc(row.created_at) < timedelta(minutes=2):
            session.rollback()
            return False
    else:
        daily, monthly = mail_used(session, now)
        if daily >= config.mail_daily_limit or monthly >= config.mail_monthly_limit:
            session.rollback()
            raise BizException('邮件免费额度已到上限，请稍后再试', code=429)
        values = message.model_dump()
        if sensitive:
            # 验证链接只用于这次投递，账本不能保留可用于改邮箱的凭据。
            values.update(html='验证链接不保存，请重新发起验证。', text='验证链接不保存，请重新发起验证。')
        row = MailDelivery(user_id=user.id, message_key=key, kind=kind, status='sending', attempts=0, created_at=now, **values)
        session.add(row)
    row.attempts += 1
    row.status = 'sending'
    row.retry_at = now+timedelta(minutes=2)
    session.commit()
    outgoing = OutgoingMail(key=str(user.id)+':'+row.message_key, sender=row.sender, recipient=row.recipient,
                            subject=row.subject, html=message.html if sensitive else row.html, text=message.text if sensitive else row.text)
    try:
        receipt = mailer.send(outgoing)
    except Exception as exc:
        row.status, row.error = 'failed', type(exc).__name__
        if sensitive:
            row.attempts = 5
        row.retry_at = now+timedelta(seconds=60*2**(row.attempts-1)) if row.attempts < 5 else None
        session.commit()
        if isinstance(exc, BizException): raise
        raise BizException('邮件发送失败，请稍后重试', code=503) from None
    row.status, row.sent_at, row.retry_at = 'sent', now, None
    row.provider_id = receipt.provider_id if receipt else None
    session.commit()
    return True


def _pending_items(session, user, settings, now):
    result, rows = [], []
    reasons = {found.contest.id: found.reason for found in match(session, Profile.model_validate(user.profile or {}), limit=None)} if settings.new_matches else {}
    for row in session.scalars(select(PendingNotification).where(PendingNotification.user_id == user.id).order_by(PendingNotification.event_id)):
        item = contests.get(session, row.contest_id)
        reason = None
        if row.reason == 'change':
            follow = session.get(Follow, (user.id, row.contest_id))
            if settings.changes and follow and follow.reminders:
                reason = '截止时间、地点、奖金或来源核实状态有变动'
        elif row.contest_id in reasons:
            reason = reasons[row.contest_id]
        if settings.tracking and reason is None and row.reason != 'change':
            for key in row.track_ids:
                track = session.get(Track, key)
                if track and track.user_id == user.id and track.enabled and any(found.id == row.contest_id for found in matching_contests(session, TrackingConditions.model_validate(track.conditions), now, user_id=user.id)):
                    reason = '符合追踪条件「'+track.text+'」'
                    break
        if item and item.status != 'ended' and reason:
            result.append((item, reason))
            rows.append(row)
        else:
            session.delete(row)
    session.commit()
    return result, rows


def dispatch_due(factory, mailer, now=None):
    from .consumer import consume_events
    now = now or datetime.now(timezone.utc)
    consume_events(factory, now)
    local = now.astimezone(BEIJING)
    count = 0
    with factory() as session:
        for user in session.scalars(select(User).where(User.is_active.is_(True), User.is_verified.is_(True))):
            row = session.get(AccountSettings, user.id)
            if row is None: continue
            settings = PushSettings.model_validate(row.push or {})
            if not settings.enabled: continue
            items, pending = _pending_items(session, user, settings, now)
            changes = [(item, queued) for item, queued in zip(items, pending) if queued.reason == 'change']
            for (item, reason), queued in changes:
                key = 'change:'+item.id+':'+fingerprint(item)
                try:
                    sent = deliver(session, user, mailer, render_mail(user, [(item, reason)], now,
                        subject=item.name+'的信息有变动', intro='你关注的比赛信息有变动。'), key=key, kind='change', now=now)
                except BizException:
                    sent = False
                accepted = session.scalar(select(MailDelivery).where(MailDelivery.user_id == user.id, MailDelivery.message_key == key))
                if accepted and accepted.status in {'sent', 'delivered'}:
                    session.delete(queued)
                    session.commit()
                count += int(sent)
            due = settings.frequency == 'instant' or ((settings.frequency == 'daily' or local.weekday() == settings.weekday) and local.time().replace(tzinfo=None) >= time.fromisoformat(settings.time))
            items, pending = [item for item, queued in zip(items, pending) if queued.reason != 'change'], [queued for queued in pending if queued.reason != 'change']
            if due and items:
                key = 'digest:'+local.date().isoformat()
                # 即时模式也受页面约定的一天最多一封限制。
                try:
                    sent = deliver(session, user, mailer, render_mail(user, items, now, soon=soon_follows(session,user,settings,now), period=settings.frequency), key=key, kind=settings.frequency, now=now)
                except BizException:
                    sent = False
                record = session.scalar(select(MailDelivery).where(MailDelivery.user_id == user.id, MailDelivery.message_key == key))
                included = {item.contest_id for item in pending if record and '/contests/'+item.contest_id in record.text}
                if record and record.status in {'sent', 'delivered'}:
                    for queued in pending:
                        if queued.contest_id not in included: continue
                        seen = session.get(SeenNotification, (user.id, queued.contest_id))
                        if seen is None:
                            seen = SeenNotification(user_id=user.id, contest_id=queued.contest_id, version=queued.version, sent_at=now)
                            session.add(seen)
                        else: seen.version, seen.sent_at = queued.version, now
                        for track_id in queued.track_ids:
                            track = session.get(Track, track_id)
                            if track and track.user_id == user.id:
                                track.last_sent_at = now
                                track.seen_contests = sorted(set(track.seen_contests or []) | {queued.contest_id})
                        session.delete(queued)
                    row.push = {**row.push, '_seen_matches': sorted(set(row.push.get('_seen_matches', [])) | included)}
                    session.commit()
                count += int(sent)
            for follow in session.scalars(select(Follow).where(Follow.user_id == user.id, Follow.reminders.is_(True))):
                if not settings.deadline_reminders: continue
                item = contests.get(session, follow.contest_id)
                if item is None: continue
                for field in DEADLINE_FIELDS:
                    value = item.fields.get(field)
                    if value is None or not value.value or date_bounds(value.value, value.precision)[1] < now: continue
                    for days in set(settings.reminder_days):
                        day = calendar_date(value.value, value.precision)-timedelta(days=days)
                        at = datetime.combine(day, time(8), BEIJING) if value.precision == 'day' else datetime.fromisoformat(value.value).astimezone(BEIJING)-timedelta(days=days)
                        if local.date() != at.date() or local < at: continue
                        try:
                            message = render_mail(user, [(item, '')], now, subject=f'{item.name}还有 {days} 天截止', intro=f'你关注的比赛离截止还有 {days} 天。')
                            key = f'reminder:{item.id}:{field}:{value.value}:{days}'
                            count += int(deliver(session, user, mailer, message, key=key, kind='reminder', now=now))
                        except BizException: pass
    return count


def start_account_scheduler(factory):
    config = get_account_runtime_settings()
    if not config.mail_enabled or not config.resend_api_key.get_secret_value() or not config.mail_sender:
        return None
    from apscheduler.schedulers.background import BackgroundScheduler
    from .resend import ResendMailer
    scheduler = BackgroundScheduler(timezone=BEIJING)
    scheduler.add_job(lambda: dispatch_due(factory, ResendMailer(config)), 'interval', seconds=60,
        id='account-mail', next_run_time=datetime.now(timezone.utc), max_instances=1, coalesce=True)
    scheduler.start()
    return scheduler
