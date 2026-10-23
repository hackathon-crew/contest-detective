import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// 前端只认 /api。开发时这里把 /api 转发给本机后端并去掉前缀，线上由 nginx 做同样的事，
// 所以后端路由本身不带 /api，前后端同域也不用处理跨域。
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // @/xxx 指向 src/xxx，需与 tsconfig.app.json 的 paths 一致
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    // 纯逻辑测试跑 node；需要 DOM 的测试在文件顶部写 @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
