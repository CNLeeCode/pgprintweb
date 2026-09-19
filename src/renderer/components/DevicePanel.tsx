import {
  Box,
  CircularProgress,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Radio
} from '@mui/material'
import UsbIcon from '@mui/icons-material/Usb'
import { useDeviceStore } from '../stores/deviceStore'
import { AppColors } from '../theme/theme'

/** 打印设备选择面板（对应 KMP UsbView.kt） */
export default function DevicePanel() {
  const { status, devices, currentPrinterId, errorMsg } = useDeviceStore()

  return (
    <Box
      sx={{
        height: 180,
        bgcolor: AppColors.windowBackground,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {status === 'loading' && <CircularProgress size={24} thickness={3} sx={{ color: AppColors.primary }} />}
      {status === 'error' && <Typography sx={{ color: AppColors.errorRed, fontSize: 14 }}>异常：{errorMsg}</Typography>}
      {status === 'success' && (
        <List dense sx={{ width: '100%', height: '100%', overflow: 'auto', p: 0.5 }}>
          {devices.map((d) => {
            const selected = currentPrinterId === d.id
            return (
              <ListItemButton
                key={d.id}
                dense
                onClick={() => useDeviceStore.getState().selectPrinter(d.id)}
                title={`${d.name}（${d.type === 'serial' ? '串口' : '系统'}）`}
                sx={{
                  borderRadius: '6px',
                  mx: 0.5,
                  my: 0.25,
                  py: 0.5,
                  px: 1,
                  position: 'relative',
                  transition: 'background-color .15s, box-shadow .15s',
                  bgcolor: selected ? AppColors.primary + '10' : 'transparent',
                  border: selected ? `1px solid ${AppColors.primary}50` : '1px solid transparent',
                  '&:hover': { bgcolor: AppColors.headerBackground }
                }}
              >
                {selected && (
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
                  <UsbIcon sx={{ fontSize: 20, color: selected ? AppColors.primary : 'inherit' }} />
                </ListItemIcon>
                <ListItemText
                  primary={d.name}
                  secondary={d.type === 'serial' ? '串口' : '系统'}
                  primaryTypographyProps={{
                    fontSize: 13,
                    fontWeight: selected ? 600 : 400,
                    noWrap: true,
                    title: d.name,
                    color: selected ? AppColors.primary : 'inherit'
                  }}
                  secondaryTypographyProps={{ fontSize: 10, color: '#999' }}
                />
                <Radio
                  size="small"
                  checked={selected}
                  onChange={() => useDeviceStore.getState().selectPrinter(d.id)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ color: selected ? AppColors.primary : undefined, '&.Mui-checked': { color: AppColors.primary } }}
                />
              </ListItemButton>
            )
          })}
        </List>
      )}
    </Box>
  )
}