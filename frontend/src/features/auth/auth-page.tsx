import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate, type Location } from 'react-router'
import { currentUserKey, useCurrentUser, type PublicUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import inkpawMark from '@/shared/assets/inkpaw-mark-56.webp'
import { Button, Input } from '@/shared/ui'
import './auth-tokens.css'
import './auth-page.css'

type Mode = 'login' | 'register'

const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((module) => ({ default: module.Octopus })),
)

export function AuthPage({ mode, utilities }: { mode: Mode; utilities?: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { data: user } = useCurrentUser()
  const [step, setStep] = useState<'email' | 'password'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountCreated, setAccountCreated] = useState(false)
  const lock = useRef(false)
  const active = useRef(true)
  const previous = location.state?.returnTo as Location | undefined
  const returnTo =
    previous && !/^\/(login|register)\/?$/.test(previous.pathname) ? previous : undefined
  const destination = returnTo
    ? { pathname: returnTo.pathname, search: returnTo.search, hash: returnTo.hash }
    : '/'
  const registration = mode === 'register'

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
    if (step === 'email') {
      navigate(destination, { replace: true, state: returnTo?.state })
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
      setError('请输入有效的邮箱地址。')
      return
    }
    setSendingCode(true)
    setError(null)
    try {
      await apiClient.request('/auth/register/code', {
        method: 'POST',
        json: { email: target },
      })
      if (!active.current) return
      setEmail(target)
      setStep('password')
      setResendIn(60)
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : '验证码发送失败，请重试。')
      }
    } finally {
      if (active.current) setSendingCode(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current) return
    const normalizedEmail = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail) || normalizedEmail.length > 320) {
      setError('请输入有效的邮箱地址。')
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
      setError(registration ? '密码需要 8–128 个字符。' : '请输入 1–128 个字符的密码。')
      return
    }
    if (registration && !accountCreated && !/^\d{6}$/.test(code)) {
      setError('请输入 6 位验证码。')
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
          json: { ...credentials, code },
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
        const message = cause instanceof Error ? cause.message : '账户请求失败，请重试。'
        setError(created ? `账号已创建。${message}` : message)
      }
    } finally {
      lock.current = false
      if (active.current) setPending(false)
    }
  }

  if (user) return <Navigate to={destination} state={returnTo?.state} replace />

  return (
    <main className="auth-stage" aria-labelledby="auth-title">
      <Button
        className="auth-stage__back"
        variant="outline"
        size="icon"
        type="button"
        aria-label={step === 'email' ? '返回原页面' : '返回邮箱'}
        onClick={back}
        disabled={pending || sendingCode}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      {utilities && <div className="auth-stage__appearance">{utilities}</div>}
      <div className="auth-stage__mascot" aria-hidden="true">
        <Suspense fallback={<img src={inkpawMark} alt="" width={106} height={93} />}>
          <Octopus size={120} mood={step === 'email' ? 'happy' : 'read'} shadow={false} />
        </Suspense>
      </div>
      <div key={step} className="auth-stage__content">
        <h1 id="auth-title">
          {step === 'email' ? (
            <>
              {registration ? '注册 ' : '登录 '}
              <span className="auth-stage__wordmark">Inkpaw</span>
            </>
          ) : registration ? (
            '创建密码'
          ) : (
            '输入密码'
          )}
        </h1>
        {registration && (
          <>
            <ol
              className="auth-stage__steps"
              aria-label={`第 ${step === 'email' ? 1 : 2} 步，共 2 步`}
            >
              <li data-current={step === 'email'} data-done={step === 'password'} />
              <li data-current={step === 'password'} />
            </ol>
            <span className="auth-stage__step-label">
              第 {step === 'email' ? 1 : 2} 步，共 2 步
            </span>
          </>
        )}
        {step === 'password' && <p className="auth-stage__email">{email}</p>}
        <form
          className="auth-stage__form"
          aria-label={registration ? '创建 Inkpaw 账号' : '登录到 Inkpaw'}
          aria-busy={pending || sendingCode}
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          {step === 'email' ? (
            <Input
              key="email"
              className="auth-stage__input"
              aria-label="邮箱"
              name="email"
              type="email"
              placeholder="邮箱地址"
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
                    aria-label="验证码"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="6 位验证码"
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
                    {resendIn > 0 ? `${resendIn} 秒后重发` : sendingCode ? '正在发送…' : '重新发送'}
                  </Button>
                </div>
              )}
              <div className="auth-stage__password">
                <Input
                  key="password"
                  className="auth-stage__input"
                  aria-label="密码"
                  name="password"
                  type={passwordVisible ? 'text' : 'password'}
                  placeholder={registration ? '创建密码' : '密码'}
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
                <Button
                  className="auth-stage__password-toggle"
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                  aria-pressed={passwordVisible}
                  disabled={pending}
                  onClick={() => setPasswordVisible((value) => !value)}
                >
                  {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
              </div>
              {registration && <small id="password-help">8–128 个字符。</small>}
            </>
          )}
          {error && (
            <p className="auth-stage__error" role="alert">
              {error}
            </p>
          )}
          <Button className="auth-stage__primary" type="submit" disabled={pending || sendingCode}>
            {step === 'email'
              ? sendingCode
                ? '正在发送验证码…'
                : '继续'
              : pending
                ? registration && !accountCreated
                  ? '正在创建…'
                  : '正在登录…'
                : registration && !accountCreated
                  ? '创建账号'
                  : '登录并继续'}
          </Button>
        </form>
      </div>
      <footer className="auth-stage__footer">
        <span>
          {registration ? '已有账号？' : '还没有账号？'}{' '}
          <Link
            to={registration ? '/login' : '/register'}
            state={location.state}
            aria-disabled={pending || sendingCode}
            onClick={(event) => {
              if (lock.current) event.preventDefault()
            }}
          >
            {registration ? '返回登录' : '创建账号'}
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
          Inkpaw 首页
        </Link>
      </footer>
    </main>
  )
}
