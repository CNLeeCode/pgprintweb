import { ipcMain } from 'electron'
import { DeviceService } from '../services/DeviceService'
import type { PrinterTarget } from '@shared/types/models'

/**
 * 打印设备 IPC 通道
 */
export function registerDeviceIpc(): void {
  ipcMain.handle('device:list', async () => DeviceService.listPrinters())

  ipcMain.handle('device:select', (_e, id: string) => DeviceService.selectPrinter(id))

  ipcMain.handle('device:current', () => DeviceService.getCurrentPrinterId())

  /**
   * 测试打印：接收完整 PrinterTarget 对象
   * - usb 类型：走 USB 直写（绕过 CUPS）
   * - driver 类型：原生模块 → USB 直写（按队列名反查）→ lp/powershell
   * - serial 类型：通过 serialport 写串口
   */
  ipcMain.handle('device:testPrint', (_e, device: PrinterTarget) => {
    const printerName = device.path || device.name
    const options =
      device.vendorId && device.productId
        ? { vid: device.vendorId, pid: device.productId }
        : undefined
    return DeviceService.testPrint(printerName, options)
  })
}