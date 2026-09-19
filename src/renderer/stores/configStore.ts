import { create } from 'zustand'
import { electronAPI } from '../api/bridge'

/**
 * 配置状态（对应 KMP DataStored）
 * 存储/读取门店号等本地配置
 */
interface ConfigState {
  shopId: string
  /** 从 electron-store 读取已保存的门店号 */
  loadShopId: () => Promise<void>
  setShopId: (id: string) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  shopId: '',
  loadShopId: async () => {
    const saved = (await electronAPI.getConfig('shopId')) as string | undefined
    if (saved) set({ shopId: saved })
  },
  setShopId: async (id: string) => {
    await electronAPI.setConfig('shopId', id)
    set({ shopId: id })
  }
}))