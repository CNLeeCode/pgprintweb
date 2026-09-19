/**
 * Preload 脚本：通过 contextBridge 安全暴露 IPC 接口给渲染进程
 * 对应 KMP 各 ViewModel 调用的工具方法
 */
import { contextBridge, ipcRenderer } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import log from 'electron-log/preload'

/**
 * 退款提示音 notice.wav 的 data URL（打包/开发双环境统一解析）
 *
 * 为什么用 data URL 而不是 file:// URL：
 *  dev 模式下渲染进程源是 http://localhost:5173（Web 源），Chromium 安全策略
 *  禁止 Web 源页面通过 file:// 协议加载本地文件（即便 <audio>/<img> 也不行），
 *  会报 "Not allowed to load local resource: file:///..."。
 *  改为 base64 data URL 后，资源内联在字符串里，无协议跨源问题，dev/prod 一致。
 *  与客服图片 kf-photo:dataUrl 采用同一模式。
 *
 * 为什么文件放 asar 外（extraResources）而不是 asar 内（public/）：
 *  Chromium 媒体栈（HTMLAudioElement）不走 Electron 的 asar fs patch，
 *  asar 内的 wav 加载会失败，必须放 asar 外。preload 读 asar 外文件再编码
 *  base64 暴露给渲染进程。
 *
 * 路径解析（候选列表逐个尝试，谁存在用谁）：
 *  - 打包后：process.resourcesPath 指向安装目录的 resources/ 子目录，
 *    notice.wav 在 <install>/resources/notice.wav
 *  - 开发环境：preload 编译产物在 out/preload/index.js，回退两级到项目根，
 *    notice.wav 在 <项目根>/resources/notice.wav
 *
 * 注意：不能用 app.isPackaged 判断 —— app 是主进程专用模块，在 preload 中
 *  require('electron') 拿不到 app（为 undefined），app.isPackaged 会抛 TypeError。
 *  改用候选路径逐个 existsSync 探测，打包/dev 两条路径都试，避免依赖 app。
 *
 * 文件缺失时返回空字符串，audioPlayer 自动回退到 Web Audio API 合成 beep，
 * 不会因文件丢失导致退款提示功能完全失效。
 *
 * @returns data:audio/wav;base64,<base64> 或空字符串（文件缺失）
 */
function resolveNoticeWavDataUrl(): string {
  // 候选路径：打包后优先（resourcesPath），dev 模式兜底（__dirname 回退两级）
  const candidates = [
    join(process.resourcesPath, 'notice.wav'),
    join(__dirname, '../../resources/notice.wav')
  ]
  for (const filePath of candidates) {
    try {
      if (existsSync(filePath)) {
        const buf = readFileSync(filePath)
        return `data:audio/wav;base64,${buf.toString('base64')}`
      }
    } catch {
      // 某些路径可能因权限/不存在抛错，跳过继续尝试下一个候选
    }
  }
  log.warn(`notice.wav 不存在（已回退 Web Audio 合成提示音），尝试路径: ${candidates.join(', ')}`)
  return ''
}

/** 退款提示音 data URL（空字符串表示文件缺失，用合成 beep 兜底） */
const noticeWavDataUrl = resolveNoticeWavDataUrl()

const api = {
  /** 通用 IPC 调用封装 */
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: unknown, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  /** 获取应用版本 */
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  /** 获取配置项 */
  getConfig: (key: string) => ipcRenderer.invoke('store:get', key),
  setConfig: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  /** 打开日志目录 */
  openLogFolder: () => ipcRenderer.invoke('app:openLogFolder'),
  /** 窗口控制 */
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  /**
   * 写入系统剪贴板（对应 KMP Utils.copyToClipboard）
   * 走主进程 clipboard 模块，规避 navigator.clipboard 在 Win7/Chromium108 下静默失败的问题
   * @param text 待复制文本
   * @returns 是否写入成功
   */
  clipboardWriteText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  /**
   * 读取系统剪贴板文本（供查询打印"粘贴"按钮用，绕过渲染进程原生粘贴限制）
   * @returns 剪贴板文本
   */
  clipboardReadText: () => ipcRenderer.invoke('clipboard:readText'),
  /** 后端接口 */
  getAppUpdateInfo: () => ipcRenderer.invoke('api:getAppUpdateInfo'),
  getPlatformList: () => ipcRenderer.invoke('api:getPlatformList'),
  getDaySeq: (wmid: string, shopid: string) => ipcRenderer.invoke('api:getDaySeq', wmid, shopid),
  getOrderList: (wmid: string, shopid: string, orderList: string[]) =>
    ipcRenderer.invoke('api:getOrderList', wmid, shopid, orderList),
  getOrder: (wmid: string, shopid: string, daySeq: string) =>
    ipcRenderer.invoke('api:getOrder', wmid, shopid, daySeq),
  /** 打印设备 */
  listPrinters: () => ipcRenderer.invoke('device:list'),
  selectPrinter: (id: string) => ipcRenderer.invoke('device:select', id),
  getCurrentPrinterId: () => ipcRenderer.invoke('device:current'),
  testPrint: (device: unknown) => ipcRenderer.invoke('device:testPrint', device),
  /** 打印服务 */
  setPrintDevice: (device: unknown) => ipcRenderer.invoke('print:setDevice', device),
  getPrintDevice: () => ipcRenderer.invoke('print:getDevice'),
  updatePlatforms: (platformIds: string[], shopId?: string) =>
    ipcRenderer.invoke('print:updatePlatforms', platformIds, shopId),
  stopAllPolling: () => ipcRenderer.invoke('print:stopAll'),
  /**
   * 切换门店：停止所有轮询 + 清空运行时状态（queue/printingSet/printedMap/pendingMap/retryMap）
   * + 广播快照刷新让 UI 清空旧门店数据。用户点"切换门店"在跳转登录页之前调用。
   * 返回主页后由 loadPrinted/requeue/updatePlatforms 按新门店重新加载。
   */
  switchShop: () => ipcRenderer.invoke('print:switchShop'),
  requeuePending: (shopId?: string) => ipcRenderer.invoke('print:requeue', shopId),
  loadPrinted: (shopId?: string) => ipcRenderer.invoke('print:loadPrinted', shopId),
  getPrintSnapshots: () => ipcRenderer.invoke('print:getSnapshots'),
  reprintOrder: (platformId: string, shopId: string, orderId: string) =>
    ipcRenderer.invoke('print:reprint', platformId, shopId, orderId),
  /** 网络检查 */
  startNetworkCheck: () => ipcRenderer.invoke('network:start'),
  stopNetworkCheck: () => ipcRenderer.invoke('network:stop'),
  checkNetwork: () => ipcRenderer.invoke('network:check'),
  getNetworkStatus: () => ipcRenderer.invoke('network:status'),
  /** 自动更新 */
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  /** 客服二维码图片（对应 KMP DragAndClickDropZone） */
  /** selectKfPhoto 返回 { success, message, path, dataUrl }；dataUrl 供 <img src> 直接显示 */
  selectKfPhoto: () => ipcRenderer.invoke('kf-photo:select'),
  removeKfPhoto: () => ipcRenderer.invoke('kf-photo:remove'),
  /** 本地路径（主进程内部/调试用，渲染进程显示请用 getKfPhotoDataUrl） */
  getKfPhotoPath: () => ipcRenderer.invoke('kf-photo:path'),
  /** 返回 base64 data URL（渲染进程 <img src> 加载用，绕过 file:// 同源策略限制） */
  getKfPhotoDataUrl: () => ipcRenderer.invoke('kf-photo:dataUrl'),
  /** 本地数据查看（JsonStore 统计/全量/打开目录） */
  getStoreStats: () => ipcRenderer.invoke('store:stats'),
  getAllStoreData: () => ipcRenderer.invoke('store:allData'),
  openStoreDir: () => ipcRenderer.invoke('store:openDir'),
  /**
   * 退款提示音 notice.wav 的 data URL（同步暴露，启动时由 preload 一次性读取+base64 编码）
   * - 空字符串：文件缺失，audioPlayer 自动回退 Web Audio API 合成 beep
   * - 非空：直接 `new Audio(noticeWavDataUrl)` 加载播放
   * 形如 data:audio/wav;base64,UklGRi....，无 file:// 跨源限制，dev/prod 一致
   */
  noticeWavDataUrl,
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', api)
} else {
  // @ts-ignore 兜底
  window.electronAPI = api
}

export type ElectronAPI = typeof api