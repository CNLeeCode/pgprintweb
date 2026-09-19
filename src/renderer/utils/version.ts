/**
 * 版本号比较（对应 KMP Utils.compareVersion）
 * 返回 >0 表示 v1 更新，<0 表示 v2 更新，0 表示相等
 */
export function compareVersion(v1: string, v2: string): number {
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