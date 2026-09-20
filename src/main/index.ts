import { app, BrowserWindow, shell, Menu, dialog } from 'electron'
import * as dns from 'node:dns'
import { join } from 'path'
import log from 'electron-log/main'
import { applyWin7CompatPatches } from './utils/win7-compat'
import { initLogger } from './utils/logger'
import { initCrashReporter } from './utils/crash'
import { JsonStore as DatabaseService } from './services/JsonStore'
import { registerAllIpc } from './ipc'
import { WINDOW_WIDTH, WINDOW_HEIGHT, UPDATE_CHECK_URL, DOMAIN_URL, API_BASE_URL, APP_VERSION } from './config'

/**
 * 启动期一次性输出关键配置实际值，便于排错（曾出现 .env 配置未注入导致全走 fallback 的事故）
 *
 * 看 main.log 开头这几行就能立刻确认 .env 是否生效：
 *   - 若更新地址显示 <生产域名>/.../getWebPgPrintUpdateInfo → 环境变量未注入（走 fallback）
 *   - 若显示 <更新服务IP> / 其他配置地址 → 注入正常
 */
log.info('[config] APP_VERSION=', APP_VERSION)
log.info('[config] DOMAIN_URL=', DOMAIN_URL)
log.info('[config] API_BASE_URL=', API_BASE_URL)
log.info('[config] UPDATE_CHECK_URL=', UPDATE_CHECK_URL)

// ⚠️ Win7 兼容：强制 DNS 解析优先 IPv4
// Node 16 默认 dns.lookup 行为在 Win7 上可能优先返回 IPv6 (AAAA 记录)，
// 但 Win7 默认 IPv6 路由不通 → 连接到 IPv6 地址超时 30s → 接口"不通"。
// 浏览器（系统网络栈）走 Happy Eyeballs 优先 IPv4，所以"直接 GET 访问正常"，
// 但 Electron 主进程的 axios 走 Node http 模块用 c-ares/libuv DNS，行为不同。
// ipv4first 让 IPv4 地址优先尝试，IPv6 失败回退兜底。
//
// 注意：必须用 namespace import（import * as dns），named import
// （import { dns }）取的是不存在的 dns.dns 属性 → undefined → 运行时崩溃。
// setDefaultResultOrder 在 Node 16.13+ 才存在，做存在性检查兜底。
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first')
}

// Win7 兼容补丁必须在 app.ready 之前应用
applyWin7CompatPatches()

/**
 * 检测应用是否由 installer 静默升级后自动启动.
 *
 * build/installer.nsh 的 customInstall 宏在 /S 静默模式 + --updated 标志双条件
 * 检测通过后, 用 ExecShell 启动新 exe 并透传 --updated 参数 (与 electron-builder
 * 内部 StartApp 宏约定一致, common.nsh:123-132).
 *
 * 通过 process.argv 检测该参数, 用途:
 *   1. 升级成功提示弹窗 (见 createWindow ready-to-show 回调)
 *   2. 后续可扩展: 跳过首次启动引导页、上报升级日志给后端等
 *
 * 注意: 首次安装走向导模式点"完成"按钮启动时不会带 --updated,
 * 只有升级路径 (/S --updated 静默升级) 才带, 语义清晰.
 */
const IS_LAUNCHED_BY_UPDATER = process.argv.includes('--updated')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // 运行时窗口/任务栏图标：
  // - 打包后：extraResources 把 resources/ 拷到 process.resourcesPath/resources/
  // - 开发环境：项目根 resources/icon.ico
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icon.ico')
    : join(__dirname, '../../resources/icon.ico')

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    title: `比优特到家小票打印系统 V${app.getVersion()}`,
    backgroundColor: '#F2F2F2',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()

    // ===== 升级启动提示 =====
    // installer.nsh 静默升级装完后 ExecShell 启动新 exe 时透传 --updated 参数,
    // 这里检测到该参数后弹 "已成功升级到 vX.X.X" 提示, 告知用户升级完成.
    //
    // 设计考量:
    //   - 不阻断启动主流程: dialog.showMessageBox 异步 + 模态到 parent window,
    //     主窗口 UI 已渲染完成, 用户点确定关闭后焦点回到应用, 期间后台 IPC/打印
    //     服务照常运行.
    //   - setTimeout 500ms 等 UI 完全渲染再弹, 避免窗口刚 show 就被 dialog 盖住
    //     导致用户先看到空白窗口再弹提示, 观感差.
    //   - dialog 错误吞掉记日志, 不让 unhandledRejection 影响应用稳定性.
    if (IS_LAUNCHED_BY_UPDATER) {
      log.info('[升级启动] 应用由 installer 静默升级后启动 (--updated)')
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return
        }
        dialog
          .showMessageBox(mainWindow, {
            type: 'info',
            title: '升级成功',
            message: `已成功升级到 v${APP_VERSION}`,
            buttons: ['确定'],
            noLink: true,
          })
          .catch((e: unknown) => {
            log.error('升级启动弹窗失败:', e)
          })
      }, 500)
    }
  })

  // ===== 调试：F12 / Ctrl+Shift+I 打开 DevTools =====
  // Win7 真机白屏排查用：白屏时按 F12 看控制台错误（路由/CSP/JS 异常一目了然）。
  // 生产环境不默认开 DevTools，仅保留快捷键供现场排障，不影响店员正常使用。
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown') {
      const { key, control, shift } = input
      const isF12 = key === 'F12'
      const isCtrlShiftI = control && shift && (key === 'I' || key === 'i')
      const isCtrlR = control && !shift && (key === 'R' || key === 'r')
      if (isF12 || isCtrlShiftI) {
        mainWindow?.webContents.toggleDevTools()
      } else if (isCtrlR) {
        // 菜单的 CmdOrCtrl+R 在 autoHideMenuBar + Win7 下偶尔不响应，这里兜底
        mainWindow?.webContents.reload()
      }
    }
  })

  // ===== 诊断：捕获渲染进程 console / preload 错误 / 加载失败，转发到主进程日志 =====
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = level >= 2 ? 'error' : level === 1 ? 'warn' : 'info'
    log[tag](`[renderer-console] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('preload-error' as any, (_e: unknown, preloadPath: string, error: Error) => {
    log.error(`[preload-error] path=${preloadPath} msg=${error?.message} stack=${error?.stack}`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    log.error(`[did-fail-load] code=${errorCode} desc=${errorDescription} url=${validatedURL}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[render-process-gone] ${JSON.stringify(details)}`)
  })
  log.info('ELECTRON_RENDERER_URL =', process.env['ELECTRON_RENDERER_URL'] || '(空，走 loadFile)')
  // ===== 诊断结束 =====

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // dev 模式加载 vite dev server，prod 加载本地文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{
          label: app.name,
          submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }]
        }] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: '操作',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { type: 'separator' },
        { label: '错误日志', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: '关于',
              message: '比优特到家小票打印系统',
              detail: `版本: ${app.getVersion()}\nElectron: ${process.versions.electron}\n平台: ${process.platform}`
            })
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  initLogger()
  initCrashReporter()
  DatabaseService.init()
  // 注册 IPC（传递主窗口获取函数，供 PrintService/UpgradeService 广播事件）
  registerAllIpc(() => mainWindow)
  createWindow()
  createMenu()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})