import { create } from 'zustand'
import { electronAPI } from '../api/bridge'
import type { PrintPlatform } from '@shared/types/models'

/**
 * @file 平台列表状态（对应 KMP component.printPlatform / checkedPrintPlatform）
 * @module stores/platformStore
 *
 * 职责：
 *  1. 通过 IPC 调用 ApiService.getPlatformList 拉取平台列表
 *  2. 维护用户勾选的平台 id 列表 checkedIds
 *  3. 【持久化】checkedIds 同步写入 electron-store 的 selectedPlatformIds
 *     （逗号分隔字符串），应用重启时自动恢复，避免用户每次重新勾选
 *  4. 【门店切换清空】clearChecked() 供切换/退出门店时调用，清空持久化
 *
 * 恢复时机：refresh() 拉取平台列表成功后，立即从持久化读取 selectedPlatformIds，
 *          按当前返回的平台列表过滤无效 id（防止服务器下架某平台后还残留勾选），
 *          再 set 进 checkedIds。
 *
 * 持久化时机：togglePlatform / toggleAll 任意变更后立即写回，避免应用异常退出丢失。
 *
 * 清空时机：仅在以下场景清空（对应 KMP 切换门店时 checkedPrintPlatform.clear()）：
 *  - HomeView.handleSwitchShop 切换门店
 *  - LoginView.handleConfirm 输入新门店号登录
 *  - 用户已登录状态下重启应用进 HomeView → 不清空，恢复上次勾选
 */
type Status = 'idle' | 'loading' | 'success' | 'error'

/** electron-store 中存储勾选平台 id 的 key */
const STORE_KEY = 'selectedPlatformIds'

/** 逗号分隔符（与 StoreService 默认约定一致） */
const SEP = ','

interface PlatformState {
  status: Status
  platforms: PrintPlatform[]
  checkedIds: string[]
  errorMsg?: string
  /** 拉取平台列表并恢复持久化的勾选项 */
  refresh: () => Promise<void>
  /** 切换单个平台勾选状态，并同步持久化 */
  togglePlatform: (id: string) => void
  /** 全选/取消全选，并同步持久化 */
  toggleAll: (all: boolean) => void
  /** 清空勾选 + 删除持久化（仅切换/退出门店时调用） */
  clearChecked: () => Promise<void>
}

/**
 * 把 checkedIds 写回 electron-store（逗号分隔字符串）
 * @param ids 平台 id 数组
 */
async function persistCheckedIds(ids: string[]): Promise<void> {
  await electronAPI.setConfig(STORE_KEY, ids.join(SEP))
}

/**
 * 从 electron-store 读取持久化的勾选 id 数组
 * @returns 持久化的 id 数组（无持久化或解析失败返回 []）
 */
async function loadPersistedIds(): Promise<string[]> {
  const saved = (await electronAPI.getConfig(STORE_KEY)) as string | undefined
  if (!saved || typeof saved !== 'string') return []
  return saved.split(SEP).map((s) => s.trim()).filter(Boolean)
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  status: 'idle',
  platforms: [],
  checkedIds: [],

  refresh: async () => {
    set({ status: 'loading' })
    const res = await electronAPI.getPlatformList()
    if (!res) {
      set({ status: 'error', errorMsg: '网络请求失败' })
      return
    }
    if (res.code !== 200) {
      set({ status: 'error', errorMsg: res.msg || '获取平台列表失败' })
      return
    }
    const platforms = res.data || []
    // 恢复持久化的勾选项，过滤掉当前平台列表里不存在的 id
    // （防止服务器下架平台后，残留无效勾选导致 PrintService 启停轮询异常）
    const persisted = await loadPersistedIds()
    const validIds = new Set(platforms.map((p) => p.id))
    const restoredIds = persisted.filter((id) => validIds.has(id))
    set({ status: 'success', platforms, checkedIds: restoredIds, errorMsg: undefined })
    // 如果持久化里有无效 id 被过滤掉了，写回一次"干净"的列表，避免下次还残留
    if (restoredIds.length !== persisted.length) {
      await persistCheckedIds(restoredIds)
    }
  },

  togglePlatform: (id) => {
    const checked = get().checkedIds
    const next = checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]
    set({ checkedIds: next })
    // 同步持久化（fire-and-forget，写失败不影响 UI）
    void persistCheckedIds(next)
  },

  toggleAll: (all) => {
    const next = all ? get().platforms.map((p) => p.id) : []
    set({ checkedIds: next })
    void persistCheckedIds(next)
  },

  clearChecked: async () => {
    // 清空内存勾选 + 清空持久化（写空串而非删 key，IPC 契约未暴露 store:delete）
    set({ checkedIds: [] })
    await persistCheckedIds([])
  }
}))
