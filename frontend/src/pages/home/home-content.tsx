import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import type { Profile } from '@/shared/api'
import type { ProfileMatchSection } from '@/features/profile-match'
import type { VerificationOptions } from '@/features/detective/verification-contracts'
import { Icon } from '@/shared/ui/site-icon'
import note from '@/shared/assets/stickers/note.png'
import happy from '@/shared/assets/mascot/octo-happy.png'
import peer from '@/shared/assets/mascot/octo-peer.png'
import read from '@/shared/assets/mascot/octo-read.png'

type OpenProfile = (section: ProfileMatchSection) => void

function usePreviewReveal() {
  const host = useRef<HTMLDivElement>(null)
  const [cycle, setCycle] = useState(0)
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCycle((value) => value + 1)
          observer.disconnect()
        }
      },
      { threshold: 0.45 },
    )
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  return { host, cycle, replay: () => setCycle((value) => value + 1) }
}

export function PersonalizedIntro({ onAddProfile }: { onAddProfile: OpenProfile }) {
  return (
    <div className="copy">
      <h2>
        从你的项目经历，
        <br />
        找到合适的赛道
      </h2>
      <p>
        连接
        GitHub，或上传一份简历，把做过的项目变成参赛画像。再补充兴趣、身份和可投入时间，按你的情况挑比赛，每条推荐都说明理由。
      </p>
      <ul className="points">
        <li>
          <Icon name="github" />
          读取公开仓库的语言与主题，提取技能和方向
        </li>
        <li>
          <Icon name="user" />
          画像由你编辑确认，时间、地点和参赛形式一起考虑
        </li>
        <li>
          <Icon name="check" />
          推荐理由关联你的技能与项目，帮你判断是否适合
        </li>
      </ul>
      <div className="feature-actions">
        <button className="btn btn-primary" type="button" onClick={() => onAddProfile('github')}>
          <Icon name="github" />
          读取我的 GitHub
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => onAddProfile('all')}>
          从简历开始
          <Icon name="arrow-right" />
        </button>
      </div>
    </div>
  )
}

export function PersonalizedPreview({
  profile,
  onAddProfile,
}: {
  profile: Profile | null
  onAddProfile: OpenProfile
}) {
  const skills = [...new Set([...(profile?.skills ?? []), ...(profile?.topics ?? [])])].slice(0, 5)
  const { host, cycle, replay } = usePreviewReveal()
  return (
    <div className="stage personal-stage" ref={host} data-revealed={cycle > 0}>
      <div className="win personal-window">
        <img className="perch px x2" src={peer} width={202} height={164} alt="" />
        <div className="win-bar">
          <div className="win-title">
            <Icon name="user" />
            你的参赛画像
          </div>
          <button
            type="button"
            className="preview-replay"
            aria-label="重看画像生成过程"
            title="重看画像生成过程"
            onClick={replay}
          >
            <Icon name="refresh" />
          </button>
        </div>
        <div className="personal-source">
          <Icon name="github" large />
          <div>
            <strong>
              {profile?.github ? `github.com/${profile.github}` : '从你的公开项目开始'}
            </strong>
            <p>{profile?.github ? '已读取的 GitHub 公开资料' : '项目语言、仓库主题与近期活动'}</p>
          </div>
          <button type="button" className="btn btn-outline" onClick={() => onAddProfile('github')}>
            {profile?.github ? '编辑' : '连接'}
          </button>
        </div>
        <ol className="profile-journey" key={cycle}>
          <li style={{ '--preview-step': 0 } as CSSProperties}>
            <span className="journey-icon">
              <Icon name="file" />
            </span>
            <div>
              <strong>提取技能与兴趣方向</strong>
              {skills.length ? (
                <div className="profile-skills">
                  {skills.map((skill) => (
                    <span className="tag" key={skill}>
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p>结合公开项目与简历里的经历</p>
              )}
            </div>
          </li>
          <li style={{ '--preview-step': 1 } as CSSProperties}>
            <span className="journey-icon">
              <Icon name="user" />
            </span>
            <div>
              <strong>确认你的参赛条件</strong>
              <p>身份、城市、参赛形式与可投入时间</p>
            </div>
          </li>
          <li style={{ '--preview-step': 2 } as CSSProperties}>
            <span className="journey-icon">
              <Icon name="check" />
            </span>
            <div>
              <strong>查看比赛与推荐理由</strong>
              <p>看技能和赛道的关联，也看时间是否合适</p>
            </div>
          </li>
        </ol>
        <div className="win-foot">
          <span>登录账号，保存画像供下次使用</span>
          <Link to="/account/profile">
            管理画像
            <Icon name="arrow-right" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export function FilterIntro() {
  return (
    <div className="copy">
      <h2>按条件筛比赛，也能按你的情况挑</h2>
      <p>
        选参赛形式和截止时间，或者连上
        GitHub、传一份简历，让它照你的技能和年级挑。每场比赛写清主办方、奖金、截止时间，以及这个日期是从哪儿看到的。
      </p>
      <ul className="points">
        <li>
          <Icon name="check" />
          形式、截止时间、关键词随意组合，结果按截止先后排
        </li>
        <li>
          <Icon name="check" />读 GitHub 和简历生成画像，每条推荐都写明理由
        </li>
        <li>
          <Icon name="check" />
          报名截止和提交截止分开写，标明出自官方原文还是转载
        </li>
      </ul>
      <p>
        赛事库从 Devpost、ETHGlobal、HackerTrip、活动行、WaytoAGI
        和主办方公开渠道整理信息，与网页检索配合。
      </p>
      <div className="update-workflow">
        <strong>后台支持按每日计划更新赛事库</strong>
        <ol aria-label="赛事更新流程">
          {['多源采集', '抽取字段', '合并去重', '核实入库'].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}
export function DeepResearchIntro() {
  return (
    <div className="copy">
      <h2>
        深度检索，
        <br />
        把参赛条件查清楚
      </h2>
      <p>
        从赛事知识库找到线索，分轮检索官网、公众号和公开网页，再读取原文、交叉比对来源。查清资格要求、报名截止和作品提交截止，把依据和分歧一起列出来。
      </p>
      <div className="legend">
        <div>
          <span className="lv lv-official">
            <Icon name="check" />
            官方原文
          </span>
          <span>在主办方官网或官方公众号上找到</span>
        </div>
        <div>
          <span className="lv lv-reposted">
            <Icon name="dot" />
            转载
          </span>
          <span>只在转载文章里看到，还没追到官方</span>
        </div>
        <div>
          <span className="lv lv-conflict">
            <Icon name="alert" />
            说法不一
          </span>
          <span>两个来源给的日期对不上，两个都列给你</span>
        </div>
        <div>
          <span className="lv lv-not_found">
            <Icon name="minus" />
            未找到
          </span>
          <span>保留尚未核实的项目，可以继续追查</span>
        </div>
      </div>
      <img
        className="stk px x2"
        src={note}
        width="158"
        height="134"
        alt=""
        style={{ right: '-8px', top: '-112px' }}
      />
    </div>
  )
}

export function DetectiveIntro() {
  return (
    <div className="copy">
      <h2>问一句，侦探去翻原文</h2>
      <p>
        它先查比赛库，库里没有就联网搜，再打开主办方页面逐字核对截止时间。查了哪些地方、读了哪些页面，都列在回答上面，每个日期标明可信到什么程度。
      </p>
      <div className="legend">
        <div>
          <span className="lv lv-official">
            <Icon name="check" />
            官方原文
          </span>
          <span>在主办方官网或官方公众号上找到</span>
        </div>
        <div>
          <span className="lv lv-reposted">
            <Icon name="dot" />
            转载
          </span>
          <span>只在转载文章里看到，还没追到官方</span>
        </div>
        <div>
          <span className="lv lv-conflict">
            <Icon name="alert" />
            说法不一
          </span>
          <span>两个来源给的日期对不上，两个都列给你</span>
        </div>
        <div>
          <span className="lv lv-not_found">
            <Icon name="minus" />
            未找到
          </span>
          <span>公开页面里没写，侦探不替主办方编</span>
        </div>
      </div>
      <img
        className="stk px x2"
        src={note}
        width="158"
        height="134"
        alt=""
        style={{ right: '-8px', top: '-112px' }}
      />
    </div>
  )
}
const researchSteps = [
  [
    'database',
    '拆解问题',
    '从赛事库和你的条件出发',
    '把参赛资格、报名截止、作品提交截止拆开，制定要查的问题与查询计划。',
  ],
  [
    'search',
    '多轮检索',
    '从不同查询继续找线索',
    '结合赛事库与网页检索，分轮调整查询，追查官网、公众号和后续公告。',
  ],
  [
    'file',
    '读取原文',
    '回到信息发布的页面',
    '读取主办方原文，保存对应摘录与链接，分别核对报名和作品提交时间。',
  ],
  [
    'link',
    '交叉核对',
    '比较来源，给出证据',
    '比较独立原始来源，将证据支持、来源冲突与尚未核实的说法分别呈现。',
  ],
]

export function ResearchPreview({
  onAsk,
}: {
  onAsk: (question: string, verification?: VerificationOptions) => void
}) {
  const [active, setActive] = useState(0)
  const { host, cycle, replay } = usePreviewReveal()
  const [question, setQuestion] = useState(
    '帮我深度检索适合 Python 开发者的线上 AI 比赛，核对参赛条件、报名和作品提交截止时间，并附上原文出处。',
  )
  const step = researchSteps[active]
  return (
    <div className="stage research-stage" ref={host} data-revealed={cycle > 0}>
      <div className="win">
        <img className="perch px x2" src={read} width={202} height={172} alt="" />
        <div className="win-bar">
          <div className="win-title">
            <Icon name="search" />
            深度检索
          </div>
          <div className="window-actions">
            <span className="window-note">知识库 + 网页</span>
            <button
              type="button"
              className="preview-replay"
              aria-label="重看检索过程"
              title="重看检索过程"
              onClick={replay}
            >
              <Icon name="refresh" />
            </button>
          </div>
        </div>
        <div className="research-body">
          <label className="research-question">
            想查清什么
            <textarea
              aria-label="深度检索问题"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
            />
          </label>
          <div
            className="research-tabs"
            role="group"
            aria-label="深度检索步骤"
            style={{ '--selected-step': active } as CSSProperties}
          >
            <span className="research-active-surface" aria-hidden="true" />
            {researchSteps.map(([icon, title], index) => (
              <button
                type="button"
                key={title}
                aria-pressed={active === index}
                onClick={() => setActive(index)}
              >
                <Icon name={icon} />
                {title}
              </button>
            ))}
          </div>
          <div className="research-focus" key={`${active}-${cycle}`}>
            <strong>{step[2]}</strong>
            <p>{step[3]}</p>
          </div>
        </div>
        <div className="win-foot research-foot">
          <span>执行后查看检索轨迹与原文证据</span>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!question.trim()}
            onClick={() => onAsk(question, { mode: 'deep' })}
          >
            开始深度检索
            <Icon name="arrow-right" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function WatchIntro() {
  return (
    <div className="copy">
      <h2>
        适合你的新比赛，
        <br />
        让侦探继续盯
      </h2>
      <p>
        保存画像和追踪条件，让符合条件的新比赛进入邮件推送。关注想参加的比赛，设置截止提醒，也跟进时间、地点和奖金的变化。
      </p>
      <ul className="points">
        <li>
          <Icon name="mail" />
          符合画像或追踪条件的新比赛，按你选择的频率推送
        </li>
        <li>
          <Icon name="bell" />
          关注的比赛，在截止前 7 天、3 天或 1 天提醒
        </li>
        <li>
          <Icon name="refresh" />
          信息有变动，回到站内查看前后字段与来源
        </li>
      </ul>
      <div className="feature-actions">
        <Link className="btn btn-primary" to="/account/push">
          设置邮件盯梢
          <Icon name="arrow-right" />
        </Link>
        <Link className="btn btn-ghost" to="/account/follows">
          查看我的关注
        </Link>
      </div>
    </div>
  )
}

const mailContents = [
  {
    title: '新比赛',
    icon: 'mail',
    subject: '与你的参赛条件相符的新机会',
    description: '从新收录的赛事里，按你确认的画像或追踪条件筛选。',
    details: ['符合的比赛与推荐理由', '参赛形式、奖励与截止时间', '回到赛事详情查看原文'],
  },
  {
    title: '截止提醒',
    icon: 'bell',
    subject: '关注的比赛，提前安排时间',
    description: '选择截止前 7 天、3 天或 1 天，提醒跟随你关注的比赛。',
    details: ['你关注的比赛', '报名或作品提交的截止节点', '赛事详情与来源查询入口'],
  },
  {
    title: '信息变动',
    icon: 'refresh',
    subject: '比赛信息变化，继续跟进',
    description: '邮件提醒你关注的比赛有变动，回到站内查看变化记录与出处。',
    details: ['比赛信息有变化的提醒', '当前的关键日期、地点与奖励', '回到站内对照前后记录与来源'],
  },
]

export function WatchPreview() {
  const [active, setActive] = useState(0)
  const content = mailContents[active]
  const { host, cycle, replay } = usePreviewReveal()
  return (
    <div className="stage watch-stage" ref={host} data-revealed={cycle > 0}>
      <div className="win">
        <div className="win-bar">
          <div className="win-title">
            <Icon name="mail" />
            邮件里会有什么
          </div>
          <button
            type="button"
            className="preview-replay"
            aria-label="重看邮件展开"
            title="重看邮件展开"
            onClick={replay}
          >
            <Icon name="refresh" />
          </button>
        </div>
        <div
          className="mail-tabs seg"
          role="group"
          aria-label="邮件内容预览"
          style={{ '--selected-mail': active } as CSSProperties}
        >
          <span className="mail-active-surface" aria-hidden="true" />
          {mailContents.map(({ title }, index) => (
            <button
              type="button"
              key={title}
              aria-pressed={active === index}
              onClick={() => setActive(index)}
            >
              {title}
            </button>
          ))}
        </div>
        <div className="mail-preview" key={`${active}-${cycle}`}>
          <span className="mail-preview-icon">
            <Icon name={content.icon} large />
          </span>
          <strong>{content.subject}</strong>
          <p>{content.description}</p>
          <ul>
            {content.details.map((detail, index) => (
              <li key={detail} style={{ '--preview-step': index } as CSSProperties}>
                <Icon name="check" />
                {detail}
              </li>
            ))}
          </ul>
        </div>
        <div className="win-foot">
          <span>内容、频率与提醒时间，由你选择</span>
          <Link to="/account/push">
            推送设置
            <Icon name="arrow-right" />
          </Link>
        </div>
      </div>
    </div>
  )
}
export function McpIntro() {
  return (
    <div className="copy">
      <h2>在你常用的 AI 里直接查</h2>
      <p>
        Inkpaw 提供远程 MCP 服务。在 Claude Code、Cursor 这类客户端里加一行配置，它就能直接查 Inkpaw
        的比赛库，拿到的日期和出处跟网页上一样。
      </p>
      <div className="tools">
        <div>
          <code>search_contests</code>
          <span>按关键词、状态、形式和日期范围查比赛</span>
        </div>
        <div>
          <code>get_contest</code>
          <span>读一场比赛的全部字段，以及每个字段的出处</span>
        </div>
        <div>
          <code>match_contests</code>
          <span>按技能、年级和偏好挑比赛，附上推荐理由</span>
        </div>
      </div>
      <p className="text-muted" style={{ fontSize: '14px' }}>
        不带令牌时只读比赛库。在个人中心的「搜索与密钥」生成个人令牌，填入下方 Authorization
        请求头，MCP 就能读取你的画像、关注和追踪条件。
      </p>
    </div>
  )
}
export function ClosingCallout({ onAsk }: { onAsk: () => void }) {
  return (
    <section className="cta-sec">
      <div className="wrap">
        <div className="cta">
          <img className="px x2" src={happy} width="206" height="160" alt="" />
          <div>
            <h2>把你的条件告诉侦探</h2>
            <p>线上还是线下、什么时候有空、会什么技能，说清楚它就去查。</p>
          </div>
          <div className="acts">
            <a className="btn btn-primary" href="#top-ask" onClick={onAsk}>
              问侦探
            </a>
            <a className="btn btn-outline" href="/contests">
              浏览赛事库
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
