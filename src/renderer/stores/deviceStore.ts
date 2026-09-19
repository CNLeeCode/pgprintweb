import { create } from 'zustand'
import { electronAPI } from '../api/bridge'
import type { PrinterTarget } from '@shared/types/models'

/**
 * 打印设备状态（对应 KMP PrintDevice.printDeviceData / currentCheckedPrinterName）
 * 通过 IPC 调用 DeviceService 枚举系统打印机与串口
 * 选中设备时同步绑定到 PrintService（主进程打印队列消费该设备）
 */
type Status = 'idle' | 'loading' | 'success' | 'error'

interface DeviceState {
  status: Status
  devices: PrinterTarget[]
  currentPrinterId?: string
  errorMsg?: string
  refresh: () => Promise<void>
  selectPrinter: (id: string) => Promise<void>
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  status: 'idle',
  devices: [],
  currentPrinterId: undefined,
  refresh: async () => {
    set({ status: 'loading' })
    const devices = await electronAPI.listPrinters()
    if (!devices) {
      set({ status: 'error', errorMsg: '枚举设备失败' })
      return
    }
    // 恢复已选中的设备并绑定到 PrintService
    const currentId = await electronAPI.getCurrentPrinterId()
    set({ status: 'success', devices, currentPrinterId: currentId })
    if (currentId) {
      const found = devices.find((d) => d.id === currentId)
      if (found) {
        await electronAPI.setPrintDevice(found)
      }
    }
  },
  selectPrinter: async (id) => {
    const devices = get().devices
    const found = devices.find((d) => d.id === id)
    // 持久化选中 + 绑定到打印服务
    await electronAPI.selectPrinter(id)
    if (found) {
      await electronAPI.setPrintDevice(found)
    }
    set({ currentPrinterId: id })
  }
}))