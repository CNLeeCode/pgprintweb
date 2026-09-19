/**
 * @file 升级 IPC 通道（方案 B，对应 UpgradeService）
 * @module ipc/update.ipc
 *
 * 通道清单：
 *  - update:check      检查更新（调 getAppUpdateInfo 接口 + 版本对比）
 *  - update:download   下载更新包（https 带进度）
 *  - update:install     退出并静默安装
 *  - update:status     获取当前状态 + 进度 + 更新信息
 *
 * 事件广播（main→renderer）：
 *  - update:status-changed   状态变更
 *  - update:available        发现新版本（带 AppUpdateInfo）
 *  - update:not-available    已是最新
 *  - update:progress         下载进度
 *  - update:downloaded       下载完成
 *  - update:error            出错
 */
import { ipcMain } from 'electron'
import { UpgradeService } from '../services/UpgradeService'
import type { DownloadProgress, UpgradeStatus } from '../services/UpgradeService'

/** 注册升级 IPC，并向主窗口广播事件 */
export function registerUpdateIpc(getMainWindow: () => Electron.BrowserWindow | null): void {
  // 主进程事件转发到渲染进程
  UpgradeService.on('status-changed', (status: UpgradeStatus) => {
    getMainWindow()?.webContents.send('update:status-changed', status)
  })
  UpgradeService.on('update-available', (info: unknown) => {
    getMainWindow()?.webContents.send('update:available', info)
  })
  UpgradeService.on('update-not-available', (info: unknown) => {
    getMainWindow()?.webContents.send('update:not-available', info)
  })
  UpgradeService.on('download-progress', (progress: DownloadProgress) => {
    getMainWindow()?.webContents.send('update:progress', progress)
  })
  UpgradeService.on('update-downloaded', (path: string) => {
    getMainWindow()?.webContents.send('update:downloaded', path)
  })
  UpgradeService.on('error', (message: string) => {
    getMainWindow()?.webContents.send('update:error', message)
  })

  // 检查更新
  ipcMain.handle('update:check', async () => {
    const info = await UpgradeService.checkForUpdates()
    return info
  })

  // 下载更新
  ipcMain.handle('update:download', async () => {
    const path = await UpgradeService.downloadUpdate()
    return path
  })

  // 退出并安装
  ipcMain.handle('update:install', () => {
    UpgradeService.quitAndInstall()
    return true
  })

  // 获取当前状态 + 进度 + 更新信息
  ipcMain.handle('update:status', () => ({
    status: UpgradeService.getStatus(),
    progress: UpgradeService.getProgress(),
    updateInfo: UpgradeService.getUpdateInfo()
  }))
}