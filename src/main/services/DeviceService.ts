import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { StoreService } from './StoreService'
import { printRawViaCommand } from '../utils/rawPrint'
import { printRawViaUsb, listUsbPrinters } from '../utils/usbPrint'
import { EscPosPrinter, WIDTH_58 } from '../utils/escpos'
import type { PrinterTarget } from '@shared/types/models'

/**
 * 打印设备服务（对应 KMP PrintDevice + UsbDevices）
 * 枚举系统驱动打印机（Electron app.getPrinters）+ 串口设备（serialport.list）
 */

let serialLib: any = null
try {
  serialLib = require('serialport')
} catch (e) {
  log.warn('serialport 模块未加载（开发机可能未编译）')
}

/**
 * @thiagoelg/node-printer 原生模块（懒加载）
 * 用于通过驱动直接发送 RAW 字节流到打印机，等价 KMP javax.print 的 AUTOSENSE 通道。
 * 开发机若未 electron-rebuild 编译会加载失败，此时回退到系统命令行（lp / powershell）。
 */
let nativePrinterLib: any = null
try {
  nativePrinterLib = require('@thiagoelg/node-printer')
} catch (e) {
  log.warn('@thiagoelg/node-printer 模块未加载（开发机可能未编译，将回退系统命令行 RAW）')
}

/**
 * 构造打印测试用的 ESC/POS 字节流
 *
 * 设计意图：测试打印必须走与真实外卖小票【完全一致】的 RAW 字节流通道
 * （ESC/POS 指令 + GBK 中文 + 切纸），而不是 silent print HTML 渲染通道。
 * 原因：
 *  1. 本项目打印机（如 Artery_CMD_ESCPO_Gprinter_iSH58）是 ESC/POS 热敏打印机，
 *     silent print 会把 HTML 经驱动渲染后发送，对 ESC/POS 打印机要么乱码要么
 *     无法识别，且 CUPS 队列里 job name 会显示成整段 data:text/html URL。
 *  2. silent print 通道与真实小票通道（printDirect RAW / lp -o raw）完全不同，
 *     silent 成功不代表真实小票能打，验证无意义。
 *
 * 测试内容 1:1 移植 KMP 参考项目 `usb.kt` 的 `printImage2()` 完整外卖小票样张：
 *   - 顶部 #130 大号订单号（3×3 缩放居中）
 *   - 平台/门店名（2×2 加粗居中："测试订单"）
 *   - 门店名（1×1 居中："比优特超市（市府大路店）"）
 *   - "用户联"（居中）
 *   - CODE128 条码 + 订单号（2401939050332732270）
 *   - 订单信息（订单号/送达时间/下单时间/收件人/电话/地址）
 *   - 备注（缺货沟通）
 *   - 商品表头 + 商品列表（"1、象牛特仑苏纯牛奶250ml*12"+条码 9987767987+X1+53.47）
 *   - 金额汇总（商品合计/配送费/包装费/优惠金额）
 *   - 实付金额（加粗）
 *   - 底部提示文字 + 客服电话（如有）
 *   - 客服图片（如 userData/kf-photo.jpg 存在）
 *   - 走纸 5 行 + 切纸
 *
 * 写法说明：KMP printImage2() 用 `writeText(text) + feed(1)` 模式输出无换行的
 * 文本行；本机 EscPosPrinter 的 `text(content)` 已带 `\n`，二者等价（一次性
 * 输出"文本+换行"），故不再追加 `feed(1)`。
 *
 * @returns ESC/POS 字节流 Buffer
 */
async function buildTestReceipt(): Promise<Buffer> {
  const p = new EscPosPrinter(WIDTH_58)
  // 1. ESC @ 初始化打印机
  p.init()

  /* ===== 顶部：大号订单号（3×3 缩放居中）===== */
  p.center()
  p.doubleSize(true)
  p.scaleTextSize(3, 3)
  p.text('#130')
  p.doubleSize(false)

  /* ===== 平台名（2×2 加粗居中）===== */
  p.bold(true)
  p.feed(1)
  p.scaleTextSize(2, 2)
  p.center()
  p.text('测试订单')
  p.bold(false)

  /* ===== 门店名 + 用户联（1×1 居中）===== */
  p.feed(1)
  p.scaleTextSize(1, 1)
  p.center()
  p.text('比优特超市（市府大路店）')
  p.text('用户联')

  /* ===== CODE128 条码 + 订单号 ===== */
  // barcode() 内部用 bwip-js 异步生成 PNG，必须 await（见 EscPosPrinter.barcode 注释）
  await p.barcode('2401939050332732270')
  p.center()
  p.text('2401939050332732270')
  p.feed(1)

  /* ===== 订单信息（左对齐 + 分隔线包围）===== */
  p.left()
  p.divider()
  p.text('订单号：这个是测试订单')
  p.text('立即送达  时间：1/6 14:20')
  p.text('下单时间：1月6日13:30')
  p.text('收件人：吴先生')
  p.text('电话：13019365834,8265   133****')
  p.text('*4500')
  p.text('地址：为保护隐私地址已隐藏，可前')
  p.text('往APP查看详情')
  p.divider()

  /* ===== 备注 ===== */
  p.text('备注：【如遇缺货】：缺货时电话与我沟通')
  p.divider()

  /* ===== 商品表头 ===== */
  p.text('商品  数量            单价  金额')
  p.divider()

  /* ===== 商品 1：长商品名 + 条码 + 数量单价小计 ===== */
  p.text('1、象牛特仑苏纯牛奶250ml*12【比优特精选 整箱 高端 早餐优选】')
  p.text('9987767987')
  // product()：name 占左、qty + total 占右，本机签名顺序为 (name, qty, total)
  p.product('  ', 'X1', '53.47')
  p.feed(1)
  p.divider()

  /* ===== 金额汇总 ===== */
  p.lineLR('商品合计', 'X1  53.47')
  p.lineLR('配送费', '4.50')
  p.lineLR('包装费', '0.00')
  p.lineLR('优惠金额', '17.57')
  p.divider()
  p.bold(true)
  p.lineLR('实付金额', '41.60')
  p.bold(false)

  /* ===== 底部提示文字 ===== */
  p.text('')
  p.text('亲，如果您不满意，请联系我们，我们')
  p.text('会服务到您满意为止！如果您满意，')
  p.text('请小小鼓励我们一下，奖励我们五星好评哦！')
  p.text('我们的客服电话：155 6601 2733')

  /* ===== 客服图片（若存在则打印，与 KMP printImage2 一致）===== */
  try {
    const { app } = require('electron')
    const { join } = require('path')
    const fs = require('fs')
    const kfPath = join(app.getPath('userData'), 'kf-photo.jpg')
    if (fs.existsSync(kfPath)) {
      p.center()
      p.localImage(kfPath)
    }
  } catch (e) {
    // 客服图片不存在或加载失败时忽略，不影响测试小票出纸
  }

  /* ===== 结束：走纸 5 行 + 切纸 ===== */
  p.feed(5)
  p.cut()

  return p.toBytes()
}

export const DeviceService = {
  /** 枚举全部打印设备：系统驱动 + 串口 */
  async listPrinters(): Promise<PrinterTarget[]> {
    const devices: PrinterTarget[] = []

    // 1. 系统驱动打印机（Electron 22+ getPrinters 在 webContents 上，推荐异步版）
    try {
      const win = BrowserWindow.getAllWindows()[0]
      const printers = win ? await win.webContents.getPrintersAsync() : []
      printers.forEach((p, i) => {
        devices.push({
          id: `d${i}-${p.name}`,
          name: p.displayName || p.name,
          type: 'driver',
          path: p.name
        })
      })
    } catch (e) {
      log.error('枚举系统打印机失败:', e)
    }

    // 2. USB Printer class 设备（macOS 优先走 USB 直写绕过 CUPS）
    // 系统驱动打印机列表里也可以匹配到对应的 CUPS 队列名（如 Artery_CMD_ESCPO_Gprinter_iSH58），
    // 但 PPD 是 raster filter，lp -o raw 无法透传，所以独立列出 USB 直写设备让用户优先选。
    try {
      const usbPrinters = listUsbPrinters()
      usbPrinters.forEach((p) => {
        // 跳过已经在 driver 列表中的同名设备（避免重复）
        if (!devices.find((d) => d.name === p.name)) {
          devices.push({
            id: p.id,
            name: `${p.name} (USB直写)`,
            type: 'usb',
            vendorId: p.vendorId,
            productId: p.productId,
            path: p.name
          })
        }
      })
    } catch (e) {
      log.error('枚举 USB Printer class 设备失败:', e)
    }

    // 3. 串口设备
    if (serialLib) {
      try {
        const ports = await serialLib.SerialPort.list()
        ports.forEach((p: any, i: number) => {
          devices.push({
            id: `s${i}-${p.path}`,
            name: p.path,
            type: 'serial',
            path: p.path,
            vendorId: p.vendorId ? parseInt(p.vendorId, 16) : undefined,
            productId: p.productId ? parseInt(p.productId, 16) : undefined
          })
        })
      } catch (e) {
        log.error('枚举串口失败:', e)
      }
    }

    return devices
  },

  /** 选中打印设备并持久化 */
  async selectPrinter(id: string): Promise<void> {
    StoreService.set('selectedPrinterId', id)
  },

  /** 获取已选中的打印设备 id */
  async getCurrentPrinterId(): Promise<string | undefined> {
    return StoreService.get('selectedPrinterId')
  },

  /**
   * 打印测试：发送 ESC/POS 测试小票到指定打印机
   *
   * 通道优先级（与 PrintService.sendToPrinter / printViaDriver 完全一致）：
   *  1. `@thiagoelg/node-printer` 的 printDirect（原生模块，最快最稳）
   *  2. 系统命令行 RAW（macOS/Linux 优先 USB 直写绕过 CUPS / Windows PowerShell RawPrinter）
   *
   * 不使用 Electron silent print：silent 走 HTML 渲染通道，对 ESC/POS 热敏打印机
   * 会乱码，且 OS 打印队列里 job name 会显示成整段 `data:text/html,...` URL，
   * 既不可读也验证不了真实小票通道。
   *
   * @param printerName 系统打印机名（p.name，非 displayName）
   * @param options 可选 USB 直写匹配参数（vid/pid）
   * @returns 是否打印成功
   */
  async testPrint(
    printerName: string,
    options?: { vid?: number; pid?: number }
  ): Promise<boolean> {
    log.info(`testPrint 开始 [${printerName}]`, options || '')
    // 1. 构造 ESC/POS 测试小票字节流（1:1 移植 KMP printImage2() 完整外卖小票样张）
    // buildTestReceipt 内部调用 bwip-js 异步生成条码，已改为 async
    const data = await buildTestReceipt()
    log.info(`testPrint ESC/POS 字节流 ${data.length} 字节，走 RAW 通道 [${printerName}]`)

    // 2. 优先原生模块 printDirect（与真实小票打印同优先级）
    if (nativePrinterLib) {
      try {
        const ok = await new Promise<boolean>((resolve) => {
          nativePrinterLib.printDirect({
            data: data,
            printer: printerName,
            type: 'RAW',
            success: () => resolve(true),
            error: (err: unknown) => {
              log.error('testPrint printDirect 失败:', err)
              resolve(false)
            }
          })
        })
        if (ok) {
          log.info(`testPrint printDirect 成功 [${printerName}]`)
          return true
        }
        log.warn('testPrint printDirect 返回失败，回退其他通道')
      } catch (e) {
        log.error('testPrint printDirect 异常，回退:', e)
      }
    } else {
      log.warn('testPrint: @thiagoelg/node-printer 不可用')
    }

    // 3. macOS/Linux：优先 USB 直写（绕过 CUPS）
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const usbOk = await printRawViaUsb(printerName, data, options)
      if (usbOk) {
        log.info(`testPrint USB 直写成功 [${printerName}]`)
        return true
      }
      log.warn('testPrint USB 直写失败，回退 lp -o raw')
    }

    // 4. 系统命令行 RAW 回退（macOS lp / Windows powershell RawPrinter）
    const cmdOk = await printRawViaCommand(printerName, data, options)
    if (cmdOk) {
      log.info(`testPrint 系统命令 RAW 成功 [${printerName}]`)
      return true
    }

    // 5. 全部 RAW 通道失败
    log.error(`testPrint 全部 RAW 通道失败 [${printerName}]`)
    return false
  }
}