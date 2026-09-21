/** 渲染进程配置（从 Vite 环境变量读取，敏感配置不硬编码明文） */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.1'
export const DOMAIN_URL = import.meta.env.VITE_DOMAIN_URL || ''
export const API_PREFIX = import.meta.env.VITE_API_PREFIX || ''
export const API_SECRET = import.meta.env.VITE_API_SECRET || ''
export const POLL_INTERVAL = 10_000
export const PRINT_MAX_RETRY = 3
export const PRINT_PAPER_WIDTH = 32
