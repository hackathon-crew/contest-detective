import { defineConfig } from '@hey-api/openapi-ts'

// 只生成类型，不生成请求客户端：后端恒返回 HTTP 200、对错看 body 的 code，
// 生成的客户端按 HTTP 状态判成败，对不上这套约定。请求统一走 shared/api 的 createApiClient。
// 输出目录每次整体重写，不手改。
export default defineConfig({
  input: '../backend/openapi.json',
  output: 'src/shared/api/generated',
  plugins: ['@hey-api/typescript'],
})
