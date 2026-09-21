/**
 * 全局配置常量（对应 KMP BuildConfig + config）
 *
 * 安全说明：域名 / 接口前缀 / 鉴权密钥等敏感配置均通过环境变量注入，
 * 不在源码中硬编码明文。真实值写在 .env / .env.production（已加入 .gitignore，不提交）。
 */

// 应用版本（与 package.json version 字段对齐，由 VITE_APP_VERSION 环境变量覆盖）
// 不再与 KMP 版本号对齐 —— Electron 端独立发版，版本号自成一套
export const APP_VERSION = process.env.VITE_APP_VERSION || '1.0.1'

// 后端域名（敏感配置，通过环境变量注入，不硬编码明文）
export const DOMAIN_URL = process.env.VITE_DOMAIN_URL || ''

// 接口前缀（敏感配置，通过环境变量注入，不硬编码明文）
export const API_PREFIX = process.env.VITE_API_PREFIX || ''

// 完整接口基础地址
export const API_BASE_URL = `${DOMAIN_URL}${API_PREFIX}`

// 接口密钥（敏感配置，通过环境变量注入，不硬编码明文）
export const API_SECRET = process.env.VITE_API_SECRET || ''

// 数据存储目录名
export const STORED_DIR = 'pgprint'

// 订单轮询间隔（毫秒）
export const POLL_INTERVAL = 10_000

// 网络连通性检查间隔（毫秒）
export const NETWORK_CHECK_INTERVAL = 30_000

// 网络连通性检查超时（毫秒）
export const NETWORK_CHECK_TIMEOUT = 5_000

// 退款提示音冷却时间（毫秒）
export const REFUND_SOUND_COOLDOWN = 6_000

// 打印失败最大重试次数
export const PRINT_MAX_RETRY = 3

// 打印发送超时（毫秒）
// 防止 USB transfer / 串口 write / lp / PowerShell 在设备离线或接口异常时回调永不触发，
// 导致 sendToPrinter → printOne → processQueue 整条链路永久卡死（this.processing 恒为 true），
// 进而使所有重打 / 查询打印调用 processQueue 时直接 return，表现为"点击重打无反应"。
export const PRINT_SEND_TIMEOUT = 25_000

// HTTP 请求超时（毫秒）
export const HTTP_TIMEOUT = 30_000

/**
 * 应用更新检查接口地址（方案 B：后端接口直返版本号 + 下载地址）
 *
 * 配置方式（.env / .env.production）：
 *   VITE_UPDATE_SERVER_URL=http://<更新服务IP>/<接口前缀>/getWebPgPrintUpdateInfo
 *
 * 前期用 IP，后期换域名只需改这一行。
 * 未配置时默认用 API_BASE_URL + 'getWebPgPrintUpdateInfo'。
 *
 * 接口返回结构（标准 RequestResult，数据在 data 字段；force_update 是字符串）：
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
 * 判定规则（前端 + 后端双保险）：
 *   - code !== 200                              → 无新版本，接口异常按"已最新"处理不阻断启动
 *   - code === 200 且 version <= APP_VERSION    → 无新版本
 *   - code === 200 且 download_url 为空         → 无新版本
 *   - code === 200 且 version > APP_VERSION 且 download_url 非空 → 有新版本
 *
 * 版本比较按点分段转 number（非字符串字典序比较），避免 "1.0.71" < "1.0.8" 误判。
 *
 * 兼容老环境名 VITE_UPDATE_CHECK_URL（避免历史部署遗漏）。
 */
export const UPDATE_CHECK_URL =
  process.env.VITE_UPDATE_SERVER_URL ||
  process.env.VITE_UPDATE_CHECK_URL ||
  `${API_BASE_URL}getWebPgPrintUpdateInfo`

/**
 * 更新策略开关
 *
 * AUTO_DOWNLOAD=true  检测到新版本自动后台下载（默认，静默不打扰）
 * AUTO_INSTALL=false   下载完成后等待用户确认才安装（默认，避免打印中突然重启）
 */
export const AUTO_DOWNLOAD = process.env.VITE_AUTO_DOWNLOAD !== 'false'
export const AUTO_INSTALL = process.env.VITE_AUTO_INSTALL === 'true'

/**
 * 版本号检查开关
 *
 * 若关闭则 Splash 直接进入"正常跳转"流程，不检查更新。
 */
export const VERSION_CHECK_ENABLED = process.env.VITE_VERSION_CHECK_ENABLED !== 'false'

// 应用窗口尺寸
export const WINDOW_WIDTH = 1270
export const WINDOW_HEIGHT = 900

// 热敏打印纸宽度（字符数）
export const PRINT_PAPER_WIDTH = 32
