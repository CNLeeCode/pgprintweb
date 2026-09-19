import axios, { AxiosInstance } from 'axios'
import log from 'electron-log/main'
import { API_BASE_URL, API_SECRET, HTTP_TIMEOUT, UPDATE_CHECK_URL } from '../config'
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
  maxRedirects: 5
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
      return res.data
    } catch (e) {
      log.error('getAppUpdateInfo 失败:', e)
      return null
    }
  },

  /** GET getPlatformList → 平台列表 */
  async getPlatformList(): Promise<RequestResult<PrintPlatform[]> | null> {
    try {
      const res = await client.get<RequestResult<PrintPlatform[]>>('getPlatformList')
      log.info('getPlatformList:', res.data?.code, res.data?.data?.length)
      return res.data
    } catch (e) {
      log.error('getPlatformList 失败:', e)
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
      return null
    }
  },

  /** POST getOrderList(wmid, shopid, secret, orderid_list[]) → 订单详情列表 */
  async getOrderList(wmid: string, shopid: string, orderIdList: string[]): Promise<ShopPrintOrderDetail[]> {
    if (!this.validateShopId(shopid, 'getOrderList')) return []
    if (!orderIdList || orderIdList.length === 0) return []
    try {
      const res = await client.post<RequestResult<ShopPrintOrderDetail[]>>('getOrderList', form({ wmid, shopid, secret: API_SECRET, 'orderid_list[]': orderIdList }))
      return res.data?.data || []
    } catch (e) {
      log.error('getOrderList 失败:', e)
      return []
    }
  },

  /**
   * POST getOrder(wmid, shopid, secret, day_seq) → 单个订单详情（重打/查询打印用）
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
      return res.data?.data || null
    } catch (e) {
      log.error('getOrder 失败 orderId=' + orderId + ':', e)
      return null
    }
  }
}