import { app } from 'electron'
import { join } from 'path'
import log from 'electron-log/main'
import { STORED_DIR } from '../config'

/**
 * SQLite 数据库服务（对应 KMP DatabaseManager.kt + SQLDelight）
 *
 * 表结构（与 KMP v4 完全一致）：
 *   - printed_order        已打印订单（防重复）
 *   - pending_print_order  待打印订单（重启恢复）
 *   - cancel_order         取消/退款订单
 *   - ConnectionInfo       连接日志
 *
 * better-sqlite3 为原生模块，需 electron-rebuild 针对 Electron ABI 编译。
 * 开发机若未编译则降级为不可用状态，生产环境（Windows 打包）正常加载。
 */

let db: any = null
let available = false

function getDbPath(): string {
  // Win7: 存到用户目录下 pgprint/db（与 KMP 一致）
  const userData = app.getPath('userData')
  return join(userData, 'pgprint.db')
}

const SCHEMA_SQL = [
  // v1: printed_order
  `CREATE TABLE IF NOT EXISTS printed_order (
    platform_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    day_seq TEXT NOT NULL,
    date TEXT NOT NULL,
    shop_id TEXT DEFAULT '',
    PRIMARY KEY(platform_id, order_id, shop_id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_printed_order_shop_date ON printed_order(date, shop_id);`,
  // v2: cancel_order
  `CREATE TABLE IF NOT EXISTS cancel_order (
    platform_id TEXT NOT NULL,
    day_seq TEXT NOT NULL,
    date TEXT NOT NULL,
    order_id TEXT NOT NULL,
    shop_id TEXT DEFAULT '',
    PRIMARY KEY(shop_id, date, order_id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_cancel_order_index ON cancel_order(date, shop_id);`,
  // v4: pending_print_order
  `CREATE TABLE IF NOT EXISTS pending_print_order (
    platform_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    day_seq TEXT NOT NULL,
    date TEXT NOT NULL,
    shop_id TEXT DEFAULT '',
    retry_count INTEGER DEFAULT 0,
    PRIMARY KEY(platform_id, order_id, shop_id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_pending_print_order_shop_date ON pending_print_order(shop_id, date);`,
  // ConnectionInfo
  `CREATE TABLE IF NOT EXISTS ConnectionInfo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dateText TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    connectionDetail TEXT NOT NULL,
    textColor TEXT DEFAULT '#07c160'
  );`,
  `CREATE INDEX IF NOT EXISTS idx_connection_date ON ConnectionInfo(dateText);`
]

function initDb(): void {
  try {
    // 动态加载原生模块（避免开发机未编译时主进程崩溃）
    const Database = require('better-sqlite3')
    const dbPath = getDbPath()
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    for (const sql of SCHEMA_SQL) {
      db.exec(sql)
    }
    db.pragma('user_version = 4')
    available = true
    log.info('SQLite 初始化成功:', dbPath)
  } catch (err) {
    available = false
    db = null
    log.error('SQLite 加载失败（原生模块未编译或不可用）:', err)
  }
}

export const DatabaseService = {
  init(): void {
    initDb()
  },

  isAvailable(): boolean {
    return available
  },

  /** 记录已打印订单（防重复） */
  insertPrintedOrder(
    platformId: string,
    orderId: string,
    daySeq: string,
    date: string,
    shopId: string
  ): void {
    if (!available) return
    db.prepare(
      'INSERT OR IGNORE INTO printed_order(platform_id, order_id, day_seq, date, shop_id) VALUES(?,?,?,?,?)'
    ).run(platformId, orderId, daySeq, date, shopId)
  },

  /** 查询某日已打印订单 day_seq 列表 */
  getPrintedDaySeqs(date: string, shopId: string): string[] {
    if (!available) return []
    const rows = db
      .prepare('SELECT day_seq FROM printed_order WHERE date = ? AND shop_id = ? ORDER BY day_seq ASC')
      .all(date, shopId)
    return rows.map((r: any) => r.day_seq)
  },

  /** 查询某日已打印订单完整记录（platform_id/order_id/day_seq），用于启动加载到内存 */
  getPrintedOrders(date: string, shopId: string): any[] {
    if (!available) return []
    return db
      .prepare('SELECT platform_id, order_id, day_seq FROM printed_order WHERE date = ? AND shop_id = ?')
      .all(date, shopId)
  },

  /** 是否已打印 */
  isPrinted(platformId: string, orderId: string, shopId: string): boolean {
    if (!available) return false
    const row = db
      .prepare('SELECT 1 FROM printed_order WHERE platform_id = ? AND order_id = ? AND shop_id = ?')
      .get(platformId, orderId, shopId)
    return !!row
  },

  /** 入队待打印订单（重启恢复） */
  insertPendingOrder(
    platformId: string,
    orderId: string,
    daySeq: string,
    date: string,
    shopId: string,
    retryCount = 0
  ): void {
    if (!available) return
    db.prepare(
      'INSERT OR REPLACE INTO pending_print_order(platform_id, order_id, day_seq, date, shop_id, retry_count) VALUES(?,?,?,?,?,?)'
    ).run(platformId, orderId, daySeq, date, shopId, retryCount)
  },

  /** 打印成功后删除待打印记录 */
  deletePendingOrder(platformId: string, orderId: string, shopId: string): void {
    if (!available) return
    db.prepare(
      'DELETE FROM pending_print_order WHERE platform_id = ? AND order_id = ? AND shop_id = ?'
    ).run(platformId, orderId, shopId)
  },

  /** 查询某日待打印订单 */
  getPendingOrders(date: string, shopId: string): any[] {
    if (!available) return []
    return db
      .prepare('SELECT * FROM pending_print_order WHERE date = ? AND shop_id = ? ORDER BY day_seq ASC')
      .all(date, shopId)
  },

  /** 更新重试次数 */
  updateRetryCount(platformId: string, orderId: string, shopId: string, count: number): void {
    if (!available) return
    db.prepare(
      'UPDATE pending_print_order SET retry_count = ? WHERE platform_id = ? AND order_id = ? AND shop_id = ?'
    ).run(count, platformId, orderId, shopId)
  },

  /** 记录取消订单 */
  insertCancelOrder(
    platformId: string,
    daySeq: string,
    date: string,
    orderId: string,
    shopId: string
  ): void {
    if (!available) return
    db.prepare(
      'INSERT OR REPLACE INTO cancel_order(platform_id, day_seq, date, order_id, shop_id) VALUES(?,?,?,?,?)'
    ).run(platformId, daySeq, date, orderId, shopId)
  },

  /** 查询某日取消订单 */
  getCancelOrderIds(date: string, shopId: string): string[] {
    if (!available) return []
    const rows = db
      .prepare('SELECT order_id FROM cancel_order WHERE date = ? AND shop_id = ?')
      .all(date, shopId)
    return rows.map((r: any) => r.order_id)
  },

  /** 记录连接日志 */
  insertConnectionLog(dateText: string, connectionDetail: string, textColor = '#07c160'): void {
    if (!available) return
    db.prepare(
      'INSERT INTO ConnectionInfo(dateText, createdAt, connectionDetail, textColor) VALUES(?,?,?,?)'
    ).run(dateText, Date.now(), connectionDetail, textColor)
  },

  /** 查询某日连接日志 */
  getConnectionLogs(dateText: string): any[] {
    if (!available) return []
    return db
      .prepare('SELECT * FROM ConnectionInfo WHERE dateText = ? ORDER BY createdAt DESC')
      .all(dateText)
  },

  /** 清理旧数据（按日期） */
  cleanOlderThanDate(date: string, shopId: string): void {
    if (!available) return
    db.prepare('DELETE FROM printed_order WHERE date < ? AND shop_id = ?').run(date, shopId)
    db.prepare('DELETE FROM pending_print_order WHERE date < ? AND shop_id = ?').run(date, shopId)
    db.prepare('DELETE FROM cancel_order WHERE date < ? AND shop_id = ?').run(date, shopId)
    db.prepare('DELETE FROM ConnectionInfo WHERE dateText < ?').run(date)
  }
}