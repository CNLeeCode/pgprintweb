/**
 * @file 版本号比较工具（主进程用，对应 KMP Utils.compareVersion）
 * @module utils/version
 *
 * 返回 >0 表示 v1 更新，<0 表示 v2 更新，0 表示相等。
 * 渲染进程已有独立 src/renderer/utils/version.ts，此为主进程副本。
 */

/**
 * 版本号比较
 * @param v1 版本号字符串，格式 x.y.z
 * @param v2 版本号字符串，格式 x.y.z
 * @returns >0 v1更新，<0 v2更新，0 相等
 */
export function compareVersionHost(v1: string, v2: string): number {
  const a = v1.split('.').map((n) => parseInt(n, 10) || 0)
  const b = v2.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const da = a[i] || 0
    const db = b[i] || 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}