# 服务器运行

使用已发布版本。静态文件在 `frontend/dist`，后端只监听回环地址，nginx 将 `/api/` 转发给后端。数据库放在 `/var/lib/contest-detective`，更新代码时保留该目录。

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

环境文件只由管理员读取，systemd 将变量传给服务；密钥不放进代码目录。模型默认关闭。启用真实调用前配置密钥、确认余额与花费上限；服务器上限 3.5 元，本地另设 1.5 元。同步间隔 360 分钟，必须只运行一个 worker。

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

验收：

```sh
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H 'Host: 43.142.60.212' http://127.0.0.1/api/health
curl -fsSI -H 'Host: 43.142.60.212' http://127.0.0.1/
systemctl is-active contest-detective
```

`/api/agent/ask` 关闭代理缓冲，nginx 每个 IP 限每分钟 5 次；应用继续执行每分钟 5 次、每天 30 次限制。nginx 覆盖客户端的转发头，后端只信任回环代理。云控制台还需放行 TCP 80，之后通过 `http://43.142.60.212/` 访问。

查看日志用 `journalctl -u contest-detective`。更新先保留旧发布目录与数据库副本，再换到新发布文件并重启服务。已有的其他服务不参与此流程。
