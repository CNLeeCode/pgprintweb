/**
 * @file 打印服务（对应 KMP PrintTask.kt + PrintManager.kt）
 * @module services/PrintService
 *
 * 职责：
 *  1. 打印队列管理：FIFO 队列，单消费者串行打印（Mutex 防并发）
 *  2. 双重去重：内存 printedSet + printingSet，防止同一订单重复入队
 *  3. 3 次重试：失败重新入队，超过上限保留 pending 等手动重打
 *  4. SQLite 持久化：入队前写 pending_print_order，成功后迁移到 printed_order
 *  5. 重启恢复：启动时加载今日 pending 重新入队
 *  6. 平台轮询：按平台 id 每个平台独立轮询任务，10 秒间隔
 *  7. 退款通知：检测到 refundNotice 通过事件通知渲染层播提示音
 */
import { app } from 'electron'
import { EventEmitter } from 'events'
import log from 'electron-log/main'
import { JsonStore as DatabaseService } from './JsonStore'
import { ApiService } from './ApiService'
import { StoreService } from './StoreService'
import { templateV1 } from '../utils/printTemplate'
import { printRawViaCommand } from '../utils/rawPrint'
import { printRawViaUsb } from '../utils/usbPrint'
import { PRINT_MAX_RETRY, POLL_INTERVAL, REFUND_SOUND_COOLDOWN, PRINT_SEND_TIMEOUT } from '../config'
import type {
  ShopPrintOrderDetail,
  ShopPrintOrderItem,
  PrinterTarget
} from '@shared/types/models'

/** 打印结果（对应 KMP PrintResult） */
export type PrintResult =
  | { kind: 'success' }
  | { kind: 'error'; reason: 'deviceNotFound' | 'deviceBusy' | 'ioError'; error?: unknown }

/** 今日日期格式化 yyyy-MM-dd */
function todayDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 订单唯一 key */
function orderKey(platformId: string, orderId: string): string {
  return `${platformId}:${orderId}`
}

/**
 * 打印服务单例
 * 用事件驱动 + Promise 队列替代 KMP 的 Channel + 协程。
 */
class PrintServiceImpl extends EventEmitter {
  /** 打印队列（FIFO） */
  private queue: ShopPrintOrderDetail[] = []
  /** 是否正在消费队列 */
  private processing = false
  /** 串行打印互斥锁 */
  private printing = false
  /** 已打印订单缓存（platformId -> Map<orderId, item>），用于去重 + UI */
  private printedMap: Record<string, Record<string, ShopPrintOrderItem>> = {}
  /** 正在打印中的订单 key 集合（防并发重复入队） */
  private printingSet = new Set<string>()
  /** 待打印订单缓存（platformId -> Map<orderId, item>），用于 UI */
  private pendingMap: Record<string, Record<string, ShopPrintOrderItem>> = {}
  /** 运行时重试计数（orderKey -> count） */
  private retryMap = new Map<string, number>()
  /** 打印失败（重试超限）订单 key 集合，防轮询重复入队死循环 + 供 UI 标红可重打 */
  private failedSet = new Set<string>()
  /** 当前选中打印机目标（从 StoreService 读取） */
  private currentDevice: PrinterTarget | null = null
  /** 轮询任务 Map（platformId -> timer） */
  private pollingTimers = new Map<string, NodeJS.Timeout>()
  /** 当前监听的平台 id 集合 */
  private platformIds = new Set<string>()
  /** 退款提示音上次播放时间戳（防频繁） */
  private lastRefundSoundTime = 0

  /* ==================== 设备绑定 ==================== */

  /**
   * 重置运行时状态（切换门店时调用）
   *
   * 背景：printedMap/pendingMap/printingSet/queue/retryMap 都按 platformId+orderId
   * 维度组织，不带门店隔离。切换门店时若不清空，旧门店的待打印订单会留在 queue
   * 里被错误打印（小票属于错误门店），pendingMap 残留导致 UI 显示脏数据，
   * printingSet 残留导致新门店同 orderId 订单被误判"正在打印"而跳过。
   *
   * 完整切换门店流程（由 IPC print:switchShop 编排）：
   *  1. stopAllPolling()    停止所有轮询定时器
   *  2. resetRuntimeState() 清空本方法涉及的所有运行时状态（本方法）
   *  3. 广播 printed-updated / pending-updated 快照（清空 UI）
   *  4. 渲染层跳转登录页 → 输入新门店号 → 回主页
   *  5. loadPrintedOrdersFromDb(新门店) 从 DB 加载新门店今日已打印
   *  6. requeuePendingOrders(新门店)   从 DB 加载新门店今日 pending 入队
   *
   * 注意：本方法不清 pollingTimers（已由 stopAllPolling 处理），
   *      不清 currentDevice（设备与门店无关，切换门店不应影响已选打印机）。
   */
  resetRuntimeState(): void {
    const queueLen = this.queue.length
    const printingLen = this.printingSet.size
    this.queue = []
    this.printingSet.clear()
    this.pendingMap = {}
    this.printedMap = {}
    this.retryMap.clear()
    this.failedSet.clear()
    this.processing = false
    this.printing = false
    log.info(
      `resetRuntimeState 已清空运行时状态：queue=${queueLen} printingSet=${printingLen} pendingMap/printedMap/retryMap/failedSet 已清空（切换门店或重置场景）`
    )
    // 广播快照刷新，让 UI 立即清空旧门店的已打印/待打印列表
    this.emit('printed-updated', this.getPrintedSnapshot())
    this.emit('pending-updated', this.getPendingSnapshot())
  }

  /**
   * 设置当前打印设备（用户在 DevicePanel 选中后调用）
   *
   * 副作用：设备从"无"变为"有"时，主动触发 processQueue 恢复此前因
   * 无设备而暂挂（unshift 回队首）的订单，避免暂挂订单永久滞留队列。
   */
  setCurrentDevice(device: PrinterTarget | null): void {
    const wasEmpty = !this.currentDevice
    this.currentDevice = device
    log.info('PrintService 当前设备:', device?.name, device?.type)
    // 设备就绪且有暂挂订单 → 恢复消费，防止"先点重打后选设备"导致订单卡死
    if (wasEmpty && device && this.queue.length > 0) {
      log.info(`设备就绪，恢复暂挂订单 ${this.queue.length} 条`)
      this.processQueue()
    }
  }

  /** 获取当前打印设备 */
  getCurrentDevice(): PrinterTarget | null {
    return this.currentDevice
  }

  /* ==================== 队列入队 ==================== */

  /**
   * 单条订单入队（手动重打 / 查询打印 入口，对应 KMP PrintTask.singlePrint）
   *
   * 关键语义：重打必须无条件打印，**不做任何去重**。
   *  - 不查 printedMap：已打印订单允许重复打印（用户主动点重打就该出纸）
   *  - 不查 printingSet：正在打印中也允许再次入队（极端并发场景，少见但不应拦截）
   *  - 不写 pending 表：重打无需重启恢复，重启后 pending 清空即可
   *
   * 去重（filterUnprinted）只用于轮询（executePollCycle）过滤新订单，
   * 走的是 enqueueBatch；两条路径职责分离，严禁在重打路径加去重。
   *
   * 入队后由 printOne 消费，成功时 insertPrintedOrder（INSERT OR IGNORE 幂等）+
   * confirmPrinted（printedMap 覆盖），二者对已存在的订单都是无害的覆盖/跳过。
   *
   * @param detail 订单详情（reprintOrder 已注入 platform/shopId）
   */
  enqueueSingle(detail: ShopPrintOrderDetail): void {
    log.info(`enqueueSingle 入队(重打,不去重) orderId=${detail.orderId} daySeq=${detail.daySeq} platform=${detail.platform} 队列将变为=${this.queue.length + 1}`)
    this.queue.push(detail)
    this.processQueue()
  }

  /**
   * 批量入队（轮询获取新订单后调用，先写 pending 表再入队）
   * @param platformId 平台 id
   * @param details 订单详情列表
   * @param shopId 门店 id
   */
  enqueueBatch(platformId: string, details: ShopPrintOrderDetail[], shopId: string): void {
    if (details.length === 0) return
    const date = todayDate()
    // 1. 写 pending_print_order 表（重启恢复用）
    details.forEach((d) => {
      DatabaseService.insertPendingOrder(platformId, d.orderId, d.daySeq, date, shopId, 0)
      // 2. 更新内存 pending 缓存（UI 显示）
      this.addPendingToMemory(platformId, d.orderId, d.daySeq)
      // 3. 标记打印中（运行时去重）
      this.printingSet.add(orderKey(platformId, d.orderId))
      // 4. 入队
      const detailWithShop = { ...d, shopId }
      this.queue.push(detailWithShop)
    })
    log.info(`平台 ${platformId} 入队 ${details.length} 条订单（已写 pending 表）`)
    this.emit('pending-updated', this.getPendingSnapshot())
    this.processQueue()
  }

  /* ==================== 队列消费（串行） ==================== */

  /** 消费队列（串行，互斥锁防并发） */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      log.info(`processQueue 跳过：正在处理中，队列剩余 ${this.queue.length}`)
      return
    }
    if (this.queue.length === 0) return
    log.info(`processQueue 开始消费 队列=${this.queue.length} 设备=${this.currentDevice?.name || '无'}`)
    this.processing = true
    while (this.queue.length > 0) {
      const detail = this.queue.shift()!
      // 等待设备就绪
      if (!this.currentDevice) {
        log.warn('无可用打印设备，订单暂挂:', detail.orderId)
        this.queue.unshift(detail)
        this.processing = false
        return
      }
      log.info(`processQueue 处理订单 orderId=${detail.orderId} daySeq=${detail.daySeq} 剩余=${this.queue.length}`)
      await this.printOne(detail)
      // 间隔防过快
      await this.sleep(500)
    }
    this.processing = false
    log.info('processQueue 消费完成')
  }

  /** 打印单条订单（带互斥锁 + 重试） */
  private async printOne(detail: ShopPrintOrderDetail): Promise<void> {
    // 互斥锁（同一时刻只有一个打印任务在执行）
    while (this.printing) {
      await this.sleep(50)
    }
    this.printing = true
    try {
      // templateV1 内部调用 bwip-js 异步生成条码 PNG，已改为 async
      const data = await templateV1(detail)
      const result = await this.sendToPrinter(this.currentDevice!, data)
      if (result.kind === 'success') {
        // 打印成功：删 pending + 写 printed + 更新内存
        // 重打场景下订单已在 printed 表/printedMap 中，insertPrintedOrder 为
        // INSERT OR IGNORE 语义（已存在跳过），confirmPrinted 为覆盖写，
        // 二者幂等不会报错，重打可正常出纸。
        DatabaseService.deletePendingOrder(detail.platform, detail.orderId, detail.shopId)
        DatabaseService.insertPrintedOrder(
          detail.platform,
          detail.orderId,
          detail.daySeq,
          todayDate(),
          detail.shopId
        )
        this.confirmPrinted(detail)
        this.removePendingFromMemory(detail.platform, detail.orderId)
        this.retryMap.delete(orderKey(detail.platform, detail.orderId))
        log.info(`打印成功 [${detail.orderId}]`)
        this.emit('printed', detail.platform, { orderId: detail.orderId, daySeq: detail.daySeq })
        // BUGFIX: 成功分支曾遗漏 printed-updated 广播，导致前端已打印区不刷新
        this.emit('printed-updated', this.getPrintedSnapshot())
        this.emit('pending-updated', this.getPendingSnapshot())
      } else {
        // 打印失败：重试逻辑
        const key = orderKey(detail.platform, detail.orderId)
        const retryCount = (this.retryMap.get(key) || 0) + 1
        this.retryMap.set(key, retryCount)
        if (retryCount < PRINT_MAX_RETRY) {
          log.warn(`订单 [${detail.orderId}] 第 ${retryCount} 次重试入队`)
          DatabaseService.updateRetryCount(
            detail.platform,
            detail.orderId,
            detail.shopId,
            retryCount
          )
          this.queue.push(detail)
        } else {
          log.error(`订单 [${detail.orderId}] 重试 ${retryCount} 次仍失败，标记为失败可重打`)
          this.printingSet.delete(key)
          this.retryMap.delete(key)
          // BUGFIX: 重试超限后加入 failedSet，阻止轮询重复入队死循环 + 供前端标红可重打
          this.failedSet.add(key)
          // BUGFIX: 触发 pending-updated 清掉待打印区该订单，failed-updated 通知前端标红
          this.emit('pending-updated', this.getPendingSnapshot())
          this.emit('failed-updated', this.getFailedSnapshot())
        }
      }
    } catch (e) {
      log.error('printOne 异常:', e)
    } finally {
      this.printing = false
    }
  }

  /* ==================== 实际打印发送 ==================== */

  /**
   * 将字节流发送到打印设备（对应 KMP PrinterManager.print）
   * - usb 类型：通过 libusb 直写字节流到 OUT 端点（绕过 CUPS PPD filter）
   * - driver 类型：先 USB 直写（按队列名反查 USB 设备），失败回退 lp / PowerShell RawPrinter
   * - serial 类型：通过 serialport 串口写入（GBK 字节流）
   */
  /**
   * Promise 超时包装（防 USB/串口 IO 卡死导致打印队列永久死锁）
   *
   * 背景：热敏打印机的 USB transfer / 串口 write 回调在设备离线、接口异常时
   * 可能永不触发，导致 sendToPrinter → printOne → processQueue 整条链路卡住，
   * this.processing 永久为 true，后续所有重打/查询打印调用 processQueue 时
   * 因 `if (this.processing) return` 直接退出，表现为"点击重打/查询打印无反应"。
   * 加超时兜底：超时则 reject，调用方 catch 后判定本次失败走重试，确保锁能释放、
   * 队列能继续消费。
   * @param p 原 Promise
   * @param ms 超时毫秒
   * @param label 日志标签（定位用）
   */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        log.error(`withTimeout 超时 [${label}] ${ms}ms（设备 IO 卡死，已强制中断）`)
        reject(new Error(`打印发送超时: ${label}`))
      }, ms)
      p.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        }
      )
    })
  }

  private async sendToPrinter(device: PrinterTarget, data: Buffer): Promise<PrintResult> {
    try {
      // 关键：RAW 字节流打印要求传入"系统打印机名 p.name"（保存在 device.path），
      // 不是 displayName。用 device.path 优先，回退 device.name，避免找不到打印机导致失败。
      const printerName = device.path || device.name
      log.info(`sendToPrinter 设备=${device.name} 系统名=${printerName} 类型=${device.type} 字节数=${data.length}`)
      if (device.type === 'usb') {
        // USB 直写专用通道（不走 CUPS / Spooler 任何路径）
        const usbOptions =
          device.vendorId && device.productId
            ? { vid: device.vendorId, pid: device.productId }
            : undefined
        // 关键：USB transfer 回调在设备离线/接口异常时可能永不触发，
        // 必须加超时兜底，否则 printOne 永久卡住 → processQueue 死锁 → 重打全废
        const ok = await this.withTimeout(
          printRawViaUsb(printerName, data, usbOptions),
          PRINT_SEND_TIMEOUT,
          `USB直写[${printerName}]`
        ).catch((e: unknown) => {
          log.error('USB 直写超时/失败:', e)
          return false
        })
        return ok ? { kind: 'success' } : { kind: 'error', reason: 'ioError' }
      }
      if (device.type === 'driver') {
        const usbOptions =
          device.vendorId && device.productId
            ? { vid: device.vendorId, pid: device.productId }
            : undefined
        const r = await this.withTimeout(
          this.printViaDriver(printerName, data, usbOptions),
          PRINT_SEND_TIMEOUT,
          `驱动打印[${printerName}]`
        ).catch(() => ({ kind: 'error', reason: 'ioError' } as PrintResult))
        return r
      } else if (device.type === 'serial') {
        const r = await this.withTimeout(
          this.printViaSerial(device.path || device.name, data),
          PRINT_SEND_TIMEOUT,
          `串口打印[${device.path || device.name}]`
        ).catch(() => ({ kind: 'error', reason: 'ioError' } as PrintResult))
        return r
      }
      return { kind: 'error', reason: 'deviceNotFound' }
    } catch (e) {
      log.error('sendToPrinter 异常:', e)
      return { kind: 'error', reason: 'ioError', error: e }
    }
  }

  /**
   * 通过驱动打印机打印（必须发送 RAW 字节流，不能经浏览器渲染）
   *
   * 关键：ES/POS 字节流是热敏打印机的指令流，必须以 RAW 数据类型直接
   * 灌入打印机驱动，不允许经过任何 HTML/PDF 渲染（silent print 必然乱码）。
   *
   * 两档优先级：
   *  1. 系统命令行 RAW（macOS/Linux 优先 USB 直写绕过 CUPS / Windows PowerShell RawPrinter）
   *     —— 等价 KMP 原版 `javax.print.PrintService` 的 RAW 打印通道
   *  2. 失败 → 明确返回 ioError（不再用 silent 兜底产生乱码）
   *
   * @param printerName 系统打印机名（p.name，非 displayName）
   * @param data ESC/POS 字节流
   * @param options 可选 USB 直写匹配参数（vid/pid）
   */
  private async printViaDriver(
    printerName: string,
    data: Buffer,
    options?: { vid?: number; pid?: number }
  ): Promise<PrintResult> {
    // 系统命令行 RAW（macOS/Linux 内部会先尝试 USB 直写再 lp，Windows 走 PowerShell RawPrinter）
    const cmdOk = await printRawViaCommand(printerName, data, options)
    if (cmdOk) {
      return { kind: 'success' }
    }

    // 全部失败：明确报错（不再用 silent 兜底，避免乱码）
    return {
      kind: 'error',
      reason: 'ioError',
      error: new Error(
        `无可用 RAW 打印通道 [${printerName}]。` +
        `请确认系统命令可用（macOS: lp；Windows: powershell）或 USB 直写设备已连接`
      )
    }
  }

  /** 通过串口打印（serialport 写入字节流） */
  private async printViaSerial(portPath: string, data: Buffer): Promise<PrintResult> {
    try {
      const serialLib = this.loadSerialPort()
      if (!serialLib) {
        return { kind: 'error', reason: 'deviceNotFound' }
      }
      const port = new serialLib.SerialPort({
        path: portPath,
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        autoOpen: false
      })
      await new Promise<void>((resolve, reject) => {
        port.open((err: Error | null) => (err ? reject(err) : resolve()))
      })
      await new Promise<void>((resolve, reject) => {
        port.write(data, (err?: Error | null) => (err ? reject(err) : resolve()))
      })
      await new Promise<void>((resolve) => port.drain(() => resolve()))
      port.close()
      return { kind: 'success' }
    } catch (e) {
      log.error('串口打印失败:', portPath, e)
      return { kind: 'error', reason: 'ioError', error: e }
    }
  }

  /* ==================== 原生模块懒加载 ==================== */

  /** 懒加载 serialport */
  private loadSerialPort(): any {
    try {
      return require('serialport')
    } catch (e) {
      log.warn('serialport 模块未加载')
      return null
    }
  }

  /* ==================== 内存缓存管理 ==================== */

  /** 打印成功后更新内存（printedMap + 移除 printingSet） */
  private confirmPrinted(detail: ShopPrintOrderDetail): void {
    const platformId = detail.platform
    const item: ShopPrintOrderItem = { orderId: detail.orderId, daySeq: detail.daySeq }
    const key = orderKey(platformId, detail.orderId)
    const platformMap = { ...(this.printedMap[platformId] || {}) }
    platformMap[detail.orderId] = item
    this.printedMap[platformId] = platformMap
    this.printingSet.delete(key)
    // BUGFIX: 打印成功后清理失败标记，避免 failedSet 残留导致后续轮询继续过滤该订单
    this.failedSet.delete(key)
  }

  /** 添加待打印订单到内存缓存（UI 显示用） */
  private addPendingToMemory(platformId: string, orderId: string, daySeq: string): void {
    const platformMap = { ...(this.pendingMap[platformId] || {}) }
    platformMap[orderId] = { orderId, daySeq }
    this.pendingMap[platformId] = platformMap
  }

  /** 从内存缓存移除待打印订单 */
  private removePendingFromMemory(platformId: string, orderId: string): void {
    const platformMap = { ...(this.pendingMap[platformId] || {}) }
    delete platformMap[orderId]
    this.pendingMap[platformId] = platformMap
  }

  /** 获取待打印快照（供 UI 渲染） */
  getPendingSnapshot(): Record<string, Record<string, ShopPrintOrderItem>> {
    return JSON.parse(JSON.stringify(this.pendingMap))
  }

  /** 获取已打印快照（供 UI 渲染） */
  getPrintedSnapshot(): Record<string, Record<string, ShopPrintOrderItem>> {
    return JSON.parse(JSON.stringify(this.printedMap))
  }

  /**
   * 获取失败订单快照（供 UI 标红渲染 + failed-updated 事件）
   * 返回 platformId -> orderId -> true 的嵌套结构，便于前端按平台分组判断
   */
  getFailedSnapshot(): Record<string, Record<string, true>> {
    const snapshot: Record<string, Record<string, true>> = {}
    for (const key of this.failedSet) {
      // failedSet 内 key 形如 "platformId_orderId"（orderKey 拼接规则）
      const sepIdx = key.lastIndexOf('_')
      if (sepIdx <= 0) continue
      const platformId = key.slice(0, sepIdx)
      const orderId = key.slice(sepIdx + 1)
      if (!snapshot[platformId]) snapshot[platformId] = {}
      snapshot[platformId][orderId] = true
    }
    return snapshot
  }

  /* ==================== 去重过滤 ==================== */

  /**
   * 双重过滤：排除已打印 + 正在打印中的订单 + 已失败（重试超限）订单
   * 对应 KMP filterUnprinted
   * BUGFIX: 增加 failedSet 过滤，避免轮询将重试超限的失败订单反复入队导致日志爆炸
   */
  filterUnprinted(platformId: string, orders: ShopPrintOrderItem[]): ShopPrintOrderItem[] {
    const printed = this.printedMap[platformId] || {}
    return orders.filter(
      (o) =>
        !printed[o.orderId] &&
        !this.printingSet.has(orderKey(platformId, o.orderId)) &&
        !this.failedSet.has(orderKey(platformId, o.orderId))
    )
  }

  /* ==================== 平台轮询 ==================== */

  /**
   * 更新监听平台列表（对应 KMP updatePlatforms）
   * 自动 diff：新增的启动轮询，移除的停止轮询。
   * @param newList 新平台 id 列表
   * @param shopId 门店 id
   */
  updatePlatforms(newList: string[], shopId: string): void {
    // 业务铁律：轮询必须带门店号，空则拒绝启动（防止空门店拉到全部门店订单）
    if (!shopId || !shopId.trim()) {
      log.warn(`updatePlatforms 门店号为空，拒绝启动轮询（platforms=[${newList.join(',')}])`)
      // 即便要启动新的，也得先停掉旧的，避免旧门店轮询继续跑
      this.stopAllPolling()
      return
    }
    log.info(`updatePlatforms: newList=[${newList.join(',')}] shopId=${shopId} 当前运行=[${[...this.platformIds].join(',')}]`)
    const newSet = new Set(newList)
    const toStart: string[] = []
    const toStop: string[] = []
    // 启动新增
    newSet.forEach((id) => {
      if (!this.platformIds.has(id)) toStart.push(id)
    })
    // 停止移除
    this.platformIds.forEach((id) => {
      if (!newSet.has(id)) toStop.push(id)
    })
    log.info(`diff 结果: 启动轮询=[${toStart.join(',')}] 停止轮询=[${toStop.join(',')}]`)
    toStart.forEach((id) => this.startPolling(id, shopId))
    toStop.forEach((id) => this.stopPolling(id))
    this.platformIds = newSet
  }

  /** 启动单平台轮询任务 */
  private startPolling(platformId: string, shopId: string): void {
    if (this.pollingTimers.has(platformId)) {
      log.info(`平台 ${platformId} 已经在运行`)
      return
    }
    log.info(`开始监听平台: ${platformId}`)
    // 立即执行一次，之后定时执行
    this.executePollCycle(platformId, shopId)
    const timer = setInterval(() => {
      this.executePollCycle(platformId, shopId)
    }, POLL_INTERVAL)
    this.pollingTimers.set(platformId, timer)
  }

  /** 停止单平台轮询 */
  private stopPolling(platformId: string): void {
    const timer = this.pollingTimers.get(platformId)
    if (timer) {
      clearInterval(timer)
      this.pollingTimers.delete(platformId)
      log.info(`停止监听平台: ${platformId}`)
    }
  }

  /** 停止全部轮询 */
  stopAllPolling(): void {
    this.pollingTimers.forEach((timer, id) => {
      clearInterval(timer)
      log.info(`平台 ${id} 已停止`)
    })
    this.pollingTimers.clear()
    this.platformIds.clear()
  }

  /**
   * 单轮轮询：getDaySeq → 去重 → getOrderList → 入队
   * 对应 KMP executePrintCycle2，每轮开始打印日志便于排查
   */
  private async executePollCycle(platformId: string, shopId: string): Promise<void> {
    log.info(`开始 [${platformId}] Time: ${new Date().toLocaleTimeString()} shopId=${shopId || '(空)'}`)
    try {
      const orderIds = await ApiService.getDaySeq(platformId, shopId)
      if (!orderIds) {
        log.warn(`[${platformId}] getDaySeq 返回 null（网络异常）`)
        return
      }
      if (orderIds.code !== 200) {
        log.warn(`[${platformId}] getDaySeq code=${orderIds.code} msg=${(orderIds as any).msg || ''}`)
        return
      }
      if (!orderIds.data || orderIds.data.length === 0) {
        log.info(`[${platformId}] 暂无新订单`)
        return
      }
      log.info(`[${platformId}] 获取到 ${orderIds.data.length} 条订单号`)
      // 退款提示
      if (orderIds.refundNotice && orderIds.refundNotice.length > 0) {
        this.handleRefundNotice()
      }
      // 去重
      const distinctOrders = this.distinctByOrderId(orderIds.data)
      const filterOrders = this.filterUnprinted(platformId, distinctOrders)
      log.info(`[${platformId}] 去重后待打印 ${filterOrders.length} 条`)
      if (filterOrders.length === 0) return
      // 获取详情
      const details = await ApiService.getOrderList(
        platformId,
        shopId,
        filterOrders.map((o) => o.orderId)
      )
      log.info(`[${platformId}] 获取订单详情 ${details.length} 条`)
      if (details.length === 0) return
      this.emit('log', `[${platformId}]获取打印信息成功！(${details.length}条)`)
      // 入队
      this.enqueueBatch(platformId, details, shopId)
    } catch (e) {
      log.error(`平台 ${platformId} 执行出错:`, e)
      this.emit('log', `[${platformId}]轮询出错: ${(e as Error).message}`)
    }
  }

  /** 按订单号去重 */
  private distinctByOrderId(orders: ShopPrintOrderItem[]): ShopPrintOrderItem[] {
    const seen = new Set<string>()
    const result: ShopPrintOrderItem[] = []
    for (const o of orders) {
      if (!seen.has(o.orderId)) {
        seen.add(o.orderId)
        result.push(o)
      }
    }
    return result
  }

  /* ==================== 退款提示 ==================== */

  /** 退款通知处理（6 秒冷却防频繁） */
  private handleRefundNotice(): void {
    const now = Date.now()
    if (now - this.lastRefundSoundTime < REFUND_SOUND_COOLDOWN) return
    this.lastRefundSoundTime = now
    this.emit('refund-notice')
    log.info('检测到退款通知，触发提示音')
  }

  /* ==================== 重启恢复 ==================== */

  /**
   * 重启恢复：加载今日 pending 重新入队（对应 KMP requeuePendingOrders）
   *
   * 同时把恢复的 pending 订单回填到 pendingMap 并广播 pending-updated，
   * 让 UI 立即显示今日待打印订单（满足"每次打开/切换门店都显示今日订单"需求）。
   *
   * 语义说明：
   *  - 入队：pending 表中的订单都是"未打印成功"的，重启后重新尝试打印（原 KMP 行为）
   *  - 回填 pendingMap：仅 UI 显示用途，打印成功后由 removePendingFromMemory 自动移除
   *  - 二者不冲突：pending 表是持久化真相源，pendingMap 是内存镜像
   *
   * @param shopId 门店 id
   */
  requeuePendingOrders(shopId: string): void {
    if (!shopId || !shopId.trim()) {
      log.warn('requeuePendingOrders 门店号为空，拒绝恢复待打印订单')
      return
    }
    const date = todayDate()
    const pendingRows = DatabaseService.getPendingOrders(date, shopId)
    if (pendingRows.length === 0) {
      // 无 pending 也要广播一次空快照，确保 UI 与主进程同步（如切换门店后新门店无 pending）
      this.emit('pending-updated', this.getPendingSnapshot())
      return
    }
    log.info(`重启恢复：重新入队 ${pendingRows.length} 条待打印订单`)
    pendingRows.forEach((row: any) => {
      const detail: ShopPrintOrderDetail = {
        platform: row.platform_id,
        orderId: row.order_id,
        daySeq: row.day_seq,
        shopName: '',
        shopPhone: '',
        billingTime: '',
        address: '',
        remarks: '',
        temperature: '',
        platformName: '',
        uptime: '',
        orderType: '',
        totalNum: '',
        packageBagMoney: '',
        shippingFee: '',
        originalPrice: '',
        totalFee: '',
        goodsList: [],
        shopId: row.shop_id || shopId
      }
      this.printingSet.add(orderKey(row.platform_id, row.order_id))
      // 回填 pendingMap：让 UI 显示今日待打印订单（每次打开/切换门店都显示）
      this.addPendingToMemory(row.platform_id, row.order_id, row.day_seq)
      this.queue.push(detail)
    })
    // 广播 pending 快照，UI 立即显示恢复的待打印订单
    this.emit('pending-updated', this.getPendingSnapshot())
    this.processQueue()
  }

  /**
   * 加载已打印订单到内存（对应 KMP loadPrintedOrdersFromDb）
   * 启动时调用，用于 UI 显示 + 当日去重。
   * @param shopId 门店 id
   */
  async loadPrintedOrdersFromDb(shopId: string): Promise<void> {
    if (!shopId || !shopId.trim()) {
      log.warn('loadPrintedOrdersFromDb 门店号为空，拒绝加载已打印订单')
      return
    }
    const date = todayDate()
    const rows = DatabaseService.getPrintedOrders(date, shopId)
    // 修复：DatabaseService 当前只有 getPrintedDaySeqs，这里补充完整查询
    const map: Record<string, Record<string, ShopPrintOrderItem>> = {}
    rows.forEach((r: any) => {
      if (!map[r.platform_id]) map[r.platform_id] = {}
      map[r.platform_id][r.order_id] = { orderId: r.order_id, daySeq: r.day_seq }
    })
    this.printedMap = map
    log.info(`从 DB 加载已打印订单 ${rows.length} 条`)
    this.emit('printed-updated', this.getPrintedSnapshot())
  }

  /** 清空已打印缓存 */
  clearPrintedOrderIds(): void {
    this.printedMap = {}
  }

  /* ==================== 工具 ==================== */

  /** sleep */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 手动重打 / 查询打印统一入口（对应 KMP printSingleDoc → getOrder → singlePrint）
   *
   * 流程：getOrder 单查订单详情 → enqueueSingle 入队 → processQueue 消费打印。
   * 防御：getOrder 返回的 detail 若缺 platform 字段（个别后端版本差异），
   * 显式注入 platform=platformId，避免 printOne 中 detail.platform 为 undefined
   * 导致 DB 去重 key 错乱、confirmPrinted 归属错误。
   */
  async reprintOrder(platformId: string, shopId: string, orderId: string): Promise<boolean> {
    try {
      // 业务铁律：重打必须传入门店号，空则拒绝（防止跨门店错打小票）
      if (!shopId || !shopId.trim()) {
        log.error(`reprintOrder 门店号为空，拒绝重打 [${platformId}][${orderId}]`)
        return false
      }
      if (!orderId || !orderId.trim()) {
        log.error(`reprintOrder 订单号为空，拒绝重打 [${platformId}]`)
        return false
      }
      log.info(`reprintOrder 入参 platformId=${platformId} shopId=${shopId} orderId=${orderId}`)
      const detail = await ApiService.getOrder(platformId, shopId, orderId)
      if (!detail) {
        log.error(`reprintOrder getOrder 返回空 [${platformId}][${orderId}]`)
        return false
      }
      // 防御性注入 platform（兜底后端返回缺字段）
      const detailWithMeta: ShopPrintOrderDetail = {
        ...detail,
        shopId,
        platform: detail.platform || platformId
      }
      log.info(
        `reprintOrder getOrder 成功 orderId=${detailWithMeta.orderId} daySeq=${detailWithMeta.daySeq} platform=${detailWithMeta.platform} 平台名=${detailWithMeta.platformName} 商品数=${detailWithMeta.goodsList?.length || 0}`
      )
      this.enqueueSingle(detailWithMeta)
      return true
    } catch (e) {
      log.error('reprintOrder 异常:', e)
      return false
    }
  }

  /** 记录操作日志（转发到渲染层） */
  log(message: string): void {
    this.emit('log', message)
  }
}

/** 打印服务单例 */
export const PrintService = new PrintServiceImpl()
