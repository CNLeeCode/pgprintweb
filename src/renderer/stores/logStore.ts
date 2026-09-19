import { create } from 'zustand'
import type { HistoryLogItem } from '@shared/types/models'

/** 连接日志状态（对应 KMP HistoryLog） */
interface LogState {
  logs: HistoryLogItem[]
  addLog: (message: string, level?: HistoryLogItem['level']) => void
  setLogs: (logs: HistoryLogItem[]) => void
}

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],
  addLog: (message, level = 'info') => {
    const item: HistoryLogItem = {
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message,
      level
    }
    set({ logs: [item, ...get().logs].slice(0, 100) })
  },
  setLogs: (logs) => set({ logs })
}))