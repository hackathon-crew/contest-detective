<p align="center">
  <a href="https://inkpaw.windup.xin">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/inkpaw-logo-dark.png">
      <img src="docs/assets/readme/inkpaw-logo-light.png" width="300" alt="Inkpaw">
    </picture>
  </a>
</p>

<h3 align="center">帮你找比赛，也帮你查清参赛条件。</h3>

<p align="center">
  <a href="https://github.com/hackathon-crew/contest-detective/releases/latest"><img src="https://img.shields.io/github/v/release/hackathon-crew/contest-detective?style=flat-square&amp;color=3f5fd6" alt="最新版本"></a>
  <a href="https://github.com/hackathon-crew/contest-detective/actions/workflows/backend.yml"><img src="https://img.shields.io/github/actions/workflow/status/hackathon-crew/contest-detective/backend.yml?branch=main&amp;style=flat-square&amp;label=backend&amp;color=3f5fd6" alt="后端检查"></a>
  <a href="https://github.com/hackathon-crew/contest-detective/actions/workflows/frontend.yml"><img src="https://img.shields.io/github/actions/workflow/status/hackathon-crew/contest-detective/frontend.yml?branch=main&amp;style=flat-square&amp;label=frontend&amp;color=3f5fd6" alt="前端检查"></a>
</p>

<p align="center">
  <strong><a href="https://inkpaw.windup.xin">在线使用 ↗</a></strong>
  &nbsp; · &nbsp; <a href="https://inkpaw.windup.xin/contests">浏览赛事库</a>
  &nbsp; · &nbsp; <a href="#接入-mcp">MCP 接入</a>
  &nbsp; · &nbsp; <a href="README.en.md">English</a>
  &nbsp; · &nbsp; <a href="https://github.com/hackathon-crew/contest-detective/issues/new/choose">反馈问题</a>
</p>

**Inkpaw**（比赛侦探）面向大学生和独立开发者，整理分散在赛事平台、主办方官网与公众号里的比赛信息。你可以直接筛选，也可以把技能、时间和参赛偏好告诉侦探，让它检索资料、读取原文，给出带出处的比赛推荐。

比赛卡片把**报名截止与作品提交截止分开记录**，同时保留来源、日期精度和核实状态。遇到转载过时、时间冲突或规则没有写清的情况，你能看到证据和缺口，再决定是否报名。

<p align="center"><a href="https://inkpaw.windup.xin"><img src="docs/assets/readme/home.png" width="100%" alt="Inkpaw 真实首页：自然语言提问、蓝色八爪鱼与赛事海报"></a></p>

<p align="center"><sub>截图取自 2026 年 10 月 25 日的线上版本 v0.1.27；赛事数量、日期与页面内容会继续变化。</sub></p>

## 开始使用

1. **先看有什么。** 打开[赛事库](https://inkpaw.windup.xin/contests)，按参赛形式、城市、截止时间和状态筛选，在列表与日历之间切换。
2. **把条件说清楚。** 在[侦探对话](https://inkpaw.windup.xin/detective)中提问，例如「我会 Python，想找下个月截止、线上能参加的 AI 黑客松」。查看回答里的工具步骤、比赛卡片和来源链接，再继续追问。
3. **留下与你有关的比赛。** 登录[个人中心](https://inkpaw.windup.xin/account)，维护画像、同步关注、设置单场提醒，或生成自己的日历订阅地址。

浏览赛事库和匿名 MCP 查询可直接使用。账号用于保存个人画像、关注、追踪条件和设置；当前网页界面以中文为主。

## 从发现到关注

| 能力 | 你可以做什么 |
| :--- | :--- |
| **赛事库** | 按关键词、形式、城市、状态与截止时间组合筛选；查看赛事海报、主办方、简介、奖金和时间节点。 |
| **侦探对话** | 用自然语言找比赛、补充条件、继续追问；对话展示查询比赛库、联网搜索、读取网页等实际工具步骤。 |
| **字段出处** | 查看每个已记录字段的来源、摘录与核实等级；报名截止、提交截止、开赛和结束时间分别呈现。 |
| **画像匹配** | 从公开 GitHub 资料、PDF / DOCX / TXT 简历或手填信息生成画像，编辑确认后按技能、身份、地点与时间偏好匹配，并查看推荐理由。 |
| **关注与日历** | 登录后跨设备同步关注，分别控制比赛提醒，导出日历或订阅个人 `.ics` 地址。 |
| **站内盯梢** | 对已关注赛事单独开启变化追踪，查看带前后字段、来源和时间的个人提醒，以及真实检查状态。 |
| **个人中心** | 管理画像、比赛推送、追踪条件、搜索与模型密钥，以及邮箱、密码、数据导出和账号删除。 |
| **MCP** | 从支持 Streamable HTTP 的客户端读取同一份赛事库；带个人令牌时，还能读取自己的画像、关注与追踪条件。 |

### 调查模式

- **普通推荐**：保留赛事库与可用搜索服务的兼容工作流，不表示本轮已由元宝实时核验。
- **比赛库**：只使用已有赛事和画像工具，不注册网页读取、搜索或写回工具。
- **实时核验**：必须配置并实际执行元宝搜索，不会退回其他搜索服务。模型先拆步骤，再把每条待查说法关联到本轮已读取原文、可点击来源和实际搜索轨迹；未执行、失败或证据不足会明确标为未完成。
- **深度调查**：在实时核验基础上，分轮执行不同查询、覆盖调查计划并逐条交叉比对原始来源。同文镜像和无法确认出处的转载不计作独立交叉证据；只有搜索次数达到要求不会自动变成“已完成”。

调查报告区分“证据支持 / 证据反驳 / 来源冲突 / 尚未核实”和“官方 / 转载”等来源等级，可导出相同内容的 Markdown 或 JSON。搜索摘要和历史赛事卡片仅作为线索，不冒充本轮原文证据。页面读取沿用公开地址、DNS 和重定向安全检查，报告不包含账号密钥、用户画像或敏感链接。

仅核验公开赛事信息，不调查时政或涉及个人的消息。截图识别结果须经用户确认后作为待查说法提交，不是事实证据。普通参赛资格中的“个人参赛”不属于个人消息。

### 把筛选结果放在一起看

赛事库支持列表与日历视图，也提供「写明了奖金」「截止时间对过原文」「只看我关注的」等条件。未写明截止时间的比赛单独保留，你仍然可以打开原文继续了解。

<p align="center"><img src="docs/assets/readme/contests.png" width="100%" alt="赛事库真实界面：小日历、筛选条件、赛事列表、截止时间和出处"></p>

### 知道一个日期是怎么来的

一场比赛可能在聚合站写着报名时间，在官网写着作品提交时间，在公众号里又补了一条延期公告。Inkpaw 按字段保存证据，避免把不同节点压成一个含糊的「截止时间」。

| 页面上的信息 | 具体含义 |
| :--- | :--- |
| **官方原文** | 该字段追溯到了主办方官网、官方赛事页面或官方公众号。 |
| **转载** | 目前的证据来自转载或聚合来源，尚未追溯到官方原文。 |
| **说法不一** | 来源给出的值存在冲突，可以展开对照不同说法。 |
| **时刻未核实** | 只核实到某一天，保留日期精度，不补造小时和分钟。 |
| **缺失原因** | 区分尚未抓取、抓取失败、抽取失败、查过未找到和来源明确未公布。 |

核实等级属于具体字段。已保存的证据有自己的采集时间，打开详情不会自动重新抓取官网；后续公告应结合来源链接继续核对。

<p align="center"><img src="docs/assets/readme/evidence.png" width="100%" alt="麦当劳程序员创意开发大赛的真实详情：介绍、日期精度、转载标记与字段原文出处"></p>

### 维护自己的参赛条件

[个人中心](https://inkpaw.windup.xin/account)分为画像、比赛推送、关注、搜索与密钥、账号管理五页。GitHub、简历和手填技能保留各自来源，导入后可以修正再保存。关注随账号同步，个人日历订阅随关注变化更新。

推送页支持频率、北京时间、自然语言追踪条件、下一封预览和投递记录。**邮件发送需要部署者配置 Resend 并启用；v0.1.27 的生产发布保持发信关闭**，保存设置不会因此自动收到邮件。

### 站内持续盯梢

登录后在「个人中心 → 关注的比赛」为已关注赛事单独开启盯梢。站内变化保留发生时的前后字段、来源与时间；旧记录没有历史快照时不会补造变化。提醒只对当前账号可见，已读状态与邮件消费互不影响。暂停后不再产生新的提醒，恢复从当前版本开始；取消关注会移除盯梢订阅。

页面分别显示订阅暂停、全站自动检查暂停、真实最后检查结果与预计下次时间。`DETECTIVE_WATCH_ENABLED` 默认 `false`，不会自行启动官网核对，也不会恢复来源同步或邮件。管理员另行启用后，按从未检查/最久未检查顺序轮转，默认每项间隔 1440 分钟、每批最多 30 项；预计时间是最早可检查时间，不保证所有关注每天都被覆盖。抓取失败保留上次成功时间，同一批次共享官网只抓取一次。网页与模型配置仍使用现有预算和来源安全限制。

## 接入 MCP

远程地址：**`https://inkpaw.windup.xin/mcp`**，传输方式为 **Streamable HTTP**。网页与 MCP 读取同一份赛事库，字段出处、核实等级和日期精度随结果一并返回。

<p align="center"><img src="docs/assets/readme/mcp.png" width="100%" alt="线上 MCP 接入窗口：客户端配置、公共工具说明与个人令牌用法"></p>

### 直接查公共赛事

以 Claude Code 为例：

```bash
claude mcp add --transport http inkpaw https://inkpaw.windup.xin/mcp
```

Cursor 在 `.cursor/mcp.json` 或 `~/.cursor/mcp.json` 中配置：

```json
{
  "mcpServers": {
    "inkpaw": {
      "url": "https://inkpaw.windup.xin/mcp"
    }
  }
}
```

连接后，可以向客户端提问：「用 Inkpaw 查一下最近截止、线上能参加的比赛，把报名链接和日期出处一起列出来。」

### 读取自己的画像和关注

在个人中心的[搜索与密钥](https://inkpaw.windup.xin/account/keys)生成个人令牌，然后添加 `Authorization` 请求头：

```bash
claude mcp add --transport http inkpaw https://inkpaw.windup.xin/mcp \
  --header "Authorization: Bearer YOUR_PERSONAL_TOKEN"
```

Cursor 的个人配置如下：

```json
{
  "mcpServers": {
    "inkpaw": {
      "url": "https://inkpaw.windup.xin/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_PERSONAL_TOKEN"
      }
    }
  }
}
```

上面的两条 Claude Code 命令是匿名与个人两种配置方式，选择一种即可。完整令牌只在生成时显示一次，轮换后旧令牌立即失效；请将令牌留在本机客户端配置中。

| 工具 | 可用范围 | 输入与结果 |
| :--- | :--- | :--- |
| `search_contests` | 匿名 / 个人 | 可传 `keyword`、`status`、`mode`、`date_from`、`date_to`、`ids`、`sort`、`page`、`page_size`；返回分页结果。 |
| `get_contest` | 匿名 / 个人 | 必填 `id`；返回一场比赛的完整详情与出处。 |
| `match_contests` | 匿名 / 个人 | 必填 `profile`；返回比赛、匹配理由和排序分数。 |
| `get_my_profile` | 个人令牌 | 无参数；返回令牌所属账号已保存的画像。 |
| `get_my_follows` | 个人令牌 | 无参数；返回本人关注的比赛及提醒开关。 |
| `get_my_tracking` | 个人令牌 | 无参数；返回本人的追踪条件。 |

例如，公共查询参数为 `{"keyword":"Python","mode":"online","page_size":5}`，显式画像匹配参数为 `{"profile":{"skills":["Python"],"preferred_modes":["online"]}}`。

MCP 工具只读取已有业务数据，不联网检索、不调用模型、不保存传入的画像。个人令牌鉴权会更新最近使用时间。公网入口按 IP 限制为每分钟 60 次请求、短时突发 20 次、最多 4 个并发连接，单次请求上限为 64 KiB；超限返回 HTTP 429。

<details>
<summary>本地 stdio MCP：读取自己的 SQLite 数据库</summary>

先在下方本地运行步骤中安装依赖并执行迁移，再启动：

```bash
uv run --directory backend contest-detective-mcp
```

默认读取后端工作目录中的 `contest_detective.db`，也可用 `DETECTIVE_DB_URL` 指定已有数据库。它以 SQLite 文件只读模式连接，不建库、不执行迁移；日志写入标准错误，标准输入和输出只承载 MCP 协议。本地 stdio 提供三个公共工具，不读取账号资料。

```json
{
  "mcpServers": {
    "inkpaw-local": {
      "command": "uv",
      "args": ["run", "--directory", "/absolute/path/to/contest-detective/backend", "contest-detective-mcp"],
      "env": {
        "DETECTIVE_DB_URL": "sqlite:////absolute/path/to/contest_detective.db"
      }
    }
  }
}
```

将示例路径替换为本机仓库与数据库的绝对路径。

</details>

## 本地运行

需要 **Python 3.12+、uv、Node.js 24 和 npm**。后端使用 FastAPI、SQLAlchemy、Alembic 和 SQLite；前端使用 React、TypeScript 与 Vite。

```bash
git clone https://github.com/hackathon-crew/contest-detective.git
cd contest-detective
cp .env.example .env
uv sync --locked --directory backend
uv run --directory backend alembic upgrade head
uv run --directory backend contest-detective
```

另开一个终端：

```bash
cd contest-detective/frontend
npm ci
npm run dev
```

按 Vite 输出的地址打开前端（默认 `http://localhost:5173`）。开发代理把 `/api` 转发至 `http://127.0.0.1:8000`；后端健康检查为 `http://127.0.0.1:8000/health`，交互式 API 文档为 `http://127.0.0.1:8000/docs`。

**首次启动是空库。** 默认关闭模型、自动采集和邮件；启动成功不会自动获得线上赛事数据。准备好来源配置后，可主动运行 `uv run --directory backend contest-detective-sync` 采集，或用下方离线工具导入已审核的公开证据包。

| 需要启用的能力 | 对应配置 |
| :--- | :--- |
| 侦探与简历理解 | `DETECTIVE_LLM_ENABLED=true`，配置 `DETECTIVE_LLM_API_KEY`、`DETECTIVE_LLM_BASE_URL`、`DETECTIVE_LLM_MODEL`；切换供应商时按需调整 `DETECTIVE_LLM_DEEPSEEK_OPTIONS`。 |
| 联网搜索 | 配置元宝搜索的 `DETECTIVE_YUANBAO_SECRET_ID` / `DETECTIVE_YUANBAO_SECRET_KEY`，或 `DETECTIVE_TAVILY_API_KEY`。 |
| 自动采集 | 配置 `DETECTIVE_SYNC_DAILY_AT` 或 `DETECTIVE_SYNC_INTERVAL_MINUTES`；来源抽取还受模型开关控制。 |
| 自动盯梢 | `DETECTIVE_WATCH_ENABLED` 默认关闭；启用后用 `DETECTIVE_WATCH_INTERVAL_MINUTES` 和 `DETECTIVE_WATCH_BATCH_SIZE` 控制间隔与批次。 |
| 个人服务密钥 | 单独生成并保管 `DETECTIVE_ACCOUNT_ENCRYPTION_KEY`，用来加密保存账号的模型与搜索密钥。 |
| 邮件与订阅链接 | 配置 `DETECTIVE_PUBLIC_BASE_URL`；发信另需 Resend 凭据、发信地址与 `DETECTIVE_MAIL_ENABLED=true`。 |

完整变量见 [`.env.example`](.env.example)。模型与搜索调用使用所配置供应商的额度；本地预算模式及生产部署见[部署说明](deploy/README.md)。前端代理与接口生成见[前端说明](frontend/README.md)。

<details>
<summary>离线更新：导入已审核的公开证据包</summary>

`contest-detective-refresh` 只导入已经整理并核对的公开证据包，不联网、读取 `.env`、启动定时任务或调用模型。它不会自行抓取或理解网页。证据包使用 `contest-refresh-v1`，每项含赛事身份、实际保存文本的 SHA-256、文本表示与完整性、原文摘录及来源；可附带有引用的简介。搜索摘要与局部摘录必须标为 `partial`，不能用来证明整页没有某项规则。

先迁移一个明确选择的本地 SQLite 数据库，再运行默认的只读预演：

```bash
uv run --directory backend contest-detective-refresh \
  --database /absolute/path/to/contest.db \
  --manifest /absolute/path/to/reviewed-public-evidence.json \
  --output-directory /absolute/path/to/refresh-reports
```

确认预演结果后，同一命令加 `--apply` 才写入。更新按赛事隔离失败，省略的历史字段和正文不会被清空；相同包重复执行不重复写入。`created`、`updated` 按不同赛事计数，`applied_entries` 按证据包条目计数，来源发现量与分页终止原因另列。失败条目保留在报告中，可在复核后用新的包版本重试。修改包内容须使用新的 `manifest_id`；不同届次或明显不相容的日期会拒绝自动合并。

写入前会在报告目录生成本地 SQLite 备份及仅包含公开赛事表差异的回滚记录。数据库备份可能含目标库的其他资料，必须留在受保护的本地目录，不上传为公开附件。回滚只撤销本次赛事变化，不恢复整库覆盖后续账号数据；发现后续修改或私人记录引用新赛事时拒绝回滚：

```bash
uv run --directory backend contest-detective-refresh \
  --database /absolute/path/to/contest.db \
  --rollback /absolute/path/to/refresh-reports/refresh-run/changes.json \
  --output-directory /absolute/path/to/refresh-reports --apply
```

纠正旧字段映射需逐条指明旧来源、值、摘录、理由和新证据，并匹配预期公开数据指纹，不能靠部分抓取覆盖历史。新包也不能悄悄改变历史来源的官方身份。此命令不会部署或连接生产服务器；生产执行须使用另行审核的运维通道。普通网页 GET 与部署迁移均不会导入证据包。

</details>

## 数据与使用边界

- **公开来源。** 采集与检索覆盖 Devpost、HackerTrip、WaytoAGI、ETHGlobal、活动行及主办方公开页面和公众号。各来源的覆盖范围不同，库里查不到时可继续问侦探。
- **原文与摘录。** 新的来源文档默认公开必要摘录和链接，历史正文继续保留；详情按需加载。截图中的赛事海报及第三方品牌属于各自权利人。
- **个人资料。** 登录后保存已确认的画像与设置。导入简历会使用配置的模型服务，建议只提供与参赛相关的内容；公开 GitHub 画像读取公开资料。
- **对话记录。** 保存在当前浏览器，按登录身份隔离，可刷新后继续追问；目前不跨设备同步。
- **凭据。** 个人模型和搜索密钥加密保存，读取接口只返回掩码；个人 MCP 令牌保存哈希。账号设置支持数据导出，以及经确认的账号删除。

## macOS 比赛助手

仓库还包含原生 [Inkpaw Companion](plugins/inkpaw-macos/README.md)：桌面八爪鱼、比赛节点倒计时、提交清单、本地规则文档问答、只读 Git 活动和系统提醒。

它是独立的 **macOS 15+ 开发版**，需要 Swift 6 工具链，尚未签名、公证或正式发行。构建与使用边界见[插件说明](plugins/inkpaw-macos/README.md)，原生验证结果见 [macOS 工作流](https://github.com/hackathon-crew/contest-detective/actions/workflows/inkpaw-macos.yml)。

## 参与贡献

发现日期错误、来源缺失或功能问题，可以[提交 Issue](https://github.com/hackathon-crew/contest-detective/issues/new/choose)，附上赛事链接与能核对的原文。开发贡献遵循 **Issue → 分支 → PR**，具体约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

[版本记录](https://github.com/hackathon-crew/contest-detective/releases) · [开发进度](https://github.com/hackathon-crew/contest-detective/milestones) · [部署说明](deploy/README.md) · [前端开发](frontend/README.md) · [hackathon-crew](https://github.com/hackathon-crew)

当前仓库尚未声明开源许可证。
