import { ipcMain } from 'electron'
import { ApiService } from '../services/ApiService'

/**
 * 后端接口 IPC 通道（渲染进程通过 preload 调用）
 */
export function registerApiIpc(): void {
  // 应用更新检查（方案 B：返回版本号 + 下载地址 + 更新说明）
  ipcMain.handle('api:getAppUpdateInfo', async () => ApiService.getAppUpdateInfo())

  ipcMain.handle('api:getPlatformList', async () => ApiService.getPlatformList())

  ipcMain.handle('api:getDaySeq', (_e, wmid: string, shopid: string) =>
    ApiService.getDaySeq(wmid, shopid)
  )

  ipcMain.handle('api:getOrderList', (_e, wmid: string, shopid: string, orderList: string[]) =>
    ApiService.getOrderList(wmid, shopid, orderList)
  )

  ipcMain.handle('api:getOrder', (_e, wmid: string, shopid: string, daySeq: string) =>
    ApiService.getOrder(wmid, shopid, daySeq)
  )
}