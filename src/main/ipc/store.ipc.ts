import { ipcMain } from 'electron'
import { StoreService } from '../services/StoreService'

/**
 * 配置持久化 IPC 通道
 */
export function registerStoreIpc(): void {
  ipcMain.handle('store:get', (_event, key: string) => StoreService.get(key as any))

  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    StoreService.set(key as any, value as any)
  })

  ipcMain.handle('store:getAll', () => StoreService.getAll())
}