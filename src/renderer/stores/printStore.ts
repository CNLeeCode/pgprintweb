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
 *  4. 订阅 print:failed-updated 事件更新 failedMap（重试超限订单标红可重打）
 */
interface PrintState {
  /** 已打印订单 Map<platformId, Map<orderId, ShopPrintOrderItem>> */
  printedMap: Record<string, Record<string, ShopPrintOrderItem>>
  /** 待打印订单 Map<platformId, Map<orderId, ShopPrintOrderItem>> */
  pendingMap: Record<string, Record<string, ShopPrintOrderItem>>
  /** 失败（重试超限）订单 Map<platformId, Map<orderId, true>>，true 仅作存在标识 */
  failedMap: Record<string, Record<string, true>>
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
  /** 设置失败订单快照 */
  setFailedSnapshot: (snap: Record<string, Record<string, true>>) => void
}

export const usePrintStore = create<PrintState>((set, get) => ({
  printedMap: {},
  pendingMap: {},
  failedMap: {},
  initialized: false,

  loadSnapshots: async () => {
    const snap = await electronAPI.getPrintSnapshots()
    if (snap) {
      // BUGFIX: loadSnapshots 同时拉取失败订单快照，确保启动时已失败订单被标红
      const failed = await electronAPI.getFailed()
      set({
        printedMap: snap.printed || {},
        pendingMap: snap.pending || {},
        failedMap: failed || {}
      })
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
    // BUGFIX: 订阅 failed-updated，重试超限订单标红 + 提供重打入口
    electronAPI.on('print:failed-updated', (snap) => {
      set({ failedMap: snap as Record<string, Record<string, true>> })
    })
  },

  setPrintedSnapshot: (snap) => set({ printedMap: snap }),
  setPendingSnapshot: (snap) => set({ pendingMap: snap }),
  setFailedSnapshot: (snap) => set({ failedMap: snap })
}))