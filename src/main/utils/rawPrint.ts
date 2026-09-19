/**
 * @file 跨平台 RAW 字节流打印工具
 * @module utils/rawPrint
 *
 * 职责：通过操作系统命令行直接发送原始字节到打印机驱动，
 * 等价于 KMP 原版 `javax.print.PrintService` + `DocFlavor.BYTE_ARRAY.AUTOSENSE`
 * 的 RAW 打印通道，绕过浏览器渲染层（避免 ESC/POS 字节被当文本渲染导致乱码）。
 *
 * 背景：
 *  - Electron silent print 只能打印可渲染的 HTML/PDF，对 ESC/POS 二进制流必然乱码。
 *  - 必须用 OS 提供的 RAW 字节流接口，否则热敏打印机收到的不是指令流。
 *
 * 多平台实现（双平台统一用【临时文件】方式，避免 stdin 管道背压丢数据）：
 *  - macOS/Linux：字节流写入临时 .bin 文件 → 调用 CUPS `lp -d <printer> -o raw <file>`
 *    让 CUPS 自己读文件。`lp` 是 CUPS 客户端，`-o raw` 表示按原始字节发送（不进行任何处理）。
 *    不用 stdin 管道：Node.js stdin highWaterMark=16KB，超过后 write() 只写部分，
 *    立即 end() 会丢剩余字节，表现为"打印没反应/半截/乱码"。
 *  - Windows（含 Win7）：通过 PowerShell 调用 Win32 Spooler API（OpenPrinter/
 *    StartDocPrinter/WritePrinter/ClosePrinter），同样按 RAW 数据类型发送。
 *    原生 PowerShell 自带 Add-Type 可编译 C# 互操作代码，无需额外组件。
 *
 * 优先级低于 `@thiagoelg/node-printer` 的 printDirect（原生模块性能更好，
 * 也更稳定），作为其回退方案。两者都失败时调用方应明确报错。
 */
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync, unlinkSync } from 'fs'
import log from 'electron-log/main'
import { printRawViaUsb } from './usbPrint'

/**
 * 跨平台发送原始字节流到指定打印机
 * @param printerName 系统打印机名（p.name，非 displayName）
 * @param data 原始字节流（ESC/POS 指令）
 * @param options 可选 USB 直写匹配参数（vid/pid）
 * @returns true=成功，false=失败
 */
export async function printRawViaCommand(
  printerName: string,
  data: Buffer,
  options?: { vid?: number; pid?: number }
): Promise<boolean> {
  if (data.length === 0) {
    log.warn('printRawViaCommand: 字节流为空，跳过')
    return false
  }
  if (!printerName) {
    log.error('printRawViaCommand: printerName 为空')
    return false
  }

  switch (process.platform) {
    case 'darwin':
    case 'linux': {
      // macOS/Linux 优先 USB 直写（绕过 CUPS PPD filter），
      // 失败再回退 lp -o raw（CUPS 路径，需队列 PPD 是 raw 透传）
      const usbOk = await printRawViaUsb(printerName, data, options)
      if (usbOk) return true
      log.warn('USB 直写失败，回退系统命令行 lp -o raw')
      return printViaLp(printerName, data)
    }
    case 'win32':
      return printViaPowerShellRaw(printerName, data)
    default:
      log.error(`printRawViaCommand: 不支持的平台 ${process.platform}`)
      return false
  }
}

/**
 * macOS/Linux：通过 `lp -d <printer> -o raw <tmpfile>` 发送原始字节流
 *
 * 实现方式：先把字节流写入临时文件，再把文件路径作为 `lp` 参数传入，
 * 让 CUPS 自己读文件。**不使用 stdin 管道**。
 *
 * 为什么不用 stdin 管道（spawn + lp.stdin.write/end）：
 *  1. Node.js stdin 默认 highWaterMark=16KB，ESC/POS 字节流（含条码位图/客服图片）
 *     超过该阈值时 write() 只写入部分并返回 false，立即调用 end() 会丢失剩余字节。
 *  2. 即便数据小，stdin 关闭与 lp 读取的时序竞争也可能导致 lp 收到不完整数据，
 *     表现为"打印没反应 / 只打出半截 / 乱码"。
 *  3. 临时文件方式与 Windows 的 PowerShell RawPrinter 通道完全一致（都用临时文件），
 *     双平台行为统一，诊断更简单。
 *
 * CUPS `lp -o raw` 含义：按原始字节发送，不做任何 filter 处理，等价 KMP 的
 * `DocFlavor.BYTE_ARRAY.AUTOSENSE`。
 *
 * @param printerName 系统打印机名
 * @param data 原始字节流
 */
function printViaLp(printerName: string, data: Buffer): Promise<boolean> {
  // 1. 写临时文件（与 Windows 通道一致的临时文件方案）
  const tmpFile = join(tmpdir(), `pgprint_${Date.now()}_${process.pid}.bin`)
  try {
    writeFileSync(tmpFile, data)
  } catch (e) {
    log.error(`lp 打印：写临时文件失败 ${tmpFile}:`, e)
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    // 2. 把文件名作为 lp 参数传入，让 CUPS 自己读文件，彻底绕开 stdin 流
    const lp = spawn('lp', ['-d', printerName, '-o', 'raw', tmpFile], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let outText = ''
    let errText = ''
    // 捕获 stdout：lp 成功时输出 "request id is xxx-123"，便于诊断
    lp.stdout.on('data', (chunk: Buffer) => {
      outText += chunk.toString()
    })
    lp.stderr.on('data', (chunk: Buffer) => {
      errText += chunk.toString()
    })

    // spawn 本身失败（如 lp 命令不存在）
    lp.on('error', (e: NodeJS.ErrnoException) => {
      log.error(`lp 命令启动失败 [${printerName}]:`, e.message)
      try { unlinkSync(tmpFile) } catch {}
      resolve(false)
    })

    lp.on('close', (code: number | null) => {
      // 无论成功失败都清理临时文件
      try { unlinkSync(tmpFile) } catch {}
      if (code === 0) {
        log.info(
          `lp 打印成功 [${printerName}] 字节数=${data.length} stdout=${outText.trim()}`
        )
        resolve(true)
      } else {
        log.error(
          `lp 退出码 ${code} [${printerName}]: ${errText.trim() || outText.trim()}`
        )
        resolve(false)
      }
    })
  })
}

/**
 * Windows：通过 PowerShell 调用 Win32 Spooler API 发送原始字节流
 * 步骤：写临时文件 → PowerShell Add-Type 编译 RawPrinter 互操作类 →
 *   OpenPrinter → StartDocPrinter(RAW) → StartPagePrinter → WritePrinter →
 *   EndPagePrinter → EndDocPrinter → ClosePrinter
 * @param printerName 系统打印机名
 * @param data 原始字节流
 */
async function printViaPowerShellRaw(printerName: string, data: Buffer): Promise<boolean> {
  // 1. 写临时文件（PowerShell 读取字节后再发送）
  const tmpFile = join(tmpdir(), `pgprint_${Date.now()}_${process.pid}.bin`)
  try {
    writeFileSync(tmpFile, data)
  } catch (e) {
    log.error(`PowerShell 打印：写临时文件失败 ${tmpFile}:`, e)
    return false
  }

  // 2. 构造 PowerShell 脚本
  // 路径中的反斜杠需在 PowerShell 字符串中转义
  const escapedFile = tmpFile.replace(/\\/g, '\\\\')
  const escapedPrinter = printerName.replace(/'/g, "''")

  // RawPrinter 互操作类：调用 winspool.drv 的 OpenPrinter/WritePrinter 等
  const psScript = `
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;

public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOC_INFO_1 {
    public string pDocName;
    public string pOutputFile;
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOC_INFO_1 di);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBuf, int bufLen, out int pcWritten);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
}
'@
Add-Type -TypeDefinition $source

$bytes = [System.IO.File]::ReadAllBytes('${escapedFile}')
$ptr = [IntPtr]::Zero
if (-not [RawPrinter]::OpenPrinter('${escapedPrinter}', [ref]$ptr, [IntPtr]::Zero)) {
  Write-Error "OpenPrinter failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  exit 1
}
try {
  $di = New-Object RawPrinter+DOC_INFO_1
  $di.pDocName = 'pgprint'
  $di.pDataType = 'RAW'
  if (-not [RawPrinter]::StartDocPrinter($ptr, 1, [ref]$di)) {
    Write-Error "StartDocPrinter failed"
    exit 1
  }
  try {
    [void][RawPrinter]::StartPagePrinter($ptr)
    $buf = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $buf, $bytes.Length)
      $written = 0
      if (-not [RawPrinter]::WritePrinter($ptr, $buf, $bytes.Length, [ref]$written)) {
        Write-Error "WritePrinter failed"
        exit 1
      }
    } finally {
      [System.Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
    }
    [void][RawPrinter]::EndPagePrinter($ptr)
  } finally {
    [void][RawPrinter]::EndDocPrinter($ptr)
  }
} finally {
  [void][RawPrinter]::ClosePrinter($ptr)
}
Write-Output 'OK'
`

  // 3. 调用 PowerShell
  return new Promise<boolean>((resolve) => {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        psScript
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    let outText = ''
    let errText = ''
    ps.stdout.on('data', (chunk: Buffer) => {
      outText += chunk.toString()
    })
    ps.stderr.on('data', (chunk: Buffer) => {
      errText += chunk.toString()
    })

    ps.on('error', (e) => {
      log.error(`PowerShell 启动失败 [${printerName}]:`, e)
      try { unlinkSync(tmpFile) } catch {}
      resolve(false)
    })

    ps.on('close', (code: number | null) => {
      try { unlinkSync(tmpFile) } catch {}
      if (code === 0 && outText.includes('OK')) {
        log.info(`PowerShell RawPrinter 成功 [${printerName}] 字节数=${data.length}`)
        resolve(true)
      } else {
        log.error(`PowerShell 退出码 ${code} [${printerName}]: ${errText.trim() || outText.trim()}`)
        resolve(false)
      }
    })
  })
}