# 服务器运行

使用已发布版本。静态文件在 `frontend/dist`，后端只监听回环地址，nginx 将 `/api/` 转发给后端。独立只读 MCP 监听 `127.0.0.1:8001`，nginx 将 `/mcp` 原路径转发给它。SQLite 部署下两个进程读取同一份 `/var/lib/contest-detective/contest.db`；PostgreSQL 部署下共用 `/etc/contest-detective.env` 中的连接配置。

服务器安装 nginx、uv 和 Git；PostgreSQL 部署还需要 `postgresql-client-16`（发布脚本用 `pg_dump` / `pg_restore` 备份 PostgreSQL）。前端在本地对应版本运行 `npm ci && npm run build`，将 `dist` 传到服务器；后端在服务器运行：

```sh
# PostgreSQL 部署需要 postgresql-client-16；Ubuntu 22.04 需先添加 PGDG 源
# sudo apt-get install -y postgresql-client-16
sudo install -d -m 755 /srv/contest-detective /opt/contest-python
# 将对应发布版本解压到 /srv/contest-detective
cd /srv/contest-detective/backend
sudo env UV_PYTHON_INSTALL_DIR=/opt/contest-python uv sync --locked --no-dev --python 3.12
```

后端的默认 uv 包源在 `backend/pyproject.toml` 中配置为腾讯云 HTTPS PyPI 镜像，自动部署使用同一配置。锁文件同时记录镜像下载地址及文件哈希；更换包源时须一并更新锁文件，再发布新版本，保证 `--locked` 安装与已发布代码一致。

Python 放在 `/opt/contest-python`，确保服务用户在 `ProtectHome=yes` 下仍能运行解释器。首次部署创建专用账户和环境文件：

```sh
cd /srv/contest-detective
sudo useradd --system --no-create-home --shell /usr/sbin/nologin contest-detective
sudo install -m 600 deploy/server.env.example /etc/contest-detective.env
sudoedit /etc/contest-detective.env
```

环境文件只由管理员读取，systemd 将变量传给服务；密钥不放进代码目录。模型默认关闭，启用时配置相应供应商的密钥、地址和模型名称。

`DETECTIVE_LLM_LIMITS_MODE` 默认是 `local`：调用前检查累计预算和余额，示例服务器预算为 3.5 元，本地默认 1.5 元。若供应商或网关已经限制额度，可设为 `external`，由供应商控制累计花费及真实上下文容量，不查询本地余额，也不叠加本地累计预算或 JSON 字节数拦截。`DETECTIVE_LLM_MAX_INPUT_TOKENS` 在 `local` 模式用于输入检查和金额预留，`external` 模式只参与预留估算。

两种模式都会逐次记录用量。侦探不设置固定请求次数、工具次数和整轮时长上限，用户可随时停止查证；每次模型请求超时 120 秒，网页抽取超时 300 秒。`local` 模式使用 `DETECTIVE_LLM_MAX_TOKENS` 控制输出并预留金额，默认 8192 tokens；`external` 模式不向模型服务附加本地输出上限，该配置仅参与费用预留估算。网页抽取共用本次提问的请求计数；独立运行的网页抽取仍限制为 6 次模型请求。失败请求或响应未取得有效用量时保留预留记录，不能将其当作实际费用；结算异常不阻断已经生成的回答。

工具参数校验失败时允许模型纠正 3 次；网页抽取格式不合要求时允许纠正 2 次，纠正请求仍计入总请求预算。侦探自主选择查证路径；明确的截止日期和时刻须与本轮已读取证据、赛事及截止类型匹配，日期级证据不能补成具体时刻。缺少支持时要求修正或标明未核实，不把未知信息补成事实。实时与深度模式还验证实际元宝执行记录、原文摘录及说法引用关系，未完成的调查如实保留部分结果。单个工具执行失败会作为工具结果交给侦探，由它选择其他来源或方法；工具和 SDK 不盲目自动重试。模型服务中断时，会返回已取得的资料并说明尚未完成核实。

比赛库查询支持 `page` 和 `page_size` 翻页，联网搜索使用请求的条数。网页读取保留完整正文，也支持用 `offset` 和 `length` 分段继续读，正常解压 gzip 等受支持的编码；下载仍按解压后的大小限制资源占用。提问与完整的已完成对话前文直接传给模型，不再按500字、六轮、12KB或每条2500字截断，实际上下文容量由模型服务处理。

同步在北京时间每天 03:00 起的 60 分钟内运行一次。进程在窗口内启动且当天还没跑过时补跑这一轮，窗口外启动则等到下一个钟点。配置了 `DETECTIVE_SYNC_DAILY_AT` 后忽略 `DETECTIVE_SYNC_INTERVAL_MINUTES`。每日时刻留空且间隔大于 0 时，仍按间隔运行，并在启动时立即执行。两者都关闭时不自动同步。必须只运行一个 worker。

`DETECTIVE_SYNC_COLLECT=both` 时，这一轮先采集 HackerTrip、WaytoAGI、Devpost，再做页面发现、抽取，以及未明确结束的主办方页面核对。官方来源和缺少日期的赛事也会核对；报名或提交截止用于安排核对顺序，不作为赛事已经结束的依据。默认每轮核对30个不同页面，调用方可显式指定批量大小。页面发现和核对只在模型启用时进行。重复赛事按已有规则合并，不另建一条。

结构化来源只有日期、正文明确写出同日时刻时，归一化会细化日期精度。模型返回的单个无效字段会被隔离，保留其余有效事实；单条来源详情失败时继续处理其他赛事，原有失败记录保留，等待后续同步更新。

`DETECTIVE_SYNC_EXTRACT_ENABLED` 默认 `true`，周期同步和 `contest-detective-sync` 只有在它与 `DETECTIVE_LLM_ENABLED` 都为 `true` 时才启用来源抽取。设为 `false` 后，HackerTrip、WaytoAGI、Devpost 的结构化入库照常运行，跳过主办方核对及依赖模型的来源发现；侦探和简历功能仍由 `DETECTIVE_LLM_ENABLED` 控制，不受这个来源开关影响。服务器修改 `/etc/contest-detective.env` 后重启服务即可生效；手动同步可在后端目录运行 `DETECTIVE_SYNC_EXTRACT_ENABLED=false uv run contest-detective-sync`，输出中的 `extraction_enabled` 应为 `false`。

安装并检查配置：

```sh
sudo install -m 644 deploy/contest-detective.service /etc/systemd/system/
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/contest-detective
sudo ln -s /etc/nginx/sites-available/contest-detective /etc/nginx/sites-enabled/contest-detective
sudo systemd-analyze verify /etc/systemd/system/contest-detective.service
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now contest-detective
sudo systemctl reload nginx
```

首次部署若 nginx 默认站点占用同一 IP，可移除默认站点的启用链接，保留配置原文件。已有其他应用的 nginx 配置应保留。

API 请求通过 HTTP/1.1 直接流式转发，关闭请求缓冲，避免简历原文先进入代理的临时文件。简历接口继续在内存中执行 2MiB 限制。

验收：

```sh
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H 'Host: 43.142.60.212' http://127.0.0.1/api/health
curl -fsSI -H 'Host: 43.142.60.212' http://127.0.0.1/
systemctl is-active contest-detective
```

`/api/agent/ask` 关闭代理缓冲，nginx 每个 IP 限每分钟 5 次；应用继续执行每分钟 5 次、每天 30 次限制。nginx 覆盖客户端的转发头，后端只信任回环代理。云控制台还需放行 TCP 80，之后通过 `http://43.142.60.212/` 访问。

查看日志用 `journalctl -u contest-detective`。更新先保留旧发布目录与数据库副本，再换到新发布文件并重启服务。已有的其他服务不参与此流程。

## PostgreSQL 迁移准备

当前生产仍使用 SQLite；本地可以用 compose 起 PostgreSQL。

### 配置

数据库配置二选一，同时设置 `DETECTIVE_DB_URL` 与组件会启动失败：

- 完整 URL：`DETECTIVE_DB_URL=postgresql+psycopg://...`
- 组件（推荐，密码不需要手工转义）：

```env
DETECTIVE_DB_HOST=127.0.0.1
DETECTIVE_DB_PORT=5432
DETECTIVE_DB_NAME=contest_detective
DETECTIVE_DB_USER=contest_detective
DETECTIVE_DB_PASSWORD=CHANGE_ME
DETECTIVE_DB_POOL_SIZE=5
DETECTIVE_DB_MAX_OVERFLOW=10
DETECTIVE_DB_POOL_TIMEOUT=30
DETECTIVE_DB_POOL_RECYCLE=1800
```

后端在容器内运行时，`DETECTIVE_DB_HOST` 用 compose 服务名 `postgres`；后端在宿主机运行时用 `127.0.0.1`。

### 本地 compose

```sh
cp .env.example .env
# 编辑 .env：注释 DETECTIVE_DB_URL，启用 DETECTIVE_DB_* 组件
docker compose --env-file .env -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml config   # 检查变量插值
```

`docker-compose.dev.yml` 使用同一组变量初始化容器：

- `DETECTIVE_DB_NAME` → `POSTGRES_DB`
- `DETECTIVE_DB_USER` → `POSTGRES_USER`
- `DETECTIVE_DB_PASSWORD` → `POSTGRES_PASSWORD`（必填）
- `DETECTIVE_DB_PORT` → 宿主机映射端口
- `DETECTIVE_PG_DATA_DIR` → 宿主机数据目录，默认 `./.data/postgres`，已被 `.gitignore` 忽略

数据目录是 bind mount，可以直接备份或迁移；切换目录前先停容器。`POSTGRES_*` 只在数据目录为空时初始化，修改密码后复用旧目录不会生效，需要 `ALTER ROLE` 或重建数据目录。

### 数据搬迁

源 SQLite 必须已经在 Alembic head，目标 PostgreSQL 必须已经迁移到 head 且除 `alembic_version` 外为空。搬迁前停止同步、通知和盯梢调度，避免切换窗口内继续写入。

先用单独的 PG 环境文件跑 dry-run：

```sh
sudo systemd-run --wait --pipe --collect \
  --unit=contest-detective-migrate-dryrun \
  --property=User=contest-detective \
  --property=EnvironmentFile=/etc/contest-detective-pg.env \
  --working-directory=/srv/contest-detective/backend \
  /srv/contest-detective/backend/.venv/bin/contest-detective-migrate-sqlite \
  --source /var/lib/contest-detective/contest.db --dry-run
```

确认报告中的源行数和目标为空后，再执行：

```sh
sudo systemd-run --wait --pipe --collect \
  --unit=contest-detective-migrate-apply \
  --property=User=contest-detective \
  --property=EnvironmentFile=/etc/contest-detective-pg.env \
  --working-directory=/srv/contest-detective/backend \
  /srv/contest-detective/backend/.venv/bin/contest-detective-migrate-sqlite \
  --source /var/lib/contest-detective/contest.db --apply
```

复制和校验在同一个 PostgreSQL 事务内完成；失败会整体回滚，目标仍为空。校验内容包括每张表的行数和规范化行哈希，以及 `contest_events` / `registration_code_sends` 的自增序列。

### 生产

- 需要 PostgreSQL 16 与 pgvector >= 0.8；数据库角色需要 `CREATE EXTENSION vector` 权限。
- 扩展由 Alembic revision `0016_pgvector_extension` 创建并校验版本，低于 0.8 会直接失败。
- 在 `/etc/contest-detective.env` 设置组件或完整 URL，按需调整 `DETECTIVE_DB_POOL_*`，然后运行：

```sh
cd /srv/contest-detective/backend
uv run alembic upgrade head
```

- 发布脚本按 `/etc/contest-detective.env` 判断数据库类型：SQLite 使用文件快照，PostgreSQL 使用 `pg_dump` / `pg_restore`；数据搬迁与生产切换另行处理，不要在切换前删除 SQLite 文件。

### Contest semantic retrieval

Postgres 部署可在 `/etc/contest-detective.env` 配置 `DETECTIVE_RAG_API_KEY`，使用硅基流动的免费 `BAAI/bge-m3`。模型与地址固定，每场比赛保存一个 1024 维向量。SQLite 始终只走关键词检索，不调用 embedding。

迁移后先回填现有比赛：

```sh
cd /srv/contest-detective/backend
uv run python -m contest_detective.bootstrap.rag_index
```

命令输出 `updated`、`unchanged`、`failed`，有失败时退出码为 1，可重新执行；已成功且内容未变的比赛不会重算。后续每轮定时同步或 `contest-detective-sync` 完成比赛提交后刷新索引。索引文本包含名称、简介、主题、已保存字段及各来源最新正文，不包含搜索摘要和抓取时间；正文按 8000 UTF-8 字节截断为单个输入，不切块。完整文本哈希决定是否更新向量。

侦探的 `search_contests` 在日期、状态、方式和屏蔽来源过滤后，合并全部关键词候选与最多 100 个余弦距离候选，用固定 RRF 排名去重，再按原名片结构分页。关键词一路始终执行，向量一路叠加召回，任一路失败只跳过该路，不中断搜索，也不向用户显示内部错误。没有关键词时沿用日期排序；有查询时按相关性排序，关键词路内仍沿用所选日期排序。具体信息仍通过 `get_contest` 读取出处。

固定评测题及标注位于 `backend/evals/contest_retrieval.json`。在对应比赛快照的 Postgres 副本完成回填后运行：

```sh
uv run python evals/evaluate_retrieval.py --cases evals/contest_retrieval.json --output /tmp/retrieval.json
```

评测关闭默认截止过滤以纳入历史比赛，原样将每题交给两种检索。Hit@5 表示前五项至少有一场相关比赛的问题比例；Precision@5 按每题五个名额计，少于五项的空位计为未命中。宽主题题按已存来源标签标注，具体需求题按简介及正文标注；结果用于比较召回，不代表参赛资格已核实。

## 个人中心配置

配置 `DETECTIVE_ACCOUNT_ENCRYPTION_KEY` 后才能保存个人模型与搜索密钥。使用独立的 Fernet 主密钥，生成方式见根目录 `.env.example`，生产环境单独生成并保管，不复用开发密钥。`DETECTIVE_PUBLIC_BASE_URL` 设为网站的 HTTPS 地址，供日历订阅和验证邮件使用。`DETECTIVE_QUERY_LIMITS_ENABLED=false` 为活动期间不限提问次数。

邮件默认关闭。启用 Resend 前配置 API key、已验证的发信域名和发件地址；默认限制 100 封/天、3000 封/月，超出免费预算前先确认费用。配置回执时填写 `DETECTIVE_RESEND_WEBHOOK_SECRET`。注册验证码和账户邮箱验证共用这项邮件服务与额度；邮件未启用或发送失败时，新用户无法完成注册。日常部署保留这些环境配置，不会自动生成主密钥或启用发信。

## 自动部署

只有一个生产环境。发布正式 GitHub Release 后，`Deploy production` 自动构建对应 tag 并部署；草稿、预发布、未合入 main 的提交不会部署。tag 使用 `vX.Y.Z`。发布前应确认该提交的常规 CI 已通过。

重新部署或回退时，在 Actions → Deploy production → Run workflow 中选择 main，填写一个已发布的正式版本 tag。流程使用同一套生产凭据，按顺序执行，不取消正在进行的部署。

管理员首次安装部署入口（服务器需有 Python 3、systemd、uv 和现有生产服务）：

```sh
sudo install -m 755 deploy/release.py /usr/local/sbin/contest-detective-deploy
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/contest-detective
sudo install -m 644 deploy/contest-detective-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo nginx -t && sudo systemctl reload nginx
```

首次启用 MCP 时，在发布包含 HTTP 入口的版本前安装上述 unit、代理配置与部署脚本；部署脚本在切换代码后启动 MCP。首次发布成功后执行 `sudo systemctl enable contest-detective-mcp`，使其开机启动。不要在仍运行旧版本代码时启动该 unit。

部署脚本在每次切换后按目标版本实际存在的入口重写 `/etc/systemd/system/<unit>.service.d/release.conf`（网站与 MCP 分别处理），并执行 `systemctl daemon-reload`。因此升级、重新部署和回退到旧包结构的版本都不需要手工修改 unit；但 unit 文件本身仍需按上述命令在首次安装时放入。

MCP 不执行迁移或采集。服务器上的 HTTP MCP 与网站共用 `DETECTIVE_DB_*`（SQLite 或 PostgreSQL）；本地 stdio MCP 仍以 SQLite `mode=ro` 打开文件，缺库或缺表时启动失败。个人令牌鉴权另用连接更新最近使用时间，因此 systemd 允许服务写入同一数据目录；工具不提供业务数据写入操作。SDK 保持 Host 与 Origin 校验，默认允许公网 IP 及回环地址。更换域名时，用环境变量 `DETECTIVE_MCP_ALLOWED_HOSTS` 和 `DETECTIVE_MCP_ALLOWED_ORIGINS` 配置 JSON 数组白名单并重启 MCP，示例见根目录 `.env.example`。nginx 保留原始 Host 和 Origin，每个 IP 限每分钟 60 次请求、突发 20 次和 4 个并发连接，请求体上限 64 KiB。

为 Actions 单独生成 Ed25519 密钥，公钥加到部署用户的 `~/.ssh/authorized_keys`，整行前缀必须是：

```text
restrict,command="sudo -n /usr/local/sbin/contest-detective-deploy" ssh-ed25519 <public-key>
```

部署用户须能免密码 sudo 执行这个固定入口；密钥只允许向入口传输发布包，不能用于交互登录或端口转发。服务器主机公钥从已有可信 SSH 连接读取，不在 Action 中临时信任扫描结果。

仓库 Actions 配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `PRODUCTION_HOST` | 生产服务器地址 |
| Variable | `PRODUCTION_USER` | 部署 SSH 用户 |
| Variable | `PRODUCTION_URL` | 生产访问地址，无末尾 `/` |
| Secret | `PRODUCTION_SSH_KEY` | 专用部署私钥 |
| Secret | `PRODUCTION_KNOWN_HOSTS` | 已核验的 SSH known_hosts 条目 |

Action 先通过同一受限 SSH 入口读取当前发布的文件 SHA-256 清单，再只上传内容变化的文件和完整目标清单，日志显示变化文件数、复用文件数及压缩包字节数。未变的 OCR/WASM 等资源在服务器复制到新的候选目录；目标清单中已经删除的文件不会带入新版本。文件在复用前与复制后都核对哈希，当前文件缺失或变化时在停服前中止。清单请求失败时直接停止，不自动改传完整包。接收端仍支持旧格式完整包，以兼容既有发布工具。

启用增量部署前，管理员须先用上述安装命令更新 `/usr/local/sbin/contest-detective-deploy`；SSH 公钥、sudoers 与授权范围保持原配置。清单接口只列出可发布文件，不包含运行环境、虚拟环境或密钥。Action 会保留自身版本的打包工具，因此手动重新部署旧 tag 时也使用当前增量协议。

增量包包含该版本的 `deploy/server.env.example`。服务器先在 `/srv/contest-detective-releases/` 准备依赖；若环境文件缺少 `DETECTIVE_LLM_NORMALIZATION_PROMPT_PATH`，只从示例补入这一项，已有值、密钥与其他设置保持原样。相对模板路径可由 `backend/src/contest_detective/agent` 目录解析，默认是 `templates/contest_normalization.jinja2`。候选版本使用服务账号加载实际配置并渲染模板，通过后才暂停公网访问、停止网站及 MCP、备份数据库、执行迁移并切换 `/srv/contest-detective` 链接。配置检查、健康检查不调用模型或搜索。

数据库备份按环境文件中的 `DETECTIVE_DB_*` 判断：

- SQLite：使用 `sqlite3.backup` 生成 `contest.db`；
- PostgreSQL：使用 `pg_dump --format=custom` 生成 `contest.dump`；失败回滚时先 `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`，再 `pg_restore --no-owner --no-privileges --exit-on-error`。

PostgreSQL 备份与恢复需要服务器安装 `postgresql-client-16`（主版本不低于服务器），并且运行发布脚本的 root 用户能读取 `/etc/contest-detective.env`。组件配置通过 `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` 传给 `pg_dump` 和 `pg_restore`；完整 URL 会解析为同一组环境变量，不会把密码放到命令行。回滚会恢复到备份时刻，备份后的写入会丢失。

数据库角色必须拥有 `public` schema，并能创建/恢复 `vector` 扩展；托管 PostgreSQL 若由管理员预装扩展，回滚前应确认 `CREATE EXTENSION` 权限，或由管理员执行恢复。`/etc/contest-detective.env` 只使用简单的 `KEY=VALUE`；不要使用行继续或 C 风格转义，密码建议使用十六进制或带引号的简单值。PostgreSQL 部署还需要包含 MCP PostgreSQL 支持的版本；旧版本会在 `/mcp` 健康检查处回滚。

后端、nginx、前端版本与 MCP 初始化检查通过后恢复访问。失败会恢复本次补配前的环境文件、旧代码与数据库，并按旧版本能力启动服务；模板检查失败时网站尚未停止。回退到尚无 HTTP 入口的版本时保持 MCP 停止。恢复失败时维持维护状态，管理员查看 Action 日志及 `journalctl -u contest-detective -u contest-detective-mcp` 后处理。环境文件原件仅在补配时保存到备份目录的 `environment`，权限为 600。

数据库快照在 `/srv/contest-detective-backups/release-*/contest.db`（SQLite）或 `contest.dump`（PostgreSQL），同目录的 `previous-release` 指向更新前代码。旧发布目录与快照保留供恢复，管理员应按磁盘容量定期清理，当前链接指向的发布目录必须保留。回退到旧 tag 会保留当前数据库并执行该版本迁移，不等同于还原历史数据库；存在不兼容迁移时应由管理员先确认恢复方案。

修改部署入口脚本或 nginx 配置后，管理员须重新执行安装命令；业务版本的日常发布无需登录服务器。

本地验证部署入口：`python3 -m unittest discover -s deploy/tests -v`。
