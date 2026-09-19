/**
 * @file 后端接口 IPC 通道（渲染进程通过 preload 调用）
 * @module ipc/api.ipc
 *
 * 通道清单：
 *  - api:getAppUpdateInfo    获取最新版本信息
 *  - api:getPlatformList     获取平台列表
 *  - api:getDaySeq           获取当日订单号列表
 *  - api:getOrderList        获取订单详情列表
 *  - api:getOrder            获取单个订单详情
 *  - api:diagnoseNetwork     主动诊断网络（DNS/TCP/HTTP 三层报告）
 *  - api:getLogs             拉取最近 50 条接口调用日志
 *
 * 事件广播（主进程 → 渲染进程）：
 *  - api:log                 接口调用日志（含 method/status/message/code）
 *                          Footer 状态指示灯据此实时刷新
 */
import { ipcMain } from 'electron'
import { ApiService } from '../services/ApiService'

/**
 * 注册后端接口 IPC 通道
 * @param getMainWindow 主窗口获取函数（用于向渲染进程广播 api:log 事件）
 */
export function registerApiIpc(getMainWindow?: () => Electron.BrowserWindow | null): void {
  // 接口调用日志广播到渲染进程（Footer 接口状态指示灯 + ApiLogDialog 实时列表）
  if (getMainWindow) {
    ApiService.on('api-log', (entry: unknown) => {
      getMainWindow()?.webContents.send('api:log', entry)
    })
  }

  // 应用更新检查（方案 B：返回版本号 + 下载地址 + 更新说明）
  ipcMain.handle('api:getAppUpdateInfo', async () => ApiService.getAppUpdateInfo())

  // 平台列表
  ipcMain.handle('api:getPlatformList', async () => ApiService.getPlatformList())

  // 当日订单号列表
  ipcMain.handle('api:getDaySeq', (_e, wmid: string, shopid: string) =>
    ApiService.getDaySeq(wmid, shopid)
  )

  // 订单详情列表
  ipcMain.handle('api:getOrderList', (_e, wmid: string, shopid: string, orderList: string[]) =>
    ApiService.getOrderList(wmid, shopid, orderList)
  )

  // 单个订单详情（day_seq 字段实收 orderId）
  ipcMain.handle('api:getOrder', (_e, wmid: string, shopid: string, daySeq: string) =>
    ApiService.getOrder(wmid, shopid, daySeq)
  )

  // 主动诊断网络：用户点"诊断网络"按钮时调用，返回完整 DNS/TCP/HTTP 报告
  ipcMain.handle('api:diagnoseNetwork', async () => ApiService.diagnoseNetwork())

  // 拉取最近 50 条接口调用日志
  ipcMain.handle('api:getLogs', () => ApiService.getRecentLogs())
}