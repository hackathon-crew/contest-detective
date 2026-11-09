import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import type {
  ProviderInput,
  ProvidersRead,
  SearchPreferences,
  TokenCreated,
  TokenMetadata,
} from '@/shared/api/generated'
import {
  copy,
  Expand,
  failure,
  Ic,
  Row,
  SecretField,
  Segments,
  Switch,
  Tags,
  useNotice,
} from './components'
import { translateSystemText, type Locale } from '@/shared/i18n'
import { useLocale } from '@/shared/i18n/locale-context'

const defaults: SearchPreferences = { scope: 'all', exclude_ended: true, blocked_domains: [] }
const providers = [
  {
    id: 'yuanbao',
    name: '元宝搜索',
    icon: 'search',
    description: '腾讯云的中文搜索，国内比赛和公众号文章主要靠它',
    fields: [
      ['yuanbao_secret_id', 'SecretId', 'AKID…'],
      ['yuanbao_secret_key', 'SecretKey', ''],
    ],
  },
  {
    id: 'tavily',
    name: 'Tavily',
    icon: 'globe',
    description: '英文搜索，补 Devpost、ETHGlobal 这类海外比赛',
    fields: [['tavily_api_key', 'API Key', 'tvly-…']],
  },
] as const
const day = (value: string, locale: Locale) =>
  new Date(value).toLocaleDateString(locale, {
    month: locale === 'en' ? 'short' : 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  })
export function KeysPanel() {
  const { locale, t } = useLocale()
  const { data: user } = useCurrentUser(),
    client = useQueryClient(),
    notice = useNotice(),
    location = useLocation()
  const providerKey = ['account-providers', user?.id],
    tokenKey = ['account-token', user?.id],
    searchKey = ['account-search', user?.id]
  const saved = useQuery({
    queryKey: providerKey,
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<ProvidersRead>('/account/providers', { signal }),
  })
  const token = useQuery({
    queryKey: tokenKey,
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<TokenMetadata | null>('/account/token', { signal }),
  })
  const search = useQuery({
    queryKey: searchKey,
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<SearchPreferences>('/account/search', { signal }),
  })
  const quota = useQuery({
    queryKey: ['account-quota', user?.id],
    enabled: !!user,
    queryFn: ({ signal }) =>
      apiClient.request<{ unlimited: boolean }>('/account/quota', { signal }),
  })
  const prefs = search.data ?? defaults
  const [vendor, setVendor] = useState<'deepseek' | 'openai'>('deepseek'),
    [base, setBase] = useState('https://api.deepseek.com'),
    [model, setModel] = useState('deepseek-flash')
  const [key, setKey] = useState(''),
    [freshToken, setFreshToken] = useState<string | null>(null),
    [busy, setBusy] = useState(''),
    [message, setMessage] = useState('')
  const [opened, setOpened] = useState<string | null>(null),
    [fields, setFields] = useState<Record<string, string>>({})
  useEffect(() => {
    if (saved.data) {
      setVendor(saved.data.llm_vendor as 'deepseek' | 'openai')
      setBase(saved.data.llm_base_url)
      setModel(saved.data.llm_model)
    }
  }, [saved.data])
  useEffect(() => {
    if (location.pathname !== '/account/keys') {
      setFreshToken(null)
      setKey('')
      setFields({})
      setOpened(null)
    }
  }, [location.pathname])
  const updateSearch = useMutation({
    scope: { id: 'account-search-' + user?.id },
    mutationFn: (json: SearchPreferences) =>
      apiClient.request<SearchPreferences>('/account/search', { method: 'PUT', json }),
    onSuccess: (data) => client.setQueryData(searchKey, data),
    onError: (e) => notice(failure(e)),
  })
  const own = saved.data?.secrets.llm_api_key?.last_four
  const masked = token.data ? token.data.prefix + '••••••••••••' + token.data.last_four : ''
  async function regenerate() {
    setBusy('token')
    try {
      const result = await apiClient.request<TokenCreated>('/account/token/regenerate', {
        method: 'POST',
      })
      client.setQueryData(tokenKey, result.metadata)
      setFreshToken(result.token)
      notice('旧令牌已失效，新令牌请现在复制')
    } catch (e) {
      notice(failure(e))
    } finally {
      setBusy('')
    }
  }
  async function save(json: ProviderInput, id: string) {
    setBusy(id)
    try {
      const result = await apiClient.request<ProvidersRead>('/account/providers', {
        method: 'PUT',
        json,
      })
      client.setQueryData(providerKey, result)
      setKey('')
      setFields({})
      setOpened(null)
      setMessage('')
      notice(
        id === 'llm'
          ? '模型密钥已保存，之后问侦探走你的密钥'
          : t('{provider} 的密钥已保存', {
              provider: translateSystemText(locale, providers.find((p) => p.id === id)!.name),
            }),
      )
    } catch (e) {
      notice(failure(e))
    } finally {
      setBusy('')
    }
  }
  async function remove(id: string, name: string) {
    setBusy(id)
    try {
      const result = await apiClient.request<{ undo_token: string }>('/account/providers/' + id, {
        method: 'DELETE',
      })
      await client.invalidateQueries({ queryKey: providerKey })
      notice(
        t('已移除 {provider} 的密钥，改用平台的', { provider: translateSystemText(locale, name) }),
        {
          label: '撤销',
          run: () => {
            void apiClient
              .request<ProvidersRead>('/account/providers/restore', {
                method: 'POST',
                json: result,
              })
              .then((data) => client.setQueryData(providerKey, data))
              .catch((e) => notice(failure(e)))
          },
        },
      )
    } catch (e) {
      notice(failure(e))
    } finally {
      setBusy('')
    }
  }
  async function test() {
    setBusy('test')
    setMessage('正在连')
    try {
      const result = await apiClient.request<{ message: string }>('/account/providers/test', {
        method: 'POST',
        json: { llm_vendor: vendor, llm_base_url: base, llm_model: model, llm_api_key: key.trim() },
      })
      setMessage(result.message)
    } catch (e) {
      setMessage(failure(e))
    } finally {
      setBusy('')
    }
  }
  const error = saved.error || token.error || search.error || quota.error
  return (
    <>
      <div className="p-head">
        <div>
          <h2>{t('搜索与密钥')}</h2>
          <p className="p-lead">
            {t('侦探查比赛时用的模型和搜索服务，默认用平台的，也可以换成你自己的密钥。')}
          </p>
        </div>
      </div>
      <div className="quota">
        <div className="sponsor">
          <img src="/brand/yuanbao.svg" alt="" />
          <span>{t('由 {provider} 提供技术支持', { provider: t('腾讯元宝') })}</span>
        </div>
        <p className="quota-big">
          {quota.data?.unlimited === false ? t('平台次数限制已开启') : t('限时无限次')}
        </p>
        <p>
          {own
            ? t('问侦探现在走你自己的{provider}密钥。', {
                provider: saved.data?.llm_vendor === 'deepseek' ? ' DeepSeek ' : '',
              })
            : t('问侦探、让它重新查证都不限次数。')}
        </p>
      </div>
      {error && (
        <p className="grp-note" role="alert">
          {translateSystemText(locale, failure(error))}
        </p>
      )}
      <div className="grp">
        <div className="grp-head">
          <h3>{t('个人令牌')}</h3>
          <span className="note">{t('在 Claude、Cursor 里接 Inkpaw MCP 时用')}</span>
        </div>
        <Row label={t('令牌')} small={t('带上它，MCP 能读到你的画像、关注和追踪条件')}>
          <div className="copyrow">
            <input
              className="inp"
              readOnly
              aria-label={t('个人令牌')}
              value={freshToken ?? masked}
              placeholder={t('还没有生成个人令牌')}
            />
            <button
              className="btn btn-outline"
              type="button"
              disabled={!freshToken}
              onClick={() => {
                if (freshToken) void copy(freshToken, notice)
              }}
            >
              <Ic name="copy" />
              {t('复制')}
            </button>
          </div>
          <div className="ctl-line">
            <span className="muted">
              {freshToken
                ? t('刚生成，只完整显示这一次')
                : token.data
                  ? t('{date}创建 · {lastUsed}', {
                      date: day(token.data.created_at, locale),
                      lastUsed: token.data.last_used_at
                        ? t('最近一次使用是 {date}', {
                            date:
                              day(token.data.last_used_at, locale) +
                              ' ' +
                              new Date(token.data.last_used_at).toLocaleTimeString(locale, {
                                hour: '2-digit',
                                minute: '2-digit',
                                hourCycle: 'h23',
                                timeZone: 'Asia/Shanghai',
                              }),
                          })
                        : t('还没有使用过'),
                    })
                  : t('还没有生成个人令牌')}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={!!busy}
              onClick={() => void regenerate()}
            >
              <Ic name="refresh" />
              {t('重新生成')}
            </button>
          </div>
        </Row>
      </div>
      <div className="grp">
        <div className="grp-head">
          <h3>{t('模型')}</h3>
          <span className="note">
            {own ? t('用你的密钥 · 末 4 位 {last4}', { last4: own }) : t('现在用平台的')}
          </span>
        </div>
        <Row label={t('供应商')}>
          <Segments
            label={t('模型供应商')}
            values={[
              ['deepseek', 'DeepSeek'],
              ['openai', t('兼容 OpenAI 的接口')],
            ]}
            value={vendor}
            change={(v) => {
              setVendor(v)
              setBase(v === 'deepseek' ? 'https://api.deepseek.com' : '')
              setModel(v === 'deepseek' ? 'deepseek-flash' : '')
            }}
          />
        </Row>
        <Row label={t('接口地址')}>
          <input
            className="inp w-md"
            aria-label={t('接口地址')}
            placeholder="https://…/v1"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </Row>
        <Row label={t('模型')}>
          <input
            className="inp w-sm"
            aria-label={t('模型名')}
            placeholder={t('模型名')}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Row>
        <Row label="API Key">
          <SecretField
            label={t('模型 API Key')}
            value={key}
            change={(v) => {
              setKey(v)
              setMessage('')
            }}
            placeholder={own ? t('已保存 · 末 4 位 {last4}', { last4: own }) : 'sk-…'}
          />
          <div className="ctl-line">
            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={!key.trim() || !!busy}
              onClick={() =>
                void save(
                  {
                    llm_vendor: vendor,
                    llm_base_url: base,
                    llm_model: model,
                    llm_api_key: key.trim(),
                  },
                  'llm',
                )
              }
            >
              {t('保存')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={!key.trim() || !!busy}
              onClick={() => void test()}
            >
              {t('测试连接')}
            </button>
            <span className="field-msg" role="status">
              {busy === 'test' && <span className="spin" />}
              {translateSystemText(locale, message)}
            </span>
          </div>
        </Row>
      </div>
      <div className="grp">
        <div className="grp-head">
          <h3>{t('搜索服务')}</h3>
          <span className="note">{t('两个都开着时，结果合在一起再查证')}</span>
        </div>
        <div>
          {providers.map((p) => {
            const last = saved.data?.secrets[p.fields[p.fields.length - 1][0]]?.last_four,
              open = opened === p.id
            return (
              <div className={'prov' + (open ? ' open' : '')} key={p.id}>
                <div className="prov-head">
                  <div className="src-ic">
                    <Ic name={p.icon} large />
                  </div>
                  <div className="src-main">
                    <b>{translateSystemText(locale, p.name)}</b>
                    <p className="prov-st">
                      {t(p.description)} ·{' '}
                      {last ? (
                        <span className="own">
                          {t('用你的密钥 · 末 4 位 {last4}', { last4: last })}
                        </span>
                      ) : (
                        t('用平台的')
                      )}
                    </p>
                  </div>
                  {last ? (
                    <div className="src-acts">
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => setOpened(open ? null : p.id)}
                      >
                        {t('修改')}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={!!busy}
                        onClick={() => void remove(p.id, p.name)}
                      >
                        {t('移除')}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => setOpened(open ? null : p.id)}
                    >
                      {t('填自己的密钥')}
                    </button>
                  )}
                </div>
                <Expand open={open}>
                  <form
                    className="prov-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void save(
                        Object.fromEntries(
                          p.fields.map(([field]) => [field, fields[field]?.trim()]),
                        ),
                        p.id,
                      )
                    }}
                  >
                    {p.fields.map(([field, label, placeholder]) => (
                      <label key={field}>
                        {label}
                        <SecretField
                          label={translateSystemText(locale, p.name) + ' ' + label}
                          value={fields[field] ?? ''}
                          change={(value) => setFields((v) => ({ ...v, [field]: value }))}
                          placeholder={placeholder}
                        />
                      </label>
                    ))}
                    <div className="acts">
                      <button
                        className="btn btn-primary btn-sm"
                        type="submit"
                        disabled={!!busy || p.fields.some(([field]) => !fields[field]?.trim())}
                      >
                        {t('保存')}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => {
                          setOpened(null)
                          setFields({})
                        }}
                      >
                        {t('取消')}
                      </button>
                    </div>
                  </form>
                </Expand>
              </div>
            )
          })}
        </div>
        <p className="safe">
          {t('密钥加密保存，只用在你自己发起的查询里；保存后页面上只显示末 4 位。')}
        </p>
      </div>
      <div className="grp">
        <div className="grp-head">
          <h3>{t('搜索偏好')}</h3>
        </div>
        <Row label={t('来源范围')}>
          <Segments
            label={t('来源范围')}
            values={[
              ['all', t('国内和海外')],
              ['cn', t('只看国内')],
              ['intl', t('只看海外')],
            ]}
            value={prefs.scope}
            change={(scope) => updateSearch.mutate({ ...prefs, scope })}
          />
        </Row>
        <div className="trow">
          <div>
            <label htmlFor="sr-ended">{t('默认不看已截止的比赛')}</label>
            <p>{t('问侦探时，已经过了截止时间的比赛不进结果')}</p>
          </div>
          <Switch
            id="sr-ended"
            label={t('默认不看已截止的比赛')}
            on={prefs.exclude_ended ?? true}
            change={(exclude_ended) => updateSearch.mutate({ ...prefs, exclude_ended })}
            disabled={updateSearch.isPending}
          />
        </div>
        <Row label={t('不看这些网站')} small={t('转载站、聚合站')}>
          <Tags
            values={prefs.blocked_domains ?? []}
            placeholder={t('比如 example.com，回车')}
            change={(blocked_domains) => updateSearch.mutate({ ...prefs, blocked_domains })}
          />
        </Row>
      </div>
    </>
  )
}
