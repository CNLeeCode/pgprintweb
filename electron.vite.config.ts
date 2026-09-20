import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * 构建 .env 变量 → process.env.XXX 的静态注入表
 *
 * 必要性：electron-vite 2.x 默认不会把 .env 中的 VITE_* 变量静态替换到
 * main / preload bundle 里（保留为 process.env.VITE_X 运行时表达式）。
 *
 * 后果：dev 模式下 electron-vite 启动脚本会自动把 .env 注入到 process.env
 * 能读到值；但 electron-builder 打包后运行的是 asar 内的 main bundle，
 * Node 主进程的 process.env 是宿主系统环境变量，根本没有 VITE_* 这些值 →
 * config.ts 里所有 `process.env.VITE_X || fallback` 全走 fallback 默认值。
 *
 * 典型故障：.env 配的 VITE_UPDATE_SERVER_URL=http://<更新服务IP>/... 不生效，
 * 实际请求打到 fallback 的 <生产域名>/.../getWebPgPrintUpdateInfo →
 * 该接口 404 → getAppUpdateInfo 返回 null → Splash 显示"检查更新失败"。
 *
 * 修复：构建时 loadEnv 读取 .env/.env.[mode]，把所有变量通过 define
 * 静态替换为字面字符串，确保打包后 main/preload 仍能读到 .env 的值。
 *
 * @param mode 构建模式（development / production）
 * @returns define 表，形如 { 'process.env.VITE_DOMAIN_URL': '"http://..."' }
 */
function buildEnvDefines(mode: string): Record<string, string> {
  // prefixes 传空串表示加载所有变量（不只是 VITE_ 前缀）
  const env = loadEnv(mode, process.cwd(), '')
  const defines: Record<string, string> = {}
  for (const key of Object.keys(env)) {
    defines[`process.env.${key}`] = JSON.stringify(env[key])
  }
  return defines
}

export default defineConfig(({ mode }) => {
  const envDefines = buildEnvDefines(mode)

  return {
    main: {
      // 静态注入 .env 变量到主进程 process.env（修复打包后丢失问题）
      define: envDefines,
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: { index: resolve(__dirname, 'src/main/index.ts') },
          external: [
            'serialport',
            'usb',
            'electron-store',
            'electron-updater',
            'node-thermal-printer',
            'bwip-js',
            'iconv-lite',
            'pngjs'
          ]
        }
      },
      resolve: {
        alias: { '@main': resolve('src/main'), '@shared': resolve('src/shared') }
      }
    },
    preload: {
      // preload 同样需要静态注入（preload 也可能读取 .env 变量）
      define: envDefines,
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
      }
    },
    renderer: {
      // renderer 不需要 define：Vite 自身已把 import.meta.env.VITE_* 注入
      root: resolve(__dirname, 'src/renderer'),
      plugins: [react()],
      resolve: {
        alias: { '@renderer': resolve('src/renderer'), '@shared': resolve('src/shared') }
      },
      server: {
        host: '0.0.0.0',
        allowedHosts: true
      },
      build: {
        rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})