import { useMemo } from 'react'
import { Box, Typography, Stack, Tooltip, IconButton } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import { AppColors } from '../theme/theme'
import { useApiLogStore } from '../stores/apiLogStore'

interface AppFooterProps {
  text: string
  /** 是否在线（网络检查通过，显示状态色点） */
  online?: boolean
  /** 点击接口状态区域回调（由父组件打开 ApiLogDialog） */
  onOpenApiLog?: () => void
}

/**
 * 底部状态栏（对应 KMP AppFooter.kt）
 *
 * 左下角：应用名 + 接口状态指示器（点击打开接口日志弹窗，含网络诊断按钮）
 * 右下角：网络连通性状态文字 + 在线/离线色点
 *
 * 接口状态判定（基于最近 5 条日志）：
 *  - 全成功      → 绿色"正常"
 *  - 含失败      → 红色"有失败"
 *  - 无日志       → 灰色"无记录"
 */
export default function AppFooter({ text, online, onOpenApiLog }: AppFooterProps) {
  const logs = useApiLogStore((s) => s.logs)

  // 基于最近 5 条日志快速判定接口状态
  const { status, label, color, Icon } = useMemo(() => {
    const recent = logs.slice(-5)
    if (recent.length === 0) {
      return {
        status: 'idle' as const,
        label: '接口无记录',
        color: AppColors.textHint,
        Icon: HelpOutlineIcon
      }
    }
    const hasFail = recent.some((l) => l.status === 'fail')
    if (hasFail) {
      return {
        status: 'fail' as const,
        label: '接口有失败',
        color: AppColors.errorRed,
        Icon: ErrorIcon
      }
    }
    return {
      status: 'ok' as const,
      label: '接口正常',
      color: AppColors.successGreen,
      Icon: CheckCircleIcon
    }
  }, [logs])

  return (
    <Box
      sx={{
        background: '#fff',
        height: 32,
        px: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: '1px solid #ECEDF9'
      }}
    >
      {/* 左侧：应用名 + 接口状态指示器 */}
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Typography sx={{ fontSize: 12, color: AppColors.textHint }}>
          比优特到家小票打印系统
        </Typography>
        {onOpenApiLog && (
          <Tooltip
            title={
              logs.length === 0
                ? '点击查看接口日志与诊断'
                : `最近 ${Math.min(logs.length, 5)} 条：点击查看详情`
            }
            arrow
          >
            <IconButton
              size="small"
              onClick={onOpenApiLog}
              sx={{ p: 0.25, ml: 0.5, borderRadius: 1 }}
            >
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Icon sx={{ fontSize: 14, color }} />
                <Typography
                  component="span"
                  sx={{
                    fontSize: 11,
                    color,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {label}
                </Typography>
              </Stack>
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {/* 右侧：网络状态 */}
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: online ? AppColors.successGreen : AppColors.errorRed,
            boxShadow: online
              ? `0 0 0 3px ${AppColors.successGreen}25`
              : `0 0 0 3px ${AppColors.errorRed}25`
          }}
        />
        <Typography sx={{ fontSize: 12, color: AppColors.textSecondary, fontWeight: 500 }}>
          {text}
        </Typography>
      </Stack>
    </Box>
  )
}