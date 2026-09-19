import { app, BrowserWindow, shell, Menu, dialog } from 'electron'
import { join } from 'path'
import log from 'electron-log/main'
import { applyWin7CompatPatches } from './utils/win7-compat'
import { initLogger } from './utils/logger'
import { initCrashReporter } from './utils/crash'
import { JsonStore as DatabaseService } from './services/JsonStore'
import { registerAllIpc } from './ipc'
import { WINDOW_WIDTH, WINDOW_HEIGHT } from './config'

// Win7 兼容补丁必须在 app.ready 之前应用
applyWin7CompatPatches()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    title: `比优特到家小票打印系统 V${app.getVersion()}`,
    backgroundColor: '#F2F2F2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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