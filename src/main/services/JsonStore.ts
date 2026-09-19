/**
 * @file JSON 文件存储服务（替代 better-sqlite3 原生模块）
 * @module services/JsonStore
 *
 * 职责：
 *  1. 已打印订单持久化（防重复打印）
 *  2. 待打印订单持久化（重启恢复）
 *  3. 取消/退款订单记录
 *  4. 连接日志记录
 *  5. 冷启动自动清理历史数据（只留存今天）
 *  6. 数据查看（统计/全量/打开目录）
 *
 * 存储结构（按日期分片，对应 KMP printed_order/pending_print_order/cancel_order/ConnectionInfo 四张表）：
 *   userData/pgprint/data/
 *     ├── printed-YYYY-MM-DD.json     已打印订单（防重复）
 *     ├── pending-YYYY-MM-DD.json     待打印订单（重启恢复）
 *     ├── cancel-YYYY-MM-DD.json      取消/退款订单
 *     └── connection-YYYY-MM-DD.json  连接日志
 *
 * 冷启动策略：
 *   init() 时扫描 data/ 目录，删除所有非今天的 JSON 文件。
 *   天然满足"每次冷启动只留存今天数据"，防止跨日重复打印或数据存留。
 *
 * 选型理由（替代 SQLite 的优势）：
 *  1. 零原生依赖：无需 electron-rebuild，Win7 部署零痛点（better-sqlite3 需针对 Electron 22 ABI 编译）
 *  2. 按日期分文件：冷启动清理历史数据只需删文件，O(n) 扫描即可
 *  3. 纯文本 JSON：可用任意编辑器（VSCode/记事本/浏览器）直接查看结构，无需数据库工具
 *  4. 数据量小：每日几十~几百条订单，JSON 读写性能足够（单文件 < 100KB）
 *  5. 可读性强：字段 camelCase/snake_case 可控，便于人工排查问题
 *
 * API 与原 DatabaseService 完全兼容（方法名/参数顺序/返回字段一致），
 * PrintService/index.ts 只需改 import 路径即可无缝切换。
 */
import { app, shell } from 'electron'
import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync
} from 'fs'
import log from 'electron-log/main'

/** 表名常量（对应文件名前缀） */
const TABLE_PRINTED = 'printed'
const TABLE_PENDING = 'pending'
const TABLE_CANCEL = 'cancel'
const TABLE_CONNECTION = 'connection'

/** 已打印订单行（字段名与原 SQLite printed_order 表一致，snake_case） */
export interface PrintedOrderRow {
  platform_id: string
  order_id: string
  day_seq: string
  date: string
  shop_id: string
}

/** 待打印订单行（对应 pending_print_order 表） */
export interface PendingOrderRow extends PrintedOrderRow {
  retry_count: number
}

/** 取消订单行（对应 cancel_order 表） */
export interface CancelOrderRow {
  platform_id: string
  day_seq: string
  date: string
  order_id: string
  shop_id: string
}

/** 连接日志行（对应 ConnectionInfo 表） */
export interface ConnectionLogRow {
  id: number
  dateText: string
  createdAt: number
  connectionDetail: string
  textColor: string
}

/**
 * 获取数据目录根路径（userData/pgprint/data/）
 * 目录不存在时自动创建（递归）
 */
function getDataDir(): string {
  const dir = join(app.getPath('userData'), 'pgprint', 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 今日日期 yyyy-MM-dd（与 PrintService.todayDate 一致） */
function todayDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 按表名 + 日期构造文件路径 */
function filePath(table: string, date: string): string {
  return join(getDataDir(), `${table}-${date}.json`)
}

/**
 * 读取某表某日的全部记录
 * 文件不存在或解析失败时返回空数组（容错，不抛异常）
 * @param table 表名前缀（printed/pending/cancel/connection）
 * @param date 日期 yyyy-MM-dd
 */
function readTable<T = any>(table: string, date: string): T[] {
  const fp = filePath(table, date)
  if (!existsSync(fp)) return []
  try {
    const raw = readFileSync(fp, 'utf-8')
    const rows = JSON.parse(raw)
    return Array.isArray(rows) ? rows : []
  } catch (e) {
    log.error(`JsonStore 读取失败 [${fp}]:`, e)
    return []
  }
}

/**
 * 写入某表某日的全部记录（整体覆盖，原子写入）
 * @param table 表名前缀
 * @param date 日期 yyyy-MM-dd
 * @param rows 记录数组
 */
function writeTable(table: string, date: string, rows: any[]): void {
  const fp = filePath(table, date)
  try {
    // JSON.stringify 带 2 空格缩进，便于人工查看
    writeFileSync(fp, JSON.stringify(rows, null, 2), 'utf-8')
  } catch (e) {
    log.error(`JsonStore 写入失败 [${fp}]:`, e)
  }
}

/**
 * 冷启动清理：删除 data/ 目录下所有非今天的 JSON 文件
 *
 * 策略：文件名格式为 tableName-YYYY-MM-DD.json，
 *   提取日期部分与 todayDate() 比较，不一致则删除。
 * 这保证了每次冷启动只留存今天的数据，防止跨日重复打印。
 */
function cleanHistoryFiles(): void {
  const dir = getDataDir()
  const today = todayDate()
  let cleaned = 0
  try {
    const files = readdirSync(dir)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      // 提取文件名中的日期：tableName-YYYY-MM-DD.json → YYYY-MM-DD
      const match = f.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.json$/)
      if (!match) continue
      const fileDate = match[2]
      if (fileDate !== today) {
        unlinkSync(join(dir, f))
        cleaned++
        log.info(`冷启动清理历史文件: ${f}`)
      }
    }
    if (cleaned > 0) {
      log.info(`冷启动清理完成：共删除 ${cleaned} 个历史数据文件（非今日 ${today}）`)
    } else {
      log.info(`冷启动检查：无历史文件需清理（今日 ${today}）`)
    }
  } catch (e) {
    log.error('冷启动清理历史文件失败:', e)
  }
}

/**
 * JsonStore 单例（API 与原 DatabaseService 完全兼容）
 */
export const JsonStore = {
  /**
   * 初始化：创建数据目录 + 清理历史文件
   * 在 app.whenReady 时调用（对应原 DatabaseService.init）
   */
  init(): void {
    getDataDir()
    cleanHistoryFiles()
    log.info('JsonStore 初始化完成，数据目录:', getDataDir())
  },

  /** 是否可用（始终 true，无原生模块依赖） */
  isAvailable(): boolean {
    return true
  },

  /* ============ printed_order（已打印，防重复） ============ */

  /**
   * 记录已打印订单（INSERT OR IGNORE 语义：已存在则跳过）
   * 主键：(platform_id, order_id, shop_id)
   */
  insertPrintedOrder(
    platformId: string,
    orderId: string,
    daySeq: string,
    date: string,
    shopId: string
  ): void {
    const rows = readTable<PrintedOrderRow>(TABLE_PRINTED, date)
    const exists = rows.some(
      (r) => r.platform_id === platformId && r.order_id === orderId && r.shop_id === shopId
    )
    if (exists) return
    rows.push({ platform_id: platformId, order_id: orderId, day_seq: daySeq, date, shop_id: shopId })
    writeTable(TABLE_PRINTED, date, rows)
  },

  /** 查询某日已打印订单 day_seq 列表（按 day_seq 升序） */
  getPrintedDaySeqs(date: string, shopId: string): string[] {
    const rows = readTable<PrintedOrderRow>(TABLE_PRINTED, date)
    return rows
      .filter((r) => r.shop_id === shopId)
      .map((r) => r.day_seq)
      .sort()
  },

  /** 查询某日已打印订单完整记录（用于启动加载到内存） */
  getPrintedOrders(date: string, shopId: string): PrintedOrderRow[] {
    const rows = readTable<PrintedOrderRow>(TABLE_PRINTED, date)
    return rows.filter((r) => r.shop_id === shopId)
  },

  /** 是否已打印（今日数据，按 platform_id + order_id + shop_id 查） */
  isPrinted(platformId: string, orderId: string, shopId: string): boolean {
    const date = todayDate()
    const rows = readTable<PrintedOrderRow>(TABLE_PRINTED, date)
    return rows.some(
      (r) => r.platform_id === platformId && r.order_id === orderId && r.shop_id === shopId
    )
  },

  /* ============ pending_print_order（待打印，重启恢复） ============ */

  /**
   * 入队待打印订单（INSERT OR REPLACE 语义：已存在则更新）
   * 主键：(platform_id, order_id, shop_id)
   */
  insertPendingOrder(
    platformId: string,
    orderId: string,
    daySeq: string,
    date: string,
    shopId: string,
    retryCount = 0
  ): void {
    const rows = readTable<PendingOrderRow>(TABLE_PENDING, date)
    const idx = rows.findIndex(
      (r) => r.platform_id === platformId && r.order_id === orderId && r.shop_id === shopId
    )
    const row: PendingOrderRow = {
      platform_id: platformId,
      order_id: orderId,
      day_seq: daySeq,
      date,
      shop_id: shopId,
      retry_count: retryCount
    }
    if (idx >= 0) rows[idx] = row
    else rows.push(row)
    writeTable(TABLE_PENDING, date, rows)
  },

  /** 打印成功后删除待打印记录（今日数据） */
  deletePendingOrder(platformId: string, orderId: string, shopId: string): void {
    const date = todayDate()
    const rows = readTable<PendingOrderRow>(TABLE_PENDING, date)
    const filtered = rows.filter(
      (r) => !(r.platform_id === platformId && r.order_id === orderId && r.shop_id === shopId)
    )
    if (filtered.length !== rows.length) {
      writeTable(TABLE_PENDING, date, filtered)
    }
  },

  /** 查询某日待打印订单（按 day_seq 升序） */
  getPendingOrders(date: string, shopId: string): PendingOrderRow[] {
    const rows = readTable<PendingOrderRow>(TABLE_PENDING, date)
    return rows
      .filter((r) => r.shop_id === shopId)
      .sort((a, b) => a.day_seq.localeCompare(b.day_seq))
  },

  /** 更新重试次数（今日数据） */
  updateRetryCount(platformId: string, orderId: string, shopId: string, count: number): void {
    const date = todayDate()
    const rows = readTable<PendingOrderRow>(TABLE_PENDING, date)
    const row = rows.find(
      (r) => r.platform_id === platformId && r.order_id === orderId && r.shop_id === shopId
    )
    if (row) {
      row.retry_count = count
      writeTable(TABLE_PENDING, date, rows)
    }
  },

  /* ============ cancel_order（取消/退款订单） ============ */

  /** 记录取消订单（INSERT OR REPLACE 语义） */
  insertCancelOrder(
    platformId: string,
    daySeq: string,
    date: string,
    orderId: string,
    shopId: string
  ): void {
    const rows = readTable<CancelOrderRow>(TABLE_CANCEL, date)
    const idx = rows.findIndex(
      (r) => r.shop_id === shopId && r.date === date && r.order_id === orderId
    )
    const row: CancelOrderRow = {
      platform_id: platformId,
      day_seq: daySeq,
      date,
      order_id: orderId,
      shop_id: shopId
    }
    if (idx >= 0) rows[idx] = row
    else rows.push(row)
    writeTable(TABLE_CANCEL, date, rows)
  },

  /** 查询某日取消订单 id 列表 */
  getCancelOrderIds(date: string, shopId: string): string[] {
    const rows = readTable<CancelOrderRow>(TABLE_CANCEL, date)
    return rows.filter((r) => r.shop_id === shopId).map((r) => r.order_id)
  },

  /* ============ ConnectionInfo（连接日志） ============ */

  /** 记录连接日志 */
  insertConnectionLog(dateText: string, connectionDetail: string, textColor = '#07c160'): void {
    const rows = readTable<ConnectionLogRow>(TABLE_CONNECTION, dateText)
    rows.push({
      id: Date.now(),
      dateText,
      createdAt: Date.now(),
      connectionDetail,
      textColor
    })
    writeTable(TABLE_CONNECTION, dateText, rows)
  },

  /** 查询某日连接日志（按 createdAt 降序，最新在前） */
  getConnectionLogs(dateText: string): ConnectionLogRow[] {
    const rows = readTable<ConnectionLogRow>(TABLE_CONNECTION, dateText)
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  },

  /* ============ 清理 ============ */

  /**
   * 清理指定日期之前的所有数据文件
   * 注意：init() 已自动清理非今日文件，此方法保留兼容性，
   * 可用于运行时按指定日期清理（如切换门店时）。
   */
  cleanOlderThanDate(date: string, _shopId?: string): void {
    const dir = getDataDir()
    try {
      const files = readdirSync(dir)
      for (const f of files) {
        const match = f.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.json$/)
        if (!match) continue
        // 字符串比较日期：YYYY-MM-DD 格式可直接字典序比较
        if (match[2] < date) {
          unlinkSync(join(dir, f))
          log.info(`清理历史文件: ${f}`)
        }
      }
    } catch (e) {
      log.error('cleanOlderThanDate 失败:', e)
    }
  },

  /* ============ 数据查看（新增，供调试工具/视图用） ============ */

  /** 今日各表统计信息（供"本地数据查看"面板展示概览） */
  getStats(): {
    date: string
    printed: number
    pending: number
    cancel: number
    connection: number
  } {
    const date = todayDate()
    return {
      date,
      printed: readTable(TABLE_PRINTED, date).length,
      pending: readTable(TABLE_PENDING, date).length,
      cancel: readTable(TABLE_CANCEL, date).length,
      connection: readTable(TABLE_CONNECTION, date).length
    }
  },

  /** 今日全部数据（供"本地数据查看"面板展示完整记录） */
  getAllData(): {
    date: string
    printed: PrintedOrderRow[]
    pending: PendingOrderRow[]
    cancel: CancelOrderRow[]
    connection: ConnectionLogRow[]
  } {
    const date = todayDate()
    return {
      date,
      printed: readTable<PrintedOrderRow>(TABLE_PRINTED, date),
      pending: readTable<PendingOrderRow>(TABLE_PENDING, date),
      cancel: readTable<CancelOrderRow>(TABLE_CANCEL, date),
      connection: readTable<ConnectionLogRow>(TABLE_CONNECTION, date)
    }
  },

  /** 获取数据目录绝对路径（供打开目录用） */
  getDataDirPath(): string {
    return getDataDir()
  },

  /** 在系统文件管理器中打开数据目录（供用户用编辑器查看 JSON） */
  openDataDir(): void {
    shell.openPath(getDataDir())
  }
}
