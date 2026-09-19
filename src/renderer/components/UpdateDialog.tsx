import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  LinearProgress,
  Typography,
  Stack,
  Chip,
  Alert
} from '@mui/material'
import { useUpdateStore } from '../stores/updateStore'
import { AppColors } from '../theme/theme'

interface UpdateDialogProps {
  /** 是否打开 */
  open: boolean
  /** 关闭弹窗（继续使用旧版本） */
  onClose: () => void
}

/**
 * 更新弹窗（方案 B）
 *
 * 状态流转：
 *  - available  显示版本号 + 更新说明 + "立即更新"按钮
 *  - downloading 显示进度条 + 已下载/总大小 + 百分比
 *  - downloaded  显示"下载完成" + "立即重启升级"按钮
 *  - error       显示错误信息 + "重试下载"按钮
 *
 * 强制更新（forceUpdate=1）：隐藏"继续旧版本"按钮，必须更新才能使用
 */
export default function UpdateDialog({ open, onClose }: UpdateDialogProps) {
  const { version, updateMsg, forceUpdate, downloadStatus, progress, errorMessage } = useUpdateStore()
  const [downloading, setDownloading] = useState(false)

  /** 开始下载 */
  const handleDownload = async () => {
    setDownloading(true)
    await useUpdateStore.getState().downloadUpdate()
  }

  /** 立即安装 */
  const handleInstall = () => {
    useUpdateStore.getState().installUpdate()
  }

  /** 格式化字节数为友好显示 */
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <Dialog open={open} onClose={forceUpdate ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>发现新版本</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* 版本号徽章 */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={version ? `V${version}` : '新版本'}
              sx={{ bgcolor: AppColors.primary, color: '#fff', fontWeight: 700 }}
            />
            {forceUpdate && (
              <Chip
                label="需更新后使用"
                size="small"
                sx={{ bgcolor: AppColors.errorRed + '15', color: AppColors.errorRed, fontWeight: 600, fontSize: 12 }}
              />
            )}
          </Stack>

          {/* 更新说明（接口返回，多行用 \n 分隔） */}
          {updateMsg && (
            <Alert severity="info" icon={false} sx={{ py: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 0.5 }}>
                更新内容
              </Typography>
              <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {updateMsg}
              </Typography>
            </Alert>
          )}

          {/* 下载中：进度条 + 字节数 + 百分比 */}
          {downloadStatus === 'downloading' && (
            <Box>
              <LinearProgress
                variant="determinate"
                value={progress?.percent || 0}
                sx={{ height: 8, borderRadius: 4 }}
              />
              <Typography sx={{ fontSize: 12, color: '#999', mt: 1, textAlign: 'center' }}>
                {formatBytes(progress?.transferred || 0)} / {progress?.total ? formatBytes(progress.total) : '?'}
                （{Math.round(progress?.percent || 0)}%）
              </Typography>
            </Box>
          )}

          {/* 下载完成 */}
          {downloadStatus === 'downloaded' && (
            <Typography sx={{ fontSize: 14, color: AppColors.successGreen }}>
              下载完成，点击"立即重启升级"完成安装。
            </Typography>
          )}

          {/* 下载失败 */}
          {downloadStatus === 'error' && (
              <Alert severity="error" sx={{ fontSize: 13 }}>
                下载失败：{errorMessage || '未知错误'}
              </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {downloadStatus === 'downloaded' ? (
          <Button variant="contained" color="primary" onClick={handleInstall}>
            立即重启升级
          </Button>
        ) : downloadStatus === 'error' ? (
          <>
            {!forceUpdate && <Button onClick={onClose}>继续旧版本</Button>}
            <Button variant="contained" color="primary" onClick={handleDownload}>
              重试下载
            </Button>
          </>
        ) : downloadStatus === 'downloading' ? (
          <Button disabled>下载中...</Button>
        ) : (
          <>
            {!forceUpdate && <Button onClick={onClose}>继续旧版本</Button>}
            <Button
              variant="contained"
              color="primary"
              onClick={handleDownload}
              disabled={downloading && downloadStatus === 'downloading'}
            >
              立即更新
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}