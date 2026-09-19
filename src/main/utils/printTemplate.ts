/**
 * @file 小票打印模板（对应 KMP PrintTemplate.kt）
 * @module utils/printTemplate
 *
 * 职责：将订单详情组装为 ESC/POS 字节流。
 *
 * 模板结构（58mm 纸宽，32 字符）：
 *  1. 大号订单号（#daySeq，含空格 2×2，不含 3×3）
 *  2. 平台名（2×2 加粗居中）
 *  3. 门店名（1×1 居中）
 *  4. "用户联"（居中）
 *  5. CODE128 条码 + 订单号
 *  6. 分隔线
 *  7. 订单信息（订单号/类型/下单时间/地址）
 *  8. 分隔线 + 备注 + 分隔线
 *  9. 商品表头 + 商品列表（序号、商品名、条码、数量×单价）
 * 10. 分隔线 + 金额汇总（配送费/包装费/商品金额/实付金额加粗）
 * 11. 温度提示 + 客服电话 + 客服图片（若存在）
 * 12. 走纸 5 行 + 切纸
 */
import { app } from 'electron'
import { join } from 'path'
import { EscPosPrinter, WIDTH_58, hasMiddleSpace, reserveOrderType } from './escpos'
import type { ShopPrintOrderDetail } from '@shared/types/models'

/**
 * 客服图片路径（对应 KMP PersistentCache.cacheDir + kf-photo.jpg）
 * 存放在 userData/pgprint/kf-photo.jpg
 */
function getKfImagePath(): string {
  return join(app.getPath('userData'), 'kf-photo.jpg')
}

/**
 * 生成完整小票字节流（对应 KMP PrintTemplate.templateV1）
 * @param detail 订单详情
 * @returns ESC/POS 字节流
 */
export async function templateV1(detail: ShopPrintOrderDetail): Promise<Buffer> {
  const printer = new EscPosPrinter(WIDTH_58)
  printer.init()

  /* ===== 顶部：大号订单号 ===== */
  printer.center()
  printer.doubleSize(true)
  if (hasMiddleSpace(detail.daySeq)) {
    printer.scaleTextSize(2, 2)
    printer.text(`#${detail.daySeq}`)
  } else {
    printer.scaleTextSize(3, 3)
    printer.text(`#${detail.daySeq}`)
  }
  printer.doubleSize(false)

  /* ===== 平台名（2×2 加粗居中）===== */
  printer.bold(true)
  printer.feed(1)
  printer.scaleTextSize(2, 2)
  printer.center()
  printer.text(detail.platformName)
  printer.bold(false)

  /* ===== 门店名 + 用户联（居中）===== */
  printer.feed(1)
  printer.scaleTextSize(1, 1)
  printer.center()
  printer.text(detail.shopName)
  printer.text('用户联')

  /* ===== CODE128 条码 + 订单号 ===== */
  // barcode() 内部用 bwip-js 异步生成 PNG，必须 await（见 EscPosPrinter.barcode 注释）
  await printer.barcode(detail.orderId)
  printer.center()
  printer.text(detail.orderId)
  printer.feed(1)

  /* ===== 订单信息 ===== */
  printer.left()
  printer.divider()
  printer.text(`订单号：${detail.orderId}`)
  printer.text(`订单类型：${reserveOrderType(detail.orderType)}`)
  printer.text(`下单时间：${detail.uptime}`)
  printer.text(`地址：${detail.address}`)
  printer.divider()

  /* ===== 备注 ===== */
  printer.text(detail.remarks)
  printer.divider()

  /* ===== 商品表头 + 列表 ===== */
  printer.lineLR('商品', '数量  单价')
  printer.divider()
  detail.goodsList.forEach((item, index) => {
    printer.text(`${index + 1}、${item.goodsName}`)
    printer.lineLR(item.barcode || '  ', `X${item.count}  ${item.price}`)
  })
  printer.left()
  printer.divider()

  /* ===== 金额汇总 ===== */
  printer.lineLR('配送费', detail.shippingFee)
  printer.lineLR('包装费', detail.packageBagMoney)
  printer.lineLR('商品金额', `X${detail.totalNum}  ${detail.originalPrice}`)
  printer.divider()
  printer.bold(true)
  printer.lineLR('实付金额', detail.totalFee)
  printer.bold(false)

  /* ===== 底部提示 ===== */
  printer.text(detail.temperature)
  if (detail.shopPhone && detail.shopPhone.length > 0) {
    printer.text(`我们的客服电话：${detail.shopPhone}`)
  }
  const kfPath = getKfImagePath()
  const fs = require('fs')
  if (fs.existsSync(kfPath)) {
    printer.center()
    printer.localImage(kfPath)
  }

  /* ===== 结束：走纸 + 切纸 ===== */
  printer.feed(5)
  printer.cut()

  return printer.toBytes()
}
