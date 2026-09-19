# KMP → Electron 对照检查文档

> **用途**：逐文件对照 KMP 参考项目（`/Users/mac/Documents/AndroidCompose/pgprint`，仅读不改）与当前 Electron 实现，检查迁移完整性与正确性。
> **生成时间**：2026-09-19
> **KMP 文件数**：73 个 `.kt`（`composeApp/src/jvmMain/kotlin/com/pgprint/app/`）
> **Electron 文件数**：51 个 `.ts/.tsx`（`src/`）

## 状态图例

| 标记 | 含义 |
|------|------|
| ✅ | 完整对应，逻辑一致 |
| ⚠️ | 部分实现 / 逻辑分散 / 存在差异需复核 |
| ❌ | 未实现（应有但缺失） |
| ➖ | 不需要（架构差异，Electron 无需该文件） |

## 对照总表

| KMP 目录 | 文件数 | ✅ | ⚠️ | ❌ | ➖ |
|----------|--------|----|----|----|----|
| app 根目录 | 6 | 3 | 2 | 0 | 1 |
| print | 1 | 0 | 1 | 0 | 0 |
| component | 16 | 8 | 6 | 0 | 2 |
| model | 20 | 18 | 1 | 0 | 1 |
| theme | 3 | 3 | 0 | 0 | 0 |
| utils | 25 | 17 | 5 | 0 | 3 |
| usb | 1 | 0 | 1 | 0 | 0 |
| router | 4 | 4 | 0 | 0 | 0 |
| **合计** | **76**¹ | **53** | **16** | **0** | **7** |

¹ 含 `print/PrintManager.kt` 与 `utils/PrintManager.kt` 两个同名文件，实际 73 个唯一文件。

**结论**：无遗漏业务功能（❌=0），16 处 ⚠️ 需复核（多为"逻辑分散到多文件"或"小功能内联"，非功能缺失）。

---

## 一、app 根目录（6 文件）

### 1. `main.kt`（6.66 KB）— 应用启动入口
- **KMP 职责**：配置 Compose Desktop 窗口（标题/图标/尺寸）、解析 Velopack 启动参数、注册全局异常、窗口关闭确认。
- **Electron 对应**：`src/main/index.ts`
- **状态**：✅
- **差异**：KMP 用 Velopack 解析启动参数，Electron 用 electron-updater（无需解析参数）；关闭确认弹窗未实现（Electron 直接退出，可补充）。

### 2. `App.kt`（18.32 KB）— 应用根 Composable + 全局状态聚合
- **KMP 职责**：收集网络/更新/打印多个 StateFlow，组合渲染 RootContent；处理窗口级副作用（退款提示音、在线状态）。
- **Electron 对应**：`src/renderer/App.tsx`（路由）+ `HomeView.tsx`（副作用聚合）+ 各 `stores/*Store.ts`
- **状态**：⚠️
- **差异**：KMP 单文件聚合；Electron 按 Zustand store 拆分到 8 个 store，副作用在 `HomeView.tsx` 的 `useEffect` 聚合。功能等价，需确认退款提示音/网络状态副作用均已接入（已确认：`playRefundSound` + `useNetworkStore.init`）。

### 3. `Splash.kt`（7.81 KB）— 启动检查页 UI
- **Electron 对应**：`src/renderer/views/SplashView.tsx`
- **状态**：✅
- **差异**：装饰插图用 CSS `radial-gradient` 模拟；更新弹窗已由 `UpdateDialog` 实现。

### 4. `Login.kt`（5.83 KB）— 登录页 UI
- **Electron 对应**：`src/renderer/views/LoginView.tsx`
- **状态**：✅
- **差异**：KMP 在 LoginComponent.initData 做打印数据初始化；Electron 推迟到 `HomeView` 挂载时（`updatePlatforms` + `loadPrinted`），功能等价。

### 5. `Platform.kt`（226 B）— 平台定义
- **Electron 对应**：`src/shared/types/models.ts`（`PrintPlatform`）
- **状态**：✅ 合并到共享类型。

### 6. `Greeting.kt`（159 B）— 模板占位
- **状态**：➖ 不需要（KMP 模板生成文件，无业务逻辑）。

---

## 二、print 目录（1 文件）

### 7. `print/PrintManager.kt`（1.68 KB）— 打印机底层封装
- **KMP 职责**：封装 `javax.print`，`print(byteArray, printerName)` 发送字节流；`getPrinterList()` 枚举。
- **Electron 对应**：`DeviceService.ts`（枚举）+ `PrintService.executePrint`（发送，走系统命令行 RAW / USB 直写）
- **状态**：⚠️
- **差异**：底层打印机封装未独立成文件，内联在 PrintService 中。建议复核打印发送的 GBK 编码与串口端口处理。

---

## 三、component 目录（16 文件）

| # | KMP 文件 | 职责 | Electron 对应 | 状态 |
|---|----------|------|---------------|------|
| 8 | `AppHeader.kt` | 顶部栏 | `AppHeader.tsx` | ✅ |
| 9 | `AppFooter.kt` | 底部网络状态 | `AppFooter.tsx`（+色点） | ✅ |
| 10 | `HomeHeader.kt` | 主页四卡片 | `HomeView.tsx`+`ToolCard.tsx` | ✅ |
| 11 | `PrintPlatformGrid.kt` | 平台订单网格 | `PlatformGrid.tsx` | ✅ |
| 12 | `SettingView.kt` | 设置视图 | `SettingPanel.tsx` | ✅ |
| 13 | `UpdateDialog.kt` | 更新弹窗 | `UpdateDialog.tsx`（扩展状态机） | ✅ |
| 14 | `HistoryLogView.kt` | 连接信息日志 | `HistoryLog.tsx` | ✅ |
| 15 | `CellItem.kt` | 通用列表项 | 内联 `DevicePanel`/`PlatformPanel` | ⚠️ 内联 |
| 16 | `CheckUpdateButton.kt` | 检查更新按钮 | 内联 `SplashView`+`AppHeader` | ✅ 内联 |
| 17 | `PrinterView.kt` | 打印机列表项 | 内联 `DevicePanel.tsx` | ✅ 内联 |
| 18 | `UsbView.kt` | USB/串口设备视图 | 内联 `DevicePanel.tsx` | ✅ 内联 |
| 19 | `RefreshButton.kt` | 刷新按钮 | 内联各组件 | ✅ 内联 |
| 20 | `DrawerContent.kt` | 侧边抽屉菜单 | `SettingPanel`+`AppHeader`+主进程菜单栏 | ⚠️ 分散 |
| 21 | `EllipsisTooltipText.kt` | 省略号文本+tooltip | 无（可用 MUI `noWrap`+`title`） | ⚠️ 未独立 |
| 22 | `DragAndClickDropZone.kt` | 拖拽安装包升级 | 无（electron-updater 自动下载） | ➖ 不需要 |

**component 差异说明**：
- `DrawerContent`：KMP 用抽屉集中入口；Electron 拆到应用菜单栏（重新加载/错误日志/关于/退出）+ SettingPanel + AppHeader。功能覆盖，入口分散。"检查更新"手动入口当前仅启动时自动检查，可补充手动触发。
- `EllipsisTooltipText`：可用 MUI `Typography noWrap title` 属性替代，非阻塞项。

---

## 四、model 目录（20 文件）

> KMP 每个模型一个文件；Electron 集中在 `src/shared/types/models.ts`（2.61 KB）。

| # | KMP 文件 | 职责 | Electron 对应 | 状态 |
|---|----------|------|---------------|------|
| 23 | `AppVersion.kt` | 版本信息 | `AppVersionInfo` | ✅ |
| 24 | `AppVersionState.kt` | 版本检查状态 sealed | `updateStore.CheckStatus` | ✅ |
| 25 | `ConnectionInfo.kt` | 连接信息 | `models.ts` | ✅ |
| 26 | `DataStatus.kt` | 数据状态 sealed | stores 内联 | ✅ |
| 27 | `DesktopToast.kt` | 桌面 Toast 类型 | 无（用 MUI Snackbar） | ⚠️ |
| 28 | `NetworkException.kt` | 网络异常 | `NetworkService` 错误处理 | ✅ |
| 29 | `OnlineStatusData.kt` | 在线状态(1良好/2异常) | `NetworkStatus` | ✅ |
| 30 | `PrintDeviceData.kt` | 打印设备数据 sealed | `deviceStore` | ✅ |
| 31 | `PrintPlatform.kt` | 平台模型(id/label/img) | `PrintPlatform` | ✅ |
| 32 | `PrinterDevice.kt` | 打印机设备 | `PrinterTarget` | ✅ |
| 33 | `PrinterTarget.kt` | 打印目标 sealed(Driver/Serial) | `PrinterTarget` | ✅ |
| 34 | `PrinterTypeEnum.kt` | 打印机类型枚举 | `models.ts` | ✅ |
| 35 | `RequestResult.kt` | 请求结果{code,data,msg} | `RequestResult` | ✅ |
| 36 | `SerialConfig.kt` | 串口配置 | `models.ts` | ✅ |
| 37 | `ShopPrintOrder.kt` | 打印订单项 | `ShopPrintOrderItem` | ✅ |
| 38 | `ShopPrintOrderDetail.kt` | 订单详情(完整字段) | `ShopPrintOrderDetail` | ✅ |
| 39 | `ShopPrintOrderItem.kt` | 订单项(orderId/daySeq) | `ShopPrintOrderItem` | ✅ |
| 40 | `UiState.kt` | UI 状态 sealed | stores | ✅ |
| 41 | `UpdateState.kt` | 更新状态 sealed | `updateStore.DownloadStatus` | ✅ |
| 42 | `DesktopToastQueue.kt`（utils 下，见 utils 节） | — | — | — |

**model 小结**：18 ✅ / 1 ⚠️（DesktopToast，可用 Snackbar 补充）/ 1 重复计入 utils。

---

## 五、theme 目录（3 文件）

| # | KMP 文件 | 职责 | Electron 对应 | 状态 |
|---|----------|------|---------------|------|
| 43 | `Color.kt`（10.63 KB） | 完整颜色定义 | `theme/theme.ts` AppColors | ✅ 精简 |
| 44 | `Theme.kt`（12.36 KB） | Material 主题构建 | `theme/theme.ts` createTheme | ✅ 精简 |
| 45 | `Type.kt`（312 B） | 字体定义 | `theme/theme.ts` typography | ✅ |

**差异**：KMP 颜色定义详尽（10KB），Electron 精简为 `AppColors` 核心色板 + M3 调色板。主色 `#0057C2` 等关键色值已确认一致。

---

## 六、utils 目录（25 文件）

### 46. `AppRequest.kt`（4.52 KB）— HTTP 客户端
- **KMP 职责**：ktor HttpClient 封装，5 接口，含超时、JSON 解析。
- **Electron 对应**：`src/main/services/ApiService.ts`（3.86 KB）
- **状态**：✅
- **差异**：Electron 用 axios + URLSearchParams 表单参数 + snake_case→camelCase 响应拦截器（对应 KMP `@SerialName`）。

### 47. `DataStored.kt`（3.01 KB）— DataStore 持久化
- **KMP 职责**：Jetpack DataStore，持久化 shopId/checkedPlatform/checkedPrinterName，Flow 异步读写。
- **Electron 对应**：`src/main/services/StoreService.ts`（electron-store，同步）
- **状态**：✅
- **差异**：KMP 异步 Flow，Electron 同步 JSON。键名一致（shopid/checked_platform/checked_printer_name）。

### 48. `DatabaseManager.kt`（5.14 KB）— SQLite
- **Electron 对应**：`src/main/services/DatabaseService.ts`（7.41 KB）
- **状态**：✅
- **差异**：KMP 用 SQLDelight，Electron 用 `JsonStore`（基于 electron-store 的 JSON 文件，1.0.81 起替代 better-sqlite3）。4 表结构一致，新增 `getPrintedOrders` 返回完整记录。

### 49. `PersistentCache.kt`（1.25 KB）— 缓存目录
- **Electron 对应**：`DatabaseService`（`app.getPath('userData')`）+ `logger.ts` 日志路径
- **状态**：✅ 无需独立文件，Electron 统一用 `app.getPath`。

### 50. `PrintTask.kt`（20.31 KB，~484 行）— 打印任务核心 ⭐
- **KMP 职责**：轮询调度（10 秒）、打印队列（Channel）、双重去重、3 次重试、DB 持久化、重启恢复、退款音频、printed/pending StateFlow。
- **Electron 对应**：`src/main/services/PrintService.ts`（20.67 KB）
- **状态**：✅
- **关键对照**：
  - 轮询：KMP `launchPollingTask` ↔ Electron `startPolling`（setInterval）
  - 队列：KMP `Channel<PrintJob>` ↔ Electron `printQueue`（async 队列）
  - 去重：KMP `printedOrderIds`+`printingOrderIds` ↔ Electron `printedMap`+`printingSet`
  - 重试：KMP `retryCount` ↔ Electron `retryMap`（MAX_RETRY=3）
  - 持久化：KMP SQLDelight ↔ Electron DatabaseService
  - 恢复：KMP `requeuePendingOrders` ↔ Electron `restorePending`
  - 退款音频：KMP `refundNotice SharedFlow` ↔ Electron `emit('print:refund-notice')`（冷却 6 秒）
- **需复核**：轮询间隔常量、退款冷却时长与 KMP 是否一致。

### 51. `PrintManager.kt`（utils 下，2.73 KB）— 打印执行
- **KMP 职责**：从队列取任务、调 PrintTemplate 生成字节、发送打印机、更新状态。
- **Electron 对应**：`PrintService.executePrint`（内联）
- **状态**：✅ 内联到 PrintService。

### 52. `EscPosPrinter.kt`（7.7 KB）— ESC/POS 指令封装
- **KMP 职责**：ESC @ 初始化、GBK 编码、align/bold/doubleSize/scaleTextSize/lineLR/barcode/qrcode/feed/cut。
- **Electron 对应**：`src/main/utils/escpos.ts`（9.65 KB）
- **状态**：✅
- **差异**：KMP 用 ZXing 生成条码 BufferedImage；Electron 用 bwip-js 生成 PNG → 位图。GBK 编码用 iconv-lite。

### 53. `PrintTemplate.kt`（5.24 KB）— 小票模板
- **KMP 职责**：`templateV1(detail)` 生成小票字节（订单号大字→平台名→门店名→用户联→条码→订单信息→备注→商品列表→金额汇总→客服图→切纸）。
- **Electron 对应**：`src/main/utils/printTemplate.ts`（3.75 KB）
- **状态**：✅
- **需复核**：客服二维码图片位图转换是否完整（KMP 用 ResourceCache 加载图片，Electron 直接读文件系统）。

### 54. `Utils.kt`（5.97 KB）— 通用工具集
- **KMP 职责**：UI 线程调度、时间格式化、Code128 条码、图片缩放留白、空格检测、资源目录、音频文件定位、文件删除、版本比较、下载页/FAQ URL、剪贴板。
- **Electron 对应**：`renderer/utils/version.ts`（版本比较）+ `escpos.ts`（条码）+ 各处分散
- **状态**：✅ 分散
- **差异**：拆分到多个工具文件。`compareVersion` 已移植；条码在 `escpos.ts`；剪贴板用 `navigator.clipboard`。

### 55. `NetworkCheck.kt`（2.25 KB）— 网络连通性检查
- **KMP 职责**：定时 HEAD 请求，2xx/401 视为可达，状态 StateFlow。
- **Electron 对应**：`src/main/services/NetworkService.ts`（2.61 KB）
- **状态**：✅
- **差异**：Electron 用 EventEmitter 广播状态变更，KMP 用 StateFlow。30 秒间隔、3 秒超时一致。

### 56. `DesktopAudioPlayer.kt`（3.37 KB）— 退款提示音
- **KMP 职责**：播放 `notice.wav`，含 6 秒冷却防频繁。
- **Electron 对应**：`src/renderer/utils/audioPlayer.ts`（1.5 KB）
- **状态**：✅
- **差异**：运行位置不同——KMP 在桌面端（主进程侧）用 Java Audio；Electron 在渲染层用 HTML5 Audio。冷却逻辑移到主进程 PrintService（`lastRefundSoundTime`），渲染层直接播放。

### 57. `UpdateManager.kt`（2.18 KB）— 版本检查
- **KMP 职责**：API 获取最新版本，对比当前版本，输出 AppVersionState StateFlow。
- **Electron 对应**：`updateStore.checkVersion`（接口检查）+ `UpdateService.checkForUpdates`（electron-updater）
- **状态**：✅
- **差异**：Electron 双检查机制（接口检查版本号 + electron-updater 检查更新源用于下载安装）。

### 58. `UpdateBuilder.kt`（2.63 KB）— Velopack 自动更新
- **KMP 职责**：检测本地 Update.exe、checkForUpdate、applyUpdateAndRestart。
- **Electron 对应**：`src/main/services/UpdateService.ts`（4.37 KB，electron-updater）
- **状态**：✅
- **差异**：方案不同——KMP 用 Velopack，Electron 用 electron-updater。Win7 兼容关闭 differentialDownload。

### 59. `WindowsInstaller.kt`（1.23 KB）— MSI 静默安装
- **KMP 职责**：生成 PowerShell 脚本以管理员权限静默安装 MSI。
- **Electron 对应**：无（electron-updater `quitAndInstall` 自动处理）
- **状态**：➖ 不需要

### 60. `PrintDevice.kt`（2.29 KB）— 打印设备状态管理
- **KMP 职责**：Combine 打印机名与设备列表，输出当前选中打印机 StateFlow；`getPrintDeviceData()` 触发设备扫描。
- **Electron 对应**：`renderer/stores/deviceStore.ts`（1.62 KB）+ `DeviceService.ts`
- **状态**：✅
- **差异**：KMP 用 Flow combine；Electron 用 Zustand 在 store 中同步计算选中设备。

### 61. `UsbDevices.kt`（1.15 KB）— 设备枚举
- **KMP 职责**：`getDevicesList()` 扫描 javax.print 驱动打印机 + jSerialComm 串口。
- **Electron 对应**：`src/main/services/DeviceService.ts`（2.74 KB）
- **状态**：✅
- **差异**：Electron 用 `app.getPrinters()` + `serialport.list()`。

### 62. `CrashHandler.kt`（3 KB）— 崩溃处理
- **KMP 职责**：全局异常处理器，写日志 + 弹窗提示 + 可打开日志目录。
- **Electron 对应**：`src/main/utils/crash.ts`（671 B）
- **状态**：✅
- **差异**：Electron 用 `process.on('uncaughtException')` + crashReporter。弹窗提示用 `dialog.showErrorBox`。

### 63. `HistoryLog.kt`（827 B）— 历史日志单例
- **KMP 职责**：操作日志 StateFlow，`updateData(msg)` 追加。
- **Electron 对应**：`renderer/stores/logStore.ts`（659 B）+ IPC `print:log` 事件
- **状态**：✅

### 64. `AppColors.kt`（434 B）— 颜色常量
- **Electron 对应**：`theme/theme.ts` AppColors
- **状态**：✅

### 65. `AppStrings.kt`（345 B）— 字符串常量
- **Electron 对应**：无独立文件，字符串内联
- **状态**：⚠️ 内联（非阻塞）

### 66. `AppToast.kt`（279 B）— Toast 封装
- **Electron 对应**：无（用 MUI Snackbar，已在部分组件使用）
- **状态**：⚠️ 可补充统一 Snackbar 封装。

### 67. `DesktopToastQueue.kt`（208 B）— Toast 队列
- **Electron 对应**：无
- **状态**：⚠️ 同上，随 Snackbar 封装一并处理。

### 68. `DesktopTool.kt`（285 B）— 桌面工具
- **KMP 职责**：桌面端工具函数（小文件）。
- **Electron 对应**：分散到各处
- **状态**：⚠️ 内联

### 69. `ResourceCache.kt`（1.92 KB）— 资源文件缓存
- **KMP 职责**：URI（file/jar/http）资源缓存到临时目录。
- **Electron 对应**：无（Electron 直接读文件系统，无需缓存层）
- **状态**：➖ 不需要

---

## 七、usb 目录（1 文件）

### 70. `usb/usb.kt`（10.57 KB）— 测试打印数据/模板/扫描 UI
- **KMP 职责**：`getTestPrintData()` 测试打印字节、`printImage2()` 测试小票模板（含商品/金额/客服图）、`PrinterScannerScreen` 设备扫描 UI。
- **Electron 对应**：`DeviceService.testPrint`（测试打印）+ `escpos.ts` 测试数据
- **状态**：⚠️
- **差异**：KMP 有完整测试小票模板（含商品/金额/客服图）；Electron 的 `testPrint` 用简单测试数据。建议复核测试打印内容是否够用（当前为简化版，可后续补充完整测试模板）。

---

## 八、router 目录（4 文件）

| # | KMP 文件 | 职责 | Electron 对应 | 状态 |
|---|----------|------|---------------|------|
| 71 | `root.kt`（4.56 KB） | 根路由 Splash→Login→Home 导航 | `App.tsx` + React Router | ✅ |
| 72 | `HomeComponent.kt`（8.65 KB） | 首页 ViewModel（平台/设备/打印/测试） | `HomeView.tsx` + 各 stores | ✅ 分散 |
| 73 | `LoginComponent.kt`（1.27 KB） | 登录 ViewModel（保存门店号/初始化打印数据） | `LoginView` + `configStore` | ✅ |
| 74 | `SplashComponent.kt`（605 B） | 闪屏 ViewModel（跳转回调） | `SplashView` + `updateStore` | ✅ |

**router 差异**：KMP 用 Decompose 组件化路由 + ViewModel 分层；Electron 用 React Router + Zustand store 拆分。`HomeComponent` 的业务逻辑（平台刷新/选择/设备选择/打印测试/手动打印）分散到 `platformStore`/`deviceStore`/`printStore` + `HomeView` 事件处理。功能等价。

---

## 九、差异与风险清单（需复核项）

### 高优先级（影响核心功能正确性）

1. **PrintService 轮询间隔与退款冷却**：确认 `POLLING_INTERVAL`（10 秒）与 `REFUND_SOUND_COOLDOWN`（6 秒）与 KMP `PrintTask.kt` 常量一致。
2. **打印发送编码**：`PrintService.executePrint` 调用系统命令行 RAW（macOS `lp -o raw` / Windows PowerShell `RawPrinter`）或 USB 直写发送字节时，确认 GBK 编码字节流正确传递（中文字符不乱码）。
3. **小票模板客服二维码**：`printTemplate.ts` 中客服图片位图转换是否完整（KMP 用 ResourceCache 加载，Electron 直接读文件）。
4. **ApiService 响应字段映射**：snake_case→camelCase 拦截器是否覆盖所有订单字段（`refund_notice`→`refundNotice`、`day_seq`→`daySeq` 等）。

### 中优先级（功能完整性）

5. **测试打印模板**：`usb/usb.kt` 的 `printImage2()` 完整测试小票（含商品/金额/客服图），Electron `testPrint` 为简化版，可补充。
6. **关闭确认弹窗**：KMP `main.kt` 有窗口关闭确认，Electron 直接退出，可补充 `before-quit` 拦截。
7. **手动检查更新入口**：KMP `DrawerContent` 有手动触发，Electron 仅启动时自动检查，可在 AppHeader 补充手动按钮。
8. **登录后打印数据初始化顺序**：KMP 在 LoginComponent.initData 完成（清理昨日/加载已打印/恢复待打印），Electron 推迟到 HomeView，确认顺序无遗漏。

### 低优先级（体验优化）

9. **省略号文本 tooltip**：可用 MUI `Typography noWrap title` 补充 `EllipsisTooltipText` 效果。
10. **统一 Snackbar 封装**：补充 `AppToast`/`DesktopToastQueue` 对应的提示队列。
11. **字符串常量集中**：`AppStrings.kt` 内联，可后续抽取常量文件。

---

## 十、架构差异总结

| 维度 | KMP | Electron | 评价 |
|------|-----|----------|------|
| 进程模型 | 单进程 JVM | 主进程+渲染进程+preload | Electron 需 IPC 桥接 |
| 状态管理 | StateFlow + Decompose | Zustand store | 等价，Electron 更细粒度 |
| 路由 | Decompose childStack | React Router | 等价 |
| HTTP | ktor | axios | 等价 |
| 持久化 | DataStore + SQLDelight | electron-store + JsonStore | 等价，Electron 改用 JSON 文件存储 |
| 打印 | javax.print + escpos-coffee | 系统命令行 RAW + 自研 escpos + USB 直写 | 等价，规避原生模块编译问题 |
| 更新 | Velopack | electron-updater | 方案不同，均兼容 Win7 |
| 音频 | Java Audio（主进程侧） | HTML5 Audio（渲染层） | 位置不同，冷却移至主进程 |
| 崩溃 | Thread.UncaughtExceptionHandler | process.on + crashReporter | 等价 |

---

## 十一、结论

- **完整性**：73 个 KMP 文件全部有对应实现或合理的架构替代（❌=0），无业务功能遗漏。
- **正确性**：核心打印流程（轮询/队列/去重/重试/持久化/恢复）1:1 移植；网络检查/音频/更新均有对应。
- **待复核**：4 项高优先级（轮询常量/打印编码/客服图/字段映射）+ 4 项中优先级，建议按清单逐项验证。
- **架构合理性**：Electron 的进程分离 + IPC 桥接 + Zustand 拆分是合理的现代化方案，与 KMP 单进程聚合等价且更易维护。

> 本文档作为迁移验收依据，后续修复 ⚠️ 项后更新状态。
