/**
 * @file ESC/POS 热敏打印指令封装（对应 KMP EscPosPrinter.kt）
 * @module utils/escpos
 *
 * 职责：将文本/对齐/字体/条码/二维码/位图等转换为 ESC/POS 字节流，
 * 供 PrintService 写入驱动打印机或串口。
 *
 * 关键点：
 *  - 中文必须 GBK 编码（iconv-lite），否则热敏打印机乱码
 *  - 32 字符宽度（58mm 纸宽），48 字符宽度（80mm 纸宽）
 *  - 条码用 bwip-js 生成位图 → RasterBitImage 指令
 *  - 二维码用 ESC/POS 原生 QR 指令
 */
import iconv from 'iconv-lite'
import bwip from 'bwip-js'
import log from 'electron-log/main'
import type { ShopPrintOrderDetail } from '@shared/types/models'

/** 纸宽字符数：58mm=32 字符，80mm=48 字符 */
export const WIDTH_58 = 32
export const WIDTH_80 = 48

/**
 * GBK 字节宽度（中文占 2 字节，英文占 1 字节）
 * @param text 文本
 * @returns GBK 编码后的字节数
 */
function byteWidth(text: string): number {
  return iconv.encode(text, 'GBK').length
}

/**
 * ESC/POS 打印机字节流构造器
 * 对应 KMP EscPosPrinter 类，所有指令 accumulate 到内部 Buffer，最终 toBytes() 输出。
 */
export class EscPosPrinter {
  /** 内部字节缓冲 */
  private chunks: Buffer[] = []
  /** 纸宽字符数 */
  private readonly width: number

  constructor(paperWidth: number = WIDTH_58) {
    this.width = paperWidth
  }

  /** 追加原始字节 */
  private writeBytes(bytes: Buffer | number[]): this {
    this.chunks.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))
    return this
  }

  /** 追加 GBK 编码文本 */
  private writeText(text: string): this {
    this.chunks.push(iconv.encode(text, 'GBK'))
    return this
  }

  /* ========== 基础指令 ========== */

  /** ESC @ 初始化打印机 */
  init(): this {
    return this.writeBytes([0x1b, 0x40])
  }

  /** 走纸 n 行 */
  feed(lines = 1): this {
    return this.writeBytes([0x1b, 0x64, lines & 0xff])
  }

  /** GS V 1 全切纸 */
  cut(): this {
    return this.writeBytes([0x1d, 0x56, 0x01])
  }

  /** 输出最终字节流 */
  toBytes(): Buffer {
    return Buffer.concat(this.chunks)
  }

  /* ========== 文本 ========== */

  /** 写入文本（GBK 编码）+ 换行 */
  text(content: string): this {
    return this.writeText(content + '\n')
  }

  /** 分隔线：32 个 '-' + 换行 */
  divider(): this {
    return this.text('-'.repeat(this.width))
  }

  /* ========== 对齐（ESC a n）========== */

  /** 左对齐 */
  left(): this {
    return this.writeBytes([0x1b, 0x61, 0x00])
  }

  /** 居中对齐 */
  center(): this {
    return this.writeBytes([0x1b, 0x61, 0x01])
  }

  /** 右对齐 */
  right(): this {
    return this.writeBytes([0x1b, 0x61, 0x02])
  }

  /* ========== 字体样式 ========== */

  /** ESC E n 加粗开关 */
  bold(on = true): this {
    return this.writeBytes([0x1b, 0x45, on ? 0x01 : 0x00])
  }

  /** GS! 0x11 双倍宽高开关（width×2 + height×2） */
  doubleSize(on = true): this {
    return this.writeBytes([0x1d, 0x21, on ? 0x11 : 0x00])
  }

  /**
   * GS! n 自定义缩放：n = ((width-1) << 4) | (height-1)
   * @param width 宽度倍数 1~8
   * @param height 高度倍数 1~8
   */
  scaleTextSize(width: number, height: number): this {
    const n = (((width - 1) << 4) | (height - 1)) & 0xff
    return this.writeBytes([0x1d, 0x21, n])
  }

  /* ========== 左右对齐一行 ========== */

  /**
   * 一行内左右对齐：左侧文本 + 中间空格填充 + 右侧文本 + 换行
   * 对应 KMP lineLR，按 GBK 字节宽度计算填充空格。
   * @param leftText 左侧文本
   * @param rightText 右侧文本
   */
  lineLR(leftText: string, rightText: string): this {
    const space = this.width - byteWidth(leftText) - byteWidth(rightText)
    const pad = ' '.repeat(Math.max(space, 1))
    return this.writeText(leftText + pad + rightText + '\n')
  }

  /* ========== 商品行（自动换行）========== */

  /**
   * 按最大宽度拆分文本（按字符逐个累加 GBK 字节宽度）
   * @param text 原始文本
   * @param maxWidth 单行最大字节宽度
   * @returns 拆分后的行数组
   */
  private splitByWidth(text: string, maxWidth: number): string[] {
    const result: string[] = []
    let buf = ''
    let currentWidth = 0
    for (const c of text) {
      const w = byteWidth(c)
      if (currentWidth + w > maxWidth) {
        result.push(buf)
        buf = ''
        currentWidth = 0
      }
      buf += c
      currentWidth += w
    }
    if (buf.length > 0) result.push(buf)
    return result.length > 0 ? result : ['']
  }

  /**
   * 打印一个商品行：商品名（自动换行）+ 右侧"数量  单价"
   * 对应 KMP product()。
   * @param name 商品名
   * @param qty 数量
   * @param total 单价/小计
   */
  product(name: string, qty: string, total: string): this {
    const rightText = `${qty}  ${total}`
    const rightWidth = byteWidth(rightText)
    const nameWidth = this.width - rightWidth - 1
    const lines = this.splitByWidth(name, nameWidth)
    lines.forEach((line, index) => {
      if (index === lines.length - 1) {
        const space = this.width - byteWidth(line) - rightWidth
        this.writeText(line + ' '.repeat(space) + rightText + '\n')
      } else {
        this.writeText(line + '\n')
      }
    })
    return this
  }

  /* ========== CODE128 条码（位图方式）========== */

  /**
   * 生成 CODE128 条码并转为 RasterBitImage 位图指令（异步）。
   * 对应 KMP barcode()：bwip-js 生成 PNG → 二值化 → GS v 0 指令。
   *
   * 【为何异步】bwip-js 4.x 的 toBuffer 已不提供同步形式，仅支持
   *   toBuffer(opts): Promise<Buffer> 或 toBuffer(opts, callback)。
   *   旧代码当同步调用 `const pngBuf = bwip.toBuffer({...})` 拿到的是 Promise，
   *   传给 rasterBitImageFromPng 必然失败（被 try/catch 吞掉，仅 log.error），
   *   表现为小票上条码完全不显示。故 barcode 改为 async，调用方需 await。
   *
   * @param data 条码内容（订单号）
   */
  async barcode(data: string): Promise<this> {
    this.feed(1)
    try {
      // bwip-js 4.x：toBuffer(opts) 返回 Promise<Buffer>，必须 await
      // height: 条码条形高度（像素），原值 40 过高，改为 20（减半）
      // paddingheight: 上下白边各占一半，原 10 → 5 同步减半保持视觉比例
      const pngBuf: Buffer = await bwip.toBuffer({
        bcid: 'code128',
        text: data,
        scale: 2,
        height: 20,
        includetext: false,
        paddingwidth: 0,
        paddingheight: 5
      })
      this.rasterBitImageFromPng(pngBuf)
    } catch (e) {
      log.error('条码生成失败:', e)
    }
    return this
  }

  /* ========== 二维码（ESC/POS 原生）========== */

  /**
   * 打印二维码（居中），对应 KMP qrcode()。
   * @param data 二维码内容
   * @param size 模块尺寸 1~16（默认 6）
   */
  qrcode(data: string, size = 6): this {
    this.feed(1)
    this.center()
    // 设置 QR 参数：n=模块尺寸
    this.writeBytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size & 0xff])
    // 错误纠正等级 M
    this.writeBytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 2, 0x45, 0x32])
    // 数据长度
    const dataBytes = iconv.encode(data, 'UTF-8')
    const len = dataBytes.length + 3
    this.writeBytes([
      0x1d, 0x28, 0x6b,
      (len & 0xff), ((len >> 8) & 0xff),
      0x31, 0x50, 0x30,
      ...dataBytes
    ])
    // 打印二维码
    this.writeBytes([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])
    this.feed(1)
    return this
  }

  /* ========== 位图（RasterBitImage）========== */

  /**
   * 将 PNG Buffer 转为 ESC/POS GS v 0 光栅位图指令。
   * 对应 KMP RasterBitImageWrapper + BitonalThreshold（阈值二值化）。
   * @param pngBuf PNG 图片字节
   * @param threshold 二值化阈值 0~255（默认 128）
   */
  rasterBitImageFromPng(pngBuf: Buffer, threshold = 128): this {
    // 动态加载 pngjs 避免开发机无原生模块时主进程崩溃
    const { PNG } = require('pngjs')
    const png = PNG.sync.read(pngBuf)
    const { width, height, data } = png

    // 横向按 8 像素对齐
    const byteWidth = Math.ceil(width / 8)
    const imgData = Buffer.alloc(byteWidth * height, 0x00)

    // 二值化：alpha < 阈值 或 灰度 < 阈值 视为黑点
    for (let y = 0; y < height; y++) {
      for (let xByte = 0; xByte < byteWidth; xByte++) {
        let bits = 0
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit
          if (x >= width) continue
          const idx = (y * width + x) * 4
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          const a = data[idx + 3]
          const gray = (r * 0.299 + g * 0.587 + b * 0.114) | 0
          // 透明或浅色 → 白（不打印）；深色 → 黑（打印）
          const isBlack = a > 0 && gray < threshold
          if (isBlack) bits |= 0x80 >> bit
        }
        imgData[y * byteWidth + xByte] = bits
      }
    }

    // GS v 0 指令：光栅位图
    const header = Buffer.from([
      0x1d, 0x76, 0x30, 0x00,
      byteWidth & 0xff, (byteWidth >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff
    ])
    this.chunks.push(header)
    this.chunks.push(imgData)
    return this
  }

  /**
   * 读取本地图片文件并打印（等比缩放）。
   * 对应 KMP localImage()。客服图片用。
   * @param filePath 图片文件绝对路径
   * @param targetWidth 目标像素宽度（默认 380）
   * @param targetHeight 目标像素高度（默认 380）
   */
  localImage(filePath: string, targetWidth = 380, targetHeight = 380): this {
    try {
      const fs = require('fs')
      if (!fs.existsSync(filePath)) return this
      const pngBuf = fs.readFileSync(filePath)
      this.rasterBitImageFromPng(pngBuf)
    } catch (e) {
      log.error('本地图片打印失败:', filePath, e)
    }
    return this
  }
}

/**
 * 判断字符串中间是否含空格（对应 KMP Utils.hasMiddleSpace）
 * 用于决定订单号打印字号：含空格用 2×2，不含用 3×3。
 * @param str 输入字符串
 */
export function hasMiddleSpace(str: string): boolean {
  return /\S\s+\S/.test(str)
}

/**
 * 预订订单类型文案（对应 KMP ShopPrintOrderDetail.reserveOrderType）
 * reserve_status == "1" 即时单，其余预约单
 */
export function reserveOrderType(orderType: string): string {
  return orderType === '1' ? '即时单' : '预约单'
}

export type { ShopPrintOrderDetail }