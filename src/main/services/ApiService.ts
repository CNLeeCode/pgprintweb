import axios, { AxiosInstance } from 'axios'
import { EventEmitter } from 'events'
import { lookup as dnsLookup } from 'node:dns/promises'
import { connect as netConnect } from 'node:net'
import log from 'electron-log/main'
import { API_BASE_URL, API_SECRET, HTTP_TIMEOUT, UPDATE_CHECK_URL } from '../config'

/**
 * 接口调用日志条目（用于渲染进程"接口日志"弹窗展示）
 *
 * 每条记录一次接口调用的结果（成功/失败 + 简要原因）。
 * 保留最近 50 条（FIFO，超出自动丢弃最旧），既能还原现场又不过度占内存。
 *
 * 用途：
 *  - 主进程主动 emit('api-log', entry) → IPC 广播给渲染进程 → Footer 状态实时刷新
 *  - 渲染进程通过 api:getLogs IPC 拉取最近 50 条做完整列表展示
 */
export interface ApiLogEntry {
  /** 时间戳 ISO 字符串（YYYY-MM-DD HH:mm:ss） */
  time: string
  /** 接口名（getPlatformList / getDaySeq / getOrderList / getOrder / getAppUpdateInfo） */
  method: string
  /** 状态：success / fail */
  status: 'success' | 'fail'
  /** 后端 code（成功时记录业务 code，失败时无则省略） */
  code?: number | string
  /** 简要描述（成功：success/数据条数；失败：错误简述，如 "timeout" "ECONNREFUSED" "HTTP 500"） */
  message: string
}

/** 最近接口调用日志保留上限（FIFO） */
const MAX_API_LOGS = 50

/** 内部 EventEmitter：用于向 IPC 层广播 api-log 事件 */
const apiLogEmitter = new EventEmitter()

/** 最近接口调用日志（FIFO，最新追加到末尾） */
const recentLogs: ApiLogEntry[] = []

/**
 * 记录一条接口调用日志
 *
 * 统一入口：所有 ApiService 方法在成功/失败分支都调用此函数，确保日志齐全。
 * 同时主动 emit 事件，由 IPC 层转发到渲染进程，让 Footer 实时感知接口状态。
 *
 * @param method 接口名
 * @param status success / fail
 * @param message 简要描述
 * @param code 后端 code（可选）
 */
function recordLog(
  method: string,
  status: 'success' | 'fail',
  message: string,
  code?: number | string
): void {
  const entry: ApiLogEntry = {
    time: new Date().toISOString().replace('T', ' ').substring(0, 19),
    method,
    status,
    message,
    code
  }
  recentLogs.push(entry)
  if (recentLogs.length > MAX_API_LOGS) recentLogs.shift()
  apiLogEmitter.emit('api-log', entry)
}

/** 从 axios 错误对象提取简短描述（避免把整个 Error 序列化刷屏） */
function shortError(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { code?: string; message?: string; response?: { status?: number } }
    if (err.response?.status) return `HTTP ${err.response.status}`
    if (err.code) return err.code
    if (err.message) return err.message.substring(0, 120)
  }
  return String(e).substring(0, 120)
}
import type {
  RequestResult,
  PrintPlatform,
  DaySeqResult,
  ShopPrintOrderDetail,
  AppUpdateInfo
} from '@shared/types/models'

/**
 * 后端接口服务（对应 KMP AppRequest + UpdateManager + PrintTask 网络部分）
 * 域名 http://<生产域名> 前缀 /index.php/Home/<接口前缀名>/
 */

const client: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: HTTP_TIMEOUT,
  maxRedirects: 5,
  // ⚠️ 显式禁用代理（Win7 兼容）
  // axios 在 Node 环境默认会读 HTTP_PROXY/HTTPS_PROXY 环境变量；
  // Win7 上 IE 代理设置残留或第三方软件注入的代理环境变量会让请求走代理失败。
  // 显式 proxy:false 完全禁用，直接走系统网络栈，与浏览器一致。
  proxy: false
})

/**
 * 后端字段名 → 前端属性名 显式映射表
 *
 * 精确对照 KMP 各数据类的 @SerialName 注解。
 * 存在原因：toCamelCase 的通用 snake→camel 正则只能处理含下划线的键
 * （如 day_seq→daySeq），但 KMP 有大量"后端字段名 ≠ 前端属性名且无下划线"的字段，
 * 通用转换无法覆盖，必须显式映射，否则前端访问属性得到 undefined。
 *
 * 典型坑（曾导致"去重后待打印 1 条 + 获取详情 0 条"死循环）：
 *  - orderid（无下划线）→ orderId：getDaySeq 返回的 data 元素键仍是 orderid，
 *    distinctByOrderId 访问 o.orderId 全为 undefined，169 条去重后只剩 1 个 undefined。
 *
 * 对照来源：
 *  - ShopPrintOrderDetail.kt 的 @SerialName（wmid/orderid/wmname/jh_temperature/...）
 *  - ShopPrintOrder.kt 的 @SerialName（refund_notice）
 *  - ShopPrintOrderItem 的 @SerialName（orderid/day_seq）
 */
const FIELD_MAP: Record<string, string> = {
  // ShopPrintOrderItem / printed_order / pending_print_order
  orderid: 'orderId',
  day_seq: 'daySeq',
  // ShopPrintOrderDetail（wmid→platform 等语义重命名，无下划线通用转换无法处理）
  wmid: 'platform',
  wmname: 'platformName',
  jh_temperature: 'temperature',
  reserve_status: 'orderType',
  shop_name: 'shopName',
  shop_phone: 'shopPhone',
  billing_time: 'billingTime',
  package_bag_money: 'packageBagMoney',
  shipping_fee: 'shippingFee',
  item_price: 'originalPrice',
  // 后端字段名与前端属性名不同但均为单词（无下划线），必须显式映射
  count: 'totalNum',
  total: 'totalFee',
  detail: 'goodsList',
  // ShopPrintOrderGoodsItem
  goods_name: 'goodsName',
  // ShopPrintOrder
  refund_notice: 'refundNotice'
}

/**
 * 子键豁免映射表（按父键分组）
 *
 * 背景：FIELD_MAP 是全局映射，但 KMP 存在"同后端字段名在不同数据类映射不同"的情况，
 * 通过 @SerialName 注解按类精确控制。Electron 用全局 FIELD_MAP 无法区分层级，必须用
 * 父键上下文豁免。
 *
 * 典型冲突：`count` 在订单详情顶层是订单总数（KMP @SerialName("count") val totalNum），
 * 但在商品列表 detail 元素里是商品数量（KMP ShopPrintOrderGoodsItem val count 无 @SerialName，
 * 后端字段名即属性名）。若不加豁免，商品数量 count 会被误转成 totalNum，导致打印模板
 * 访问 item.count 得到 undefined。
 *
 * 配置格式：{ 父键(后端原始键名): [需保持原名的子键列表] }
 */
const FIELD_KEEP_BY_PARENT: Record<string, string[]> = {
  // 商品列表 detail 元素：count（数量）/price（单价）保持原名，不走 count→totalNum 映射
  detail: ['count', 'price']
}

/**
 * 递归后端键名 → 前端属性名转换（对应 KMP @SerialName 注解）
 *
 * 转换优先级：
 *  1. 先查 FIELD_KEEP_BY_PARENT[parentKey] 豁免表，命中则保持原名（处理同字段名跨类冲突）
 *  2. 再查 FIELD_MAP 显式映射表（精确对照 KMP @SerialName），命中直接用映射值
 *  3. 未命中再走通用 snake_case → camelCase 正则转换（处理剩余带下划线字段）
 *
 * 上下文传递：递归子对象时把当前键名作为 parentKey 传入，用于层级感知。
 * 仅转换对象键，跳过数组元素；空值/原始类型原样返回。
 *
 * @param obj 待转换数据
 * @param parentKey 父级键名（后端原始键名），用于查豁免表
 */
function toCamelCase(obj: unknown, parentKey?: string): unknown {
  if (Array.isArray(obj)) return obj.map((item) => toCamelCase(item, parentKey))
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    // 当前父键下的豁免字段列表（命中则子键保持原名，不走 FIELD_MAP）
    const keepFields = parentKey ? FIELD_KEEP_BY_PARENT[parentKey] : undefined
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      let camelKey: string
      if (keepFields && keepFields.includes(k)) {
        // 命中豁免：保持原名（如商品列表内的 count/price，避免被全局 count→totalNum 误转）
        camelKey = k
      } else {
        // 优先查显式映射表，未命中再走通用 snake→camel 转换
        camelKey = FIELD_MAP[k] ?? k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
      }
      // 递归子对象时传入当前键名（后端原始键名）作为 parentKey
      result[camelKey] = toCamelCase(v, k)
    }
    return result
  }
  return obj
}

// 响应拦截器：自动转 camelCase
client.interceptors.response.use((response) => {
  response.data = toCamelCase(response.data)
  return response
})

/** 表单参数工具：orderid_list[] 数组参数 */
function form(params: Record<string, string | string[]>): URLSearchParams {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) p.append(k, item)
    } else {
      p.append(k, v)
    }
  }
  return p
}

export const ApiService = {
  /** 订阅接口日志事件（IPC 层用于转发到渲染进程） */
  on: (event: string, listener: (...args: unknown[]) => void) => apiLogEmitter.on(event, listener),
  /** 获取最近接口调用日志（渲染进程通过 IPC 拉取） */
  getRecentLogs: (): ApiLogEntry[] => [...recentLogs],
  /**
   * GET getWebPgPrintUpdateInfo → 获取最新版本号 + 下载地址 + 更新说明（方案 B）
   *
   * 接口地址由 UPDATE_CHECK_URL 配置（环境变量 VITE_UPDATE_SERVER_URL），
   * 前期 IP 后期域名只改 .env 一行。
   *
   * 后端响应格式（标准 RequestResult，数据在 data 字段；force_update 是字符串）：
   *   {
   *     "code": 200,
   *     "msg": "success",
   *     "data": {
   *       "name": "PG-PRINTER",
   *       "version": "1.0",
   *       "key": "kZasd99989Cskjk=9/a0Dsa3jlkjlkS",
   *       "download_url": "",
   *       "update_msg": "1.优化已知问题",
   *       "force_update": "0"
   *     }
   *   }
   *
   * axios 响应拦截器自动转 camelCase 后：res.data.data 已是 AppUpdateInfo 对象
   * （downloadUrl/updateMsg/forceUpdate）。
   *
   * 判定规则（由调用方 UpgradeService 实现，此处只负责透传）：
   *   code===200 且 downloadUrl 非空 → 有新版本
   *   其它情况 → 无新版本
   *
   * 失败返回 null，调用方（UpgradeService）负责降级处理。
   */
  async getAppUpdateInfo(): Promise<RequestResult<AppUpdateInfo> | null> {
    try {
      const res = await client.get<RequestResult<AppUpdateInfo>>(UPDATE_CHECK_URL, {
        baseURL: '' // 使用完整地址，避免与 API_BASE_URL 拼接
      })
      log.info(
        'getAppUpdateInfo:',
        res.data?.code,
        'version=' + (res.data as any)?.data?.version,
        'hasUrl=' + !!((res.data as any)?.data?.downloadUrl)
      )
      recordLog('getAppUpdateInfo', 'success', `version=${(res.data as any)?.data?.version || '(无)'} hasUrl=${!!((res.data as any)?.data?.downloadUrl)}`, res.data?.code)
      return res.data
    } catch (e) {
      log.error('getAppUpdateInfo 失败:', e)
      recordLog('getAppUpdateInfo', 'fail', shortError(e))
      return null
    }
  },

  /** GET getPlatformList → 平台列表 */
  async getPlatformList(): Promise<RequestResult<PrintPlatform[]> | null> {
    try {
      const res = await client.get<RequestResult<PrintPlatform[]>>('getPlatformList')
      log.info('getPlatformList:', res.data?.code, res.data?.data?.length)
      recordLog('getPlatformList', 'success', `平台数=${res.data?.data?.length ?? 0}`, res.data?.code)
      return res.data
    } catch (e) {
      log.error('getPlatformList 失败:', e)
      recordLog('getPlatformList', 'fail', shortError(e))
      return null
    }
  },

  /**
   * 校验门店号非空（业务铁律：所有订单相关接口必须传门店号）
   * @returns true 通过 / false 拒绝（已记录告警日志）
   */
  validateShopId(shopid: string, apiName: string): boolean {
    if (!shopid || !shopid.trim()) {
      log.warn(`[${apiName}] 门店号为空，拒绝请求（接口必须传门店号，不能为空）`)
      return false
    }
    return true
  },

  /** POST getDaySeq(wmid, shopid, secret) → 当日订单号列表 */
  async getDaySeq(wmid: string, shopid: string): Promise<DaySeqResult | null> {
    if (!this.validateShopId(shopid, 'getDaySeq')) return null
    try {
      const res = await client.post<DaySeqResult>('getDaySeq', form({ wmid, shopid, secret: API_SECRET }))
      log.info(`getDaySeq wmid=${wmid} shopid=${shopid} code=${res.data?.code} dataLen=${res.data?.data?.length || 0} refundNotice=${res.data?.refundNotice?.length || 0}`)
      // 诊断日志：打印首条数据结构，确认 orderid→orderId / day_seq→daySeq 字段映射已生效
      if (res.data?.data && res.data.data.length > 0) {
        const first = res.data.data[0] as any
        log.info(`getDaySeq 首条样本 orderId=${first.orderId} daySeq=${first.daySeq}`)
      }
      return res.data
    } catch (e) {
      log.error('getDaySeq 失败:', e)
      recordLog('getDaySeq', 'fail', shortError(e) + (shopid ? ` shopid=${shopid}` : ''))
      return null
    }
  },

  /** POST getOrderList(wmid, shopid, secret, orderid_list[]) → 订单详情列表 */
  async getOrderList(wmid: string, shopid: string, orderIdList: string[]): Promise<ShopPrintOrderDetail[]> {
    if (!this.validateShopId(shopid, 'getOrderList')) return []
    if (!orderIdList || orderIdList.length === 0) return []
    try {
      const res = await client.post<RequestResult<ShopPrintOrderDetail[]>>('getOrderList', form({ wmid, shopid, secret: API_SECRET, 'orderid_list[]': orderIdList }))
      recordLog('getOrderList', 'success', `订单数=${res.data?.data?.length ?? 0}`, res.data?.code)
      return res.data?.data || []
    } catch (e) {
      log.error('getOrderList 失败:', e)
      recordLog('getOrderList', 'fail', shortError(e))
      return []
    }
  },

  /** POST getOrder(wmid, shopid, secret, day_seq) → 单个订单详情（重打/查询打印用）
   *
   * 重要：后端字段名虽为 day_seq，但实际接收的是 orderId（订单号），不是流水号 daySeq。
   * 对照 KMP HomeComponent.printSingleDoc：形参名为 daySeq，但 DrawerContent 传入的
   * 实参是 matchedOrder.orderId（见 DrawerContent.kt: `queryValue = matchedOrder?.orderId ?: inputValue`）。
   * 若误传流水号 daySeq，后端按 orderId 查询返回空 → getOrder 返回 null → 重打失败。
   *
   * @param wmid 平台 id
   * @param shopid 门店 id
   * @param orderId 订单号（写入后端 day_seq 字段）
   */
  async getOrder(wmid: string, shopid: string, orderId: string): Promise<ShopPrintOrderDetail | null> {
    if (!this.validateShopId(shopid, 'getOrder')) return null
    if (!orderId || !orderId.trim()) {
      log.warn('[getOrder] 订单号为空，拒绝请求')
      return null
    }
    try {
      const res = await client.post<RequestResult<ShopPrintOrderDetail>>(
        'getOrder',
        form({ wmid, shopid, secret: API_SECRET, day_seq: orderId })
      )
      log.info(`getOrder orderId=${orderId} code=${res.data?.code} msg=${(res.data as any)?.msg || ''} hasData=${!!res.data?.data}`)
      recordLog('getOrder', 'success', `orderId=${orderId} hasData=${!!res.data?.data}`, res.data?.code)
      return res.data?.data || null
    } catch (e) {
      log.error('getOrder 失败 orderId=' + orderId + ':', e)
      recordLog('getOrder', 'fail', shortError(e) + ` orderId=${orderId}`)
      return null
    }
  },

  /**
   * 网络诊断：分步诊断 DNS / TCP / HTTP 三层，返回多行报告
   *
   * 调用场景：Splash 启动检查接口失败时，主进程主动跑一遍诊断，
   * 把详细错误塞到 error 事件 message 里，让 Splash ErrorView 直接展示。
   * 用户在 Win7 真机上一眼看出是 DNS 解析失败 / TCP 连不上 / HTTP 错误码。
   *
   * 诊断步骤：
   *  1. DNS 解析 <生产域名>，列出 IPv4/IPv6 地址
   *  2. TCP 连接到第一个 IPv4 地址的 80 端口（3 秒超时）
   *  3. 用 axios 实际请求 API_BASE_URL，记录响应码 / 错误信息
   *
   * @returns 多行诊断报告字符串
   */
  async diagnoseNetwork(): Promise<string> {
    const lines: string[] = []
    const host = new URL(API_BASE_URL).hostname
    const port = new URL(API_BASE_URL).port || (new URL(API_BASE_URL).protocol === 'https:' ? '443' : '80')

    // 1. DNS 解析
    lines.push(`[1/3] DNS 解析 ${host}`)
    try {
      const addrs = await dnsLookup(host, { all: true, verbatim: true })
      const ipv4 = addrs.filter((a) => a.family === 4).map((a) => a.address)
      const ipv6 = addrs.filter((a) => a.family === 6).map((a) => a.address)
      lines.push(`  IPv4: ${ipv4.length ? ipv4.join(', ') : '(无)'}`)
      lines.push(`  IPv6: ${ipv6.length ? ipv6.join(', ') : '(无)'}`)
    } catch (e) {
      lines.push(`  ❌ DNS 解析失败: ${(e as Error).message}`)
      lines.push(`  提示：检查系统 DNS 配置或 hosts 文件`)
      return lines.join('\n')
    }

    // 2. TCP 连接
    const ip = (await dnsLookup(host, { verbatim: true })).address
    lines.push(`[2/3] TCP 连接 ${ip}:${port}`)
    const tcpOk = await new Promise<boolean>((resolve) => {
      const sock = netConnect({ host: ip, port: Number(port) }, () => {
        sock.end()
        resolve(true)
      })
      sock.setTimeout(3000)
      sock.on('timeout', () => {
        sock.destroy()
        resolve(false)
      })
      sock.on('error', () => resolve(false))
    })
    if (tcpOk) {
      lines.push(`  ✓ TCP 连接成功`)
    } else {
      lines.push(`  ❌ TCP 连接失败（超时或被拒绝）`)
      lines.push(`  提示：检查防火墙/路由/VPN，或公司网络是否屏蔽了 ${host}`)
      return lines.join('\n')
    }

    // 3. HTTP 请求
    lines.push(`[3/3] HTTP 请求 ${API_BASE_URL}getPlatformList`)
    try {
      const res = await client.get('getPlatformList', { timeout: 8000 })
      lines.push(`  ✓ HTTP ${res.status} code=${res.data?.code} 平台数=${res.data?.data?.length ?? 0}`)
    } catch (e) {
      const err = e as any
      if (err?.response) {
        lines.push(`  ⚠️ HTTP ${err.response.status} ${err.response.statusText}`)
        lines.push(`  服务端响应了但状态异常，可能是后端鉴权/接口问题`)
      } else if (err?.code === 'ECONNABORTED') {
        lines.push(`  ❌ HTTP 请求超时`)
      } else {
        lines.push(`  ❌ HTTP 请求失败: ${err?.message || String(e)}`)
        if (err?.code) lines.push(`  错误码: ${err.code}`)
      }
    }

    return lines.join('\n')
  }
}