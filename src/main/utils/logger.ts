import log from 'electron-log/main'
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

/**
 * 日志系统初始化（对应 KMP CrashHandler.kt + logback）
 *
 * - electron-log：分级日志文件，按日期轮转
 * - crashReporter：原生崩溃 dump
 * - process.on('uncaughtException')：未捕获异常兜底
 *
 * 注意：electron-log 的 file transport 在 resolvePathFn 返回自定义路径时，
 * 不会自动创建该路径的目录；若目录不存在，日志会被静默丢弃（info/error 全丢，
 * 仅启动早期用默认路径写入的 warn 可见）。故此处必须显式 mkdirSync 创建 logs 目录。
 */
export function initLogger(): void {
  // 日志目录：{APPDATA}/pgprint/logs/
  const logsDir = join(app.getPath('userData'), 'logs')
  // 必须显式创建：electron-log 自定义路径不自动建目录
  try {
    mkdirSync(logsDir, { recursive: true })
  } catch {
    // 目录已存在或创建失败时忽略，electron-log 会兜底尝试
  }
  log.transports.file.resolvePathFn = () => join(logsDir, 'main.log')
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB 轮转
  log.transports.console.level = 'debug'
  log.initialize()

  log.info('========== pgprinter 启动 ==========')
  log.info('版本:', app.getVersion())
  log.info('平台:', process.platform)
  log.info('Electron:', process.versions.electron)
  log.info('Node:', process.versions.node)
  log.info('Chromium:', process.versions.chrome)

  const errorHandler = (err: Error) => {
    log.error('未捕获异常:', err?.stack || err)
  }
  process.on('uncaughtException', errorHandler)
  process.on('unhandledRejection', (reason) => {
    log.error('未处理的 Promise 拒绝:', reason)
  })
}