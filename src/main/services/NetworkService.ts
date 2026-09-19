/**
 * @file 网络连通性检查服务（对应 KMP NetworkCheck.kt）
 * @module services/NetworkService
 *
 * 职责：
 *  1. 定时 HEAD 请求服务器域名，判断连通性（30 秒间隔）
 *  2. 2xx 或 401（Unauthorized）均视为可达（401 表示服务器响应了，只是需鉴权）
 *  3. 超时 3 秒，避免卡死
 *  4. 通过事件向渲染进程广播在线/离线状态
 */
import { EventEmitter } from 'events'
import axios, { AxiosError } from 'axios'
import log from 'electron-log/main'
import { DOMAIN_URL, NETWORK_CHECK_INTERVAL, NETWORK_CHECK_TIMEOUT } from '../config'

/** 网络状态（对应 KMP OnlineStatusData.status: 1=good, 2=bad） */
export interface NetworkStatus {
  status: 1 | 2
  message: string
}

/**
 * 网络检查服务单例
 */
class NetworkServiceImpl extends EventEmitter {
  /** 当前状态 */
  private current: NetworkStatus = { status: 2, message: '网络检查中...' }
  /** 定时器 */
  private timer: NodeJS.Timeout | null = null

  /** 单次检查：HEAD 请求 DOMAIN_URL */
  async singleCheck(): Promise<NetworkStatus> {
    try {
      const res = await axios.head(DOMAIN_URL, {
        timeout: NETWORK_CHECK_TIMEOUT,
        maxRedirects: 5,
        validateStatus: (s) => (s >= 200 && s < 300) || s === 401
      })
      const ok = (res.status >= 200 && res.status < 300) || res.status === 401
      return {
        status: ok ? 1 : 2,
        message: ok ? '网络环境良好' : '网络环境异常'
      }
    } catch (e) {
      const msg = e instanceof AxiosError ? `网络环境异常: ${e.message}` : '网络环境异常'
      return { status: 2, message: msg }
    }
  }

  /** 启动定时检查（立即检查一次 + 定时循环） */
  keepCheck(): void {
    if (this.timer) return
    this.runOnce()
    this.timer = setInterval(() => this.runOnce(), NETWORK_CHECK_INTERVAL)
    log.info(`网络检查已启动，间隔 ${NETWORK_CHECK_INTERVAL}ms`)
  }

  /** 执行一次检查并广播结果 */
  private async runOnce(): Promise<void> {
    const next = await this.singleCheck()
    // 状态变化时才广播（减少无效 IPC）
    if (next.status !== this.current.status || next.message !== this.current.message) {
      this.current = next
      this.emit('status-changed', this.current)
    }
  }

  /** 停止定时检查 */
  stopKeepCheck(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      log.info('网络检查已停止')
    }
  }

  /** 获取当前状态 */
  getStatus(): NetworkStatus {
    return this.current
  }
}

/** 网络检查服务单例 */
export const NetworkService = new NetworkServiceImpl()