/**
 * @file 退款提示音播放器（对应 KMP DesktopAudioPlayer.kt）
 * @module utils/audioPlayer
 *
 * 职责：在渲染进程播放退款提示音。
 *
 * 实现方案（优先级）：
 *  1. 【主路径】用户提供的 notice.wav 文件
 *     - 文件位于 <项目根>/resources/notice.wav（开发）或
 *       <安装目录>/resources/notice.wav（打包后，经 electron-builder extraResources
 *       复制到 asar 外，升级时随新包一起部署）
 *     - preload 在启动时一次性读取该文件并 base64 编码为 data URL，通过
 *       contextBridge 同步暴露为 window.electronAPI.noticeWavDataUrl
 *     - 用 HTMLAudioElement 加载播放，音质/音色为用户原始文件
 *     - 必须用 data URL 而非 file://：dev 模式渲染进程源是 http://localhost:5173
 *       （Web 源），Chromium 禁止 Web 源页面用 file:// 加载本地文件，会报
 *       "Not allowed to load local resource"。data URL 内联无此限制。
 *     - 文件仍须放 asar 外：Chromium 媒体栈不走 asar fs patch，asar 内 wav
 *       读取失败；preload 读 asar 外文件再编码 base64 暴露给渲染进程
 *
 *  2. 【兜底】Web Audio API 合成 3 声 880Hz beep
 *     - 何时触发：notice.wav 文件缺失（noticeWavDataUrl 为空）/ 加载失败 / 播放失败
 *     - 形态：连续 3 声 0.18s beep，间隔 0.12s，总时长约 0.78s
 *     - 模拟原 KMP 版 notice.wav 的提示节奏，保证文件缺失也不静默
 *
 * 冷却逻辑已由主进程 PrintService（lastRefundSoundTime + REFUND_SOUND_COOLDOWN）
 * 在事件源头处理，渲染层收到 'print:refund-notice' 即直接播放，
 * 无需重复冷却，避免主从冷却不一致。
 */
import log from '../utils/logger'

/** 音频上下文缓存（复用，避免每次播放都创建；仅合成 beep 兜底时使用） */
let audioCtx: AudioContext | null = null

/** notice.wav HTMLAudio 实例（主路径，复用避免每次播放重新加载） */
let wavAudio: HTMLAudioElement | null = null

/** notice.wav 是否已成功加载过（标记 wav 通道可用性，避免每次都走失败重试） */
let wavLoaded = false

/** 是否曾因用户交互激活过 AudioContext（autoplay 限制用） */
let contextActivated = false

/**
 * 获取/创建 AudioContext（仅合成 beep 兜底路径用）
 * 浏览器 autoplay 限制：AudioContext 必须由用户交互触发启动。
 * Electron 渲染进程通常无此限制，但保留 resume 调用以防万一。
 */
function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext
      if (!Ctor) {
        log.warn('当前环境不支持 Web Audio API')
        return null
      }
      audioCtx = new Ctor()
    }
    // 若被浏览器挂起（autoplay 限制），尝试恢复
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {})
    }
    return audioCtx
  } catch (e) {
    log.error('创建 AudioContext 复败:', e)
    return null
  }
}

/**
 * 懒加载 notice.wav wavAudio 实例
 * 从 preload 暴露的 window.electronAPI.noticeWavDataUrl 取 data URL。
 * data URL 形如 data:audio/wav;base64,UklGRi....，无 file:// 跨源限制。
 * @returns HTMLAudioElement | null（null 表示文件缺失或加载失败，应回退合成 beep）
 */
function getWavAudio(): HTMLAudioElement | null {
  if (wavAudio && wavLoaded) return wavAudio
  const url = (window as any).electronAPI?.noticeWavDataUrl as string | undefined
  if (!url) return null // 文件缺失（preload 已记录 warn 日志）
  if (!wavAudio) {
    wavAudio = new Audio(url)
    wavAudio.preload = 'auto'
    wavAudio.oncanplaythrough = () => {
      wavLoaded = true
      log.info('notice.wav 加载成功，后续退款提示将使用该音频文件')
    }
    wavAudio.onerror = () => {
      log.warn(`notice.wav 加载失败，回退 Web Audio 合成 beep: ${url.slice(0, 40)}...`)
      wavLoaded = false
      wavAudio = null
    }
  }
  return wavLoaded ? wavAudio : null
}

/**
 * 通过 Web Audio API 播放一声 beep
 * @param ctx AudioContext
 * @param freq 频率 Hz
 * @param startAt 开始时间（秒，相对 ctx.currentTime）
 * @param duration 持续时间（秒）
 */
function playBeep(ctx: AudioContext, freq: number, startAt: number, duration: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square' // 方波更接近电子提示音
  osc.frequency.value = freq
  // 包络：快速起音，平滑衰减，避免咔哒声
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(0.25, startAt + 0.01)
  gain.gain.linearRampToValueAtTime(0.25, startAt + duration - 0.03)
  gain.gain.linearRampToValueAtTime(0, startAt + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

/**
 * 通过 Web Audio API 合成 3 声 880Hz beep（兜底路径）
 */
function playSynthBeep(): void {
  const ctx = getAudioContext()
  if (!ctx) return
  try {
    const now = ctx.currentTime
    const beepDur = 0.18
    const gap = 0.12
    for (let i = 0; i < 3; i++) {
      playBeep(ctx, 880, now + i * (beepDur + gap), beepDur)
    }
    contextActivated = true
  } catch (e) {
    log.error('Web Audio 合成 beep 播放失败:', e)
  }
}

/**
 * 播放退款提示音
 * 形态（主路径）：notice.wav 原始音频文件，1-2 秒
 * 形态（兜底）：连续 3 声 880Hz beep，每声 0.18s，间隔 0.12s，总时长约 0.78s。
 * @param forced 是否强制播放（用户主动测试时传 true，忽略一切错误）
 */
export function playRefundSound(forced = false): void {
  // 1. 主路径：notice.wav 文件
  const audio = getWavAudio()
  if (audio) {
    try {
      audio.currentTime = 0
      const p = audio.play()
      if (p && typeof p.then === 'function') {
        p.catch((e) => {
          if (!forced) log.warn('notice.wav 播放失败，回退合成 beep:', e)
          playSynthBeep()
        })
      }
      return
    } catch (e) {
      if (!forced) log.warn('notice.wav 播放异常，回退合成 beep:', e)
    }
  }

  // 2. 兜底：Web Audio API 合成 beep
  playSynthBeep()
}

/**
 * 用户交互时调用，激活 AudioContext 以绕过 autoplay 限制。
 * 建议在 React onClick 等用户手势处调用一次。
 */
export function activateAudio(): void {
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().then(() => {
      contextActivated = true
    }).catch(() => {})
  }
}

/** 停止播放并释放资源 */
export function stopRefundSound(): void {
  if (audioCtx) {
    try { void audioCtx.close() } catch {}
    audioCtx = null
  }
  if (wavAudio) {
    wavAudio.pause()
    wavAudio.currentTime = 0
    wavAudio = null
    wavLoaded = false
  }
  contextActivated = false
}
