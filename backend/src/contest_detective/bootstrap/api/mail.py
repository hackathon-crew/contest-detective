"""邮件发送依赖。测试覆盖这一处即可替换所有发信入口。"""

from contest_detective.system.notifications.resend import ResendMailer


def get_mailer():
    return ResendMailer()
