import { create } from 'zustand'
import { electronAPI } from '../api/bridge'
import log from '../utils/logger'

/**
 * 网络状态（对应 KMP NetworkCheck.networkStatusData）
 * 数据来源：
 *  1. 启动时调用 getNetworkStatus 拉取主进程当前状态
 *  2. 订阅 network:status-changed 事件实时更新
 *  3. 手动 checkNetwork 触发一次检查
 */
type NetStatus = 1 | 2

interface NetworkState {
  status: NetStatus
  message: string
  initialized: boolean
  /** 启动定时检查 + 订阅事件（仅调用一次） */
  init: () => Promise<void>
  /** 手动触发一次检查 */
  check: () => Promise<void>
  /** 设置状态 */
  setStatus: (status: NetStatus, message: string) => void
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  status: 2,
  message: '网络检查中...',
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    // 订阅状态变更事件
    electronAPI.on('network:status-changed', (status) => {
      const s = status as { status: 1 | 2; message: string }
      set({ status: s.status, message: s.message })
    })
    // 启动定时检查
    await electronAPI.startNetworkCheck()
    // 立即拉取一次当前状态
    const current = await electronAPI.getNetworkStatus()
    if (current) {
      set({ status: current.status, message: current.message })
    }
    log.info('网络检查已启动')
  },

  check: async () => {
    const result = await electronAPI.checkNetwork()
    if (result) {
      set({ status: result.status, message: result.message })
    }
  },

  setStatus: (status, message) => set({ status, message })
}))