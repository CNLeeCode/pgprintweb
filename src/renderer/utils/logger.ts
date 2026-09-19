/**
 * @file 渲染进程日志工具
 * @module utils/logger
 *
 * 职责：渲染进程轻量日志，开发环境输出到 console，
 * 生产环境可通过 IPC 转发到主进程 electron-log（后续扩展）。
 */
type Level = 'info' | 'warn' | 'error'

function emit(level: Level, args: unknown[]): void {
  const prefix = `[renderer]`
  // eslint-disable-next-line no-console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(prefix, ...args)
}

export const log = {
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args)
}

export default log