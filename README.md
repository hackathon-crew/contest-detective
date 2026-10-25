# Inkpaw

面向大学生的比赛发现与核实工具。用户给出筛选条件，agent 检索公众号和赛事官网，输出经过核实的比赛信息。

## 要解决的问题

比赛信息分散在各个公众号和聚合站里，转载内容经常过时。比赛延期、改赛制、追加赛道之后，旧的转载仍然在流传，学生拿到一条比赛信息，很难判断它是否可信、是否已经过期，只能自己逐条追到官网去核对。

现有的比赛聚合站只收录在其平台上发布的比赛，企业和社区举办的比赛有很大一部分只在公众号和官网发布。Inkpaw 检索全网公开信息，并对每一条结果核实来源。

## 功能

- **条件筛选**：按参赛形式（线上或线下）、截止时间范围筛选，并可排除指定的比赛类型。
- **结构化输出**：每个比赛生成一张卡片，包含主办方、截止时间、参赛形式、报名链接和是否收费。
- **来源核实**：每张卡片附带证据链，标明信息出处、是否追溯到官方页面、不同来源的截止日期是否冲突。

## 当前状态

已提供赛事查询、来源核实、画像匹配和只读 MCP，支持远程 HTTP 与本地 stdio。前端运行方式见 [frontend/README.md](frontend/README.md)，开发进度见 [Milestones](https://github.com/hackathon-crew/contest-detective/milestones)。

## 远程只读 MCP

服务使用 Streamable HTTP，不带令牌时直接读取网站同一份赛事库。

登录后在「个人中心 → 搜索与密钥」生成个人令牌，在 MCP 客户端配置里增加 `Authorization: Bearer YOUR_PERSONAL_TOKEN` 请求头，即可读取本人画像、关注和追踪条件。页面只完整显示新令牌一次，重新生成会立即作废旧令牌。个人令牌请通过 HTTPS 连接传输。

个人模型与搜索密钥加密保存在账号下，只用于本人发起的查询；保存后只显示末 4 位。自托管时先在 `.env` 配置 `DETECTIVE_ACCOUNT_ENCRYPTION_KEY`，生成命令见 `.env.example`。活动期间默认不限提问次数，`DETECTIVE_QUERY_LIMITS_ENABLED=true` 可恢复次数限制。

Claude Code 按[官方 HTTP 配置方式](https://code.claude.com/docs/en/mcp)添加：

```bash
claude mcp add --transport http inkpaw http://43.142.60.212/mcp
```

Cursor 在项目的 `.cursor/mcp.json` 或用户的 `~/.cursor/mcp.json` 中加入以下配置，见[官方 MCP 说明](https://cursor.com/docs/mcp)：

```json
{
  "mcpServers": {
    "inkpaw": {
      "url": "http://43.142.60.212/mcp"
    }
  }
}
```

远程与本地服务提供相同的三个工具，参数和返回结构见下表。日期精度、核实等级和来源链接保持原样；画像只用于当前请求，不保存或读取账号。服务不调用搜索或模型。公网每个 IP 每分钟允许 60 次请求，支持短时突发 20 次，最多 4 个并发连接；超限返回 HTTP 429。单次请求上限为 64 KiB。

公网当前使用 HTTP；匿名画像只需填写用于筛选的技能、地点和时间，不包含简历原文或凭据。

## 本地只读 MCP

安装后端依赖并准备 SQLite 数据库：

```bash
uv sync --locked --directory backend
uv run --directory backend alembic upgrade head
```

启动 stdio 服务：

```bash
uv run --directory backend contest-detective-mcp
```

默认读取后端工作目录中的 `contest_detective.db`，也可通过 `DETECTIVE_DB_URL` 指定已有 SQLite 文件。MCP 以文件只读模式连接，启动不会创建数据库或执行迁移；标准输入、输出承载协议，运行日志写入标准错误。

在支持 stdio MCP 的客户端中配置命令，将示例中的绝对路径替换为本机仓库和数据库位置：

```json
{
  "mcpServers": {
    "contest-detective": {
      "command": "uv",
      "args": ["run", "--directory", "/absolute/path/to/contest-detective/backend", "contest-detective-mcp"],
      "env": {
        "DETECTIVE_DB_URL": "sqlite:////absolute/path/to/contest_detective.db"
      }
    }
  }
}
```

服务只提供三个读取工具，均声明只读、无破坏和无外部访问：

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `search_contests` | 平铺的 `keyword`、`status`、`mode`、`date_from`、`date_to`、`ids`、`sort`、`page`、`page_size`，均可省略 | `items`、`total`、`page`、`page_size` |
| `get_contest` | 必填 `id` | 完整赛事详情及出处；缺少赛事返回工具错误 |
| `match_contests` | 必填 `profile`，结构与画像接口相同 | `items`，每条包含赛事、模板理由及排序分数 |

例如查询参数 `{"keyword":"Python","mode":"online","page_size":5}`，匹配参数 `{"profile":{"skills":["Python"],"preferred_modes":["online"]}}`。这些调用只读取本地赛事库，不联网获取资料、不调用模型、不保存画像，也不读取登录态。

## 赛事简介与详情

列表直接提供带出处的简介和主题；完整详情在打开比赛时加载。历史正文仍保留，新的来源文档默认只公开必要摘录与链接，不自动转载全文。字段的“尚未抓取”“获取失败”“抽取失败”“已查来源未找到”“来源明确未公布”和“存在冲突”分别展示，缺失不等于没有要求。

## 不使用 API key 的离线更新

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

## 站内持续盯梢

登录后在「个人中心 → 关注的比赛」为已关注赛事单独开启盯梢。站内变化保留发生时的前后字段、来源与时间；旧记录没有历史快照时不会补造变化。提醒只对当前账号可见，已读状态与邮件消费互不影响。暂停后不再产生新的提醒，恢复从当前版本开始；取消关注会移除盯梢订阅。

页面分别显示订阅暂停、全站自动检查暂停、真实最后检查结果与预计下次时间。`DETECTIVE_WATCH_ENABLED` 默认 `false`，不会自行启动官网核对，也不会恢复来源同步或邮件。管理员另行启用后，按从未检查/最久未检查顺序轮转，默认每项间隔 1440 分钟、每批最多 30 项；预计时间是最早可检查时间，不保证所有关注每天都被覆盖。抓取失败保留上次成功时间，同一批次共享官网只抓取一次。网页与模型配置仍使用现有预算和来源安全限制。

## 参与开发

流程与规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。
