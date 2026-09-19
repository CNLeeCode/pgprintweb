import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, IconButton, Checkbox, FormControlLabel, LinearProgress } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import AppHeader from '../components/AppHeader'
import AppFooter from '../components/AppFooter'
import ToolCard from '../components/ToolCard'
import DevicePanel from '../components/DevicePanel'
import PlatformPanel from '../components/PlatformPanel'
import HistoryLog from '../components/HistoryLog'
import SettingPanel from '../components/SettingPanel'
import PlatformGrid from '../components/PlatformGrid'
import QueryPrintDialog from '../components/QueryPrintDialog'
import UpdateDialog from '../components/UpdateDialog'
import ApiLogDialog from '../components/ApiLogDialog'
import { useConfigStore } from '../stores/configStore'
import { usePlatformStore } from '../stores/platformStore'
import { useDeviceStore } from '../stores/deviceStore'
import { usePrintStore } from '../stores/printStore'
import { useNetworkStore } from '../stores/networkStore'
import { useUpdateStore } from '../stores/updateStore'
import { useLogStore } from '../stores/logStore'
import { useApiLogStore } from '../stores/apiLogStore'
import { electronAPI } from '../api/bridge'
import { AppColors } from '../theme/theme'
import { playRefundSound } from '../utils/audioPlayer'

/**
 * 主页（对应 KMP App.kt LoggedView + HomeHeader + PrintPlatformGrid）
 *
 * 职责：
 *  1. 启动时加载门店号/平台列表/设备列表/打印快照
 *  2. 订阅 PrintService 事件（日志/打印成功/退款/快照更新）
 *  3. 平台勾选变更时通知 PrintService 启停轮询
 *  4. 设备选择后绑定到 PrintService
 *  5. 手动重打单条订单
 */
export default function HomeView() {
  const navigate = useNavigate()
  const shopId = useConfigStore((s) => s.shopId)
  const setShopId = useConfigStore((s) => s.setShopId)
  const platforms = usePlatformStore((s) => s.platforms)
  const checkedIds = usePlatformStore((s) => s.checkedIds)
  const platformStatus = usePlatformStore((s) => s.status)
  const refreshPlatforms = usePlatformStore((s) => s.refresh)
  const toggleAll = usePlatformStore((s) => s.toggleAll)
  const refreshDevices = useDeviceStore((s) => s.refresh)
  const devices = useDeviceStore((s) => s.devices)
  const currentPrinterId = useDeviceStore((s) => s.currentPrinterId)
  const printedMap = usePrintStore((s) => s.printedMap)
  const pendingMap = usePrintStore((s) => s.pendingMap)
  const networkStatus = useNetworkStore((s) => s.status)
  const updateStatus = useUpdateStore((s) => s.status)
  const latestVersion = useUpdateStore((s) => s.version)
  const refreshVersion = useUpdateStore((s) => s.checkVersion)
  const logs = useLogStore((s) => s.logs)
  const addLog = useLogStore((s) => s.addLog)

  // 启动初始化：加载门店/平台/设备，订阅打印事件，恢复持久化
  useEffect(() => {
    useConfigStore.getState().loadShopId()
    usePlatformStore.getState().refresh()
    useDeviceStore.getState().refresh()
    // 订阅主进程打印事件（仅一次）
    usePrintStore.getState().subscribe()
    // 启动网络定时检查 + 订阅状态变更
    useNetworkStore.getState().init()
    // 启动接口日志订阅 + 拉取最近日志（Footer 接口状态指示用）
    useApiLogStore.getState().init()
    addLog('系统启动，开始监听')
    // 订阅操作日志事件
    electronAPI.on('print:log', (msg) => addLog(String(msg)))
    // 退款通知：播放提示音（冷却已在主进程处理）
    electronAPI.on('print:refund-notice', () => {
      playRefundSound()
      addLog('检测到退款通知', 'warn')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 未设置门店号则跳转登录
  useEffect(() => {
    useConfigStore.getState().loadShopId().then(() => {
      if (!useConfigStore.getState().shopId) navigate('/login', { replace: true })
    })
  }, [navigate])

  // 门店号就绪后：加载已打印订单 + 重启恢复
  useEffect(() => {
    if (!shopId) return
    electronAPI.loadPrinted(shopId).then(() => {
      usePrintStore.getState().loadSnapshots()
    })
    electronAPI.requeuePending(shopId)
  }, [shopId])

  // 平台勾选变更：通知 PrintService 启停轮询（对照 KMP App.kt LaunchedEffect）
  useEffect(() => {
    if (platforms.length === 0) return
    // 业务铁律：门店号为空时拒绝启动轮询，防止空门店拉到全部门店订单
    if (!shopId || !shopId.trim()) {
      addLog('门店号为空，暂不启动轮询')
      electronAPI.stopAllPolling()
      return
    }
    electronAPI.updatePlatforms(checkedIds, shopId)
    if (checkedIds.length === 0) {
      // 取消全部平台：停止所有轮询（对应 KMP checkedPrintPlatform.isEmpty() → stopPollingTask）
      electronAPI.stopAllPolling()
      addLog('已取消所有平台，停止轮询')
    } else {
      addLog(`已选择 ${checkedIds.length} 个平台，开始轮询`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedIds, shopId, platforms.length])

  // 离开主页前停止全部轮询 + 网络检查
  useEffect(() => {
    return () => {
      electronAPI.stopAllPolling()
      electronAPI.stopNetworkCheck()
    }
  }, [])

  const checkedPlatforms = platforms.filter((p) => checkedIds.includes(p.id))
  const allSelected = platforms.length > 0 && checkedIds.length === platforms.length

  // 查询打印对话框开关
  const [queryOpen, setQueryOpen] = useState(false)
  // 更新对话框开关（点击"发现新版本"徽章或下载完成自动打开）
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  // 接口日志弹窗开关（点击 Footer 接口状态指示器打开）
  const [apiLogOpen, setApiLogOpen] = useState(false)

  // 订阅下载完成事件：后台静默下载完成后自动弹窗提示用户重启升级
  useEffect(() => {
    const off = electronAPI.on('update:downloaded', () => {
      setUpdateDialogOpen(true)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 手动重打订单（对应 KMP PrintTask.singlePrint） */
  const onPrintDoc = async (platformId: string, orderId: string) => {
    addLog(`重打订单 ${orderId}`)
    const ok = await electronAPI.reprintOrder(platformId, shopId, orderId)
    addLog(ok ? `重打订单 ${orderId} 已入队` : `重打订单 ${orderId} 失败`, ok ? 'info' : 'error')
  }

  /**
   * 查询打印：在已打印+待打印 Map 中匹配 orderId/daySeq
   * 命中用 orderId 重打，未命中用原始输入兜底（对应 KMP DrawerContent）
   * 注意：getOrder 后端 day_seq 字段实收 orderId，故始终传 orderId
   */
  const handleQueryPrint = async (orderId: string, platformId: string) => {
    addLog(`查询打印：平台 ${platformId}，订单号 ${orderId}`)
    const ok = await electronAPI.reprintOrder(platformId, shopId, orderId)
    addLog(ok ? `查询打印 ${orderId} 已入队` : `查询打印 ${orderId} 处理失败`, ok ? 'info' : 'error')
  }

  const handleChangeShop = async () => {
    // 切换门店：先通知主进程停止轮询 + 清空运行时状态（queue/printingSet/
    // printedMap/pendingMap/retryMap），避免旧门店订单残留被错误打印。
    // 然后清空持久化的平台勾选，避免新门店继承旧门店的勾选。
    await electronAPI.switchShop()
    await usePlatformStore.getState().clearChecked()
    await setShopId('')
    navigate('/login', { replace: true })
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
      <AppHeader
        currentShop={shopId ? `当前门店：${shopId}` : '当前门店：未设置'}
        isNeedUpdate={updateStatus === 'update'}
        latestVersion={latestVersion ? ` V${latestVersion}` : ''}
        onChangeShop={handleChangeShop}
        onRefreshVersion={refreshVersion}
        onUpdateClick={() => setUpdateDialogOpen(true)}
      />
      {platformStatus === 'loading' && platforms.length === 0 && <LinearProgress />}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Box
          sx={{
            display: 'flex',
            gap: '8px',
            p: '10px',
            overflowX: 'auto',
            bgcolor: AppColors.headerBackground
          }}
        >
          <ToolCard
            title="选择打印设备"
            suffix={
              <IconButton size="small" onClick={() => refreshDevices()}>
                <RefreshIcon sx={{ fontSize: 18 }} />
              </IconButton>
            }
          >
            <DevicePanel />
          </ToolCard>
          <ToolCard
            title="选择平台"
            suffix={
              platformStatus === 'error' ? (
                <IconButton size="small" onClick={() => refreshPlatforms()}>
                  <RefreshIcon sx={{ fontSize: 18 }} />
                </IconButton>
              ) : (
                <FormControlLabel
                  control={<Checkbox size="small" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} />}
                  label="全选"
                  sx={{ '& .MuiTypography-root': { fontSize: 14 } }}
                />
              )
            }
          >
            <PlatformPanel />
          </ToolCard>
          <ToolCard title="连接信息">
            <HistoryLog logs={logs} />
          </ToolCard>
          <ToolCard>
            <SettingPanel
            onPrintTest={async () => {
              const dev = devices.find((d) => d.id === currentPrinterId)
              if (!dev) {
                addLog('请先选择打印设备', 'warn')
                return
              }
              addLog('开始打印测试')
              // 关键：传完整 PrinterTarget 对象（含 vid/pid），让主进程走 USB 直写或驱动适配
              const ok = await electronAPI.testPrint(dev)
              addLog(ok ? '打印测试成功' : '打印测试失败', ok ? 'info' : 'error')
            }}
            onOpenHistory={() => setQueryOpen(true)}
          />
          </ToolCard>
        </Box>

        {checkedPlatforms.length > 0 && (
          <PlatformGrid
            platforms={checkedPlatforms}
            printedMap={printedMap}
            pendingMap={pendingMap}
            shopId={shopId}
            onPrintDoc={onPrintDoc}
          />
        )}
      </Box>
      <AppFooter
        text={networkStatus === 1 ? '网络环境良好' : '网络环境异常'}
        online={networkStatus === 1}
        onOpenApiLog={() => setApiLogOpen(true)}
      />

      {/* 查询打印对话框（对应 KMP DrawerContent） */}
      <QueryPrintDialog
        open={queryOpen}
        onClose={() => setQueryOpen(false)}
        platforms={platforms}
        printedMap={printedMap}
        pendingMap={pendingMap}
        onPrint={handleQueryPrint}
      />

      {/* 更新对话框（方案 B：进度条 + 静默安装） */}
      <UpdateDialog
        open={updateDialogOpen}
        onClose={() => setUpdateDialogOpen(false)}
      />

      {/* 接口日志弹窗：Footer 接口状态指示器打开，含网络诊断按钮 */}
      <ApiLogDialog open={apiLogOpen} onClose={() => setApiLogOpen(false)} />
    </Box>
  )
}
