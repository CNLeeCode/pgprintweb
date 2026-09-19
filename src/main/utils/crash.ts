import { app, crashReporter } from 'electron'
import { join } from 'path'
import log from 'electron-log/main'

/**
 * 崩溃报告初始化（对应 KMP CrashHandler.kt）
 * 生成 native crash dump 到 userData/crashes 目录
 */
export function initCrashReporter(): void {
  const crashesDir = join(app.getPath('userData'), 'crashes')
  try {
    crashReporter.start({
      productName: 'pgprinter',
      companyName: 'BUTCOMPANY',
      submitURL: '',
      uploadToServer: false,
      ignoreSystemCrashHandler: true
    })
    log.info('crashReporter 已启动，dump 目录:', crashesDir)
  } catch (err) {
    log.error('crashReporter 启动失败:', err)
  }
}