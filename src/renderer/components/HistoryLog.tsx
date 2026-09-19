import { Box, Typography } from '@mui/material'
import type { HistoryLogItem } from '@shared/types/models'
import { AppColors } from '../theme/theme'

interface HistoryLogProps {
  logs: HistoryLogItem[]
}

/** 连接信息日志（对应 KMP HistoryLogView.kt） */
export default function HistoryLog({ logs }: HistoryLogProps) {
  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: AppColors.windowBackground,
        overflow: 'auto',
        p: 0.5
      }}
    >
      {logs.length === 0 && (
        <Typography sx={{ fontSize: 12, color: '#999', p: 1, textAlign: 'center' }}>暂无连接信息</Typography>
      )}
      {logs.map((log, i) => {
        const color =
          log.level === 'error'
            ? AppColors.errorRed
            : log.level === 'warn'
              ? AppColors.pendingOrange
              : log.level === 'success'
                ? AppColors.successGreen
                : AppColors.textPrimary
        return (
          <Box
            key={i}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0.5,
              px: 0.75,
              py: 0.4,
              borderRadius: '4px',
              '&:hover': { bgcolor: '#fff' }
            }}
          >
            <Typography
              component="span"
              sx={{ fontSize: 11, color: AppColors.textHint, fontFamily: 'Consolas, monospace', flexShrink: 0, mt: '2px' }}
            >
              {log.time}
            </Typography>
            <Typography
              component="span"
              sx={{ fontSize: 13, color, wordBreak: 'break-all', lineHeight: 1.5 }}
            >
              {log.message}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}