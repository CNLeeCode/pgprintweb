/**
 * 封装 preload 暴露的 electron API
 * 渲染进程统一通过此模块与主进程通信
 */
import type { ElectronAPI } from '../../preload'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

const fallback: ElectronAPI = {
  invoke: () => Promise.reject(new Error('electronAPI 未注入')),
  on: () => () => {},
  getAppVersion: () => Promise.resolve('0.0.0'),
  getConfig: () => Promise.resolve(null),
  setConfig: () => Promise.resolve(),
  openLogFolder: () => Promise.resolve(),
  minimize: () => Promise.resolve(),
  close: () => Promise.resolve(),
  /** 剪贴板 fallback：preload 未注入时返回 false，渲染层会 toast"复制失败" */
  clipboardWriteText: () => Promise.resolve(false),
  /** 读取剪贴板 fallback：返回空串 */
  clipboardReadText: () => Promise.resolve(''),
  getAppUpdateInfo: () => Promise.resolve(null),
  getPlatformList: () => Promise.resolve(null),
  getDaySeq: () => Promise.resolve(null),
  getOrderList: () => Promise.resolve([]),
  getOrder: () => Promise.resolve(null),
  listPrinters: () => Promise.resolve([]),
  selectPrinter: () => Promise.resolve(),
  getCurrentPrinterId: () => Promise.resolve(undefined),
  testPrint: (_device: unknown) => Promise.resolve(false),
  setPrintDevice: () => Promise.resolve(),
  getPrintDevice: () => Promise.resolve(null),
  updatePlatforms: () => Promise.resolve(),
  stopAllPolling: () => Promise.resolve(),
  /** 切换门店 fallback：preload 未注入时静默成功 */
  switchShop: () => Promise.resolve(),
  requeuePending: () => Promise.resolve(),
  loadPrinted: () => Promise.resolve(),
  getPrintSnapshots: () => Promise.resolve({ printed: {}, pending: {} }),
  reprintOrder: () => Promise.resolve(false),
  startNetworkCheck: () => Promise.resolve(),
  stopNetworkCheck: () => Promise.resolve(),
  checkNetwork: () => Promise.resolve({ status: 2, message: 'fallback' }),
  getNetworkStatus: () => Promise.resolve({ status: 2, message: 'fallback' }),
  checkUpdate: () => Promise.resolve(),
  downloadUpdate: () => Promise.resolve(),
  installUpdate: () => Promise.resolve(),
  getUpdateStatus: () => Promise.resolve({ status: 'idle', progress: null }),
  selectKfPhoto: () => Promise.resolve({ success: false, message: 'fallback', path: '', dataUrl: '' }),
  removeKfPhoto: () => Promise.resolve({ success: false, message: 'fallback' }),
  getKfPhotoPath: () => Promise.resolve(''),
  getKfPhotoDataUrl: () => Promise.resolve(''),
  /** 本地数据查看 fallback */
  getStoreStats: () => Promise.resolve({ date: '', printed: 0, pending: 0, cancel: 0, connection: 0 }),
  getAllStoreData: () => Promise.resolve({ date: '', printed: [], pending: [], cancel: [], connection: [] }),
  openStoreDir: () => Promise.resolve(true)
}

export const electronAPI: ElectronAPI = window.electronAPI ?? fallback