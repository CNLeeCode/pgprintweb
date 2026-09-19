/**
 * 客服二维码图片 IPC 通道
 * 对应 KMP DragAndClickDropZone.kt：拖拽/点击选择图片 → 保存为 kf-photo.jpg → 供打印模板底部客服图片使用
 * 图片最终存放路径：userData/kf-photo.jpg（与 printTemplate.ts 的 getKfImagePath 一致）
 *
 * 【为何返回 dataUrl 而非仅返回 path】
 * 渲染进程（Chromium）出于同源策略，禁止从 http://(dev server) 或 file:// 页面加载
 * 其他 file:// 资源。若渲染进程用 `src={file://${path}}` 加载本地图片会失败（ERR_FILE_NOT_FOUND
 * 或被安全策略拦截）。因此主进程读取图片字节、嗅探 MIME、转成 base64 data URL 返回，
 * 渲染进程直接用 data URL 作为 <img src>，彻底绕过 file:// 安全限制，且无需关闭 webSecurity。
 *
 * 注意：kf-photo.jpg 只是固定文件名，源文件可能是 png/bmp/gif，复制后内容不变，
 * 故必须按文件头 magic bytes 嗅探真实 MIME，不能用扩展名臆断。
 */
import { ipcMain, dialog, app } from 'electron'
import { join } from 'path'
import { copyFileSync, existsSync, unlinkSync, readFileSync } from 'fs'
import log from 'electron-log/main'

/** 客服二维码图片固定存放路径（对应 printTemplate.ts 的 getKfImagePath） */
function getKfImagePath(): string {
  return join(app.getPath('userData'), 'kf-photo.jpg')
}

/**
 * 按文件头 magic bytes 嗅探图片真实 MIME 类型
 * @param buf 图片文件前若干字节
 * @returns MIME 字符串；无法识别时兜底 image/jpeg（kf-photo.jpg 默认场景）
 */
function detectImageMime(buf: Buffer): string {
  // JPEG：FF D8
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  // PNG：89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  // BMP：42 4D
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  // GIF：47 49 46 38 (GIF8)
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  // 兜底：文件名固定为 .jpg，按 jpeg 处理
  return 'image/jpeg'
}

/**
 * 读取客服二维码图片并转成 base64 data URL
 * @returns data URL 字符串（如 "data:image/png;base64,xxxx"）；文件不存在返回空串
 */
function readKfPhotoAsDataUrl(): string {
  const dest = getKfImagePath()
  if (!existsSync(dest)) return ''
  try {
    const buf = readFileSync(dest)
    const mime = detectImageMime(buf)
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[kf-photo] 读取 dataUrl 失败: ${msg}`)
    return ''
  }
}

/**
 * 注册客服二维码相关 IPC
 * - kf-photo:select   打开文件选择对话框，将选中图片复制为 kf-photo.jpg，返回 dataUrl 供渲染进程显示
 * - kf-photo:remove   删除已设置的客服二维码图片
 * - kf-photo:path     返回当前客服二维码图片本地路径（不存在返回空串，仅供主进程内部/调试用）
 * - kf-photo:dataUrl  返回当前图片的 base64 data URL（供渲染进程 <img src> 加载，绕过 file:// 限制）
 */
export function registerKfPhotoIpc(): void {
  // 选择客服二维码图片（点击按钮触发）
  ipcMain.handle('kf-photo:select', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择客服二维码图片',
        filters: [
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif'] }
        ],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) {
        log.info('[kf-photo] 用户取消选择')
        return { success: false, message: '已取消选择', path: '', dataUrl: '' }
      }
      const src = result.filePaths[0]
      const dest = getKfImagePath()
      // 复制覆盖目标文件（KMP 原版固定保存为 kf-photo.jpg）
      copyFileSync(src, dest)
      // 读取复制后的图片转 data URL，供渲染进程直接显示（解决 file:// 加载失败问题）
      const dataUrl = readKfPhotoAsDataUrl()
      log.info(`[kf-photo] 客服二维码已保存: ${dest} dataUrlLen=${dataUrl.length}`)
      return { success: true, message: '设置成功', path: dest, dataUrl }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`[kf-photo] 保存失败: ${msg}`)
      return { success: false, message: `保存失败：${msg}`, path: '', dataUrl: '' }
    }
  })

  // 移除客服二维码图片
  ipcMain.handle('kf-photo:remove', () => {
    const dest = getKfImagePath()
    try {
      if (existsSync(dest)) {
        unlinkSync(dest)
        log.info('[kf-photo] 客服二维码已移除')
        return { success: true, message: '已移除' }
      }
      return { success: true, message: '未设置客服二维码' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`[kf-photo] 移除失败: ${msg}`)
      return { success: false, message: `移除失败：${msg}` }
    }
  })

  // 查询当前客服二维码本地路径（主进程内部/调试用，渲染进程显示请用 kf-photo:dataUrl）
  ipcMain.handle('kf-photo:path', () => {
    const dest = getKfImagePath()
    return existsSync(dest) ? dest : ''
  })

  // 查询当前客服二维码 base64 data URL（渲染进程 <img src> 加载用，绕过 file:// 安全限制）
  ipcMain.handle('kf-photo:dataUrl', () => {
    return readKfPhotoAsDataUrl()
  })
}
