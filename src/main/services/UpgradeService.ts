/**
 * @file 升级服务（方案 B：后端接口直返下载地址 + 主进程 https 下载 + nsis 静默安装）
 * @module services/UpgradeService
 *
 * 职责：
 *  1. 调 getAppUpdateInfo 获取最新版本号 + 下载地址 + 更新说明
 *  2. 与本地 APP_VERSION 对比，判断是否有新版本
 *  3. 用 Node https 模块下载 nsis 安装包到临时目录，广播下载进度
 *  4. 下载完成后 shell 启动 installer.exe /S --updated 静默覆盖安装
 *
 * 替代旧 UpdateService（electron-updater 方案）：
 *  - 不再依赖独立更新服务器 + latest.yml + sha512
 *  - 下载地址由后端接口返回，发版只需把 exe 丢到静态目录 + 改接口返回
 *
 * Win7 兼容性要点：
 *  - Node https 模块在 Win7 SP1+KB2533623 上支持 TLS1.2
 *  - nsis /S 静默安装无对话框，--updated 让安装器装完自启新版本
 *
 * 事件流：
 *  - update-available     检测到新版本（带 AppUpdateInfo）
 *  - update-not-available 已是最新
 *  - download-progress    下载进度(percent/transferred/total)
 *  - update-downloaded     下载完成（带本地安装包路径）
 *  - error                 检查/下载/安装出错
 */
import { EventEmitter } from 'events'
import { get, request } from 'https'
import { createWriteStream, statSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { ApiService } from './ApiService'
import { APP_VERSION, AUTO_DOWNLOAD } from '../config'
import type { AppUpdateInfo } from '@shared/types/models'

/** 下载进度信息 */
export interface DownloadProgress {
  /** 百分比 0-100 */
  percent: number
  /** 已下载字节数 */
  transferred: number
  /** 总字节数（未知时为 0） */
  total: number
}

/** 升级状态：idle/checking/available/downloading/downloaded/error */
export type UpgradeStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** 升级服务单例（替代旧 UpdateService） */
class UpgradeServiceImpl extends EventEmitter {
  private currentStatus: UpgradeStatus = 'idle'
  private lastProgress: DownloadProgress | null = null
  /** 最近一次检查到的更新信息（含版本号/下载地址/更新说明/强制更新标志） */
  private updateInfo: AppUpdateInfo | null = null
  /** 下载完成的本地安装包绝对路径 */
  private installerPath: string = ''
  /** 当前下载请求对象，用于取消 */
  private currentReq: ReturnType<typeof get> | null = null

  /**
   * 检查更新（主流程：调接口 + 按 downloadUrl 判定 + 广播结果）
   *
   * 判定规则（由后端控制，前端不做版本号比较）：
   *   - 接口请求失败 / code !== 200 → 无新版本（按"已最新"处理，不阻断启动）
   *   - code === 200 且 downloadUrl 为空 → 无新版本
   *   - code === 200 且 downloadUrl 非空 → 有新版本，按 downloadUrl 下载安装
   *
   * 说明：后端通过是否下发 download_url 来控制是否有新版本，前端无需关注
   * version 字段的具体值，避免本地与后端版本号格式不一致导致的误判。
   *
   * @returns 检查到的更新信息（无新版本或失败时为 null）
   */
  async checkForUpdates(): Promise<AppUpdateInfo | null> {
    this.setStatus('checking')
    log.info('升级检查：开始，APP_VERSION=', APP_VERSION)

    const res = await ApiService.getAppUpdateInfo()
    if (!res) {
      // 接口请求失败：降级按"已最新"处理，不阻断启动
      log.warn('升级检查：接口请求失败，降级跳过')
      this.setStatus('idle')
      this.emit('update-not-available', null)
      return null
    }
    if (res.code !== 200) {
      // 接口返回非 200：同样降级按"已最新"处理
      log.warn('升级检查：接口返回非200', res.code, res.msg)
      this.setStatus('idle')
      this.emit('update-not-available', null)
      return null
    }

    const info = res.data
    if (!info) {
      log.warn('升级检查：接口未返回 data')
      this.setStatus('idle')
      this.emit('update-not-available', null)
      return null
    }

    // 核心判定：downloadUrl 非空 → 有新版本；为空 → 无新版本
    if (info.downloadUrl && info.downloadUrl.trim()) {
      this.updateInfo = info
      this.setStatus('available')
      this.emit('update-available', info)
      log.info(
        `升级检查：发现新版本 ${info.version || '(未知)'}，下载地址 ${info.downloadUrl}，强制更新=${info.forceUpdate}`
      )

      // 自动下载策略：检测到新版本立即后台下载（静默不打扰用户）
      if (AUTO_DOWNLOAD) {
        log.info('AUTO_DOWNLOAD=true，开始后台静默下载')
        // 异步下载，不阻塞 await
        this.downloadUpdate(info.downloadUrl).catch((e) => {
          log.error('自动下载失败:', e)
        })
      }
      return info
    } else {
      // downloadUrl 为空 → 后端表示无新版本
      this.setStatus('idle')
      this.emit('update-not-available', info)
      log.info('升级检查：已是最新版本（downloadUrl 为空）', info.version)
      return null
    }
  }

  /**
   * 下载更新包（支持 302 重定向 + 断点续传）
   *
   * @param url 安装包下载地址（由后端接口返回）
   * @returns 本地安装包绝对路径
   */
  async downloadUpdate(url?: string): Promise<string> {
    const downloadUrl = url || this.updateInfo?.downloadUrl
    if (!downloadUrl) {
      this.emit('error', '下载地址为空，无法下载更新')
      return ''
    }

    // 若已下载完成则直接返回已有路径，避免重复下载
    if (this.installerPath && existsSync(this.installerPath)) {
      log.info('安装包已存在，跳过下载:', this.installerPath)
      this.setStatus('downloaded')
      this.emit('update-downloaded', this.installerPath)
      return this.installerPath
    }

    // 临时目录：Win7 友好，默认 app.getPath('temp')
    const tmpDir = app.getPath('temp')
    const fileName = downloadUrl.split('/').pop() || 'pgprint-setup.exe'
    const filePath = join(tmpDir, fileName)

    log.info(`开始下载更新包: ${downloadUrl} → ${filePath}`)
    this.setStatus('downloading')

    try {
      await this.downloadWithRedirect(downloadUrl, filePath, 0)

      this.installerPath = filePath
      this.setStatus('downloaded')
      this.emit('update-downloaded', filePath)
      log.info('更新包下载完成:', filePath)
      return filePath
    } catch (e) {
      this.setStatus('error')
      this.emit('error', (e as Error).message || String(e))
      log.error('更新包下载失败:', e)
      // 下载失败时清理半成品文件
      this.cleanupFile(filePath)
      throw e
    }
  }

  /**
   * 退出并安装（下载完成后调用）
   *
   * 启动 installer.exe /S --updated 静默覆盖安装：
   *  - /S 是 nsis 的静默安装参数，无任何对话框
   *  - --updated 是 electron-builder nsis 约定的"更新模式"标志
   *    装完后启动新版本，并传 --updated 让新版本知道自己是被升级启动的
   *  - detached:true + unref() 让子进程脱离父进程，父进程退出不影响安装器
   */
  quitAndInstall(): void {
    if (!this.installerPath) {
      log.warn('quitAndInstall 跳过：安装包路径为空')
      return
    }

    log.info('退出应用并启动静默安装:', this.installerPath)
    try {
      const child = spawn(
        this.installerPath,
        ['/S', '--updated'],
        { detached: true, stdio: 'ignore' }
      )
      child.unref()
      // 给安装器一点时间启动，再退出主进程
      setTimeout(() => {
        app.quit()
      }, 500)
    } catch (e) {
      log.error('启动安装器失败:', e)
      this.emit('error', `启动安装失败: ${(e as Error).message}`)
    }
  }

  /** 获取当前状态 */
  getStatus(): UpgradeStatus {
    return this.currentStatus
  }

  /** 获取上次下载进度 */
  getProgress(): DownloadProgress | null {
    return this.lastProgress
  }

  /** 获取最近一次检查的更新信息 */
  getUpdateInfo(): AppUpdateInfo | null {
    return this.updateInfo
  }

  /**
   * 带重定向处理的下载（最多 5 次跳转，防止死循环）
   *
   * 对象存储短链、CDN 通常会 302 重定向到真实地址，必须手动跟随。
   */
  private downloadWithRedirect(url: string, filePath: string, redirectCount: number): Promise<void> {
    if (redirectCount > 5) {
      return Promise.reject(new Error('重定向次数过多（>5），疑似死循环'))
    }

    return new Promise((resolve, reject) => {
      // 检查断点续传：若已有部分文件，用 Range 请求续传
      let existingSize = 0
      if (existsSync(filePath)) {
        existingSize = statSync(filePath).size
      }

      const headers: Record<string, string> = {}
      if (existingSize > 0) {
        headers['Range'] = `bytes=${existingSize}-`
        log.info(`断点续传：从 ${existingSize} 字节继续`)
      }

      const req = get(url, { headers }, (res) => {
        // 处理重定向
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          log.info(`下载重定向 ${res.statusCode} → ${res.headers.location}`)
          res.resume()
          this.downloadWithRedirect(res.headers.location, filePath, redirectCount + 1).then(resolve, reject)
          return
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`下载失败，HTTP ${res.statusCode}`))
          res.resume()
          return
        }

        // 206 表示续传，已下载大小需累加；200 表示全新下载，覆盖旧文件
        const isResume = res.statusCode === 206 && existingSize > 0
        const total = Number(res.headers['content-length'] || 0) + (isResume ? existingSize : 0)
        let transferred = isResume ? existingSize : 0

        // 节流进度广播，避免频繁 setState 拖慢 UI（200ms 一次）
        let lastEmit = 0

        const stream = createWriteStream(filePath, { flags: isResume ? 'a' : 'w' })
        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length
          const now = Date.now()
          if (now - lastEmit > 200) {
            lastEmit = now
            this.lastProgress = {
              percent: total ? Math.min(100, (transferred / total) * 100) : 0,
              transferred,
              total
            }
            this.emit('download-progress', this.lastProgress)
          }
        })
        res.pipe(stream)
        stream.on('finish', () => {
          stream.close()
          // 下载完成时补发一次 100% 进度
          this.lastProgress = { percent: 100, transferred, total }
          this.emit('download-progress', this.lastProgress)
          resolve()
        })
        stream.on('error', reject)
      })

      req.on('error', reject)
      this.currentReq = req
    })
  }

  /** 设置状态并广播 */
  private setStatus(status: UpgradeStatus): void {
    if (this.currentStatus !== status) {
      this.currentStatus = status
      this.emit('status-changed', status)
    }
  }

  /** 删除半成品文件 */
  private cleanupFile(filePath: string): void {
    try {
      if (existsSync(filePath)) unlinkSync(filePath)
    } catch {
      // 忽略清理失败
    }
  }
}

/** 升级服务单例 */
export const UpgradeService = new UpgradeServiceImpl()