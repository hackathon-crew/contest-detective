import base64
import hashlib
import hmac
import json
import time

import httpx

from contest_detective.framework.exceptions import BizException
from .config import get_account_runtime_settings
from .ports import DeliveryReceipt


def email_document(fragment):
    styles = ('body{font:400 16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#303030;'
              'max-width:552px;margin:0 auto;padding:24px;background:#fff}*{box-sizing:border-box}p,h4{margin:0}'
              'a{color:#3f5fd6;text-decoration:none}.m-brand{display:flex;align-items:center;gap:8px;color:#111}'
              '.m-brand span{font-weight:700;font-size:20px;line-height:1}.m-hi{margin-top:16px;font-size:15px;line-height:1.75}'
              '.m-sec{margin-top:24px}.m-sec h4{margin-bottom:4px;font-size:14px;font-weight:600;color:#111}'
              '.m-item{display:flex;gap:14px;padding:14px 0;border-top:1px solid #e3e3e3}'
              '.m-item img,.m-cover{display:block;width:80px;height:60px;object-fit:cover;border-radius:8px}'
              '.m-item b{font-size:15px;font-weight:600}.m-item p{margin-top:3px;font-size:13px;color:#6c6c6c}'
              '.m-why{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;font-size:12px;color:#6c6c6c}'
              '.m-foot{margin-top:24px;padding-top:16px;border-top:1px solid #e3e3e3;font-size:12px;line-height:1.8;color:#6c6c6c}')
    return '<!doctype html><html><head><meta charset="utf-8"><style>'+styles+'</style></head><body>'+fragment+'</body></html>'


class ResendMailer:
    def __init__(self, settings=None, *, client=None):
        self.settings = settings or get_account_runtime_settings()
        self.client = client

    def send(self, message):
        config = self.settings
        if not config.mail_enabled or not config.resend_api_key.get_secret_value() or not config.mail_sender:
            raise BizException('邮件服务还没有配置', code=503)
        values = dict(from_=message.sender, to=[message.recipient], subject=message.subject,
                      html=email_document(message.html), text=message.text)
        values['from'] = values.pop('from_')
        headers = {'Authorization': 'Bearer '+config.resend_api_key.get_secret_value(), 'Idempotency-Key': message.key}
        try:
            if self.client is None:
                with httpx.Client(timeout=20) as client:
                    response = client.post('https://api.resend.com/emails', headers=headers, json=values)
            else:
                response = self.client.post('https://api.resend.com/emails', headers=headers, json=values)
            if response.status_code == 429:
                raise BizException('邮件服务额度已到上限，请稍后再试', code=429)
            response.raise_for_status()
            return DeliveryReceipt(provider_id=response.json()['id'])
        except (httpx.HTTPError, KeyError, ValueError):
            raise BizException('邮件发送失败，请稍后重试', code=503) from None


def verify_webhook(body, headers, secret, now=None):
    # Svix 签名覆盖原始字节，不能先解析再序列化 JSON。
    try:
        stamp = headers['svix-timestamp']
        if abs((time.time() if now is None else now)-int(stamp)) > 300:
            raise ValueError('expired')
        key = base64.b64decode(secret.removeprefix('whsec_'), validate=True)
        signed = (headers['svix-id']+'.'+stamp+'.').encode()+body
        expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
        valid = any(hmac.compare_digest(expected, value[3:]) for value in headers['svix-signature'].split() if value.startswith('v1,'))
        if not valid: raise ValueError('signature')
        return json.loads(body)
    except (KeyError, ValueError, TypeError):
        raise BizException('邮件回执签名无效', code=400) from None
