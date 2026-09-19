import { useState } from 'react'
import { Box, Stack, Typography, Button, Snackbar } from '@mui/material'
import type { PrintPlatform, ShopPrintOrderItem } from '@shared/types/models'
import { AppColors } from '../theme/theme'

interface PlatformGridProps {
  platforms: PrintPlatform[]
  printedMap: Record<string, Record<string, ShopPrintOrderItem>>
  pendingMap: Record<string, Record<string, ShopPrintOrderItem>>
  shopId: string
  onPrintDoc: (platformId: string, orderId: string) => void
}

/** 平台订单网格（对应 KMP PrintPlatformGrid.kt） */
export default function PlatformGrid({
  platforms,
  printedMap,
  pendingMap,
  shopId,
  onPrintDoc
}: PlatformGridProps) {
  const [toast, setToast] = useState('')

  if (platforms.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5
        }}
      >
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            bgcolor: AppColors.headerBackground,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Typography sx={{ fontSize: 28, opacity: 0.5 }}></Typography>
        </Box>
        <Typography sx={{ fontSize: 14, color: AppColors.textHint }}>请先选择要监听的平台</Typography>
      </Box>
    )
  }

  /**
   * 复制订单号到系统剪贴板（对应 KMP Utils.copyToClipboard(it.orderId)）
   *
   * 走 Electron 主进程 clipboard 模块（经 IPC）而非 navigator.clipboard.writeText，原因：
   *  1. navigator.clipboard.writeText 是 Promise，无 await 时失败静默，
   *     会造成"toast 提示成功但实际未复制"假象；
   *  2. Electron 22 + Win7 下 navigator.clipboard 在非 secure context 可能不可用；
   *  3. 主进程 clipboard 走系统级 API，跨平台稳定，对应 KMP AWT systemClipboard。
   *
   * 流程：await IPC 返回 → 成功 toast"复制成功" / 失败 toast"复制失败"。
   */
  const copy = async (orderId: string) => {
    try {
      const ok = await window.electronAPI.clipboardWriteText(orderId)
      setToast(ok ? `复制成功：${orderId}` : '复制失败，请重试')
    } catch {
      setToast('复制失败，请重试')
    }
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, 300px)',
        gap: '10px',
        p: '10px',
        bgcolor: '#fff',
        alignContent: 'start'
      }}
    >
      {platforms.map((p) => {
        const printed = printedMap[p.id] || {}
        const pending = pendingMap[p.id] || {}
        const printedCount = Object.keys(printed).length
        const pendingCount = Object.keys(pending).length
        return (
          <PlatformGridItem
            key={p.id}
            platform={p}
            pendingCount={pendingCount}
            printedCount={printedCount}
            pending={pending}
            printed={printed}
            onReprint={(orderId) => onPrintDoc(p.id, orderId)}
            onCopy={copy}
          />
        )
      })}
      <Snackbar
        open={!!toast}
        autoHideDuration={1500}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      />
    </Box>
  )
}

interface ItemProps {
  platform: PrintPlatform
  pendingCount: number
  printedCount: number
  pending: Record<string, ShopPrintOrderItem>
  printed: Record<string, ShopPrintOrderItem>
  onReprint: (orderId: string) => void
  onCopy: (text: string) => void
}

function PlatformGridItem({
  platform,
  pendingCount,
  printedCount,
  pending,
  printed,
  onReprint,
  onCopy
}: ItemProps) {
  return (
    <Box
      sx={{
        height: 400,
        bgcolor: '#fff',
        borderRadius: '8px',
        border: `1px solid ${AppColors.headerBackground}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
        '&:hover': {
          transform: 'translateY(-3px)',
          boxShadow: '0 12px 28px rgba(0,87,194,0.12)',
          borderColor: AppColors.primary + '40'
        }
      }}
    >
      <Box
        sx={{
          px: '10px',
          py: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #ECEDF9'
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          {platform.img ? (
            <Box component="img" src={platform.img} sx={{ width: 18, height: 18, borderRadius: '3px' }} />
          ) : (
            <Box sx={{ width: 18, height: 18, borderRadius: '3px', bgcolor: AppColors.primary }} />
          )}
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: AppColors.textPrimary }}>{platform.label}</Typography>
        </Stack>
        <Stack direction="row" spacing={0.5}>
          <Box
            sx={{
              px: '6px',
              py: '2px',
              borderRadius: '10px',
              bgcolor: pendingCount > 0 ? '#FFF3E0' : '#F5F5F5',
              color: pendingCount > 0 ? AppColors.pendingOrange : AppColors.textHint
            }}
          >
            <Typography sx={{ fontSize: 11, fontWeight: 600 }}>待 {pendingCount}</Typography>
          </Box>
          <Box
            sx={{
              px: '6px',
              py: '2px',
              borderRadius: '10px',
              bgcolor: printedCount > 0 ? '#E8F5E9' : '#F5F5F5',
              color: printedCount > 0 ? AppColors.successGreen : AppColors.textHint
            }}
          >
            <Typography sx={{ fontSize: 11, fontWeight: 600 }}>已 {printedCount}</Typography>
          </Box>
        </Stack>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {pendingCount > 0 && (
          <SectionRow
            label="待打印"
            bgColor="#FFF3E0"
            textColor={AppColors.pendingOrange}
            orders={pending}
            pending
            onReprint={onReprint}
            onCopy={onCopy}
          />
        )}
        {printedCount > 0 && (
          <SectionRow
            label="已打印"
            bgColor="#E8F5E9"
            textColor={AppColors.successGreen}
            orders={printed}
            onReprint={onReprint}
            onCopy={onCopy}
          />
        )}
        {pendingCount === 0 && printedCount === 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography sx={{ fontSize: 12, color: AppColors.textHint }}>暂无订单</Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

interface SectionProps {
  label: string
  bgColor: string
  textColor: string
  orders: Record<string, ShopPrintOrderItem>
  pending?: boolean
  onReprint: (orderId: string) => void
  onCopy: (text: string) => void
}

function SectionRow({ label, bgColor, textColor, orders, pending, onReprint, onCopy }: SectionProps) {
  const list = Object.values(orders)
  return (
    <Box>
      <Box sx={{ bgcolor: bgColor, px: 1, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: textColor }} />
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: textColor }}>{label}</Typography>
      </Box>
      {list.map((o) => (
        <Stack
          key={o.orderId}
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: 1,
            py: 0.5,
            transition: 'background-color .15s',
            '&:hover': { bgcolor: AppColors.headerBackground }
          }}
        >
          <Typography sx={{ fontSize: 13, fontWeight: 500 }}>#{o.daySeq}</Typography>
          {!pending && (
            <Stack direction="row" spacing={0.5}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => onReprint(o.orderId)}
                sx={{
                  minWidth: 40,
                  height: 22,
                  fontSize: 11,
                  p: 0,
                  color: AppColors.primary,
                  borderColor: AppColors.primary + '60',
                  '&:hover': { borderColor: AppColors.primary, bgcolor: AppColors.primary + '10' }
                }}
              >
                重打
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => onCopy(o.orderId)}
                sx={{
                  minWidth: 40,
                  height: 22,
                  fontSize: 11,
                  p: 0,
                  color: AppColors.primary,
                  borderColor: AppColors.primary + '60',
                  '&:hover': { borderColor: AppColors.primary, bgcolor: AppColors.primary + '10' }
                }}
              >
                复单
              </Button>
            </Stack>
          )}
        </Stack>
      ))}
    </Box>
  )
}