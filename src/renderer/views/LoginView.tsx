import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Stack, Typography, TextField, Button, CircularProgress, InputAdornment } from '@mui/material'
import StoreIcon from '@mui/icons-material/Store'
import { useConfigStore } from '../stores/configStore'
import { usePlatformStore } from '../stores/platformStore'
import { useNetworkStore } from '../stores/networkStore'
import { electronAPI } from '../api/bridge'
import { AppColors } from '../theme/theme'

/**
 * 门店登录页（对应 KMP Login.kt）
 */
export default function LoginView() {
  const navigate = useNavigate()
  const { shopId, loadShopId, setShopId } = useConfigStore()
  const networkMessage = useNetworkStore((s) => s.message)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    loadShopId()
  }, [loadShopId])

  // 已有门店号则自动进入主页
  useEffect(() => {
    if (shopId) {
      setLoading(true)
      navigate('/home')
    }
  }, [shopId, navigate])

  const handleConfirm = async () => {
    setTouched(true)
    if (!input.trim()) return
    setLoading(true)
    // 防御场景：用户已登录状态下关闭应用，重启后想换门店登录。
    // 此时主进程运行时状态（queue/printingSet/printedMap/pendingMap/retryMap）
    // 可能还残留旧门店数据，输入新门店号登录前先调用 switchShop 清空，
    // 确保新门店进来时是干净的运行时状态。
    await electronAPI.switchShop()
    // 输入新门店号登录：清空上一门店持久化的平台勾选
    // （覆盖场景：用户已登录状态下关闭应用，重启后想换门店登录）
    await usePlatformStore.getState().clearChecked()
    await setShopId(input.trim())
    navigate('/home')
  }

  const showError = touched && !input.trim()

  return (
    <Box
      sx={{
        position: 'relative',
        height: '100vh',
        background: `linear-gradient(135deg, ${AppColors.headerBackground} 0%, #fff 100%)`,
        overflow: 'hidden'
      }}
    >
      {/* 右下角装饰：多层渐变球 */}
      <Box
        sx={{
          position: 'absolute',
          bottom: -120,
          right: -80,
          width: 420,
          height: 420,
          borderRadius: '50%',
          opacity: 0.22,
          background: `radial-gradient(circle at 70% 70%, ${AppColors.primary}, transparent 60%)`
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: -60,
          right: 100,
          width: 240,
          height: 240,
          borderRadius: '50%',
          opacity: 0.16,
          background: `radial-gradient(circle at 50% 50%, ${AppColors.primaryDark}, transparent 60%)`
        }}
      />

      <Stack
        alignItems="center"
        justifyContent="center"
        sx={{ height: '100%', transform: 'translateY(-100px)', position: 'relative', zIndex: 1 }}
      >
        <Box
          sx={{
            width: 500,
            background: '#fff',
            borderRadius: '12px',
            p: '32px 24px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
            border: '1px solid #ECEDF9',
            boxShadow: '0 12px 40px rgba(0,87,194,0.12)'
          }}
        >
          {/* 标题图标 */}
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              bgcolor: AppColors.primary + '12',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <StoreIcon sx={{ fontSize: 22, color: AppColors.primary }} />
          </Box>
          <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#333' }}>请输入门店号</Typography>
          <TextField
            fullWidth
            placeholder="请输入门店号"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm()
            }}
            autoFocus
            error={showError}
            helperText={showError ? '门店号不能为空' : ''}
            variant="outlined"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <StoreIcon sx={{ fontSize: 18, color: AppColors.textHint }} />
                </InputAdornment>
              )
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                height: 48,
                borderRadius: '10px',
                bgcolor: '#F8F9FC',
                fontSize: 16,
                '& fieldset': { borderColor: '#ECEDF9' },
                '&:hover fieldset': { borderColor: AppColors.primary + '60' },
                '&.Mui-focused fieldset': { borderWidth: 2, borderColor: AppColors.primary },
                '&.Mui-focused': { bgcolor: '#fff' }
              }
            }}
          />
          <Button
            fullWidth
            variant="contained"
            color="primary"
            onClick={handleConfirm}
            disabled={loading || !input.trim()}
            sx={{ maxWidth: 280, height: 42, borderRadius: '10px', fontSize: 14, fontWeight: 600 }}
          >
            {loading ? <CircularProgress size={20} color="inherit" /> : '输入完成'}
          </Button>
          <Typography sx={{ fontSize: 12, textAlign: 'center', color: AppColors.textHint }}>
            {networkMessage}
          </Typography>
        </Box>
      </Stack>
    </Box>
  )
}