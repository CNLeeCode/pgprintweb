import { create } from 'zustand'
import { electronAPI } from '../api/bridge'
import log from '../utils/logger'

/**
 * 接口调用日志条目（与主进程 ApiLogEntry 结构一致）
 *
 * 用途：Footer 接口状态指示灯 + ApiLogDialog 列表展示。
 * 数据来源：
 *  1. 启动时 getApiLogs 拉一次最近 50 条做兜底
 *  2. 订阅 api:log 事件实时增量更新
 */
export interface ApiLogEntry {
  time: string
  method: string
  status: 'success' | 'fail'
  code?: number | string
  message: string
}

interface ApiLogState {
  /** 接口调用日志列表（新追加到末尾，max 50） */
  logs: ApiLogEntry[]
  /** 是否已订阅 api:log 事件（防重复订阅） */
  initialized: boolean
  /** 启动：订阅 api:log 事件 + 拉取最近日志（仅调用一次） */
  init: () => Promise<void>
  /** 手动添加一条（兼容 fallback 时使用） */
  append: (entry: ApiLogEntry) => void
  /** 清空日志（切换门店时调用，避免旧门店日志干扰） */
  clear: () => void
}

export const useApiLogStore = create<ApiLogState>((set, get) => ({
  logs: [],
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })

    // 订阅主进程接口日志事件：每条接口调用结果都会触发
    electronAPI.on('api:log', (entry: unknown) => {
      const e = entry as ApiLogEntry
      if (!e || !e.method) return
      set((state) => {
        const next = [...state.logs, e]
        if (next.length > 50) next.shift()
        return { logs: next }
      })
    })

    // 拉一次当前最近日志（兜底：渲染进程启动前主进程已记录的日志）
    try {
      const initial = (await electronAPI.getApiLogs()) as ApiLogEntry[]
      if (Array.isArray(initial) && initial.length > 0) {
        set({ logs: initial.slice(-50) })
      }
    } catch (e) {
      log.warn('拉取最近接口日志失败:', e)
    }
  },

  append: (entry) =>
    set((state) => {
      const next = [...state.logs, entry]
      if (next.length > 50) next.shift()
      return { logs: next }
    }),

  clear: () => set({ logs: [] })
}))