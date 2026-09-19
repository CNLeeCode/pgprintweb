import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Box,
  Typography,
  Stack,
  InputAdornment
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import type { PrintPlatform, ShopPrintOrderItem } from '@shared/types/models'
import { AppColors } from '../theme/theme'

/**
 * 查询打印对话框（对应 KMP DrawerContent.kt）
 *
 * 职责：
 *  1. 选择平台（分段按钮）
 *  2. 输入订单号或流水号
 *  3. 在已打印 + 待打印订单 Map 中查找匹配项
 *     - 命中：用该订单的 daySeq 触发重打
 *     - 未命中：用原始输入作为 daySeq 触发重打（后端 getOrder 兜底）
 *  4. 关闭对话框
 *
 * 重打入口走主进程 reprintOrder(platformId, shopId, daySeq) → getOrder → 入队打印
 */
interface QueryPrintDialogProps {
  /** 是否打开 */
  open: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 可选平台列表 */
  platforms: PrintPlatform[]
  /** 已打印订单 Map：platformId → (orderId → item) */
  printedMap: Record<string, Record<string, ShopPrintOrderItem>>
  /** 待打印订单 Map：platformId → (orderId → item) */
  pendingMap: Record<string, Record<string, ShopPrintOrderItem>>
  /** 查到后触发重打（orderId, platformId）；getOrder 后端 day_seq 字段实收 orderId */
  onPrint: (orderId: string, platformId: string) => void
}

/**
 * 查询打印对话框组件
 *
 * 用法：在 HomeView 中由 SettingPanel 的"查询打印"按钮触发 open=true
 */
export default function QueryPrintDialog({
  open,
  onClose,
  platforms,
  printedMap,
  pendingMap,
  onPrint
}: QueryPrintDialogProps) {
  // 当前选中平台
  const [selected, setSelected] = useState<string>('')
  // 用户输入的订单号/流水号
  const [input, setInput] = useState('')
  // 提示信息
  const [hint, setHint] = useState<{ text: string; color: string } | null>(null)

  // 打开时默认选第一个平台，清空输入与提示
  useEffect(() => {
    if (open) {
      setSelected(platforms[0]?.id ?? '')
      setInput('')
      setHint(null)
    }
  }, [open, platforms])

  // 当前平台名称（用于提示）
  const selectedLabel = useMemo(() => {
    return platforms.find((p) => p.id === selected)?.label ?? ''
  }, [platforms, selected])

  /**
   * 从系统剪贴板读取文本并填入输入框（"粘贴"按钮）
   *
   * 为何不走原生 Cmd+V/Ctrl+V：Electron 22 下主进程 clipboard.writeText 写入的剪贴板，
   * 渲染进程输入框原生粘贴（Chromium 剪贴板读取）存在同步/格式差异，可能粘贴不进去；
   * 改由主进程 clipboard:readText IPC 主动读取，绕过该限制，Win7/Mac 均稳定。
   */
  const handlePaste = async () => {
    try {
      const text = (await window.electronAPI.clipboardReadText()) as string
      const trimmed = (text || '').trim()
      if (!trimmed) {
        setHint({ text: '剪贴板为空，请先复制订单号', color: AppColors.errorRed })
        return
      }
      setInput(trimmed)
      setHint(null)
    } catch {
      setHint({ text: '读取剪贴板失败', color: AppColors.errorRed })
    }
  }

  /**
   * 查询打印按钮：在已打印 + 待打印 Map 中匹配 orderId 或 daySeq
   * 命中用 daySeq 重打，未命中用原始输入兜底（对应 KMP DrawerContent 未找到走 input 兜底）
   */
  const handleQueryPrint = () => {
    const trimmed = input.trim()
    if (!trimmed) {
      setHint({ text: '请输入订单号或流水号', color: AppColors.errorRed })
      return
    }
    if (!selected) {
      setHint({ text: '请选择平台', color: AppColors.errorRed })
      return
    }

    // 合并当前平台的已打印 + 待打印订单
    const printed = printedMap[selected] || {}
    const pending = pendingMap[selected] || {}
    const allItems = [...Object.values(printed), ...Object.values(pending)]

    // 优先匹配 orderId，其次匹配 daySeq
    const matched = allItems.find((o) => o.orderId === trimmed || o.daySeq === trimmed)

    if (matched) {
      setHint({
        text: `已找到订单 #${matched.daySeq}（${matched.orderId}），开始重打`,
        color: AppColors.successGreen
      })
      // getOrder 后端 day_seq 字段实收 orderId，故传 matched.orderId
      onPrint(matched.orderId, selected)
    } else {
      // 未命中：用原始输入作为 orderId 兜底，让后端 getOrder 兜底查询
      setHint({
        text: `未找到本地记录，用输入值查询后端重打`,
        color: AppColors.pendingOrange
      })
      onPrint(trimmed, selected)
    }

    // 稍延迟关闭，让用户看到提示
    setTimeout(onClose, 600)
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700, pb: 1 }}>查询打印</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {/* 平台分段选择 */}
          {platforms.length > 0 ? (
            <ToggleButtonGroup
              value={selected}
              exclusive
              onChange={(_, val) => val && setSelected(val)}
              size="small"
              sx={{ flexWrap: 'wrap', gap: 0.5 }}
            >
              {platforms.map((p) => (
                <ToggleButton
                  key={p.id}
                  value={p.id}
                  sx={{
                    px: 1.5,
                    py: 0.375,
                    fontSize: 12,
                    borderRadius: '6px !important',
                    border: `1px solid ${selected === p.id ? AppColors.primary : '#ECEDF9'} !important`,
                    color: selected === p.id ? AppColors.primary : AppColors.textSecondary,
                    bgcolor: selected === p.id ? AppColors.primary + '12' : 'transparent',
                    fontWeight: selected === p.id ? 600 : 400
                  }}
                >
                  {p.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : (
            <Typography sx={{ fontSize: 12, color: AppColors.textHint }}>暂无可选平台</Typography>
          )}

          {/* 订单号 / 流水号输入框 */}
          <TextField
            autoFocus
            fullWidth
            placeholder="请输入订单号或流水号"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setHint(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQueryPrint()
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18, color: AppColors.textHint }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Button
                    size="small"
                    onClick={handlePaste}
                    startIcon={<ContentPasteIcon sx={{ fontSize: 16 }} />}
                    sx={{
                      minWidth: 'auto',
                      fontSize: 12,
                      color: AppColors.primary,
                      textTransform: 'none',
                      py: 0.25,
                      px: 0.75
                    }}
                  >
                    粘贴
                  </Button>
                </InputAdornment>
              )
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                height: 44,
                borderRadius: '8px',
                fontSize: 14,
                '& fieldset': { borderColor: '#ECEDF9' },
                '&:hover fieldset': { borderColor: AppColors.primary + '60' },
                '&.Mui-focused fieldset': { borderWidth: 2, borderColor: AppColors.primary }
              }
            }}
          />

          {/* 提示信息 */}
          {hint && (
            <Typography sx={{ fontSize: 12, color: hint.color, lineHeight: 1.5 }}>{hint.text}</Typography>
          )}

          {/* 说明 */}
          <Typography sx={{ fontSize: 11, color: AppColors.textHint, lineHeight: 1.6 }}>
            支持输入订单号或流水号查询，命中本地已打印/待打印记录后立即重打；未命中则用输入值直接查询后端重打。
            {selectedLabel && `当前平台：${selectedLabel}`}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: AppColors.textSecondary }}>
          取消
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleQueryPrint}
          disabled={!input.trim() || !selected}
          sx={{ borderRadius: '8px', fontWeight: 600 }}
        >
          查询打印
        </Button>
      </DialogActions>
    </Dialog>
  )
}
