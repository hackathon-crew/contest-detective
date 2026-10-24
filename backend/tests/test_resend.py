import httpx
import pytest
from pydantic import SecretStr

from contest_detective.common.exceptions import BizException
from contest_detective.server.notifications.ports import OutgoingMail


def test_resend_uses_the_api_and_reuses_the_delivery_key():
    from contest_detective.server.notifications.config import NotificationSettings
    from contest_detective.server.notifications.resend import ResendMailer
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={'id': 'provider-id'})
    settings = NotificationSettings(mail_enabled=True, resend_api_key=SecretStr('test-key'), mail_sender='Inkpaw <hello@example.com>')
    message = OutgoingMail(key='daily:owner:2026-10-25', sender=settings.mail_sender, recipient='reader@example.com', subject='新比赛', html='<p>比赛</p>', text='比赛')
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        mailer = ResendMailer(settings, client=client)
        assert mailer.send(message).provider_id == 'provider-id'
        mailer.send(message)
    assert requests[0].url == 'https://api.resend.com/emails'
    assert requests[0].headers['authorization'] == 'Bearer test-key'
    assert requests[0].headers['idempotency-key'] == requests[1].headers['idempotency-key'] == message.key
    assert b'"to":["reader@example.com"]' in requests[0].content
    assert '<style>' in __import__('json').loads(requests[0].content)['html']


def test_resend_disabled_never_calls_the_network():
    from contest_detective.server.notifications.config import NotificationSettings
    from contest_detective.server.notifications.resend import ResendMailer
    with httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail('mail was disabled'))) as client:
        with pytest.raises(BizException):
            ResendMailer(NotificationSettings(), client=client).send(OutgoingMail(key='test', sender='x', recipient='y', subject='s', html='h', text='t'))
