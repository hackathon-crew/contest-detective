# Inkpaw 前端

React + TypeScript + Vite。

## 侦探对话

顶部「侦探」进入聊天页；首页底部输入口发送后也会进入对应对话。左上角的小按钮展开会话记录，支持新建和切换。文字与工具步骤通过真实 `/api/agent/ask` 接口展示；正文在出处校验完成后逐字显现。

记录保存在当前浏览器，并按登录身份隔离。刷新后可以继续追问，离开聊天页时正在生成的回复继续保留；跨设备不共享记录。每条回复下方只列出比赛库已标为官方且未标记过时的来源。请求只携带最近六轮已完成的前文，最多 12KB；旧回复作为上下文，日期和出处仍需本轮重新查证。

## 开发

```bash
npm ci
npm run dev
```

开发服务器把 `/api` 转发到 `http://127.0.0.1:8000` 并去掉前缀，先在 `backend` 里用 `uv run contest-detective` 启动后端。后端在别的地址时，用环境变量 `VITE_API_PROXY_TARGET` 指过去。

## 检查

```bash
npm run format:check   # 格式
npm run lint           # 静态检查
npm run typecheck      # 类型
npm test               # 测试，包括分层依赖检查
npm run build          # 构建
```

CI 按这个顺序跑，最后再比对一遍生成的接口类型。

## 接口类型

后端改了路由或响应模型之后，在这里运行：

```bash
npm run generate:api
```

它先导出 `backend/openapi.json`，再生成 `src/shared/api/generated`，两处都要提交，生成的文件不手改。请求统一用 `@/shared/api` 的 `apiClient`，它负责解包 `code/message/data`，失败时抛 `ApiError`。

## 分层

`app → pages → features → entities → shared`，只能引用比自己低的层；`pages`、`features`、`entities` 下的每个子目录是一个切片，同层切片之间不互相引用。规则写在 `src/architecture.test.ts`，违反时 `npm test` 失败。

## 部署

`npm run build` 产出 `dist`，交给 nginx 托管静态文件，所有找不到的路径回退到 `index.html`，`/api/` 转发给后端并去掉前缀。前后端同域，后端不用配跨域。
