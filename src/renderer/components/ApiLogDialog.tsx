import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Stack,
  Tooltip
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { useApiLogStore } from '../stores/apiLogStore'
import { electronAPI } from '../api/bridge'
import { AppColors } from '../theme/theme'

interface ApiLogDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * 接口日志弹窗
 *
 * 由 AppFooter 左下角"接口"状态点击打开，供现场排查接口不通问题。
 *
 * 三大区域：
 *  1. 顶部"诊断网络"按钮：调用主进程分步诊断 DNS 解析 → TCP 连接 → HTTP 请求，
 *     返回多行报告展示在主体上方（红色框，monospace 字体）
 *  2. 主体：最近 50 条接口调用日志列表（时间 + 接口 + 状态色点 + 简述）
 *  3. 底部按钮：清空 / 关闭
 *
 * 典型使用场景：店员反馈"接不到单" → 现场点 Footer 接口状态 → 弹窗看诊断报告。
 */
export default function ApiLogDialog({ open, onClose }: ApiLogDialogProps) {
  const logs = useApiLogStore((s) => s.logs)
  const clear = useApiLogStore((s) => s.clear)
  const [diagnosing, setDiagnosing] = useState(false)
  const [report, setReport] = useState<string>('')

  /** 触发主进程诊断（DNS / TCP / HTTP 三步） */
  const runDiagnose = useCallback(async () => {
    setDiagnosing(true)
    setReport('')
    try {
      const result = (await electronAPI.diagnoseNetwork()) as string
      setReport(result || '（无诊断结果）')
    } catch (e) {
      setReport(`诊断失败: ${(e as Error).message}`)
    } finally {
      setDiagnosing(false)
    }
  }, [])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700, py: 1.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>接口日志与网络诊断</Box>
          <Tooltip title="重新诊断">
            <IconButton size="small" onClick={runDiagnose} disabled={diagnosing}>
              {diagnosing ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ py: 1 }}>
        {/* 诊断报告区 */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Button
            variant="contained"
            size="small"
            onClick={runDiagnose}
            disabled={diagnosing}
            startIcon={diagnosing ? <CircularProgress size={14} /> : undefined}
            sx={{ fontSize: 12, textTransform: 'none' }}
          >
            {diagnosing ? '诊断中...' : '诊断网络'}
          </Button>
          <Typography sx={{ fontSize: 11, color: AppColors.textHint }}>
            分步检查 DNS 解析 → TCP 连接 → HTTP 请求
          </Typography>
        </Stack>

        {report && (
          <Box
            component="pre"
            sx={{
              margin: 0,
              mb: 1.5,
              padding: 1.25,
              background: '#FFF3E0',
              border: `1px solid ${AppColors.pendingOrange}40`,
              borderRadius: 1,
              fontSize: 12,
              fontFamily: 'Consolas, "Courier New", monospace',
              color: AppColors.textPrimary,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 280,
              overflow: 'auto'
            }}
          >
            {report}
          </Box>
        )}

        {/* 接口调用日志列表 */}
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: AppColors.textSecondary, mb: 0.75 }}>
          最近接口调用（共 {logs.length} 条）
        </Typography>
        <Box
          sx={{
            border: '1px solid #ECEDF9',
            borderRadius: 1,
            maxHeight: 360,
            overflow: 'auto',
            bgcolor: '#FAFBFC'
          }}
        >
          {logs.length === 0 && (
            <Typography sx={{ fontSize: 12, color: '#999', p: 2, textAlign: 'center' }}>
              暂无接口调用记录
            </Typography>
          )}
          {logs
            .slice()
            .reverse()
            .map((log, i) => {
              const isOk = log.status === 'success'
              return (
                <Box
                  key={i}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.25,
                    py: 0.75,
                    borderBottom: '1px solid #F3F4F8',
                    '&:hover': { bgcolor: '#fff' }
                  }}
                >
                  <Typography
                    component="span"
                    sx={{
                      fontSize: 11,
                      color: AppColors.textHint,
                      fontFamily: 'Consolas, monospace',
                      flexShrink: 0,
                      width: 78
                    }}
                  >
                    {log.time}
                  </Typography>
                  <Typography
                    component="span"
                    sx={{
                      fontSize: 12,
                      fontFamily: 'Consolas, monospace',
                      color: AppColors.primary,
                      flexShrink: 0,
                      width: 130,
                      fontWeight: 600
                    }}
                  >
                    {log.method}
                  </Typography>
                  {isOk ? (
                    <CheckCircleIcon sx={{ fontSize: 14, color: AppColors.successGreen, flexShrink: 0 }} />
                  ) : (
                    <ErrorIcon sx={{ fontSize: 14, color: AppColors.errorRed, flexShrink: 0 }} />
                  )}
                  <Typography
                    component="span"
                    sx={{
                      fontSize: 12,
                      color: isOk ? AppColors.textSecondary : AppColors.errorRed,
                      wordBreak: 'break-all',
                      flex: 1
                    }}
                  >
                    {log.message}
                  </Typography>
                </Box>
              )
            })}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.25 }}>
        <Button onClick={clear} size="small" color="inherit" sx={{ fontSize: 12 }}>
          清空日志
        </Button>
        <Button onClick={onClose} variant="contained" size="small" sx={{ fontSize: 12 }}>
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  )
}