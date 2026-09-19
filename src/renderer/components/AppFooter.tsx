import { Box, Typography, Stack } from '@mui/material'
import { AppColors } from '../theme/theme'

interface AppFooterProps {
  text: string
  /** 是否在线（显示状态色点） */
  online?: boolean
}

/**
 * 底部网络状态栏（对应 KMP AppFooter.kt）
 * 右下角显示网络状态文字 + 在线/离线色点
 */
export default function AppFooter({ text, online }: AppFooterProps) {
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
      <Typography sx={{ fontSize: 12, color: AppColors.textHint }}>
        比优特到家小票打印系统
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: online ? AppColors.successGreen : AppColors.errorRed,
            boxShadow: online ? `0 0 0 3px ${AppColors.successGreen}25` : `0 0 0 3px ${AppColors.errorRed}25`
          }}
        />
        <Typography sx={{ fontSize: 12, color: AppColors.textSecondary, fontWeight: 500 }}>
          {text}
        </Typography>
      </Stack>
    </Box>
  )
}