/**
 * @file 网络检查 IPC 通道（对应 KMP NetworkCheck 暴露给 UI 的方法）
 * @module ipc/network.ipc
 *
 * 通道清单：
 *  - network:start   启动定时检查
 *  - network:stop    停止定时检查
 *  - network:check   手动触发一次检查
 *  - network:status  获取当前状态
 *
 * 事件广播：
 *  - network:status-changed  状态变化时推送
 */
import { ipcMain } from 'electron'
import { NetworkService } from '../services/NetworkService'
import type { NetworkStatus } from '../services/NetworkService'

/** 注册网络检查 IPC，并向主窗口广播状态变更 */
export function registerNetworkIpc(getMainWindow: () => Electron.BrowserWindow | null): void {
  // 状态变更转发到渲染进程
  NetworkService.on('status-changed', (status: NetworkStatus) => {
    getMainWindow()?.webContents.send('network:status-changed', status)
  })

  ipcMain.handle('network:start', () => {
    NetworkService.keepCheck()
    return true
  })

  ipcMain.handle('network:stop', () => {
    NetworkService.stopKeepCheck()
    return true
  })

  ipcMain.handle('network:check', async () => {
    return await NetworkService.singleCheck()
  })

  ipcMain.handle('network:status', () => {
    return NetworkService.getStatus()
  })
}
