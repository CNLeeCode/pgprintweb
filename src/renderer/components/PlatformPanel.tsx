import { Box, CircularProgress, Typography, List, ListItemButton, ListItemIcon, ListItemText, Checkbox, IconButton } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { usePlatformStore } from '../stores/platformStore'
import { AppColors } from '../theme/theme'

/** 平台选择面板（对应 KMP ChoosePrintDeviceList） */
export default function PlatformPanel() {
  const { status, platforms, checkedIds, errorMsg, refresh, togglePlatform } = usePlatformStore()

  return (
    <Box sx={{ height: 180, bgcolor: AppColors.windowBackground, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {status === 'loading' && <CircularProgress size={24} thickness={3} sx={{ color: AppColors.primary }} />}
      {status === 'error' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ color: AppColors.errorRed, fontSize: 14 }}>异常：{errorMsg}</Typography>
          <IconButton size="small" onClick={() => refresh()}>
            <RefreshIcon />
          </IconButton>
        </Box>
      )}
      {status === 'success' && (
        <List dense sx={{ width: '100%', height: '100%', overflow: 'auto', p: 0.5 }}>
          {platforms.map((p) => {
            const checked = checkedIds.includes(p.id)
            return (
              <ListItemButton
                key={p.id}
                dense
                onClick={() => togglePlatform(p.id)}
                title={p.label}
                sx={{
                  borderRadius: '6px',
                  mx: 0.5,
                  my: 0.25,
                  py: 0.5,
                  px: 1,
                  position: 'relative',
                  transition: 'background-color .15s',
                  bgcolor: checked ? AppColors.primary + '10' : 'transparent',
                  border: checked ? `1px solid ${AppColors.primary}50` : '1px solid transparent',
                  '&:hover': { bgcolor: AppColors.headerBackground }
                }}
              >
                {checked && (
                  <Box
                    sx={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 3,
                      height: '60%',
                      borderRadius: 2,
                      bgcolor: AppColors.primary
                    }}
                  />
                )}
                <ListItemIcon sx={{ minWidth: 32 }}>
                  {p.img ? (
                    <Box component="img" src={p.img} sx={{ width: 20, height: 20, borderRadius: '4px' }} />
                  ) : (
                    <Box
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: '4px',
                        bgcolor: AppColors.primary,
                        opacity: checked ? 1 : 0.6
                      }}
                    />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={p.label}
                  primaryTypographyProps={{
                    fontSize: 13,
                    fontWeight: checked ? 600 : 400,
                    noWrap: true,
                    title: p.label,
                    color: checked ? AppColors.primary : 'inherit'
                  }}
                />
                <Checkbox
                  size="small"
                  checked={checked}
                  onChange={() => togglePlatform(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ color: checked ? AppColors.primary : undefined, '&.Mui-checked': { color: AppColors.primary } }}
                />
              </ListItemButton>
            )
          })}
        </List>
      )}
    </Box>
  )
}