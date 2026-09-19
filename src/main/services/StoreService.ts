import Store from 'electron-store'
import log from 'electron-log/main'

/**
 * 配置持久化服务（对应 KMP DataStored.kt / DataStore）
 * 存储门店号、选中打印机、选中平台等轻量配置
 */

interface StoreSchema {
  /** 登录门店号 */
  shopId?: string
  /** 选中的打印设备 id */
  selectedPrinterId?: string
  /** 选中的平台 id 列表（逗号分隔） */
  selectedPlatformIds?: string
  /** 已知最新版本号（缓存） */
  latestVersion?: string
  /** 窗口尺寸 */
  windowBounds?: { x: number; y: number; width: number; height: number }
}

const store = new Store<StoreSchema>({
  name: 'config',
  defaults: {
    shopId: '',
    selectedPrinterId: '',
    selectedPlatformIds: ''
  }
})

export const StoreService = {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    const val = store.get(key)
    log.debug('store.get', key, '=', val)
    return val
  },

  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    log.debug('store.set', key, '=', value)
    store.set(key, value)
  },

  delete<K extends keyof StoreSchema>(key: K): void {
    store.delete(key)
  },

  getAll(): StoreSchema {
    return store.store
  }
}

export type { StoreSchema }