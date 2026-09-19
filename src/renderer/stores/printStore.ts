import { create } from 'zustand'
import { electronAPI } from '../api/bridge'
import type { ShopPrintOrderItem } from '@shared/types/models'

/**
 * 打印订单状态（对应 KMP PrintTask.printedOrderMapList / pendingOrderMapList）
 * 结构：Map<platformId, Map<orderId, ShopPrintOrderItem>>
 *
 * 数据来源：
 *  1. 启动时调用 getPrintSnapshots 拉取主进程内存快照
 *  2. 订阅 print:printed-updated / print:pending-updated 事件实时更新
 *  3. 订阅 print:log / print:refund-notice 转发到 logStore
 */
interface PrintState {
  /** 已打印订单 Map<platformId, Map<orderId, ShopPrintOrderItem>> */
  printedMap: Record<string, Record<string, ShopPrintOrderItem>>
  /** 待打印订单 Map<platformId, Map<orderId, ShopPrintOrderItem>> */
  pendingMap: Record<string, Record<string, ShopPrintOrderItem>>
  /** 是否已初始化（防止重复订阅） */
  initialized: boolean
  /** 拉取主进程快照 */
  loadSnapshots: () => Promise<void>
  /** 订阅 IPC 事件（仅调用一次） */
  subscribe: () => void
  /** 设置已打印快照 */
  setPrintedSnapshot: (snap: Record<string, Record<string, ShopPrintOrderItem>>) => void
  /** 设置待打印快照 */
  setPendingSnapshot: (snap: Record<string, Record<string, ShopPrintOrderItem>>) => void
}

export const usePrintStore = create<PrintState>((set, get) => ({
  printedMap: {},
  pendingMap: {},
  initialized: false,

  loadSnapshots: async () => {
    const snap = await electronAPI.getPrintSnapshots()
    if (snap) {
      set({ printedMap: snap.printed || {}, pendingMap: snap.pending || {} })
    }
  },

  subscribe: () => {
    if (get().initialized) return
    set({ initialized: true })
    // 已打印快照变更
    electronAPI.on('print:printed-updated', (snap) => {
      set({ printedMap: snap as Record<string, Record<string, ShopPrintOrderItem>> })
    })
    // 待打印快照变更
    electronAPI.on('print:pending-updated', (snap) => {
      set({ pendingMap: snap as Record<string, Record<string, ShopPrintOrderItem>> })
    })
  },

  setPrintedSnapshot: (snap) => set({ printedMap: snap }),
  setPendingSnapshot: (snap) => set({ pendingMap: snap })
}))