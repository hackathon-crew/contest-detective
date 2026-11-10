import { PressedToggle } from '@/shared/ui/pressed-toggle'
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate, type Location } from 'react-router'
import { currentUserKey, useCurrentUser, type PublicUser } from '@/entities/user'
import { ApiError, apiClient } from '@/shared/api'
import inkpawMark from '@/shared/assets/inkpaw-mark-56.webp'
import { Button, Input } from '@huyanxius/ui'
import { translateSystemText } from '@/shared/i18n'
import { useLocale } from '@/shared/i18n/locale-context'
import './auth-tokens.css'
import './auth-page.css'

type Mode = 'login' | 'register'

const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((module) => ({ default: module.Octopus })),
)

export function AuthPage({ mode, utilities }: { mode: Mode; utilities?: ReactNode }) {
  const { locale, t } = useLocale()
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { data: user } = useCurrentUser()
  const registration = mode === 'register'
  const [step, setStep] = useState<'invite' | 'email' | 'password'>(
    registration ? 'invite' : 'email',
  )
  const [inviteCode, setInviteCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ message: string; created?: boolean } | null>(null)
  const [accountCreated, setAccountCreated] = useState(false)
  const lock = useRef(false)
  const active = useRef(true)
  const previous = location.state?.returnTo as Location | undefined
  const returnTo =
    previous && !/^\/(login|register)\/?$/.test(previous.pathname) ? previous : undefined
  const destination = returnTo
    ? { pathname: returnTo.pathname, search: returnTo.search, hash: returnTo.hash }
    : '/'

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  function back() {
    if (lock.current || sendingCode) return
    if (step === 'email' && registration) {
      setError(null)
      setStep('invite')
      return
    }
    if (step !== 'password') {
      const protectedPage = /^\/account(?:\/|$)/.test(returnTo?.pathname ?? '')
      const state = returnTo?.state
      // 取消登录保留草稿，但不能重开需要登录的画像窗口，否则会再次跳回登录页。
      navigate(protectedPage ? '/' : destination, {
        replace: true,
        state:
          !protectedPage && state
            ? {
                ...state,
                personalIntent: {
                  ...state.personalIntent,
                  profileSection: undefined,
                  resumeProfileQuestion: undefined,
                  saveGuestConversation: undefined,
                },
              }
            : undefined,
      })
      return
    }
    setStep('email')
    setPassword('')
    setCode('')
    setResendIn(0)
    setPasswordVisible(false)
    setError(null)
    setAccountCreated(false)
  }

  async function sendCode(target = email.trim()) {
    if (sendingCode) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target) || target.length > 320) {
      setError({ message: '请输入有效的邮箱地址。' })
      return
    }
    setSendingCode(true)
    setError(null)
    try {
      await apiClient.request('/auth/register/code', {
        method: 'POST',
        json: { email: target, invite_code: inviteCode },
      })
      if (!active.current) return
      setEmail(target)
      setStep('password')
      setResendIn(60)
    } catch (cause) {
      if (active.current) {
        if (cause instanceof ApiError && cause.code === 403) setStep('invite')
        setError({ message: cause instanceof Error ? cause.message : '验证码发送失败，请重试。' })
      }
    } finally {
      if (active.current) setSendingCode(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current) return
    if (step === 'invite') {
      const enteredCode = inviteCode.trim().toUpperCase()
      if (!enteredCode) {
        setError({ message: '请输入邀请码。' })
        return
      }
      lock.current = true
      setPending(true)
      setError(null)
      try {
        await apiClient.request('/auth/register/invite', {
          method: 'POST',
          json: { invite_code: enteredCode },
        })
        if (!active.current) return
        setInviteCode(enteredCode)
        setStep('email')
      } catch (cause) {
        if (active.current)
          setError({ message: cause instanceof Error ? cause.message : '未能验证邀请码。' })
      } finally {
        lock.current = false
        if (active.current) setPending(false)
      }
      return
    }
    const normalizedEmail = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail) || normalizedEmail.length > 320) {
      setError({ message: '请输入有效的邮箱地址。' })
      return
    }
    if (step === 'email') {
      setEmail(normalizedEmail)
      setError(null)
      if (registration) {
        await sendCode(normalizedEmail)
        return
      }
      setStep('password')
      return
    }
    if (password.length < (registration ? 8 : 1) || password.length > 128) {
      setError({
        message: registration ? '密码需要 8–128 个字符。' : '请输入 1–128 个字符的密码。',
      })
      return
    }
    if (registration && !accountCreated && !/^\d{6}$/.test(code)) {
      setError({ message: '请输入 6 位验证码。' })
      return
    }
    lock.current = true
    setPending(true)
    setError(null)
    let created = accountCreated
    try {
      const credentials = { email: normalizedEmail, password }
      if (registration && !created) {
        await apiClient.request('/auth/register', {
          method: 'POST',
          json: { ...credentials, code, invite_code: inviteCode },
        })
        created = true
        if (active.current) setAccountCreated(true)
      }
      const current = await apiClient.request<PublicUser>('/auth/login', {
        method: 'POST',
        json: credentials,
      })
      await client.cancelQueries({ queryKey: currentUserKey })
      if (active.current) setPassword('')
      client.setQueryData(currentUserKey, current)
    } catch (cause) {
      if (active.current) {
        if (registration && !created && cause instanceof ApiError && cause.code === 403) {
          setStep('invite')
          setPassword('')
          setCode('')
        }
        const message = cause instanceof Error ? cause.message : '账户请求失败，请重试。'
        setError({ message, created })
      }
    } finally {
      lock.current = false
      if (active.current) setPending(false)
    }
  }

  if (user) return <Navigate to={destination} state={returnTo?.state} replace />

  const stepIndex = step === 'invite' ? 0 : step === 'email' ? 1 : 2
  const progress = t('第 {step} 步，共 3 步', { step: stepIndex + 1 })
  const errorMessage = error ? translateSystemText(locale, error.message) : ''
  return (
    <main className="auth-stage" aria-labelledby="auth-title">
      <Button
        className="auth-stage__back"
        variant="outline"
        size="icon"
        type="button"
        aria-label={
          step === 'password'
            ? t('返回邮箱')
            : step === 'email' && registration
              ? t('返回邀请码')
              : t('返回原页面')
        }
        onClick={back}
        disabled={pending || sendingCode}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      {utilities && <div className="auth-stage__appearance">{utilities}</div>}
      <div className="auth-stage__mascot" aria-hidden="true">
        <Suspense fallback={<img src={inkpawMark} alt="" width={106} height={93} />}>
          <Octopus size={120} mood={step === 'password' ? 'read' : 'happy'} shadow={false} />
        </Suspense>
      </div>
      <div key={step} className="auth-stage__content">
        <h1 id="auth-title">
          {step !== 'password' ? (
            <>
              {registration ? t('注册 ') : t('登录 ')}
              <span className="auth-stage__wordmark">Inkpaw</span>
            </>
          ) : registration ? (
            t('创建密码')
          ) : (
            t('输入密码')
          )}
        </h1>
        {registration && (
          <>
            <ol className="auth-stage__steps" aria-label={progress}>
              {[0, 1, 2].map((index) => (
                <li key={index} data-current={index === stepIndex} data-done={index < stepIndex} />
              ))}
            </ol>
            <span className="auth-stage__step-label">{progress}</span>
          </>
        )}
        {step === 'password' && <p className="auth-stage__email">{email}</p>}
        <form
          className="auth-stage__form"
          aria-label={registration ? t('创建 Inkpaw 账号') : t('登录到 Inkpaw')}
          aria-busy={pending || sendingCode}
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          {step === 'invite' ? (
            <>
              <Input
                className="auth-stage__input"
                aria-label={t('邀请码')}
                aria-describedby="invite-help"
                name="invite_code"
                placeholder={t('邀请码')}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={32}
                required
                autoFocus
                disabled={pending}
                value={inviteCode}
                onChange={(event) => {
                  setInviteCode(event.target.value)
                  setError(null)
                }}
              />
              <small id="invite-help">{t('内测中，填写邀请码后对话不限量')}</small>
            </>
          ) : step === 'email' ? (
            <Input
              key="email"
              className="auth-stage__input"
              aria-label={t('邮箱')}
              name="email"
              type="email"
              placeholder={t('邮箱地址')}
              autoComplete="email"
              maxLength={320}
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          ) : (
            <>
              <input type="hidden" name="email" autoComplete="username" value={email} />
              {registration && !accountCreated && (
                <div className="auth-stage__code">
                  <Input
                    key="code"
                    className="auth-stage__input"
                    aria-label={t('验证码')}
                    name="code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t('6 位验证码')}
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    disabled={pending}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  <Button
                    className="auth-stage__resend"
                    variant="ghost"
                    type="button"
                    disabled={pending || sendingCode || resendIn > 0}
                    onClick={() => void sendCode()}
                  >
                    {resendIn > 0
                      ? t('{seconds} 秒后重发', { seconds: resendIn })
                      : sendingCode
                        ? t('正在发送…')
                        : t('重新发送')}
                  </Button>
                </div>
              )}
              <div className="auth-stage__password">
                <Input
                  key="password"
                  className="auth-stage__input"
                  aria-label={t('密码')}
                  name="password"
                  type={passwordVisible ? 'text' : 'password'}
                  placeholder={registration ? t('创建密码') : t('密码')}
                  autoComplete={registration ? 'new-password' : 'current-password'}
                  minLength={registration ? 8 : 1}
                  maxLength={128}
                  required
                  autoFocus={!registration}
                  disabled={pending}
                  value={password}
                  aria-describedby={registration ? 'password-help' : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <PressedToggle pressed={passwordVisible}>
                  <Button
                    className="auth-stage__password-toggle"
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={passwordVisible ? t('隐藏密码') : t('显示密码')}
                    disabled={pending}
                    onClick={() => setPasswordVisible((value) => !value)}
                  >
                    {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </Button>
                </PressedToggle>
              </div>
              {registration && <small id="password-help">{t('8–128 个字符。')}</small>}
            </>
          )}
          {error && (
            <p className="auth-stage__error" role="alert">
              {error.created ? t('账号已创建。{message}', { message: errorMessage }) : errorMessage}
            </p>
          )}
          <Button className="auth-stage__primary" type="submit" disabled={pending || sendingCode}>
            {step === 'invite'
              ? pending
                ? t('正在验证邀请码…')
                : t('继续')
              : step === 'email'
                ? sendingCode
                  ? t('正在发送验证码…')
                  : t('继续')
                : pending
                  ? registration && !accountCreated
                    ? t('正在创建…')
                    : t('正在登录…')
                  : registration && !accountCreated
                    ? t('创建账号')
                    : t('登录并继续')}
          </Button>
        </form>
      </div>
      <footer className="auth-stage__footer">
        <span>
          {registration ? t('已有账号？') : t('还没有账号？')}{' '}
          <Link
            to={registration ? '/login' : '/register'}
            state={location.state}
            aria-disabled={pending || sendingCode}
            onClick={(event) => {
              if (lock.current) event.preventDefault()
            }}
          >
            {registration ? t('返回登录') : t('创建账号')}
          </Link>
        </span>
        <Link
          className="auth-stage__home"
          to="/"
          aria-disabled={pending || sendingCode}
          onClick={(event) => {
            if (lock.current) event.preventDefault()
          }}
        >
          <img src={inkpawMark} alt="" width={24} height={21} />
          {t('Inkpaw 首页')}
        </Link>
      </footer>
    </main>
  )
}
