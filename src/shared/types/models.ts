/**
 * 共享类型定义（主进程与渲染进程共用）
 * 字段映射 1:1 对齐 KMP model 目录（@SerialName 注解值）
 */

/** UI 状态机（对应 KMP UiState sealed interface） */
export type UiState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

/** 请求结果包装（对应 KMP RequestResult） */
export interface RequestResult<T> {
  code: number
  msg: string
  data: T
}

/** 外卖平台（对应 PrintPlatform: id/label/img） */
export interface PrintPlatform {
  id: string
  label: string
  img: string
}

/** 打印设备目标 */
export interface PrinterTarget {
  id: string
  name: string
  type: 'usb' | 'serial' | 'driver'
  vendorId?: number
  productId?: number
  path?: string
}

/** 订单号条目（对应 ShopPrintOrderItem: day_seq/orderid） */
export interface ShopPrintOrderItem {
  daySeq: string
  orderId: string
}

/** 退款通知条目 */
export interface RefundNoticeItem {
  orderId?: string
  daySeq?: string
  [k: string]: unknown
}

/** getDaySeq 接口返回（对应 ShopPrintOrder: code/msg/date/data/refund_notice） */
export interface DaySeqResult {
  code: number
  msg: string
  date: string
  data: ShopPrintOrderItem[]
  refundNotice: RefundNoticeItem[]
}

/** 订单商品行（对应 ShopPrintOrderGoodsItem: goods_name/barcode/count/price） */
export interface OrderGoodsItem {
  goodsName: string
  barcode: string
  count: string
  price: string
}

/** 完整订单详情（对应 ShopPrintOrderDetail） */
export interface ShopPrintOrderDetail {
  platform: string // wmid
  daySeq: string // day_seq
  orderId: string // orderid
  shopName: string // shop_name
  shopPhone: string // shop_phone
  billingTime: string // billing_time
  address: string
  remarks: string
  temperature: string // jh_temperature
  platformName: string // wmname
  uptime: string
  orderType: string // reserve_status: 1即时单 else 预约单
  totalNum: string // count
  packageBagMoney: string // package_bag_money
  shippingFee: string // shipping_fee
  originalPrice: string // item_price
  totalFee: string // total
  goodsList: OrderGoodsItem[] // detail
  shopId: string // transient
}

/**
 * 应用更新信息（对应后端 getWebPgPrintUpdateInfo 接口的 msg 字段）
 *
 * 后端响应格式（msg 是对象，非字符串；force_update 是字符串 "0"/"1"）：
 *   {
 *     "code": 200,
 *     "msg": {
 *       "name": "PG-PRINTER",
 *       "version": "1.0",
 *       "key": "kZasd99989Cskjk=9/a0Dsa3jlkjlkS",
 *       "download_url": "",
 *       "update_msg": "1.优化已知问题",
 *       "force_update": "0"
 *     }
 *   }
 *
 * axios 响应拦截器自动把 snake_case 转 camelCase：
 *   download_url → downloadUrl / update_msg → updateMsg / force_update → forceUpdate
 *
 * 判定规则（前端 + 后端双保险，前端做语义化版本比较）：
 *   code === 200 且 version > APP_VERSION 且 downloadUrl 非空 → 有新版本
 *   其它情况 → 无新版本
 *
 * 版本比较按点分段转 number 进行（非字符串字典序比较），
 * 避免 "1.0.71" < "1.0.8" 的字典序误判。
 */
export interface AppUpdateInfo {
  /** 应用名（PG-PRINTER），仅用于鉴权/校验，UI 不展示 */
  name?: string
  /** 最新版本号，后端控制（如 "1.0"），用于"发现新版本 Vx.y"展示 */
  version?: string
  /** 鉴权 key，当前未使用，预留（与 getLastAppVersionData 一致） */
  key?: string
  /** 新版本安装包完整下载地址（nsis .exe）；空表示无新版本 */
  downloadUrl: string
  /** 更新说明，更新弹窗展示给用户看（多行用 \n 分隔） */
  updateMsg?: string
  /** 强制更新标志，"0"=非强制（默认），"1"=强制更新（不允许"继续旧版本"）
   *  后端返回字符串，类型用 string | number 双兼容，使用时统一按 == "1" 判断是否强制更新
   */
  forceUpdate?: string | number
}

/** 操作日志条目 */
export interface HistoryLogItem {
  time: string
  message: string
  level: 'info' | 'error' | 'warn'
}

/** 网络状态 */
export type NetworkStatus = 'online' | 'offline' | 'checking'

/** 打印状态 */
export type PrintStatus = 'idle' | 'pending' | 'printing' | 'success' | 'failed'