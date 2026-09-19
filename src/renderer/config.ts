/** 渲染进程配置（从 Vite 环境变量读取） */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.1'
export const DOMAIN_URL = import.meta.env.VITE_DOMAIN_URL || 'http://<生产域名>'
export const API_SECRET = '<鉴权密钥>'
export const POLL_INTERVAL = 10_000
export const PRINT_MAX_RETRY = 3
export const PRINT_PAPER_WIDTH = 32