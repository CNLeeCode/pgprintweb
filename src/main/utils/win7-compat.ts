import { app } from 'electron'

/**
 * Windows 7 兼容性补丁
 *
 * Win7 上 Chromium 108（Electron 22）的 GPU 加速常因老显卡驱动崩溃或白屏，
 * 必须在 app.ready 之前关闭硬件加速。
 *
 * ⚠️ 千万不要加 `--disable-software-rasterizer`：
 *   disableHardwareAcceleration() / --disable-gpu 已经关掉 GPU 渲染路径，
 *   此时 Chromium 必须回退到 SwiftShader 软件光栅化才能绘制画面。
 *   若再叠 --disable-software-rasterizer，软件光栅化也被禁，Chromium 没有任何
 *   可用渲染后端 → Win7 老机器直接白屏（1.0.x 版本的真实事故）。
 */
export function applyWin7CompatPatches(): void {
  // 关闭 GPU 硬件加速（Win7 老显卡驱动黑屏/崩溃兜底）
  // 等价于 --disable-gpu，Electron 官方推荐 API，二选一即可，无需再叠 --disable-gpu
  app.disableHardwareAcceleration()

  // 沙箱相关：Win7 上 GPU 沙箱/渲染沙箱常因系统 API 缺失崩溃，关闭兜底
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')

  // Win7 不支持 TLS 1.3，强制允许的协议下限避免握手失败
  app.commandLine.appendSwitch('ssl-version-min', 'tls1.2')
}