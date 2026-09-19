import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: [
          'better-sqlite3',
          'serialport',
          'usb',
          'electron-store',
          'electron-updater',
          'node-thermal-printer',
          'bwip-js',
          'iconv-lite',
          'pngjs',
          '@thiagoelg/node-printer'
        ]
      }
    },
    resolve: {
      alias: { '@main': resolve('src/main'), '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
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
})