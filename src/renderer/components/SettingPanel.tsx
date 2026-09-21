/**
 * 设置面板（对应 KMP SettingView.kt）
 * 包含：管理后台跳转、打印测试、设置客服二维码（选择/预览/移除）、播放音频、查询打印、本地数据查看
 */
import { useState, useEffect } from 'react'
import {
  Stack, Button, Box, IconButton, Dialog, DialogContent, DialogTitle, DialogActions,
  Typography, Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Chip, CircularProgress
} from '@mui/material'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import RefreshIcon from '@mui/icons-material/Refresh'
import CloseIcon from '@mui/icons-material/Close'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import ImageIcon from '@mui/icons-material/Image'
import { playRefundSound } from '../utils/audioPlayer'
import { electronAPI } from '../api/bridge'
import { DOMAIN_URL } from '../config'

/** 客服二维码选择结果（主进程 kf-photo:select 返回） */
interface KfPhotoResult {
  success: boolean
  message: string
  path: string
  /** base64 data URL，供 <img src> 直接显示（绕过 file:// 同源策略） */
  dataUrl: string
}

/** 今日各表统计（store:stats 返回） */
interface StoreStats {
  date: string
  printed: number
  pending: number
  cancel: number
  connection: number
}

/** 今日全部数据（store:allData 返回） */
interface StoreAllData {
  date: string
  printed: any[]
  pending: any[]
  cancel: any[]
  connection: any[]
}

interface SettingPanelProps {
  onPrintTest: () => void
  onOpenHistory: () => void
}

/** 设置面板组件 */
export default function SettingPanel({ onPrintTest, onOpenHistory }: SettingPanelProps) {
  /**
   * 客服二维码图片 base64 data URL
   * 用 data URL 而非 file:// 路径：Chromium 同源策略禁止从 http://(dev) 或 file:// 页面
   * 加载其他 file:// 资源，file:// 会加载失败；data URL 无此限制。
   */
  const [kfDataUrl, setKfDataUrl] = useState('')
  /** 客服二维码管理弹窗开关（对应 KMP BasicAlertDialog showKFPhotoPopup） */
  const [kfManageOpen, setKfManageOpen] = useState(false)

  /** 本地数据查看弹窗开关 */
  const [dataViewOpen, setDataViewOpen] = useState(false)
  /** 各表统计 */
  const [stats, setStats] = useState<StoreStats | null>(null)
  /** 全部数据 */
  const [allData, setAllData] = useState<StoreAllData | null>(null)
  /** 数据加载中 */
  const [dataLoading, setDataLoading] = useState(false)
  /** 当前选中的 Tab（0=printed 1=pending 2=cancel 3=connection） */
  const [dataTab, setDataTab] = useState(0)

  // 初始化时读取已设置的客服二维码 data URL（对应 KMP 弹窗打开时读取 kf-photo.jpg）
  useEffect(() => {
    electronAPI.getKfPhotoDataUrl().then((d: string) => setKfDataUrl(d || ''))
  }, [])

  /**
   * 选择客服二维码图片（对应 KMP DragAndClickDropZone "点击选择文件"）
   * 主进程选文件→复制为 kf-photo.jpg→返回 dataUrl，渲染进程直接刷新预览
   */
  const handleSelect = async () => {
    const res = (await electronAPI.selectKfPhoto()) as KfPhotoResult
    if (res.success) {
      setKfDataUrl(res.dataUrl)
    } else if (!res.message.includes('取消')) {
      // 用户取消无需提示，仅失败时提示
      alert(res.message)
    }
  }

  /** 移除已设置的客服二维码（对应 KMP "移除文件" 文字链接） */
  const handleRemove = async () => {
    await electronAPI.removeKfPhoto()
    setKfDataUrl('')
  }

  /** 加载今日本地数据（统计 + 全量） */
  const handleLoadData = async () => {
    setDataLoading(true)
    try {
      const [s, d] = await Promise.all([
        electronAPI.getStoreStats(),
        electronAPI.getAllStoreData()
      ])
      setStats(s as StoreStats)
      setAllData(d as StoreAllData)
    } finally {
      setDataLoading(false)
    }
  }

  /** 打开本地数据查看弹窗 */
  const handleOpenDataView = () => {
    setDataViewOpen(true)
    handleLoadData()
  }

  /** 在系统文件管理器中打开数据目录（用编辑器查看 JSON 文件） */
  const handleOpenDir = () => {
    electronAPI.openStoreDir()
  }

  const open = (url: string) => window.open(url, '_blank')

  /** 各 Tab 的列定义（用于动态渲染表头） */
  const tabColumns: Record<string, string[]> = {
    printed: ['平台ID', '订单号', 'day_seq', '日期', '门店ID'],
    pending: ['平台ID', '订单号', 'day_seq', '日期', '门店ID', '重试次数'],
    cancel: ['平台ID', 'day_seq', '日期', '订单号', '门店ID'],
    connection: ['ID', '日期', '时间', '内容', '颜色']
  }

  /** 当前 Tab 对应的数据数组 */
  const tabData: any[] = (() => {
    if (!allData) return []
    const key = ['printed', 'pending', 'cancel', 'connection'][dataTab]
    return (allData as any)[key] || []
  })()

  /** 当前 Tab 的行单元格取值函数（字段名 → 显示值） */
  const renderCell = (row: any, colIndex: number): string => {
    const tabKey = ['printed', 'pending', 'cancel', 'connection'][dataTab]
    if (tabKey === 'connection') {
      // connection 表特殊处理：createdAt 毫秒转可读时间
      return [
        String(row.id || ''),
        row.dateText || '',
        row.createdAt ? new Date(row.createdAt).toLocaleTimeString() : '',
        row.connectionDetail || '',
        row.textColor || ''
      ][colIndex]
    }
    const fields = ['platform_id', 'order_id', 'day_seq', 'date', 'shop_id', 'retry_count']
    return String(row[fields[colIndex]] || '')
  }

  return (
    <Stack spacing={0.8} sx={{ height: '100%', overflow: 'auto', pr: 0.5 }}>
      <Button
        variant="contained"
        size="small"
        onClick={() => open(`${DOMAIN_URL}/index.php/Home/MgTest/`)}
        sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: '8px' }}
      >
        管理后台
      </Button>
      <Button
        variant="contained"
        size="small"
        onClick={onPrintTest}
        sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: '8px' }}
      >
        打印测试
      </Button>

      {/* 客服二维码：点击打开管理弹窗（对应 KMP 点击"设置客服二维码"按钮弹出 BasicAlertDialog） */}
      <Button
        variant="contained"
        size="small"
        onClick={() => setKfManageOpen(true)}
        sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: '8px' }}
      >
        设置客服二维码{kfDataUrl ? '（已设置）' : ''}
      </Button>

      {/* 播放提示音：强制播放，用于手动验证音频通道是否正常 */}
      <Button
        variant="contained"
        size="small"
        onClick={() => playRefundSound(true)}
        sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: '8px' }}
      >
        播放音频
      </Button>
      <Button
        variant="contained"
        size="small"
        onClick={onOpenHistory}
        sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: '8px' }}
      >
        查询打印
      </Button>
      {/* 本地数据查看：展示今日 JsonStore 各表统计与完整记录，支持打开数据目录 */}
      <Button
        variant="outlined"
        size="small"
        startIcon={<FolderOpenIcon />}
        onClick={handleOpenDataView}
        sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: '8px', borderColor: '#ECEDF9' }}
      >
        本地数据查看
      </Button>

      {/* 客服二维码管理弹窗（对应 KMP SettingView 的 BasicAlertDialog + DragAndClickDropZone） */}
      <Dialog open={kfManageOpen} onClose={() => setKfManageOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { minHeight: 420 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
          <span>设置客服二维码</span>
          <IconButton size="small" onClick={() => setKfManageOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pt: 1 }}>
          {/* 200x200 预览框（对应 KMP Box size 200dp border） */}
          <Box
            sx={{
              width: 200,
              height: 200,
              border: '1px solid #bdbdbd',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: '#fafafa',
              overflow: 'hidden'
            }}
          >
            {kfDataUrl ? (
              <Box
                component="img"
                src={kfDataUrl}
                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <Stack alignItems="center" spacing={1} sx={{ color: '#bdbdbd' }}>
                <ImageIcon sx={{ fontSize: 48 }} />
                <Typography variant="caption" color="text.disabled">未设置图片</Typography>
              </Stack>
            )}
          </Box>
          {/* 点击选择文件（对应 KMP "点击选择文件" 按钮） */}
          <Button
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={handleSelect}
            sx={{ width: 200 }}
          >
            点击选择文件
          </Button>
          {/* 移除文件（对应 KMP "移除文件" 文字链接） */}
          <Button
            variant="text"
            size="small"
            color="inherit"
            disabled={!kfDataUrl}
            onClick={handleRemove}
            sx={{ color: '#9e9e9e', textTransform: 'none' }}
          >
            移除文件
          </Button>
        </DialogContent>
      </Dialog>

      {/* 本地数据查看弹窗 */}
      <Dialog open={dataViewOpen} onClose={() => setDataViewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>本地数据查看 {stats?.date ? `（${stats.date}）` : ''}</span>
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<RefreshIcon />} onClick={handleLoadData} disabled={dataLoading}>
              刷新
            </Button>
            <Button size="small" startIcon={<FolderOpenIcon />} onClick={handleOpenDir}>
              打开目录
            </Button>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {dataLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : (
            <>
              {/* 各表统计概览 */}
              {stats && (
                <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                  <Chip label={`已打印 ${stats.printed}`} color="success" variant="outlined" size="small" />
                  <Chip label={`待打印 ${stats.pending}`} color="warning" variant="outlined" size="small" />
                  <Chip label={`已取消 ${stats.cancel}`} color="error" variant="outlined" size="small" />
                  <Chip label={`连接日志 ${stats.connection}`} color="info" variant="outlined" size="small" />
                </Stack>
              )}
              {/* Tab 切换各表数据 */}
              <Tabs value={dataTab} onChange={(_, v) => setDataTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 1 }}>
                <Tab label={`已打印 (${stats?.printed ?? 0})`} />
                <Tab label={`待打印 (${stats?.pending ?? 0})`} />
                <Tab label={`已取消 (${stats?.cancel ?? 0})`} />
                <Tab label={`连接日志 (${stats?.connection ?? 0})`} />
              </Tabs>
              {tabData.length === 0 ? (
                <Typography sx={{ textAlign: 'center', py: 3, color: '#999' }}>暂无数据</Typography>
              ) : (
                <TableContainer component={Paper} sx={{ maxHeight: 360 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        {tabColumns[['printed', 'pending', 'cancel', 'connection'][dataTab]].map((h) => (
                          <TableCell key={h} sx={{ fontWeight: 700, bgcolor: '#F5F5F5' }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {tabData.map((row, i) => {
                        const cols = tabColumns[['printed', 'pending', 'cancel', 'connection'][dataTab]]
                        return (
                          <TableRow key={i} hover>
                            {cols.map((_, ci) => (
                              <TableCell key={ci}>{renderCell(row, ci)}</TableCell>
                            ))}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDataViewOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}