import { registerStoreIpc } from './store.ipc'
import { registerAppIpc } from './app.ipc'
import { registerApiIpc } from './api.ipc'
import { registerDeviceIpc } from './device.ipc'
import { registerPrintIpc } from './print.ipc'
import { registerNetworkIpc } from './network.ipc'
import { registerUpdateIpc } from './update.ipc'
import { registerKfPhotoIpc } from './kf-photo.ipc'
import { registerStoreDataIpc } from './store-data.ipc'

/**
 * 注册全部 IPC 通道（对应 KMP 各 ViewModel 的方法调用入口）
 * @param getMainWindow 主窗口获取函数（用于向渲染进程广播事件）
 */
export function registerAllIpc(getMainWindow: () => Electron.BrowserWindow | null): void {
  registerStoreIpc()
  registerAppIpc()
  registerApiIpc(getMainWindow)
  registerDeviceIpc()
  registerPrintIpc(getMainWindow)
  registerNetworkIpc(getMainWindow)
  registerUpdateIpc(getMainWindow)
  registerKfPhotoIpc()
  registerStoreDataIpc()
}