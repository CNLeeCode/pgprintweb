import { app } from 'electron'

/**
 * Windows 7 兼容性补丁
 *
 * Win7 上 Chromium 108（Electron 22）的 GPU 加速常因老显卡驱动崩溃或白屏，
 * 必须在 app.ready 之前关闭硬件加速并附加启动参数。
 */
export function applyWin7CompatPatches(): void {
  // 关闭 GPU 硬件加速（Win7 老显卡驱动黑屏/崩溃兜底）
  app.disableHardwareAcceleration()

  // 防黑屏/沙箱崩溃启动参数
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  app.commandLine.appendSwitch('disable-software-rasterizer')

  // Win7 不支持 TLS 1.3，强制允许的协议下限避免握手失败
  app.commandLine.appendSwitch('ssl-version-min', 'tls1.2')
}