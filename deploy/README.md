# 服务器运行

使用已发布版本。静态文件在 `frontend/dist`，后端只监听回环地址，nginx 将 `/api/` 转发给后端。独立只读 MCP 监听 `127.0.0.1:8001`，nginx 将 `/mcp` 原路径转发给它。两个进程读取同一份 `/var/lib/contest-detective/contest.db`，更新代码时保留该目录。

服务器安装 nginx、uv 和 Git。前端在本地对应版本运行 `npm ci && npm run build`，将 `dist` 传到服务器；后端在服务器运行：

```sh
sudo install -d -m 755 /srv/contest-detective /opt/contest-python
# 将对应发布版本解压到 /srv/contest-detective
cd /srv/contest-detective/backend
sudo env UV_PYTHON_INSTALL_DIR=/opt/contest-python uv sync --locked --no-dev --python 3.12
```

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

工具参数校验失败时允许模型纠正 3 次；网页抽取格式不合要求时允许纠正 2 次，纠正请求仍计入总请求预算。侦探自主选择查证路径，回答不因日期、引用格式或时刻措辞被拦截；尚未核实的信息在回答中说明。单个工具执行失败会作为工具结果交给侦探，由它选择其他来源或方法；工具和 SDK 不盲目自动重试。模型服务中断时，会返回已取得的资料并说明尚未完成核实。

比赛库查询支持 `page` 和 `page_size` 翻页，联网搜索使用请求的条数。网页读取保留完整正文，也支持用 `offset` 和 `length` 分段继续读，正常解压 gzip 等受支持的编码；下载仍按解压后的大小限制资源占用。提问与完整的已完成对话前文直接传给模型，不再按500字、六轮、12KB或每条2500字截断，实际上下文容量由模型服务处理。

同步在北京时间每天 03:00 起的 60 分钟内运行一次。进程在窗口内启动且当天还没跑过时补跑这一轮，窗口外启动则等到下一个钟点。配置了 `DETECTIVE_SYNC_DAILY_AT` 后忽略 `DETECTIVE_SYNC_INTERVAL_MINUTES`。每日时刻留空且间隔大于 0 时，仍按间隔运行，并在启动时立即执行。两者都关闭时不自动同步。必须只运行一个 worker。

`DETECTIVE_SYNC_COLLECT=both` 时，这一轮先采集 HackerTrip、WaytoAGI、Devpost，再做页面发现、抽取，以及 30 天内仍未截止的报名页核对。页面发现和核对只在模型启用时进行。重复赛事按已有规则合并，不另建一条。

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

MCP 不执行迁移或采集，SQLite 使用 `mode=ro`，systemd 也将数据目录设为只读；缺库或缺表时启动失败。SDK 保持 Host 与 Origin 校验，默认允许公网 IP 及回环地址。更换域名时，用环境变量 `DETECTIVE_MCP_ALLOWED_HOSTS` 和 `DETECTIVE_MCP_ALLOWED_ORIGINS` 配置 JSON 数组白名单并重启 MCP，示例见根目录 `.env.example`。nginx 保留原始 Host 和 Origin，每个 IP 限每分钟 60 次请求、突发 20 次和 4 个并发连接，请求体上限 64 KiB。

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

Action 通过 SSH 标准输入发送构建包。服务器先在 `/srv/contest-detective-releases/` 准备依赖，再暂停公网访问、停止网站及 MCP、备份 SQLite、执行迁移并切换 `/srv/contest-detective` 链接。后端、nginx、前端版本与 MCP 初始化检查通过后恢复访问。失败会恢复旧代码与数据库，并按旧版本能力启动服务；回退到尚无 HTTP 入口的版本时保持 MCP 停止。恢复失败时维持维护状态，管理员查看 Action 日志及 `journalctl -u contest-detective -u contest-detective-mcp` 后处理。`/etc/contest-detective.env` 保持原样，健康检查不调用模型或搜索。

数据库快照在 `/srv/contest-detective-backups/release-*/contest.db`，同目录的 `previous-release` 指向更新前代码。旧发布目录与快照保留供恢复，管理员应按磁盘容量定期清理，当前链接指向的发布目录必须保留。回退到旧 tag 会保留当前数据库并执行该版本迁移，不等同于还原历史数据库；存在不兼容迁移时应由管理员先确认恢复方案。

修改部署入口脚本或 nginx 配置后，管理员须重新执行安装命令；业务版本的日常发布无需登录服务器。

本地验证部署入口：`python3 -m unittest discover -s deploy/tests -v`。
