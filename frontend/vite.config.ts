import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'AGENTPLAZA_')
  return {
    plugins: [vue()],
    resolve: { alias: { '@': resolve('src') } },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.AGENTPLAZA_DEV_API_TARGET || 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
    define: { __DEV__: mode === 'development' },
  }
})
