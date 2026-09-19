import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Stack, Typography, CircularProgress, Button, Chip, IconButton } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useUpdateStore } from '../stores/updateStore'
import { AppColors } from '../theme/theme'
import { APP_VERSION } from '../config'
import UpdateDialog from '../components/UpdateDialog'

/**
 * 启动检查页（对应 KMP Splash.kt）
 * 四状态：检查中 / 有新版本 / 正常跳转 / 异常
 */
export default function SplashView() {
  const navigate = useNavigate()
  const { status, version, message, checkVersion } = useUpdateStore()
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)

  useEffect(() => {
    checkVersion()
  }, [checkVersion])

  // 发现新版本时自动弹出更新弹窗
  useEffect(() => {
    if (status === 'update') setUpdateDialogOpen(true)
  }, [status])

  // 正常状态：显示"跳转中..."1秒后跳登录
  useEffect(() => {
    if (status === 'usual') {
      const t = setTimeout(() => navigate('/login'), 1000)
      return () => clearTimeout(t)
    }
  }, [status, navigate])

  return (
    <Box
      sx={{
        position: 'relative',
        height: '100vh',
        background: `linear-gradient(135deg, #fff 0%, ${AppColors.headerBackground} 100%)`,
        overflow: 'hidden'
      }}
    >
      {/* 左下角装饰：多层渐变球，营造品质感 */}
      <Box
        sx={{
          position: 'absolute',
          bottom: -120,
          left: -80,
          width: 480,
          height: 480,
          borderRadius: '50%',
          opacity: 0.22,
          background: `radial-gradient(circle at 30% 70%, ${AppColors.primary}, transparent 60%)`
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: -60,
          left: 80,
          width: 240,
          height: 240,
          borderRadius: '50%',
          opacity: 0.18,
          background: `radial-gradient(circle at 50% 50%, ${AppColors.primaryDark}, transparent 60%)`
        }}
      />
      {/* 右上角点缀 */}
      <Box
        sx={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 340,
          height: 340,
          borderRadius: '50%',
          opacity: 0.12,
          background: `radial-gradient(circle at 50% 50%, ${AppColors.primary}, transparent 60%)`
        }}
      />

      <Stack
        sx={{
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '40px',
          position: 'relative',
          zIndex: 1
        }}
      >
        {/* 应用名称 + 版本徽章 */}
        <Stack alignItems="center" spacing={1.5}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${AppColors.primary}, ${AppColors.primaryDark})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 8px 24px ${AppColors.primary}40`
            }}
          >
            <Typography sx={{ fontSize: 26, color: '#fff', fontWeight: 700 }}>B</Typography>
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: AppColors.textPrimary }}>
            比优特到家小票打印系统
          </Typography>
          <Chip
            label={`V ${APP_VERSION}`}
            size="small"
            sx={{ bgcolor: AppColors.primary + '12', color: AppColors.primary, fontWeight: 600, fontSize: 12 }}
          />
        </Stack>

        <Box sx={{ width: 500, minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {status === 'checking' && <CheckingView text="检查更新中...." />}
          {status === 'usual' && <CheckingView text="跳转中..." />}
          {status === 'update' && (
            <UpdateView
              version={version || ''}
              onDownload={() => setUpdateDialogOpen(true)}
              onContinue={() => navigate('/login')}
            />
          )}
          {status === 'error' && (
            <ErrorView
              message={message || '未知错误'}
              onRefresh={checkVersion}
              onContinue={() => navigate('/login')}
            />
          )}
        </Box>
      </Stack>

      {/* 底部信息 */}
      <Typography
        sx={{
          position: 'absolute',
          bottom: 16,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 11,
          color: AppColors.textHint,
          zIndex: 1
        }}
      >
        Powered by Electron 22 · 自动小票打印系统
      </Typography>

      <UpdateDialog open={updateDialogOpen} onClose={() => setUpdateDialogOpen(false)} />
    </Box>
  )
}

function CheckingView({ text }: { text: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}>
      <CircularProgress size={28} thickness={5} sx={{ color: AppColors.primary }} />
      <Typography sx={{ fontSize: 16, color: AppColors.textSecondary }}>{text}</Typography>
    </Stack>
  )
}

function UpdateView({
  version,
  onDownload,
  onContinue
}: {
  version: string
  onDownload: () => void
  onContinue: () => void
}) {
  return (
    <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-around" sx={{ width: 460 }}>
      <Chip
        label={`发现新版本 V${version}`}
        sx={{ bgcolor: AppColors.errorRed + '15', color: AppColors.errorRed, fontWeight: 700, height: 30, fontSize: 13 }}
      />
      <Button variant="contained" color="primary" onClick={onDownload} sx={{ px: 2 }}>
        下载新版本
      </Button>
      <Button variant="outlined" onClick={onContinue}>继续旧版本</Button>
    </Stack>
  )
}

function ErrorView({
  message,
  onRefresh,
  onContinue
}: {
  message: string
  onRefresh: () => void
  onContinue: () => void
}) {
  return (
    <Stack spacing={2} sx={{ minWidth: 400, maxWidth: 560 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Typography sx={{ fontSize: 16, fontWeight: 600 }}>检查更新失败</Typography>
          <IconButton size="small" onClick={onRefresh} sx={{ color: AppColors.primary }}>
            <RefreshIcon />
          </IconButton>
        </Stack>
        <Button size="small" onClick={onContinue}>继续旧版本</Button>
      </Stack>
      {/* whiteSpace: pre-wrap 保留换行与缩进，fontFamily monospace 让 [1/3]/[2/3] 列对齐 */}
      <Typography
        component="pre"
        sx={{
          margin: 0,
          fontSize: 12,
          fontFamily: 'Consolas, "Courier New", monospace',
          color: AppColors.errorRed,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          padding: 1.5,
          background: AppColors.errorRed + '0A',
          borderRadius: 1
        }}
      >
        {message}
      </Typography>
    </Stack>
  )
}