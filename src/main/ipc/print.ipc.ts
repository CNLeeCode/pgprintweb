/**
 * @file 打印相关 IPC 通道（对应 KMP PrintTask 暴露给 UI 的方法）
 * @module ipc/print.ipc
 *
 * 通道清单：
 *  - print:setDevice       设置当前打印设备
 *  - print:getDevice       获取当前打印设备
 *  - print:updatePlatforms 更新监听平台列表（启停轮询，必须带门店号）
 *  - print:switchShop      切换门店：停轮询 + 重置运行时状态 + 广播快照清空
 *  - print:requeue         重启恢复重新入队（必须带门店号，按门店+日期过滤）
 *  - print:loadPrinted     从 DB 加载已打印订单到内存（必须带门店号，按门店+日期过滤）
 *  - print:getSnapshots    获取已打印/待打印快照
 *  - print:reprint         手动重打单条订单（必须带门店号）
 *  - print:filterUnprinted 仅供调试：过滤未打印订单
 *  - print:stopAll         停止全部轮询
 *  
 *  业务铁律：所有订单相关接口必须传门店号，不能为空。空门店号会被拒绝，
 *  防止后端按空门店查询返回全部门店数据或异常。切换门店时必须调用
 *  print:switchShop 清空运行时状态（queue/printingSet/printedMap/pendingMap/retryMap），
 *  避免旧门店的待打印订单残留队列被错误打印。
 */
import { ipcMain } from 'electron'
import { PrintService } from '../services/PrintService'
import { DeviceService } from '../services/DeviceService'
import { StoreService } from '../services/StoreService'
import log from 'electron-log/main'
import type { ShopPrintOrderItem, PrinterTarget } from '@shared/types/models'

/**
 * 注册打印 IPC 通道，并向主窗口广播事件：
 *  - print:log            操作日志
 *  - print:printed        单条打印成功
 *  - print:refund-notice  退款通知（触发提示音）
 *  - print:printed-updated 已打印快照变更
 *  - print:pending-updated 待打印快照变更
 */
export function registerPrintIpc(getMainWindow: () => Electron.BrowserWindow | null): void {
  // 事件转发到渲染进程
  PrintService.on('log', (msg: string) => {
    getMainWindow()?.webContents.send('print:log', msg)
  })
  PrintService.on('printed', (platformId: string, item: ShopPrintOrderItem) => {
    getMainWindow()?.webContents.send('print:printed', platformId, item)
  })
  PrintService.on('refund-notice', () => {
    getMainWindow()?.webContents.send('print:refund-notice')
  })
  PrintService.on('printed-updated', (snap: Record<string, Record<string, ShopPrintOrderItem>>) => {
    getMainWindow()?.webContents.send('print:printed-updated', snap)
  })
  PrintService.on('pending-updated', (snap: Record<string, Record<string, ShopPrintOrderItem>>) => {
    getMainWindow()?.webContents.send('print:pending-updated', snap)
  })

  /* ---------- 设备绑定 ---------- */
  ipcMain.handle('print:setDevice', async (_e, device: PrinterTarget | null) => {
    PrintService.setCurrentDevice(device)
    if (device) {
      await DeviceService.selectPrinter(device.id)
    }
    return true
  })

  ipcMain.handle('print:getDevice', async () => {
    // 优先返回运行时设备，其次从存储恢复
    const current = PrintService.getCurrentDevice()
    if (current) return current
    const savedId = await DeviceService.getCurrentPrinterId()
    if (savedId) {
      const devices = await DeviceService.listPrinters()
      const found = devices.find((d) => d.id === savedId) || null
      if (found) PrintService.setCurrentDevice(found)
      return found
    }
    return null
  })

  /* ---------- 平台轮询 ---------- */
  ipcMain.handle('print:updatePlatforms', (_e, platformIds: string[], shopId?: string) => {
    // 业务铁律：门店号不能为空，空则拒绝启动轮询（防止空门店拉到全部门店订单）
    const sid = (shopId && shopId.trim()) || StoreService.get('shopId') || ''
    if (!sid) {
      log.warn('print:updatePlatforms 门店号为空（参数+StoreService 都为空），拒绝启动轮询')
      // 防御：即便拒绝，也得停掉可能存在的旧轮询，避免旧门店轮询继续跑
      PrintService.stopAllPolling()
      return false
    }
    PrintService.updatePlatforms(platformIds, sid)
    return true
  })

  ipcMain.handle('print:stopAll', () => {
    PrintService.stopAllPolling()
    return true
  })

  /* ---------- 切换门店 ---------- */
  /**
   * 切换门店编排通道（用户点"切换门店"时调用，在跳转登录页之前）
   *
   * 完整流程：
   *  1. stopAllPolling()     停止所有轮询定时器
   *  2. resetRuntimeState() 清空 queue/printingSet/pendingMap/printedMap/retryMap
   *  3. 广播 printed-updated/pending-updated 快照（清空 UI 旧门店数据）
   *
   * 后续步骤由渲染层在用户输入新门店号返回主页后触发：
   *  - print:loadPrinted(新门店) 从 DB 加载新门店今日已打印
   *  - print:requeue(新门店)     从 DB 加载新门店今日 pending 入队
   *  - print:updatePlatforms     启动新门店轮询
   *
   * 关键：本通道不删除 StoreService.shopId（由渲染层 LoginView 重新写入），
   *      也不清 currentDevice（设备与门店无关，切换门店不应影响已选打印机）。
   */
  ipcMain.handle('print:switchShop', () => {
    log.info('print:switchShop 切换门店：停止轮询 + 重置运行时状态')
    PrintService.stopAllPolling()
    PrintService.resetRuntimeState()
    return true
  })

  /* ---------- 持久化恢复 ---------- */
  ipcMain.handle('print:requeue', (_e, shopId?: string) => {
    // 业务铁律：恢复待打印必须带门店号，按门店+日期从 DB 过滤
    const sid = (shopId && shopId.trim()) || StoreService.get('shopId') || ''
    if (!sid) {
      log.warn('print:requeue 门店号为空，拒绝恢复待打印订单')
      return false
    }
    PrintService.requeuePendingOrders(sid)
    return true
  })

  ipcMain.handle('print:loadPrinted', async (_e, shopId?: string) => {
    // 业务铁律：加载已打印必须带门店号，按门店+日期从 DB 过滤
    const sid = (shopId && shopId.trim()) || StoreService.get('shopId') || ''
    if (!sid) {
      log.warn('print:loadPrinted 门店号为空，拒绝加载已打印订单')
      return false
    }
    await PrintService.loadPrintedOrdersFromDb(sid)
    return true
  })

  /* ---------- 快照查询 ---------- */
  ipcMain.handle('print:getSnapshots', () => ({
    printed: PrintService.getPrintedSnapshot(),
    pending: PrintService.getPendingSnapshot()
  }))

  /* ---------- 手动重打 ---------- */
  ipcMain.handle(
    'print:reprint',
    async (_e, platformId: string, shopId: string, orderId: string) => {
      // 业务铁律：重打必须传门店号，空则拒绝（防止跨门店错打小票）
      const sid = (shopId && shopId.trim()) || StoreService.get('shopId') || ''
      if (!sid) {
        log.warn(`print:reprint 门店号为空，拒绝重打 [${platformId}][${orderId}]`)
        return false
      }
      log.info(`手动重打 [${platformId}][${orderId}] 门店=${sid}`)
      return PrintService.reprintOrder(platformId, sid, orderId)
    }
  )

  /* ---------- 调试：过滤未打印 ---------- */
  ipcMain.handle(
    'print:filterUnprinted',
    (_e, platformId: string, orders: ShopPrintOrderItem[]) =>
      PrintService.filterUnprinted(platformId, orders)
  )
}
