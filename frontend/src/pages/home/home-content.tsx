import { Icon } from '@/shared/ui/site-icon'
import note from '@/shared/assets/stickers/note.png'
import happy from '@/shared/assets/mascot/octo-happy.png'
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
        三个工具都只读比赛库，画像用完即弃。
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
