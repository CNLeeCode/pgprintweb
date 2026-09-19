import { Box, IconButton, Badge, Stack, Typography, Chip } from '@mui/material'
import SyncAltIcon from '@mui/icons-material/SyncAlt'
import RefreshIcon from '@mui/icons-material/Refresh'
import { APP_VERSION } from '../config'
import { AppColors } from '../theme/theme'

interface AppHeaderProps {
  currentShop: string
  isNeedUpdate: boolean
  latestVersion?: string
  onChangeShop: () => void
  onRefreshVersion: () => void
  /** 点击"发现新版本"徽章触发应用内更新弹窗（方案 B） */
  onUpdateClick: () => void
}

/**
 * 顶部栏（对应 KMP AppHeaderView / AppHeader.kt）
 *
 * 版本区域变更（方案 B）：
 *  - 删除原 getDownloadPage 浏览器跳转（两处 window.open）
 *  - "当前版本"区域仅展示版本号
 *  - "发现新版本"徽章点击打开应用内 UpdateDialog（进度条 + 静默安装）
 */
export default function AppHeader({
  currentShop,
  isNeedUpdate,
  latestVersion,
  onChangeShop,
  onRefreshVersion,
  onUpdateClick
}: AppHeaderProps) {
  return (
    <Box sx={{ borderBottom: '1px solid #ECEDF9', bgcolor: '#fff' }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ height: 48, px: '20px' }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              px: '10px',
              py: '4px',
              borderRadius: '20px',
              bgcolor: AppColors.primary + '12',
              transition: 'background-color .2s',
              '&:hover': { bgcolor: AppColors.primary + '20' }
            }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: AppColors.textPrimary }}>
              {currentShop}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={onChangeShop}
            sx={{
              color: AppColors.primary,
              '&:hover': { bgcolor: AppColors.primary + '15' }
            }}
          >
            <SyncAltIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          {!isNeedUpdate && (
            <IconButton
              size="small"
              onClick={onRefreshVersion}
              sx={{ '&:hover': { bgcolor: AppColors.primary + '12' } }}
            >
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
          <Box
            sx={{
              px: '10px',
              py: '4px',
              borderRadius: '20px',
              bgcolor: AppColors.headerBackground,
              transition: 'background-color .2s'
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: AppColors.textSecondary, userSelect: 'none' }}>
              当前版本：V{APP_VERSION}
            </Typography>
          </Box>
          {isNeedUpdate && (
            <Chip
              label={`发现新版本${latestVersion}`}
              size="small"
              sx={{
                bgcolor: AppColors.errorRed,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                '&:hover': { bgcolor: '#d32f2f' }
              }}
              onClick={onUpdateClick}
            />
          )}
        </Stack>
      </Stack>
    </Box>
  )
}