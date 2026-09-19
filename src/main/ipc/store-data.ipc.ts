/**
 * @file 本地数据查看 IPC（供"本地数据查看"面板查询 JSON 存储数据）
 * @module ipc/store-data.ipc
 *
 * 通道清单：
 *  - store:stats    获取今日各表统计（printed/pending/cancel/connection 计数）
 *  - store:allData  获取今日全部数据（完整记录，供列表展示）
 *  - store:openDir  在系统文件管理器中打开数据目录（供用户用编辑器查看 JSON 文件）
 *
 * 用途：用户可通过设置面板的"本地数据查看"按钮查看今日本地存储结构，
 *   或直接打开数据目录用 VSCode/记事本查看 JSON 文件内容。
 */
import { ipcMain } from 'electron'
import { JsonStore } from '../services/JsonStore'

/** 注册本地数据查看 IPC 通道 */
export function registerStoreDataIpc(): void {
  /** 获取今日各表统计概览 */
  ipcMain.handle('store:stats', () => {
    return JsonStore.getStats()
  })

  /** 获取今日全部数据（完整记录） */
  ipcMain.handle('store:allData', () => {
    return JsonStore.getAllData()
  })

  /** 在系统文件管理器中打开数据目录 */
  ipcMain.handle('store:openDir', () => {
    JsonStore.openDataDir()
    return true
  })
}
