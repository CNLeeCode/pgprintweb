import { Card, Box, Stack, Typography } from '@mui/material'
import { ReactNode } from 'react'
import { AppColors } from '../theme/theme'

interface ToolCardProps {
  title?: string
  suffix?: ReactNode
  width?: number | string
  children: ReactNode
}

/**
 * 工具卡片容器（对应 KMP ToolItem.kt）
 * 固定高度（含标题 38px + 内容区 180px + 内边距）保证 4 张卡片严格对齐
 * 鼠标悬停时微微抬升，营造可交互质感
 */
export default function ToolCard({ title, suffix, width = 305, children }: ToolCardProps) {
  return (
    <Card
      sx={{
        width,
        height: 300,
        bgcolor: '#fff',
        borderRadius: '8px',
        border: '1px solid #ECEDF9',
        boxShadow: '0 1px 3px rgba(0,87,194,0.04)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 8px 24px rgba(0,87,194,0.10)',
          borderColor: AppColors.primary + '50'
        }
      }}
    >
      <Box sx={{ p: '12px 16px 6px', flexShrink: 0, borderBottom: title ? '1px solid #F5F5F5' : 'none' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          {title && (
            <Typography sx={{ fontSize: 16, fontWeight: 700, color: AppColors.textPrimary, letterSpacing: '0.2px' }}>
              {title}
            </Typography>
          )}
          {suffix}
        </Stack>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: '8px 12px 12px' }}>
        {children}
      </Box>
    </Card>
  )
}