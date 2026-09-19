import { create } from 'zustand'
import { electronAPI } from '../api/bridge'
import type { AppUpdateInfo } from '@shared/types/models'
import log from '../utils/logger'

/**
 * 升级状态机（方案 B：后端接口直返下载地址 + 主进程 https 下载）
 *
 * 单检查机制：
 *  调主进程 update:check → UpgradeService 调 getAppUpdateInfo 接口
 *  → 按 downloadUrl 是否非空判定有无新版本（前端不做版本号比较）
 *  → 有新版本：主进程后台静默下载（AUTO_DOWNLOAD）→ 下载完成弹"立即重启升级"
 *
 * 状态流转：
 *  checking → update（有新版本）→ downloading → downloaded（可安装）
 *  checking → usual（已是最新 / 接口失败降级，均不阻断启动）
 *
 * 与 KMP 原版差异：
 *  KMP 用 getLastAppVersionData 检查版本 + Velopack 下载安装；
 *  Electron 改用 getWebPgPrintUpdateInfo 返回完整下载地址 + Node https 下载 + nsis 静默安装。
 */
type CheckStatus = 'idle' | 'checking' | 'update' | 'usual' | 'error'
type DownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error'

/** 下载进度 */
interface ProgressInfo {
  percent: number
  transferred: number
  total: number
}

interface UpdateState {
  /** 版本检查状态 */
  status: CheckStatus
  /** 最新版本号 */
  version?: string
  /** 检查失败信息 */
  message?: string
  /** 下载状态 */
  downloadStatus: DownloadStatus
  /** 下载进度 */
  progress?: ProgressInfo
  /** 下载/安装错误信息 */
  errorMessage?: string
  /** 更新说明（接口返回，更新弹窗展示） */
  updateMsg?: string
  /** 是否强制更新（1=强制，0=非强制） */
  forceUpdate?: boolean
  /** 是否已订阅事件（防止重复订阅） */
  initialized: boolean
  /** 下载完成（用于触发弹窗自动打开） */
  downloaded: boolean
  /** 检查版本（调 getAppUpdateInfo 接口 + 版本对比） */
  checkVersion: () => Promise<void>
  /** 初始化：订阅主进程升级事件（仅一次） */
  init: () => void
  /** 下载更新 */
  downloadUpdate: () => Promise<void>
  /** 退出并安装 */
  installUpdate: () => void
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'checking',
  version: undefined,
  message: undefined,
  downloadStatus: 'idle',
  progress: undefined,
  errorMessage: undefined,
  updateMsg: undefined,
  forceUpdate: false,
  initialized: false,
  downloaded: false,

  init: () => {
    if (get().initialized) return
    set({ initialized: true })

    // 订阅主进程升级事件
    electronAPI.on('update:status-changed', (s) => {
      const status = s as DownloadStatus
      set({ downloadStatus: status })
    })
    electronAPI.on('update:available', (info) => {
      const u = info as AppUpdateInfo
      set({
        status: 'update',
        version: u.version,
        updateMsg: u.updateMsg,
        // forceUpdate 后端返回字符串 "0"/"1"，用 == 兼容字符串与数字两种形态
        forceUpdate: u.forceUpdate == '1' || u.forceUpdate === 1
      })
      log.info('发现新版本:', u.version, '强制更新:', u.forceUpdate)
    })
    electronAPI.on('update:not-available', () => {
      // 已是最新（或接口失败降级）：进入 usual 状态，SplashView 1秒后跳登录页
      // 不阻断启动——更新检查失败不应阻止用户使用应用
      set({ status: 'usual' })
    })
    electronAPI.on('update:progress', (p) => {
      set({ progress: p as ProgressInfo, downloadStatus: 'downloading' })
    })
    electronAPI.on('update:downloaded', () => {
      set({ downloadStatus: 'downloaded', downloaded: true })
      log.info('更新包下载完成，可安装')
    })
    electronAPI.on('update:error', (msg) => {
      // 下载/安装阶段错误：设 error 状态，但检查阶段的失败已由 update:not-available 处理
      set({ downloadStatus: 'error', errorMessage: String(msg) })
      log.error('更新出错:', msg)
    })
  },

  checkVersion: async () => {
    set({ status: 'checking' })

    // 方案 B：直接调主进程检查，由 UpgradeService 统一处理接口+对比+广播
    // checkUpdate 内部会触发 update:available / update:not-available / update:error 事件
    get().init()
    const info = (await electronAPI.checkUpdate()) as AppUpdateInfo | null

    if (info) {
      // 有新版本：UpgradeService 已广播 update:available 事件，这里保底设置状态
      // forceUpdate 后端返回字符串 "0"/"1"，用 == 兼容字符串与数字两种形态
      set({ status: 'update', version: info.version, updateMsg: info.updateMsg, forceUpdate: info.forceUpdate == '1' || info.forceUpdate === 1 })
    } else {
      // 无新版本或检查失败：根据主进程状态判断
      // 若接口正常但无新版本，UpgradeService 会广播 update:not-available
      // 若接口失败，UpgradeService 会广播 update:error
      // 这里降级处理：若仍处于 checking，说明事件未触达，按"已最新"处理不阻断启动
      if (get().status === 'checking') {
        log.warn('版本检查未返回结果，降级跳过更新检查')
        set({ status: 'usual', message: '版本检查不可用' })
      }
    }
  },

  downloadUpdate: async () => {
    await electronAPI.downloadUpdate()
  },

  installUpdate: () => {
    electronAPI.installUpdate()
  }
}))