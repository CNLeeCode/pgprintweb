import { ipcMain, app, shell, BrowserWindow, clipboard } from 'electron'
import { APP_VERSION } from '../config'

/**
 * 应用级 IPC 通道（版本/日志/窗口控制/剪贴板）
 *
 * clipboard 走主进程而非渲染进程 navigator.clipboard 的原因：
 *  1. navigator.clipboard.writeText 是异步 Promise，无 await/catch 时失败静默，
 *     会造成"toast 提示成功但实际未复制"的假象；
 *  2. Electron 22（Chromium 108）+ Win7 下 navigator.clipboard 在非 secure context
 *     或权限受限时可能不可用；
 *  3. Electron 主进程 clipboard 模块直接走系统剪贴板 API，跨平台稳定，Win7 兼容，
 *     对应 KMP Utils.copyToClipboard 的 AWT systemClipboard 方案。
 */
export function registerAppIpc(): void {
  ipcMain.handle('app:getVersion', () => APP_VERSION)

  ipcMain.handle('app:openLogFolder', () => {
    shell.openPath(app.getPath('userData'))
  })

  ipcMain.handle('win:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('win:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  /**
   * 写入系统剪贴板（对应 KMP Utils.copyToClipboard）
   * @param text 待复制文本（订单号）
   * @returns boolean 是否写入成功（主进程 clipboard.writeText 同步 API 不会失败，这里恒 true 兜底）
   */
  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    try {
      clipboard.writeText(String(text ?? ''))
      return true
    } catch (e) {
      // 异常时返回 false，由渲染层提示"复制失败"
      // 不抛异常，避免渲染层未 catch 导致 unhandledRejection
      return false
    }
  })

  /**
   * 读取系统剪贴板文本
   *
   * 用途：查询打印对话框的"粘贴"按钮主动读取剪贴板内容填入输入框。
   * 为何不依赖渲染进程 Cmd+V/Ctrl+V：Electron 22 下主进程 clipboard.writeText
   * 写入的剪贴板内容，渲染进程输入框原生粘贴（Chromium 剪贴板读取）存在同步/格式差异，
   * 可能粘贴不进去；改由主进程统一读写剪贴板，绕过该限制，Win7/Mac 均稳定。
   * @returns string 剪贴板文本（无内容返回空串）
   */
  ipcMain.handle('clipboard:readText', () => {
    try {
      return clipboard.readText()
    } catch (e) {
      return ''
    }
  })
}