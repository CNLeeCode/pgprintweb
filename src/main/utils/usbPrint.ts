/**
 * @file USB 直写字节流通道（绕过 CUPS PPD filter）
 * @module utils/usbPrint
 *
 * 职责：通过 libusb 直接把 ESC/POS 字节流写到打印机的 OUT bulk 端点，
 * 完全跳过 CUPS 队列与 PPD filter 链，等价 KMP 参考项目 Java `javax.print`
 * 在 macOS 上的底层行为（Cocoa print system 直走 USB backend）。
 *
 * 为什么要绕过 CUPS：
 *  - macOS 较新版本（CUPS 2.4+，新版 macOS 系统）已【不再支持 raw 队列】
 *    （`lpadmin -m raw` 报 `macOS不再支持原始队列`）。
 *  - 系统给未知 USB 打印机配置的默认 PPD 是 Generic PostScript/HP DeskJet
 *    风格的栅格 PPD（PageSize Letter/Legal/A4、Duplex 等），ESC/POS 字节流
 *    被当 PostScript 喂给 raster filter，filter 失败导致字节流被丢弃，
 *    CUPS 队列里会显示一个 1024 字节占位任务。
 *  - 实测：50 字节 ESC/POS 字节流经 `lp -o raw` 提交后，CUPS 把它转成
 *    1024 字节占位任务且 NOT COMPLETED，打印机不动。
 *
 * 实现要点：
 *  1. 用 `usb` 包的 `getDeviceList()` 扫描所有 USB 设备。
 *  2. 对每个设备 open 后枚举接口，找 `bInterfaceClass === 0x07`（Printer Class，
 *     ESC/POS 热敏打印机的标准 USB 接口类）。
 *  3. iface.claim() 抢占接口（macOS 上 CUPS usb backend 不持续锁定，
 *     平时是空闲的，可被 libusb 直接拿走）。
 *  4. 在接口的 endpoints 中找 `direction === 'out'` 的端点，调用 `transfer(data, cb)`。
 *  5. 写完 release + close，给 CUPS 留出后续 lp 路径。
 *
 * 选 printer matcher 策略（按优先级）：
 *  1. 优先精确匹配 vid 和 pid（在 stores/devices 选中 usb 设备时已带 vid/pid）。
 *  2. 否则找所有 bInterfaceClass=7 的 Printer class 接口的设备（一台物理机一个接口）。
 *  3. 兼容用户从 CUPS 列表选 driver 类型的情况：尝试匹配系统打印机的 USB Vendor Name
 *     / Product Name 字段（"Gprinter" / "Artery" / "ESC" / "Receipt" 等关键词）。
 *
 * 这是 macOS/Linux 上 ESC/POS 字节流透传的最可靠通道；Windows 上仍优先
 * PowerShell RawPrinter（Win32 Spooler）和 @thiagoelg/node-printer。
 */
import log from 'electron-log/main'

/** USB Printer class（bInterfaceClass = 0x07） */
const USB_PRINTER_CLASS = 0x07

/** 已知 ESC/POS 热敏打印机的产品名关键词（用于从 CUPS 队列名反查 USB 设备） */
const ESCPOS_NAME_HINTS = [
  'gprinter',
  'printer',
  'receipt',
  'escpos',
  'esc/pos',
  'artery',
  'suncsw',
  'xprinter',
  'epson'
]

/** USB 包动态加载（开发机若未 electron-rebuild 失败回退到系统命令行） */
let usbLib: any = null
try {
  usbLib = require('usb')
} catch (e) {
  log.warn('@module usb 未加载，USB 直写通道不可用')
}

/**
 * 找系统中的 USB Printer class 设备（VID + PID + Printer class 接口）
 *
 * 返回所有 Printer class 设备列表（单台机器同时插多台 ESC/POS 也支持）。
 * @param targetVid 可选：精确匹配的 vendor id（十进制）
 * @param targetPid 可选：精确匹配的 product id（十进制）
 */
function findUsbPrinters(targetVid?: number, targetPid?: number): any[] {
  if (!usbLib) return []
  const list = usbLib.getDeviceList() as any[]
  const printers: any[] = []
  for (const d of list) {
    const desc = d.deviceDescriptor
    if (!desc || !desc.idVendor || !desc.idProduct) continue
    if (targetVid && desc.idVendor !== targetVid) continue
    if (targetPid && desc.idProduct !== targetPid) continue
    try {
      d.open()
    } catch (e) {
      continue
    }
    try {
      const ifaces = d.interfaces || []
      for (const iface of ifaces) {
        try {
          if (iface.descriptor && iface.descriptor.bInterfaceClass === USB_PRINTER_CLASS) {
            printers.push({ device: d, iface, vid: desc.idVendor, pid: desc.idProduct })
            break
          }
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      /* ignore */
    }
    // 如果该设备不是 Printer，关掉它
    if (!printers.find((p) => p.device === d)) {
      try { d.close() } catch {}
    }
  }
  return printers
}

/**
 * 从 CUPS 打印队列名反查可能对应的 USB 设备（macOS 兜底匹配）
 *
 * 用途：用户从 DevicePanel 选了 `Artery_CMD_ESCPO_Gprinter_iSH58`（CUPS driver
 * 类型）时，我们不知道对应的 vid/pid，需根据队列名中的关键词匹配系统 USB 设备。
 *
 * @param printerName CUPS 队列名
 */
function findUsbPrinterByName(printerName: string): any | null {
  const lower = printerName.toLowerCase()
  const matched = findUsbPrinters()
  if (matched.length === 0) return null
  if (matched.length === 1) return matched[0]
  // 多台打印机时按名字关键词匹配
  for (const m of matched) {
    try {
      const prodName = m.device.getStringDescriptor(m.device.deviceDescriptor.iProduct) || ''
      if (lower.includes(prodName.toLowerCase()) || prodName.toLowerCase().includes(lower)) {
        return m
      }
    } catch {}
  }
  // 退而求其次：用全局关键词匹配
  for (const m of matched) {
    let name = ''
    try {
      name = m.device.getStringDescriptor(m.device.deviceDescriptor.iProduct) || ''
    } catch {}
    const lname = name.toLowerCase()
    if (ESCPOS_NAME_HINTS.some((h) => lname.includes(h))) return m
  }
  return matched[0]
}

/**
 * 通过 USB 直写字节流到打印机的 OUT 端点
 *
 * 调用约束：device 已 open 过且 iface 是从 device.interfaces 取到的（同一对象）。
 * @param device usb.Device 对象
 * @param iface usb.Interface 对象（bInterfaceClass === 0x07）
 * @param data 要写入的字节流
 * @returns true=成功，false=失败
 */
async function writeViaUsb(device: any, iface: any, data: Buffer): Promise<boolean> {
  try {
    iface.claim()
  } catch (e) {
    log.error('USB 直写：claim 接口失败（可能被占用）:', e)
    return false
  }
  try {
    // 找 OUT 方向的端点
    const outEp = (iface.endpoints || []).find(
      (ep: any) => ep.direction === 'out'
    )
    if (!outEp) {
      log.error('USB 直写：未找到 OUT 端点')
      return false
    }
    // 按字节大小分包发送（部分打印机单包 maxPacketSize=64，传整段 libusb 会自动拆包，
    // 但大 buffer 时保险起见手动按 4KB 切分，规避 macOS 上偶发 EOVERFLOW）
    const CHUNK = 4096
    for (let i = 0; i < data.length; i += CHUNK) {
      const piece = data.subarray(i, Math.min(i + CHUNK, data.length))
      await new Promise<void>((resolve, reject) => {
        outEp.transfer(piece, (err: any) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
    return true
  } catch (e) {
    log.error('USB 直写：transfer 失败:', e)
    return false
  } finally {
    // 释放接口（要点：waitTransfer 完成 后再 release，避免 libusb 报 busy）
    await new Promise<void>((resolve) => {
      try {
        iface.release(false, () => resolve())
      } catch {
        resolve()
      }
    })
    try { device.close() } catch {}
  }
}

/**
 * 跨平台 USB 直写字节流到 ESC/POS 打印机（公共 API）
 *
 * 优先级：
 *  1. 如果传入 vid/pid，精确匹配 USB Printer class 接口写；
 *  2. 否则按 printer name 关键词反查 USB 设备；
 *  3. 都失败回 false，调用方走 lp/PowerShell 回退。
 *
 * @param printerName CUPS 队列名（仅用于名称反查）
 * @param data ESC/POS 字节流
 * @param options 可选 vid/pid（USB 设备级精确匹配）
 */
export async function printRawViaUsb(
  printerName: string,
  data: Buffer,
  options?: { vid?: number; pid?: number }
): Promise<boolean> {
  if (!usbLib) {
    return false
  }
  if (data.length === 0) {
    log.warn('USB 直写：字节流为空，跳过')
    return false
  }

  // 1. 优先按 vid/pid 精确匹配
  let matched: any | null = null
  if (options?.vid && options?.pid) {
    const list = findUsbPrinters(options.vid, options.pid)
    matched = list.length > 0 ? list[0] : null
  }
  // 2. 否则按队列名反查
  if (!matched) {
    matched = findUsbPrinterByName(printerName)
    if (!matched) {
      log.warn('USB 直写：未匹配到 USB Printer class 设备')
      return false
    }
  }

  const { device, iface, vid, pid } = matched
  log.info(`USB 直写：匹配设备 VID=0x${vid.toString(16)} PID=0x${pid.toString(16)} 字节数=${data.length}`)
  const ok = await writeViaUsb(device, iface, data)
  if (ok) {
    log.info(`USB 直写成功 [${printerName}]`)
  } else {
    log.error(`USB 直写失败 [${printerName}]`)
  }
  return ok
}

/**
 * 枚举所有 USB Printer class 设备（供 DeviceService 展示给用户选）
 *
 * 返回 PrinterTarget 风格的对象：包含 id/name/type='usb'/vid/pid。
 * 这条通道需要用户在 DevicePanel 选对应的 USB 设备才能用。
 */
export function listUsbPrinters(): Array<{
  id: string
  name: string
  type: 'usb'
  vendorId: number
  productId: number
}> {
  const printers = findUsbPrinters()
  return printers.map((p) => {
    let prodName = ''
    try { prodName = p.device.getStringDescriptor(p.device.deviceDescriptor.iProduct) || '' } catch {}
    return {
      id: `u-${p.vid.toString(16)}-${p.pid.toString(16)}`,
      name: prodName || `USB-Printer-0x${p.vid.toString(16)}-0x${p.pid.toString(16)}`,
      type: 'usb' as const,
      vendorId: p.vid,
      productId: p.pid
    }
  })
}