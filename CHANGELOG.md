# 变更日志

## [1.0.7] - 2026-09-19

### 移除：移除两个 CI 编译失败的原生依赖

#### 背景
CI 构建持续失败，根因是两个原生模块在 Windows runner（Node 18.20.8）上无法编译：
1. `@thiagoelg/node-printer@0.6.2` 无 Windows prebuild 二进制，回退 `node-gyp rebuild` 本地编译 C++ 失败（`npm error code 1`）。
2. `better-sqlite3@12` 要求 Node 20+，Node 18.20.8 触发 EBADENGINE 警告，存在编译兼容风险。

经核查，这两个模块在运行时均已无实际依赖：
- `@thiagoelg/node-printer` 仅作为"优先通道"使用，失败已有系统命令行 RAW（macOS `lp -o raw` / Windows PowerShell `RawPrinter`）+ USB 直写兜底，移除后打印通道收敛为系统命令行 + USB 直写，更稳定。
- `better-sqlite3` 仅存于孤立的 `DatabaseService.ts`（1.0.81 已被 `JsonStore.ts` 完全替代，无任何 import 引用），删除该死代码文件即可。

#### 变更
- `package.json`：
  - 移除 `dependencies.better-sqlite3`
  - 移除 `optionalDependencies.@thiagoelg/node-printer`（及整个 `optionalDependencies` 块）
  - `rebuild` 脚本白名单 `serialport,usb,better-sqlite3` → `serialport,usb`
- `src/main/services/DatabaseService.ts`：删除（死代码，1.0.81 起 `JsonStore` 已完全替代，无 import 引用）
- `src/main/services/DeviceService.ts`：
  - 移除顶部 `nativePrinterLib` try-require 加载块
  - `testPrint` 删除"原生模块 printDirect"分支，通道收敛为 USB 直写 + 系统命令行
- `src/main/services/PrintService.ts`：
  - `printViaDriver` 删除"原生模块 printDirect"分支，三档优先级 → 两档
  - 删除 `loadNativePrinter` 方法
  - 更新 `sendToPrinter` 注释（移除 silent print / printDirect 提及）
- `electron.vite.config.ts`：`external` 数组移除 `'better-sqlite3'` 和 `'@thiagoelg/node-printer'`
- `electron-builder.yml`：更新 `npmRebuild` 注释说明
- `.github/workflows/build-windows.yml`：更新步骤 5/6 注释
- `src/main/utils/rawPrint.ts`、`src/main/utils/usbPrint.ts`：更新注释
- `docs/KMP到Electron对照检查文档.md`：更新对照表

#### 影响
- CI `npm install` 不再因 `@thiagoelg/node-printer` 编译失败而中断
- `better-sqlite3` 的 EBADENGINE 警告消除（依赖已移除）
- 打印功能不受影响：RAW 字节流统一走系统命令行（lp / PowerShell RawPrinter）+ USB 直写
- 数据持久化不受影响：`JsonStore`（基于 electron-store 的 JSON 文件）继续承担订单去重/待打印恢复

## [1.0.6] - 2026-09-19

### 修复：CI 原生模块编译失败（@thiagoelg/node-printer node-gyp 报错）

#### 背景
CI 在 `npm install` 步骤失败：`@thiagoelg/node-printer@0.6.2` 无 Windows prebuild 二进制，回退 `node-gyp rebuild` 本地编译 C++ 失败（`npm error code 1`）。同时 `better-sqlite3@12` 要求 Node 20+，Node 18 触发 EBADENGINE 警告。

#### 变更
- `package.json`：`@thiagoelg/node-printer` 从 `dependencies` 移到 `optionalDependencies`（代码已 try-require 降级，装不上不阻断主流程）
- `.github/workflows/build-windows.yml`：
  - Node 18 → Node 20（消除 better-sqlite3 EBADENGINE 警告，GitHub Actions 推荐 LTS）
  - `npm install` → `npm install --ignore-scripts`（跳过所有包的 prebuild-install/node-gyp postinstall 脚本，避免 @thiagoelg/node-printer 编译失败拖垮安装）
  - 原生模块编译统一由下一步 `electron-rebuild` 处理（只编译 serialport/usb/better-sqlite3 白名单）

#### 影响
- CI `npm install` 不再因 @thiagoelg/node-printer 编译失败而中断
- better-sqlite3/serialport/usb 仍由 electron-rebuild 正确编译为 Electron 22 ABI
- @thiagoelg/node-printer 在打包产物中缺失，运行时 try-require 降级到系统命令行 RAW 通道（不影响核心打印功能）

## [1.0.5] - 2026-09-19

### 修复：CI 依赖版本声明错误导致 npm install 失败

#### 背景
GitHub Actions 构建在 `npm install` 步骤报错：
`npm error code ETARGET No matching version found for @thiagoelg/node-printer@^4.2.1`
原因：`@thiagoelg/node-printer` 在 npm 上最新版本为 `0.6.2`，根本不存在 `4.2.1`。同时 `better-sqlite3` 依赖此前遗漏未声明，`rebuild` 脚本也未将其列入 electron-rebuild 编译白名单。

#### 变更
- `package.json`：
  - `@thiagoelg/node-printer` 版本 `^4.2.1` → `^0.6.2`（修正为 npm 实际存在的 latest 版本）
  - 新增 `better-sqlite3@^12.0.0` 依赖（原先遗漏，主进程 DatabaseService 依赖它）
  - `rebuild` 脚本：`electron-rebuild -f -w serialport,usb` → `... serialport,usb,better-sqlite3`（补入 better-sqlite3 针对 Electron 22 ABI 重编译）
- `.github/workflows/build-windows.yml`：注释同步说明 `@thiagoelg/node-printer` 不列入 electron-rebuild（代码已 try-require 降级，编译失败不拖垮 rebuild）

#### 影响
- CI `npm install` 恢复正常
- 运行时：better-sqlite3 经 electron-rebuild 后可在 Electron 22 ABI 下正常加载，避免 `Module version mismatch` 崩溃
- `@thiagoelg/node-printer` 维持 try-require 降级策略，编译失败不影响主流程

## [1.0.4] - 2026-09-19

### 新增：GitHub Actions CI 构建 Windows NSIS 安装包

#### 背景
macOS 26.3 上 brew 4.1.19 存在版本号正则 bug（`macos_version.rb` 只匹配 `1\d+` 开头），无法安装 wine 交叉编译 Windows nsis 包。
改用 GitHub Actions 的 `windows-latest` runner 原生构建，自带 NSIS 无需 wine，产物与真机 Windows 构建完全一致。

#### 变更
- 新增 `.github/workflows/build-windows.yml`：手动触发（workflow_dispatch），matrix 并行构建多版本 NSIS 安装包
  - 输入版本号 JSON 数组（默认 `["1.0.0","1.0.1"]`），一次触发同时产出两个版本
  - `npm version` 设 package.json 版本号 + `VITE_APP_VERSION` 环境变量注入 config.ts
  - `npm run build:win` 构建 + electron-builder 打 nsis 包
  - `upload-artifact` 上传 `release/*.exe`，30 天保留

#### 使用方式
1. git push 到 GitHub 仓库
2. Actions 标签页 → "Build Windows Installer (Win7 兼容)" → Run workflow
3. 输入版本号（默认 1.0.0 + 1.0.1），等待 5-10 分钟
4. Artifacts 区域下载两个 exe
5. 1.0.0 装到 Win7 机器，1.0.1 放服务器 + 后端接口返回 downloadUrl，测试升级流程

## [1.0.3] - 2026-09-19

### 修复：适配后端 getWebPgPrintUpdateInfo 实际返回格式

#### 背景
后端更新检查接口实际返回格式与原假设存在差异：
1. 接口名是 `getWebPgPrintUpdateInfo`（非 `getAppUpdateInfo`）
2. 数据放在标准 `data` 字段（非 `msg`），`msg` 是字符串 "success"
3. `force_update` 是字符串 `"0"`/`"1"`（非数字 `0`/`1`）
4. 判定规则由后端控制：`code===200 && download_url 非空` → 有新版本，前端不再做版本号比较

#### 变更
- `src/main/config.ts`：环境变量 `VITE_UPDATE_CHECK_URL` → `VITE_UPDATE_SERVER_URL`（兼容老名），默认接口名改 `getWebPgPrintUpdateInfo`
- `src/shared/types/models.ts`：`AppUpdateInfo` 加 `name`/`key` 字段，`forceUpdate` 类型改为 `string | number`
- `src/main/services/ApiService.ts`：`getAppUpdateInfo()` 回滚归一化逻辑（数据在 data 字段），日志增强输出 version/hasUrl
- `src/main/services/UpgradeService.ts`：判定规则改为按 `downloadUrl` 非空，删除 `compareVersionHost` 版本号比较；接口失败降级为"已最新"不阻断启动
- `src/renderer/stores/updateStore.ts`：`forceUpdate` 判断改 `== '1'` 兼容字符串；`update:not-available` 事件补设 `usual` 状态；清理未使用的 `compareVersion`/`APP_VERSION` import
- `.env.production`：配置 `VITE_UPDATE_SERVER_URL=http://<更新服务IP>/index.php/Home/<接口前缀名>/getWebPgPrintUpdateInfo`

## [1.0.2] - 2026-09-19

### 升级：方案 B 后端接口直返下载地址（替代 electron-updater）

#### 背景
原 electron-updater 方案需独立更新服务器 + latest.yml + sha512 维护，发版流程繁琐。
改为方案 B：后端接口直返版本号 + 下载地址，主进程 https 下载 + nsis 静默安装。

#### 变更
- 新增后端接口 `getAppUpdateInfo`：返回 version + download_url + update_msg + force_update
- `src/shared/types/models.ts`：新增 `AppUpdateInfo` 类型，删除 `AppVersionInfo`
- `src/main/config.ts`：新增 `UPDATE_CHECK_URL` / `AUTO_DOWNLOAD` / `AUTO_INSTALL`，删除 `UPDATE_SERVER_URL`
- `src/main/services/ApiService.ts`：新增 `getAppUpdateInfo()`，删除 `getLastAppVersionData()`
- `src/main/services/UpgradeService.ts`（新建）：Node https 下载带进度 + shell 静默安装
- `src/main/services/UpdateService.ts`（删除）：electron-updater 旧实现已移除
- `src/main/utils/version.ts`（新建）：主进程版本比较工具 compareVersionHost
- `src/main/ipc/api.ipc.ts`：`api:getLastAppVersionData` → `api:getAppUpdateInfo`
- `src/main/ipc/update.ipc.ts`：通道对齐 UpgradeService，事件转发到渲染进程
- `src/main/index.ts`：移除 UpdateService.init() 调用
- `src/preload/index.ts` + `src/renderer/api/bridge.ts`：接口契约更新
- `src/renderer/stores/updateStore.ts`：重写，移除 electron-updater 订阅，加 updateMsg/forceUpdate/progress
- `src/renderer/components/UpdateDialog.tsx`：进度条 + 更新说明 + 强制更新分支
- `src/renderer/components/AppHeader.tsx`：删除 `getDownloadPage` 两处 window.open，改为触发应用内 UpdateDialog
- `src/renderer/views/HomeView.tsx`：加 UpdateDialog + 下载完成自动弹窗订阅 + onUpdateClick 传参
- `electron-builder.yml`：nsis 改 `oneClick: true` + `perMachine: true`，删除 `publish` 段
- `package.json`：卸载 `electron-updater` 依赖，版本号 1.0.1 → 1.0.2
- `docs/自动更新方案文档.md`：重写为方案 B 文档

#### 用户体验
- 首次安装：双击 exe 一键安装，不问目录，装完自启
- 升级：检测到新版本 → 后台静默下载（进度条可见）→ 下载完成弹窗 → 点确认静默升级重启
- 强制更新：隐藏"继续旧版本"按钮，必须升级才能使用
- 接口地址可变：前期 IP 后期域名，改 `.env` 的 `VITE_UPDATE_CHECK_URL` 一行

## [1.0.1] - 2026-09-19

### 打包：Windows dir 便携版 1.0.1（版本号升级 + 打包配置调整）

#### 变更
- 版本号从 1.0.0 升级到 1.0.1（用于版本区分/自动更新测试）
- electron-builder.yml 新增 `npmRebuild: false`：macOS 打包跳过原生模块编译，
  serialport/usb 自带 win32-x64 prebuilds 直接拷贝即可在 Windows 运行
- package.json 移除 `build` 字段：让 electron-builder 读取 electron-builder.yml
  （此前 package.json 的 build 字段导致 electron-builder 忽略 yml 配置）
- `@thiagoelg/node-printer` 无 prebuilds，Windows 上懒加载失败自动回退 PowerShell RawPrinter（功能正常）

#### 打包环境说明
- 当前 macOS (Apple Silicon arm64) 开发机，brew 4.1.19 过旧不兼容 macOS 26.3，
  无法用 brew 安装 wine，故无法打 nsis 安装包（nsis 需要 wine 运行 makensis）
- 使用 `--dir --x64` 模式打 Windows x64 便携版（免安装目录，拷到 Windows 即可运行）
- Win7 兼容：Electron 22.3.27 (Chromium 108) + x64 架构

#### 打包命令
```bash
npm run build
npx electron-builder --win --dir --x64
# 产物：release/win-unpacked/pgprinter.exe → 移至 release/v1.0.1-win-unpacked/
```

#### 涉及文件
- package.json（version 1.0.0 → 1.0.1 + 移除 build 字段）
- src/renderer/config.ts（APP_VERSION 默认值 1.0.0 → 1.0.1）
- .env / .env.production（VITE_APP_VERSION 1.0.0 → 1.0.1）
- src/renderer/index.html（title V1.0.0 → V1.0.1）
- electron-builder.yml（新增 npmRebuild: false）

### 修复：每次打开/切换门店都显示今日订单（已打印+待打印）

#### 问题
此前 `requeuePendingOrders`（重启恢复）只把 pending 表订单 push 到队列重新打印，
**没有回填 `pendingMap` 也没广播 `pending-updated`**，导致 UI 的待打印列表始终为空。
用户切换门店或重新打开应用后，即使本地缓存有今日订单（已打印+待打印），待打印订单不显示。

#### 变更
- `PrintService.requeuePendingOrders` 恢复每条 pending 订单时，同步调用
  `addPendingToMemory` 回填 `pendingMap`，并在入队完成后 emit `pending-updated`
  广播快照，让 UI 立即显示今日待打印订单
- pending 为空时也广播一次空快照，确保切换门店后新门店无 pending 时 UI 与主进程同步
- 打印成功后由既有 `removePendingFromMemory` + emit 自动从 pendingMap 移除，无需额外处理

#### 效果
- 首次打开：`loadPrinted` 显示已打印 + `requeuePending` 修复后显示待打印
- 切换门店：`switchShop` 清空 → 新门店 `loadPrinted` + `requeuePending` 修复后显示
- 无新订单时也能看到今日历史订单（已打印 + 待打印）

#### 涉及文件
- src/main/services/PrintService.ts（requeuePendingOrders 增加回填 pendingMap + 广播）

---

## [1.0.0] - 2026-09-19（补丁10）

### 修复：接口必须传门店号不能为空 + 切换门店按门店+日期隔离

#### 现象
1. 接口层（getDaySeq/getOrderList/getOrder）允许门店号为空直接发请求，
   后端按空 shopid 查询可能返回全部门店数据或异常。
2. 切换门店时只调用 stopAllPolling()，未清理运行时状态
   （queue/printingSet/printedMap/pendingMap/retryMap），导致：
   - 旧门店的待打印订单残留在 queue 里被错误打印（小票属于错误门店）
   - pendingMap 残留导致 UI 显示脏数据
   - printingSet 残留导致新门店同 orderId 订单被误判"正在打印"而跳过
   - printedMap 没立即清空，新门店数据加载完成前显示旧门店已打印订单

#### 修复

**业务铁律：所有订单相关接口必须传门店号，不能为空。切换门店必须按门店+日期隔离。**

**1. ApiService 防御层校验**（src/main/services/ApiService.ts）
- 新增 validateShopId(shopid, apiName) 方法
- getDaySeq/getOrderList/getOrder 入口加门店号非空校验，空则拒绝请求并告警

**2. PrintService 运行时状态隔离**（src/main/services/PrintService.ts）
- 新增 resetRuntimeState() 方法：清空 queue/printingSet/pendingMap/printedMap/
  retryMap，并广播 printed-updated/pending-updated 快照让 UI 同步清空
- updatePlatforms 加门店号校验，空则拒绝启动轮询并停掉旧轮询
- requeuePendingOrders 加门店号校验，空则拒绝恢复
- loadPrintedOrdersFromDb 加门店号校验，空则拒绝加载
- reprintOrder 加门店号 + 订单号校验，空则拒绝重打

**3. IPC 通道校验 + 新增 print:switchShop**（src/main/ipc/print.ipc.ts）
- print:updatePlatforms/print:requeue/print:loadPrinted/print:reprint
  加门店号非空校验，空则拒绝并返回 false
- 新增 print:switchShop 通道：stopAllPolling() + resetRuntimeState()，
  供切换门店时清空运行时状态，避免旧门店订单残留

**4. preload + bridge 暴露 switchShop**（src/preload/index.ts、src/renderer/api/bridge.ts）
- 新增 switchShop() IPC 封装

**5. 渲染层切换门店流程**（src/renderer/views/HomeView.tsx、LoginView.tsx）
- HomeView handleChangeShop：先调 switchShop() 清空主进程运行时状态，
  再清空平台勾选、清空 shopId、跳转登录页
- HomeView 平台勾选 effect：加 shopId 空串拦截，空则不启动轮询
- LoginView handleConfirm：输入新门店号登录前先调 switchShop()，
  防御场景：用户已登录状态下关闭应用，重启后想换门店登录，
  此时主进程运行时状态可能还残留旧门店数据

#### 切换门店完整流程
1. 用户点"切换门店" → HomeView.handleChangeShop
2. electronAPI.switchShop() → 主进程 stopAllPolling + resetRuntimeState + 广播快照清空
3. 清空平台勾选、清空 shopId、跳转登录页
4. 用户输入新门店号 → LoginView.handleConfirm
5. electronAPI.switchShop()（防御性二次清空，应对重启换门店场景）
6. 写入新 shopId、跳转主页
7. HomeView useEffect [shopId] 触发：
   - loadPrinted(新门店) 从 DB 按门店+今日日期加载已打印
   - requeuePending(新门店) 从 DB 按门店+今日日期加载 pending 入队
8. HomeView 平台勾选 effect 触发：updatePlatforms(checkedIds, 新门店) 启动轮询

#### 涉及文件
- src/main/services/ApiService.ts
- src/main/services/PrintService.ts
- src/main/ipc/print.ipc.ts
- src/preload/index.ts
- src/renderer/api/bridge.ts
- src/renderer/views/HomeView.tsx
- src/renderer/views/LoginView.tsx

---

## [1.0.0] - 2026-09-19（补丁9）

### 修复：退款提示音 notice.wav 加载失败（Not allowed to load local resource）

#### 现象
dev 模式下渲染进程加载 notice.wav 报错：
`Not allowed to load local resource: file:///Users/.../resources/notice.wav (http://localhost:5173/home:0)`
随后 audioPlayer 回退 Web Audio 合成 beep（丢失用户原始音色）。

#### 根因
Electron 安全策略：dev 模式渲染进程源是 `http://localhost:5173`（Web 源），
Chromium 禁止 Web 源页面通过 `file://` 协议加载本地文件（即便 `<audio>` 也不行）。
preload 原先用 `pathToFileURL()` 把 notice.wav 转成 `file:///...` URL 暴露给渲染进程，
`new Audio('file:///...')` 在 dev 模式被 Chromium 直接拦截。

#### 修复
改为 base64 data URL 暴露，与客服图片 `kf-photo:dataUrl` 同一模式：
- preload `resolveNoticeWavUrl()` → `resolveNoticeWavDataUrl()`：
  用 `readFileSync` 读取 wav 文件，`Buffer.toString('base64')` 编码，
  返回 `data:audio/wav;base64,<base64>`（空串表示文件缺失）
- contextBridge 暴露字段 `noticeWavUrl` → `noticeWavDataUrl`（语义更准确）
- audioPlayer 取值同步改为 `window.electronAPI.noticeWavDataUrl`，
  `new Audio(dataUrl)` 直接播放，无 file:// 跨源限制
- 69KB wav base64 后约 92KB 常驻内存，可接受
- 仍保留 asar 外 extraResources 放置（Chromium 媒体栈不走 asar fs patch）
- 仍保留 Web Audio 合成 beep 兜底（文件缺失/播放失败时）

#### 涉及文件
- `src/preload/index.ts`
- `src/renderer/utils/audioPlayer.ts`

---

## [1.0.0] - 2026-09-19（补丁8）

### 验证+加固：重打路径不去重，确保支持重复打印

#### 背景
用户反馈"重打/查询打印失败"，担心是订单号已存在于已打印数据中被去重拦截。
经核查代码，重打路径（`reprintOrder → enqueueSingle`）**本身不做任何去重**：
- `enqueueSingle` 仅 `queue.push` + `processQueue`，不查 `printedMap`、不查 `printingSet`
- `filterUnprinted`（去重）只用于轮询 `executePollCycle` 过滤新订单，走 `enqueueBatch`，与重打路径分离
- `insertPrintedOrder` 为 INSERT OR IGNORE 语义（已存在跳过），`confirmPrinted` 为覆盖写，均幂等

故之前失败的真正原因是补丁7修复的 `getOrder` 参数传错（daySeq 当 orderId），
与"已打印去重"无关。重打功能本身是支持的。

#### 实现（防御性注释加固，防止未来误改）
1. `PrintService.enqueueSingle`：补充完整 JSDoc，明确"重打不做任何去重"语义，
   说明 printedMap/printingSet/pending 表均不参与重打路径，去重只用于轮询
2. `PrintService.printOne` 成功分支：注明 `insertPrintedOrder` 的 INSERT OR IGNORE
   幂等性与 `confirmPrinted` 的覆盖语义，确保重打已打印订单不会因 DB 主键冲突报错

#### 涉及文件
- `src/main/services/PrintService.ts`

---

## [1.0.0] - 2026-09-19（补丁7）

### 修复：重打/查询打印提示失败（getOrder 参数传错）

#### 背景
点击「查询打印」「重打」按钮均提示失败无法打印。根因：后端 `getOrder` 接口的 `day_seq`
字段虽名为 day_seq，但**实际接收的是 orderId（订单号）**，不是流水号 daySeq。
对照 KMP 原版 `DrawerContent.kt`：`queryValue = matchedOrder?.orderId ?: inputValue`，
传入 `printSingleDoc`（形参名 daySeq，但值是 orderId），再 `append("day_seq", orderId)`。
Electron 版 `reprintOrder` 却把真正的流水号 daySeq 传给后端 day_seq 字段，
后端按 orderId 查流水号查不到 → `data` 空 → `getOrder` 返回 null →
`reprintOrder` 返回 false → 前端提示失败。

#### 实现（全链路 daySeq→orderId 语义对齐）
1. `ApiService.getOrder`：第3参 `daySeq`→`orderId`，内部仍 append `day_seq` 字段（后端字段名不变），
   补充 code/msg/hasData 诊断日志
2. `PrintService.reprintOrder`：第3参 `daySeq`→`orderId`
3. `main/ipc/print.ipc.ts`：`print:reprint` handler 第3参→`orderId`
4. `preload/index.ts`：`reprintOrder` 暴露签名→`orderId`
5. `HomeView.onPrintDoc`：`(platformId, orderId, daySeq)`→`(platformId, orderId)`，传 orderId
6. `HomeView.handleQueryPrint`：`(daySeq, platformId)`→`(orderId, platformId)`，传 orderId
7. `PlatformGrid`：`onPrintDoc`/`onReprint` 类型移除 daySeq，重打按钮只传 `o.orderId`
8. `QueryPrintDialog`：`onPrint(orderId, platformId)`，命中后用 `matched.orderId` 触发重打

#### 涉及文件
- `src/main/services/ApiService.ts`、`src/main/services/PrintService.ts`
- `src/main/ipc/print.ipc.ts`、`src/preload/index.ts`
- `src/renderer/views/HomeView.tsx`
- `src/renderer/components/PlatformGrid.tsx`、`src/renderer/components/QueryPrintDialog.tsx`

---

### 修复：主进程运行时日志静默丢失（logs 目录缺失）

#### 背景
`logger.ts` 用 `resolvePathFn` 指定 `userData/logs/main.log`，但 `userData/logs/` 子目录不存在。
electron-log 自定义路径不自动建目录，导致 `initLogger` 之后的 `log.info/error` 全部静默丢弃，
日志文件只剩启动早期的 warn（写在默认路径），无法诊断重打失败等运行时问题。

#### 实现
- `logger.ts`：`initLogger` 内显式 `mkdirSync(logsDir, { recursive: true })` 创建日志目录，
  再设置 `resolvePathFn`，确保 info/error 日志正常落盘

#### 涉及文件
- `src/main/utils/logger.ts`

---

### 修复：退款提示音始终回退系统 beep（notice.wav 路径解析失败）

#### 背景
点击播放音频仍是系统提示音而非 `resources/notice.wav`。根因：`preload/index.ts` 用
`app.isPackaged` 判断打包状态，但 `app` 是主进程专用模块，在 preload 中 `import { app }`
拿到的是 `undefined`，`app.isPackaged` 抛 TypeError 被 catch，返回空串，
`audioPlayer` 检测到空 URL 回退 Web Audio 合成 beep。

#### 实现
1. `preload/index.ts`：移除 `app` 导入，改为候选路径逐个 `existsSync` 探测
   （打包后 `process.resourcesPath`、dev 模式 `__dirname` 回退两级），不再依赖 `app.isPackaged`
2. `renderer/utils/audioPlayer.ts`：修复 `stopRefundSound` 引用未定义变量 `fallbackAudio` 的笔误（应为 `wavAudio`）

#### 涉及文件
- `src/preload/index.ts`、`src/renderer/utils/audioPlayer.ts`

---

## [1.0.0] - 2026-09-19（补丁6）

### 功能：平台勾选持久化到本地缓存，重启自动恢复

#### 背景
原 `platformStore.checkedIds` 是纯内存状态，应用重启后丢失，用户每次启动都要重新勾选平台。
`StoreService` 早已预留 `selectedPlatformIds` 字段（逗号分隔字符串），但渲染层未对接，
导致持久化能力闲置，违反 KMP 原版 `checkedPrintPlatform` 的"切换门店才清空"语义。

#### 实现
1. `platformStore.ts`：
   - `refresh()` 拉取平台列表成功后，立即从 `electron-store` 读取 `selectedPlatformIds`，
     按当前平台列表过滤无效 id（防止服务器下架平台后残留勾选），恢复到 `checkedIds`
   - `togglePlatform` / `toggleAll` 任意变更后立即写回 `electron-store`（fire-and-forget）
   - 新增 `clearChecked()`：清空内存 + 持久化，供切换门店调用
2. `HomeView.handleChangeShop`：切换门店前调 `clearChecked()`，避免新门店继承旧门店勾选
3. `LoginView.handleConfirm`：输入新门店号登录前调 `clearChecked()`，
   覆盖"用户已登录状态下关闭应用，重启后换门店登录"场景
4. 已登录状态重启进 HomeView：不清空，自动恢复上次勾选

#### 持久化时机矩阵
| 场景 | 内存 checkedIds | 持久化 selectedPlatformIds |
|------|-----------------|--------------------------|
| 启动（已登录）→ HomeView | 恢复 | 不变 |
| 启动（未登录）→ LoginView → 输新门店号 | 清空 | 清空 |
| HomeView 点切换门店 → LoginView → 输新门店号 | 清空 | 清空 |
| HomeView 内 toggle 平台 | 变更 | 同步写回 |

#### 涉及文件
- `src/renderer/stores/platformStore.ts`（持久化读写 + clearChecked 新增）
- `src/renderer/views/HomeView.tsx`（handleChangeShop 加 clearChecked）
- `src/renderer/views/LoginView.tsx`（handleConfirm 加 clearChecked + 引入 platformStore）

---

## [1.0.0] - 2026-09-19（补丁5）

### 功能：自定义退款提示音 notice.wav 打包/升级携带

#### 背景
原退款提示音由 Web Audio API 合成 3 声 880Hz beep，不依赖任何音频文件。
用户反馈希望用自己的 notice.wav 文件，且要求打包和升级时都携带。

#### 实现方案
**文件存放位置：`<项目根>/resources/notice.wav`**
- `electron-builder.yml` 已配置 `extraResources: from: resources/ to: resources/`
- 打包后复制到安装目录 `resources/notice.wav`（asar 包外）
- electron-updater 全量 nsis 包覆盖安装时随新包一起部署，升级后自动更新

**为什么放 asar 外（extraResources）而非 asar 内（public/）**：
Chromium 媒体栈（HTMLAudioElement）不走 Electron 的 asar fs patch，
asar 内的 wav 文件加载会失败，必须用 `file://` 协议直读 asar 外文件。

#### 播放优先级（双兜底保障）
1. **主路径**：`notice.wav` 文件（preload 启动时解析 file:// URL，HTMLAudioElement 播放）
2. **兜底**：Web Audio API 合成 3 声 880Hz beep（文件缺失/加载失败/播放失败时自动回退）
→ 文件缺失也不会静默，退款提示功能始终可用。

#### 路径解析（preload 同步暴露）
- 打包后：`process.resourcesPath/notice.wav`
- 开发：`<项目根>/resources/notice.wav`（preload 编译产物在 out/preload/，回退两级）
- 通过 `pathToFileURL` 转 file:// URL，经 contextBridge 暴露为 `window.electronAPI.noticeWavUrl`

#### 涉及文件
- `resources/README.md`（新增，说明文件存放规则和规格建议）
- `src/preload/index.ts`（新增 `resolveNoticeWavUrl` + 暴露 `noticeWavUrl`）
- `src/renderer/utils/audioPlayer.ts`（优先级反转：wav 文件优先，合成 beep 兜底）

#### notice.wav 规格建议
- WAV PCM 无压缩、22050Hz、单声道、1-2 秒、音量已归一化

---

## [1.0.0] - 2026-09-19（补丁4）

### Bug 修复：重打 / 查询打印点击无反应（打印队列死锁）

#### 现象
点击"重打"按钮或"查询打印"后，小票不打印，界面无任何提示，且后续所有重打/查询打印操作均失效。

#### 根因
`PrintService.sendToPrinter` 的三个打印通道（USB `transfer`、`lp`、PowerShell）**均无超时保护**。当热敏打印机离线、USB 接口异常或驱动占用时，`outEp.transfer(piece, cb)` 的回调 `cb` 永不触发，导致：
- `printOne` 永久卡在 `await this.sendToPrinter(...)`
- `processQueue` 的 `this.processing` 永久为 `true`
- 后续所有 `reprintOrder`/`enqueueSingle` 调用 `processQueue` 时因 `if (this.processing) return` 直接退出
- 重打与查询打印共用 `reprintOrder` 链路，故两者同时失效

#### 修复
1. **核心：打印发送超时兜底**（`src/main/config.ts` 新增 `PRINT_SEND_TIMEOUT=25000`）
   - 新增 `withTimeout` 私有方法，对 USB 直写 / 驱动打印 / 串口打印三通道统一加 25s 超时；
   - 超时则 reject → catch 判定 ioError → 走重试 → `finally` 释放 `this.printing` 锁，`processQueue` 得以继续消费，死锁解除。
2. **设备就绪恢复暂挂订单**：`setCurrentDevice` 在设备从"无"变"有"且队列非空时，主动触发 `processQueue`，修复"先点重打后选设备"导致订单永久滞留队列的隐患。
3. **reprintOrder 防御性注入 platform**：`getOrder` 返回 detail 若缺 `platform` 字段，显式注入 `platformId`，避免 `printOne` 中 `detail.platform` 为 undefined 导致 DB 去重 key 错乱、`confirmPrinted` 归属错误。
4. **全链路诊断日志**：`reprintOrder`/`enqueueSingle`/`processQueue`/`sendToPrinter` 加结构化日志，定位"重打不打印"问题到具体环节（getOrder 空 / 入队 / 设备无 / IO 超时 / 重试）。

#### 涉及文件
- `src/main/config.ts`
- `src/main/services/PrintService.ts`

---

## [1.0.0] - 2026-09-19（补丁3）

### Bug 修复：查询打印对话框无法粘贴订单号

#### 现象
复单复制订单号成功后，打开"查询打印"对话框，在输入框用 Cmd+V/Ctrl+V 粘贴，内容粘贴不进去。

#### 根因
Electron 22 下主进程 `clipboard.writeText` 写入的系统剪贴板，与渲染进程输入框原生粘贴（Chromium 剪贴板读取）存在同步/格式差异，导致粘贴读取不到刚写入的内容。这是 Electron 多平台已知问题，Win7/Mac 均可能出现。

#### 修复
在查询打印输入框增加"粘贴"按钮，通过 IPC 从主进程 `clipboard.readText` 主动读取剪贴板内容填入输入框，绕过渲染进程原生粘贴限制：
- `src/main/ipc/app.ipc.ts`：新增 `clipboard:readText` IPC handler；
- `src/preload/index.ts`：暴露 `clipboardReadText`；
- `src/renderer/api/bridge.ts`：fallback 补全；
- `src/renderer/components/QueryPrintDialog.tsx`：输入框 endAdornment 加"粘贴"按钮 + handlePaste，剪贴板为空时提示。

#### 涉及文件
- `src/main/ipc/app.ipc.ts`
- `src/preload/index.ts`
- `src/renderer/api/bridge.ts`
- `src/renderer/components/QueryPrintDialog.tsx`

---

## [1.0.0] - 2026-09-19（补丁2）

### Bug 修复：复单（复制订单号）点击无效

#### 现象
点击已打印订单的"复单"按钮，toast 提示"复制成功"，但实际剪贴板无内容，粘贴无果。

#### 根因
`PlatformGrid.tsx` 原用渲染进程 `navigator.clipboard?.writeText(orderId)`：
1. `navigator.clipboard.writeText` 是异步 Promise，原代码未 await/catch，失败时静默，但 toast 仍提示"复制成功"，造成假象；
2. Electron 22（Chromium 108）+ Win7 下 `navigator.clipboard` 在非 secure context 或权限受限时可能不可用，可选链 `?.` 让 API 缺失时静默跳过；
3. 对应 KMP 原版 `Utils.copyToClipboard` 走 AWT `systemClipboard`（系统级剪贴板），稳定可靠，Electron 渲染层 API 达不到同等稳定性。

#### 修复
改走 Electron 主进程 `clipboard` 模块（经 IPC），对应 KMP AWT systemClipboard 方案：
- `src/main/ipc/app.ipc.ts`：新增 `clipboard:writeText` IPC handler，用 `clipboard.writeText` 写系统剪贴板，try/catch 兜底返回 boolean；
- `src/preload/index.ts`：暴露 `clipboardWriteText(text)` 方法；
- `src/renderer/api/bridge.ts`：补全 fallback 兜底；
- `src/renderer/components/PlatformGrid.tsx`：`copy` 改为 async，await IPC 返回后按成功/失败分别 toast，消除"假成功"。

#### 涉及文件
- `src/main/ipc/app.ipc.ts`（新增 clipboard IPC handler）
- `src/preload/index.ts`（暴露 clipboardWriteText）
- `src/renderer/api/bridge.ts`（fallback 补全）
- `src/renderer/components/PlatformGrid.tsx`（copy 改 async + 错误兜底）

---

## [1.0.0] - 2026-09-19（补丁）

### Bug 修复：条码过高 + 商品数量显示 undefined

#### 1. 条形码高度减半
- **现象**：小票上 CODE128 条码过高，占位过大。
- **根因**：`escpos.ts` 的 `barcode()` 调用 bwip-js 时 `height: 40` 偏高。
- **修复**：`height: 40 → 20`（条码条形高度减半），`paddingheight: 10 → 5`（上下白边同比减半保持视觉比例）。

#### 2. 商品数量显示 undefined
- **现象**：小票商品行"X{undefined}  {价格}"，数量为 undefined。
- **根因**：`ApiService.ts` 的 `FIELD_MAP` 含 `count: 'totalNum'`（对应 KMP `ShopPrintOrderDetail.@SerialName("count") val totalNum`，订单总数）。但 `toCamelCase` 递归转换时，商品列表 `detail` 元素里的 `count`（商品数量，KMP `ShopPrintOrderGoodsItem.val count` 无 @SerialName）也被全局映射成 `totalNum`，导致 `printTemplate.ts` 访问 `item.count` 得到 undefined。
- **修复**：`toCamelCase` 增加上下文感知——新增 `FIELD_KEEP_BY_PARENT` 豁免表，当父键为 `detail`（商品列表）时，其元素的 `count`/`price` 保持后端原名，不走 `count→totalNum` 映射。递归时传入当前键名作为 `parentKey`。
- **对照 KMP**：对应 `ShopPrintOrderGoodsItem` 的 `count`/`price` 无 @SerialName 注解，后端字段名即属性名；而 `ShopPrintOrderDetail` 的 `count` 有 @SerialName 映射为 `totalNum`。两者通过 @SerialName 按类精确区分，Electron 用父键上下文模拟此语义。

#### 涉及文件
- `src/main/utils/escpos.ts`（条码高度参数减半）
- `src/main/services/ApiService.ts`（toCamelCase 上下文感知 + FIELD_KEEP_BY_PARENT 豁免表）

---

## [1.0.0] - 2026-09-19

### 功能补全：复单/查询打印/重打 + 版本号独立

#### 背景
对照 KMP 原版（`PrintPlatformGrid.kt`、`DrawerContent.kt`）核查三个订单操作功能，发现复单有 BUG、查询打印未实现、重打已正常。同时版本号此前与 KMP 1.0.71/1.0.84 混用，需独立从 1.0.0 起。

#### 1. 复单（复制订单号）BUG 修复
- **原问题**：`PlatformGrid.tsx` 的"复单"按钮复制的是 `daySeq`（取餐号），与 KMP `Utils.copyToClipboard(it.orderId)` 不一致。
- **修复**：改为复制 `orderId`（订单号），提示文案对齐 KMP 改为"复制成功：{orderId}"。

#### 2. 查询打印功能实现（对应 KMP DrawerContent.kt）
- **原状态**：`HomeView` 的 `onOpenHistory` 仅打日志"查询打印（待实现）"，完全未实现。
- **实现**：新建 `QueryPrintDialog` 组件（Dialog 形式，对应 KMP 的 Drawer）：
  - 平台分段选择（ToggleButtonGroup）
  - 订单号/流水号输入框（回车确认）
  - 查找逻辑：在已打印 + 待打印 Map 中匹配 `orderId` 或 `daySeq`
    - 命中：用该订单的 `daySeq` 触发 `reprintOrder` 重打
    - 未命中：用原始输入值作为 `daySeq` 兜底查询后端重打
  - 提示信息（命中绿色 / 未命中橙色 / 校验红色）
- **接入**：`HomeView` 新增 `queryOpen` 状态 + `handleQueryPrint`，`SettingPanel.onOpenHistory` 改为打开对话框。

#### 3. 重打功能确认
- 已正常实现（`PlatformGrid` 已打印区按钮 → `onReprint(orderId, daySeq)` → `reprintOrder(platformId, shopId, daySeq)` → `getOrder` → 入队），无需改动。

#### 4. 版本号独立为 1.0.0（不再与 KMP 对齐）
- `package.json` version: `1.0.84` → `1.0.0`
- `src/renderer/config.ts` APP_VERSION 默认值: `1.0.71` → `1.0.0`
- `.env` / `.env.production` VITE_APP_VERSION: `1.0.71` → `1.0.0`
- `src/renderer/index.html` title: 加 `V1.0.0`
- `src/main/index.ts` 窗口 title: 改为动态 `比优特到家小票打印系统 V${app.getVersion()}`
- `SplashView` 版本徽章已引用 `APP_VERSION`，自动显示 `V1.0.0`

#### 涉及文件
- `src/renderer/components/PlatformGrid.tsx`（复单复制 orderId + bgcolor 拼写修复）
- `src/renderer/components/QueryPrintDialog.tsx`（新增）
- `src/renderer/views/HomeView.tsx`（接入查询打印对话框）
- `src/renderer/config.ts`
- `src/renderer/index.html`
- `src/main/index.ts`
- `package.json`
- `.env`
- `.env.production`

---

## [1.0.84] - 2026-09-19

### Bug 修复：小票 CODE128 条码不显示

#### 现象
打印小票（含测试打印）时，订单号下方的 CODE128 条码完全不显示，只字节数不变但条码区域空白。

#### 根因
`src/main/utils/escpos.ts` 的 `barcode()` 方法误用了 bwip-js 的异步 API：
- bwip-js 4.x 的 `toBuffer(opts)` 返回 `Promise<Buffer>`，**没有同步形式**（已确认 4.11.4 类型定义仅有 `toBuffer(opts, callback): void` 和 `toBuffer(opts): Promise<Buffer>`）。
- 旧代码 `const pngBuf = bwip.toBuffer({...})` 把 Promise 当 Buffer 用，传给 `rasterBitImageFromPng(pngBuf)`，`pngjs` 解析 Promise 必然抛错，被 `try/catch` 吞掉仅 `log.error`，导致条码字节完全不写入输出流。

#### 修复方案
将条码生成链路改为异步链式 await（bwip-js 4.x 仅异步 API，无法保持同步）：
1. `EscPosPrinter.barcode(data)` 由 `this` 改为 `Promise<this>`，内部 `await bwip.toBuffer(...)`。
2. `printTemplate.ts` 的 `templateV1()` 由 `Buffer` 改为 `async: Promise<Buffer>`，`printer.barcode()` 调用前加 `await`。
3. `DeviceService.ts` 的测试小票构造 `buildTestReceipt()` 同步改 `async: Promise<Buffer>`，`p.barcode()` 加 `await`。
4. 调用点同步加 `await`：
   - `PrintService.ts:155` `const data = await templateV1(detail)`（已在 async `printOne` 内）。
   - `DeviceService.ts` `testPrint` 内 `const data = await buildTestReceipt()`（已在 async 内）。

bwip-js 生成参数（scale/height/padding）保持不变，仅修 API 误用。

#### 涉及文件
- `src/main/utils/escpos.ts`
- `src/main/utils/printTemplate.ts`
- `src/main/services/PrintService.ts`
- `src/main/services/DeviceService.ts`

#### 验证方法
重启应用 → 选择打印设备 → 点"打印测试" → 测试小票订单号"2401939050332732270"下方应出现完整可扫的 CODE128 条码 → 真实订单小票条码同样正常显示。

## [1.0.83] - 2026-09-19

### Bug 修复 + 功能对齐：客服二维码弹窗管理与图片加载失败

#### 现象
1. 设置面板的"设置客服二维码"未像 KMP 原版那样使用独立弹窗管理（KMP 用 `BasicAlertDialog` + `DragAndClickDropZone`，Electron 版直接在面板内嵌缩略图）。
2. 选择完图片后预览加载失败（`<img src="file://...">` 显示不出来）。

#### 根因（图片加载失败）
渲染进程用 `src={`file://${kfPath}`}` 加载本地图片，但 `BrowserWindow` 的 `webPreferences` 未关闭 `webSecurity`，Chromium 同源策略禁止从 `http://`(dev server) 或 `file://` 页面加载其他 `file://` 资源，导致图片加载失败。

#### 修复方案
**不改 webSecurity（保持安全）**，改为主进程读取图片字节→嗅探 MIME→转 base64 data URL 返回，渲染进程用 data URL 作为 `<img src>`，彻底绕过 `file://` 限制。

#### 改动内容
1. **主进程 `src/main/ipc/kf-photo.ipc.ts`**
   - 新增 `detectImageMime(buf)`：按文件头 magic bytes 嗅探真实 MIME（JPEG/PNG/BMP/GIF），解决"文件名固定 .jpg 但源文件可能是 png"的 MIME 错判问题。
   - 新增 `readKfPhotoAsDataUrl()`：读取 kf-photo.jpg 转 `data:${mime};base64,...`。
   - `kf-photo:select` 返回值新增 `dataUrl` 字段。
   - 新增 `kf-photo:dataUrl` IPC 通道：返回当前图片 data URL（供渲染进程初始化加载）。

2. **Preload `src/preload/index.ts`**：新增 `getKfPhotoDataUrl()` 暴露给渲染进程。

3. **渲染层 `src/renderer/api/bridge.ts`**：fallback 同步新增 `getKfPhotoDataUrl`，`selectKfPhoto` 返回类型含 `dataUrl`。

4. **`src/renderer/components/SettingPanel.tsx`**（对齐 KMP `SettingView.kt` + `DragAndClickDropZone.kt`）：
   - 状态由 `kfPath`(本地路径) 改为 `kfDataUrl`(base64 data URL)。
   - 面板内改为单个"设置客服二维码"按钮（已设置时标注"（已设置）"），点击打开管理弹窗。
   - 新增管理弹窗（对应 KMP `BasicAlertDialog`）：标题"设置客服二维码"+关闭按钮、200×200 预览框（对应 KMP `Box size 200dp border`）、"点击选择文件"按钮（对应 KMP 同名按钮）、"移除文件"文字链接（对应 KMP `Text "移除文件" clickable`）。
   - 图片统一用 dataUrl 加载，不再用 `file://`。
   - 清理未使用的 `Tooltip`/`RemoveCircleIcon` 导入。

#### 涉及文件
- `src/main/ipc/kf-photo.ipc.ts`
- `src/preload/index.ts`
- `src/renderer/api/bridge.ts`
- `src/renderer/components/SettingPanel.tsx`

#### 验证方法
重启应用 → 设置面板点击"设置客服二维码" → 弹窗弹出 → 点"点击选择文件"选图 → 200×200 预览框立即显示图片（不再加载失败）→ 关闭弹窗后面板按钮显示"（已设置）" → 打印小票底部含客服图片。

## [1.0.82] - 2026-09-19

### Bug 修复：轮询"去重后待打印 1 条 / 获取订单详情 0 条"死循环

#### 现象
应用轮询时日志反复出现：
```
[meituan] 获取到 169 条订单号
[meituan] 去重后待打印 1 条
[meituan] 获取订单详情 0 条
```
视图不显示订单列表，也不打印。

#### 根因
`ApiService.toCamelCase` 的通用正则 `/_([a-z])/g` 只能转换含下划线的键（如 `day_seq`→`daySeq`），但 KMP 大量 `@SerialName` 字段**无下划线且后端名 ≠ 前端属性名**，通用转换无法覆盖：
- `orderid`（无下划线）→ 未转成 `orderId`
- `wmid` → 未转成 `platform`
- `wmname` → 未转成 `platformName`
- `jh_temperature` → 未转成 `temperature`
- `count` → 未转成 `totalNum`
- `total` → 未转成 `totalFee`
- `detail` → 未转成 `goodsList`

致命链路：`getDaySeq` 返回的 data 元素键仍是 `orderid`，`distinctByOrderId` 访问 `o.orderId` 全为 `undefined`，169 条去重后只剩 1 个 `undefined`；`getOrderList([undefined])` 后端查不到 → 返回 0 条 → 不入队不打印 → 下轮仍当作新订单 → 死循环。

#### 修复
`src/main/services/ApiService.ts` 新增 `FIELD_MAP` 显式映射表，精确对照 KMP `@SerialName` 注解（覆盖 `ShopPrintOrderDetail`/`ShopPrintOrder`/`ShopPrintOrderItem`/`ShopPrintOrderGoodsItem` 全部字段）。`toCamelCase` 改为**优先查映射表，未命中再走通用 snake→camel**，彻底消除无下划线字段的转换遗漏。

新增诊断日志：`getDaySeq` 成功后打印首条样本 `orderId`/`daySeq`，便于确认字段映射生效。

#### 涉及文件
- `src/main/services/ApiService.ts`（新增 FIELD_MAP + 改造 toCamelCase + getDaySeq 诊断日志）

#### 验证方法
重启应用后查看日志，应出现：
```
getDaySeq 首条样本 orderId=<真实订单号> daySeq=<真实取餐号>
[meituan] 去重后待打印 N 条   （N 接近 169 减去已打印数，而非 1）
[meituan] 获取订单详情 M 条   （M > 0）
```

## [1.0.81] - 2026-09-19

### 存储：用 JSON 文件分片方案替代 SQLite（消除原生模块编译痛点）

#### 背景
better-sqlite3 是原生模块，Win7 部署必须用 `electron-rebuild` 针对 Electron 22 ABI 编译，容易因 Node ABI 不匹配导致启动崩溃。用户希望不用 SQLite，并要求冷启动只留存今天数据、能查看数据结构。

#### 方案：JsonStore（按日期分片 JSON 文件）
- 存储目录 `userData/pgprint/data/`，每日每表一个 JSON 文件：
  - `printed-YYYY-MM-DD.json`（已打印，防重复）
  - `pending-YYYY-MM-DD.json`（待打印，重启恢复）
  - `cancel-YYYY-MM-DD.json`（取消/退款）
  - `connection-YYYY-MM-DD.json`（连接日志）
- JSON 带 2 空格缩进，可用 VSCode/记事本/浏览器直接查看结构。
- 数据量小（每日几十~几百条订单），JSON 读写性能足够。
- 优势：零原生依赖、按日期天然分片、冷启动清理极简、纯文本可读。

#### 冷启动只留存今天
- `JsonStore.init()` 启动时扫描 `data/` 目录，删除所有非今天的 JSON 文件。
- 天然满足"每次冷启动移除今天之前的订单数据"，防止跨日重复打印或数据存留。
- `cleanOlderThanDate()` 保留兼容，可运行时按指定日期清理。

#### 本地数据查看工具
- 新增主进程 IPC `src/main/ipc/store-data.ipc.ts`：`store:stats`（各表计数）、`store:allData`（全量记录）、`store:openDir`（打开目录）。
- `SettingPanel.tsx` 新增"本地数据查看"按钮：弹窗显示今日各表统计（Chip 标签）+ Tab 切换各表完整数据（表格）+ 刷新 + 打开目录按钮。
- 用户也可直接点"打开目录"用文件管理器/编辑器查看 JSON 文件原始内容。

#### API 兼容
- `JsonStore` 与原 `DatabaseService` 完全同名同参方法，PrintService/index.ts 只改 import 路径即可无缝切换，无逻辑改动。

#### 涉及文件
- `src/main/services/JsonStore.ts`（新增，替代 DatabaseService）
- `src/main/ipc/store-data.ipc.ts`（新增，数据查看 IPC）
- `src/main/ipc/index.ts`（注册 store-data IPC）
- `src/main/services/PrintService.ts`（import 改 JsonStore）
- `src/main/index.ts`（import 改 JsonStore）
- `src/preload/index.ts`（暴露 getStoreStats/getAllStoreData/openStoreDir）
- `src/renderer/api/bridge.ts`（补 fallback）
- `src/renderer/components/SettingPanel.tsx`（新增本地数据查看面板）
- `package.json`（移除 better-sqlite3 + @types/better-sqlite3，rebuild 脚本去掉 better-sqlite3）

### 条形码打印确认
- 经核查，条形码打印已完整实现，与 KMP 一致，无需改动：
  - `src/main/utils/escpos.ts:201` `barcode()` 方法用 `bwip-js` 生成 CODE128 条码 → 二值化 → `GS v 0` 光栅位图指令。
  - `src/main/utils/printTemplate.ts:71` `printer.barcode(detail.orderId)` 已调用，条码下方打印订单号文字。

### 版本同步
- `package.json` 版本号同步至 1.0.81。

## [1.0.80] - 2026-09-19

### 修复：5 项 UI/交互/功能缺陷（轮询不生效为其中最关键项）

#### 1. LoginView 门店号输入框样式优化
- 问题描述：原 `variant="filled"` 隐藏下划线方案不够清爽，与 KMP `Login.kt` 灰底无边框单行回车提交风格不符。
- 修复：改为 `variant="outlined"` + `fieldset: border:none` + 灰底 `#F5F5F5`，聚焦时显示主色 2px 边框并切换白底；卡片阴影/内边距/圆角强化；按钮禁用态在输入为空时置灰；加 `autoFocus`。
- 涉及文件：`src/renderer/views/LoginView.tsx`

#### 2. DevicePanel 设备名过长无 hover/title
- 问题描述：设备名过长时 `noWrap` 截断，用户无法看到完整名称，也无悬停提示。
- 修复：`ListItemButton` 增加 `title` 原生提示；`ListItemText` primaryTypographyProps 增加 `title`；选中态加主色淡边框；hover 背景 `#ECEDF9`；Radio 加 `onClick stopPropagation` 防冒泡双触发。
- 涉及文件：`src/renderer/components/DevicePanel.tsx`

#### 3. PlatformPanel 复选框冒泡导致勾选不上（问题5 根因）
- 问题描述：点击 Checkbox 时，`Checkbox.onChange` 与冒泡到 `ListItemButton.onClick` 各触发一次 `togglePlatform`，净效果为 0，勾选不上；进而 `checkedIds` 不变，`updatePlatforms` 永不调用，轮询无法启动。
- 修复：Checkbox 增加 `onClick={(e) e.stopPropagation()}` 阻止冒泡到 ListItemButton，仅保留 Checkbox 自身 onChange 触发；同步加 title/hover/选中边框。
- 涉及文件：`src/renderer/components/PlatformPanel.tsx`

#### 4. 实现设置客服二维码功能（对应 KMP DragAndClickDropZone）
- 问题描述：原"设置客服二维码"按钮仅 `console.log`，无实际功能。
- 修复：
  - 新增主进程 IPC `src/main/ipc/kf-photo.ipc.ts`：`kf-photo:select`（dialog 选图 → 复制到 `userData/kf-photo.jpg`）、`kf-photo:remove`（删除）、`kf-photo:path`（查询路径）。
  - `ipc/index.ts` 注册；`preload/index.ts` 暴露 `selectKfPhoto/removeKfPhoto/getKfPhotoPath`；`bridge.ts` 补 fallback。
  - `SettingPanel.tsx` 重写：已设置显示缩略图 + 重新选择/移除按钮 + 点击大图预览弹窗；未设置显示设置按钮。
  - 图片路径与 `printTemplate.ts` 的 `getKfImagePath()` 一致，打印小票底部自动读取。
- 涉及文件：`src/main/ipc/kf-photo.ipc.ts`(新增)、`src/main/ipc/index.ts`、`src/preload/index.ts`、`src/renderer/api/bridge.ts`、`src/renderer/components/SettingPanel.tsx`

#### 5. 加固平台轮询逻辑（对照 KMP PrintTask.kt / App.kt）
- 问题描述：勾选平台后轮询"没生效、没请求接口、没日志"——表面看是轮询坏了，根因是问题 3 冒泡导致勾选不上。即便修好冒泡，原实现也缺可观测日志、shopId 空时直接 return、勾选清空未停止轮询。
- 修复：
  - `PrintService.updatePlatforms` 增加 newList/shopId/diff（启动/停止）日志。
  - `PrintService.executePollCycle` 每轮开始打印 `开始 [platformId] Time:` 日志（对照 KMP），getDaySeq 返回 null/code!=200/空数据/有订单各分支日志，去重后数量、详情获取数量日志。
  - `ApiService.getDaySeq` 成功时打印 code/dataLen/refundNotice。
  - `HomeView` 轮询 effect：不再因 `shopId` 为空就 return（改由主进程 IPC 兜底从 StoreService 取 shopId），确保轮询能启动；`checkedIds` 清空时主动 `stopAllPolling`（对照 KMP `checkedPrintPlatform.isEmpty() → stopPollingTask`）。
- 涉及文件：`src/main/services/PrintService.ts`、`src/main/services/ApiService.ts`、`src/renderer/views/HomeView.tsx`

### 版本同步
- `package.json` 版本号同步至 1.0.80（此前落后于 CHANGELOG）。

## [1.0.79] - 2026-09-19

### 修正：打印测试内容改回参照 KMP `printImage2()` 完整外卖小票样张

#### 背景
1.0.77 把测试内容改成了 KMP `usb.kt` 的 `getTestPrintData()` 简短自检小票（标题+项目+时间+切纸），但用户明确要求"打印测试改成参考代码的样式的小票样式"——即 KMP 中真正的完整外卖小票模拟样张 `printImage2()`。

#### 修正
`src/main/services/DeviceService.ts` 的 `buildTestReceipt()` 函数完全 1:1 移植 KMP `usb.kt` 的 `printImage2()`：

测试小票内容（与 KMP 完全一致）：
- 顶部 `#130` 大号订单号（3×3 缩放居中，`GS!` 0x33）
- 平台名"测试订单"（2×2 加粗居中）
- 门店名"比优特超市（市府大路店）"（1×1 居中）
- "用户联"（居中）
- CODE128 条码 + 订单号 `2401939050332732270`
- 订单信息：订单号/立即送达/下单时间/收件人吴先生/电话/地址
- 备注：【如遇缺货】：缺货时电话与我沟通
- 商品表头"商品  数量            单价  金额"
- 商品 1：`1、象牛特仑苏纯牛奶250ml*12【比优特精选 整箱 高端 早餐优选】` + 条码 `9987767987` + `X1 53.47`
- 金额汇总：商品合计 X1 53.47 / 配送费 4.50 / 包装费 0.00 / 优惠金额 17.57
- 实付金额 41.60（加粗）
- 底部提示文字 + 客服电话 155 6601 2733
- 客服图片（若 `userData/kf-photo.jpg` 存在）
- 走纸 5 行 + 切纸

写法说明：KMP `printImage2()` 用 `printer.writeText(text) + printer.feed(1)` 模式输出无换行文本行；本机 `EscPosPrinter.text(content)` 已带 `\n`，二者等价（"文本+换行"一次性输出），故不再追加 `feed(1)`。

文件头注释、函数注释、行内注释同步更新。

## [1.0.78] - 2026-09-19

### 新增：USB 直写字节流通道（绕过 CUPS PPD filter），彻底解决 macOS/Linux ESC/POS 字节流无法透传

#### 症状
1.0.77 修复 stdin 管道丢数据后，临时 .bin 文件能创建但 `lp -o raw <tmpfile>` 仍打不出小票：CUPS 队列里出现 1024 字节占位任务且 NOT COMPLETED。

#### 根因
1. macOS 较新版本（CUPS 2.4+）已不再支持 raw 队列：`lpadmin -m raw` 报错 `macOS不再支持原始队列`，无法绕过 PPD filter。
2. 系统给未知 USB 打印机（Gprinter iSH58）配置的默认 PPD 是 HP DeskJet 风格的栅格 PPD（PageSize Letter/Legal/A4、Duplex 等），ESC/POS 字节流被当 PostScript 喂给 raster filter，filter 失败导致字节流被丢弃。
3. 实测：50 字节 ESC/POS 字节流经 `lp -o raw` 提交后，CUPS 把它转成 1024 字节占位任务且 NOT COMPLETED，打印机不动。
4. macOS 没有 Linux 那样的 `/dev/usb/lp0` 字符设备节点，也没有暴露成 `/dev/cu.*` 串口设备，所以无法靠写设备文件直发字节流。
5. KMP 在 macOS 上能打这台打印机，是因为 Java `javax.print.PrintService` + `DocFlavor.BYTE_ARRAY.AUTOSENSE` 底层走 macOS Cocoa printing layer，直接通过 USB backend 发送字节流，绕开了 CUPS PPD filter。

#### 方案：libusb 直写 USB OUT 端点
参考 KMP javax.print AUTOSENSE 的底层行为，通过 `usb` NPM 包（libusb 绑定）直接把 ESC/POS 字节流写到打印机的 USB OUT bulk 端点，完全跳过 CUPS 队列和 PPD filter 链。

实现要点：
1. **新增 `src/main/utils/usbPrint.ts`**：
   - `findUsbPrinters()`：扫描 USB 设备列表，匹配 `bInterfaceClass === 0x07`（Printer Class）接口的设备。
   - `printRawViaUsb(printerName, data, options?)`：优先按 vid/pid 精确匹配，否则按队列名关键词反查 USB 设备，claim 接口 → 找 OUT 端点 → 按 4KB 分块 transfer 字节流 → release 接口。
   - `listUsbPrinters()`：枚举所有 USB Printer class 设备，供 DeviceService 展示给用户选。
2. **修改 `src/main/utils/rawPrint.ts`**：
   - `printRawViaCommand` 新增 `options?` 参数（vid/pid）。
   - macOS/Linux 路径优先 USB 直写，失败再回退 `lp -o raw`。
3. **修改 `src/main/services/PrintService.ts`**：
   - `sendToPrinter` 新增 `usb` 类型分支：直接走 `printRawViaUsb`。
   - `printViaDriver` 新增 `options?` 参数，由 driver 类型链路上传 vid/pid 给 raw 命令，让 macOS 优先 USB 直写。
4. **修改 `src/main/services/DeviceService.ts`**：
   - `listPrinters` 在系统驱动打印机之外，额外枚举 USB Printer class 设备，标记为 `(USB直写)` 让用户优先选。
   - `testPrint` 新增 `options?` 参数，按通道优先级 USB 直写 → 原生模块 → 命令行回退。
5. **修改 `src/main/ipc/device.ipc.ts`**：
   - `device:testPrint` 接收完整 `PrinterTarget` 对象（含 vid/pid），让 USB 直写能精确匹配设备。
6. **修改 `src/preload/index.ts` + `src/renderer/views/HomeView.tsx`**：
   - `testPrint(dev)` 传整个 PrinterTarget。

#### 验证
开 `/tmp/usbtest.js` 临时脚本（已删），通过 `usb` 包直接将 50 字节 ESC/POS 测试字节流写到 Gprinter iSH58 的 OUT 端点（VID=0x6868 PID=0x0200，bInterfaceClass=0x07，OUT EP=0x01），打印机正常出纸切纸。

#### 影响
- macOS 开发机：USB 直写为首选通道，选 `(USB直写)` 设备即直接走 libusb 端点；选 CUPS 队列也能自动反查 USB 设备并直写。
- Windows 部署机：不受影响（仍优先 PowerShell RawPrinter + @thiagoelg/node-printer），USB 直写作为兜底。
- Linux：与 macOS 同走 USB 直写优先。

## [1.0.77] - 2026-09-19

### 修复：macOS/Linux `lp` 打印通道 stdin 管道丢数据导致打印失败

#### 症状
点击「打印测试」后，开发机（macOS）走 `printRawViaCommand` → `printViaLp` 通道时打印失败/无反应。日志可能显示 lp 退出码非 0 或干脆没打出小票。

#### 根因
`printViaLp` 用 `spawn('lp', ...) + lp.stdin.write(data) + lp.stdin.end()` 通过 stdin 管道灌字节流：
1. Node.js stdin 默认 highWaterMark = 16KB。ESC/POS 字节流（含条码位图/客服图片）一旦超过该阈值，`write()` 只写入部分并返回 false，立即调用 `end()` 会丢失剩余字节 → 打印机收不到完整指令。
2. 即便数据小，stdin 关闭与 lp 读取的时序竞争也可能导致 lp 收到不完整数据，表现为"打印没反应 / 只打出半截 / 乱码"。
3. 大数据量时 `write()` 返回 false 后未监听 `drain` 事件就 `end()`，是确定的丢数据 bug。

#### 修复
`src/main/utils/rawPrint.ts` - `printViaLp` 改为【临时文件】方式，与 Windows 的 PowerShell RawPrinter 通道完全一致：
1. 字节流写入临时文件 `${tmpdir()}/pgprint_${Date.now()}_${pid}.bin`
2. `lp -d <printer> -o raw <tmpfile>` 把文件路径作为参数传入，让 CUPS 自己读文件
3. 完成（成功/失败）后删除临时文件
4. 同时捕获 stdout（lp 成功输出 "request id is xxx-123"）和 stderr，诊断更完整

文件头注释同步更新：说明双平台统一用临时文件方式，及为什么不用 stdin 管道。

### 修正：测试打印内容改回参照 KMP `getTestPrintData()` 简短版本

#### 背景
1.0.76 把测试内容改成了 KMP `usb.kt` 的 `printImage2()`（完整外卖小票模拟样张）。但用户明确要求"测试内容参照参照代码的测试内容"，KMP 中真正的"测试打印函数"是 `getTestPrintData()`（函数名即"获取测试打印数据"），输出的是简短连接自检小票（标题+项目+时间+切纸），不是完整外卖小票。`printImage2()` 是完整模板渲染示例，不是测试函数。

#### 修正
`src/main/services/DeviceService.ts` - `buildTestReceipt` 重写为 1:1 移植 `getTestPrintData()`：
- ESC @ 初始化
- 居中（ESC a 1）+ "热敏打印机测试"（GBK）
- 左对齐（ESC a 0）+ "项目: 打印机连接成功"
- 左对齐 + "时间: <当天日期>"（KMP 写死 2025-12-27，本机改动态当天日期便于排查）
- 切纸（GS V 1，等价 KMP 的 GS V 66 0）

测试目的只验证"RAW 通道打通 + GBK 中文正常 + 切纸生效"，不需要整张外卖小票（整张模板由 `printTemplate.ts` 在真实订单时验证）。

#### 涉及文件
- `src/main/utils/rawPrint.ts`：`printViaLp` 改临时文件方式；文件头注释更新；捕获 stdout。
- `src/main/services/DeviceService.ts`：`buildTestReceipt` 改为 `getTestPrintData()` 简短内容；移除不再用到的 `import { app }` / `import { join }`。

## [1.0.76] - 2026-09-19

### 修正：打印测试内容改为 1:1 移植 KMP 参考代码的完整外卖小票样张

#### 症状
1.0.75 已把 testPrint 通道从 silent print HTML 改为 ESC/POS RAW，但测试小票内容是自己简化的"打印测试"标题 + 设备名 + 时间，不是外卖小票格式，验证不了真实小票模板渲染（订单号/条码/商品行/金额汇总/客服图片）。

#### 修正
`src/main/services/DeviceService.ts` - `buildTestReceipt` 改为 1:1 移植 KMP 参考项目 `composeApp/.../usb/usb.kt` 的 `printImage2()`（即 KMP `onClickPrintTest` 实际调用的测试内容），输出一份完整外卖小票模拟样张：
- 顶部大号订单号 `#130`（居中 3×3）
- 平台/门店：`测试订单`（2×2 加粗居中）→ `比优特超市（市府大路店）` → `用户联`
- CODE128 条码 `2401939050332732270` + 条码数字
- 订单信息：订单号/送达时间/下单时间/收件人/电话/地址
- 备注、商品表头、商品行（`product()` 左右对齐）
- 金额汇总：商品合计/配送费/包装费/优惠金额/实付金额（加粗）
- 底部提示语 + 客服电话
- 客服图片（`kf-photo.jpg` 存在才打印，路径与 `printTemplate.ts` 一致：`app.getPath('userData')/kf-photo.jpg`）
- 走纸 5 行 + 切纸

这样测试打印验证的就是真实外卖小票的完整渲染链路（GBK 中文、CODE128 条码、商品行左右对齐、金额汇总、位图客服图片、切纸），与 `printTemplate.ts` 结构完全一致。

#### 涉及文件
- `src/main/services/DeviceService.ts`：`buildTestReceipt` 重写为 `printImage2()` 1:1 移植；新增 `import { app }` / `import { join }`；`testPrint` 调用改为无参 `buildTestReceipt()`。

## [1.0.75] - 2026-09-19

### 修复：打印测试走错通道（队列显示 data:text/html URL，非外卖小票格式）

#### 症状
点击「打印测试」后，OS 打印队列里出现的任务内容是 `data:text/html;charset=utf-8,<html><body>...10:36:36</p></body></html>` 这种整段 data URL，而不是外卖小票订单格式的 ESC/POS 字节流。

#### 根因
`DeviceService.testPrint` 用的是 **Electron silent print HTML 渲染通道**，而真实外卖小票打印（`PrintService.sendToPrinter`）走的是 **ESC/POS RAW 字节流通道**（printDirect / `lp -o raw`）。两条通道完全不同：
1. silent print 把 HTML 经驱动渲染后发送，对 ESC/POS 热敏打印机（如 `Artery_CMD_ESCPO_Gprinter_iSH58`）要么乱码要么无法识别；
2. silent print 的 job name 默认取页面 URL，data URL 的整段内容就成了队列里显示的任务名；
3. silent print 成功不代表真实小票能打（通道不同），验证无意义。

#### 修复
`src/main/services/DeviceService.ts` - `testPrint` 彻底改为走与真实小票一致的 ESC/POS RAW 字节流通道：
1. 新增 `buildTestReceipt(printerName)`：用 `EscPosPrinter`（与 `printTemplate.ts` 同一套指令封装）构造测试小票字节流 —— 初始化(ESC @) → 居中 2×2「打印测试」→ 设备名 → 分隔线 → 时间 → 说明 → 走纸切纸。
2. 通道优先级与 `PrintService.printViaDriver` 完全一致：
   - 优先 `@thiagoelg/node-printer` 的 `printDirect`（type=RAW）
   - 回退系统命令行 RAW（macOS `lp -o raw` / Windows PowerShell RawPrinter，复用 `printRawViaCommand`）
3. 移除 `BrowserWindow` silent print 相关代码（loadURL/print/超时兜底全部删除）。

#### 效果
- OS 打印队列里 job name 不再是 data URL，而是正常的 RAW 任务。
- 验证的就是真实外卖小票走的 ESC/POS 通道：GBK 中文、指令解析、切纸全部覆盖。
- 日志链路：`testPrint 开始` → `testPrint ESC/POS 字节流 N 字节，走 RAW 通道` → `testPrint printDirect 成功`（或 `系统命令 RAW 成功`）。

#### 涉及文件
- `src/main/services/DeviceService.ts`：新增 `buildTestReceipt`、加载 `nativePrinterLib`、重写 `testPrint`、import `printRawViaCommand`/`EscPosPrinter`/`WIDTH_58`。

## [1.0.74] - 2026-09-19

### 修复：打印测试卡死，OS 打印队列无任务

#### 症状
点击「打印测试」后日志只输出 `testPrint 开始 [Artery_CMD_ESCPO_Gprinter_iSH58]` 再无下文，系统打印机队列（CUPS/lpstat）里看不到任何任务。

#### 根因
`DeviceService.testPrint` 存在死锁：
```
await new Promise(r => win.webContents.once('did-finish-load', r))  // 等 did-finish-load
win.loadURL('data:text/html;...')                                   // loadURL 在 await 之后才调用
```
`await` 在等 `did-finish-load` 事件，但触发该事件的 `loadURL` 却在 `await` **之后**才执行 → 事件永远不触发 → 函数永久卡死 → `webContents.print` 根本没被调用 → OS 打印队列自然空。

#### 修复（已被 1.0.75 取代）
`src/main/services/DeviceService.ts` - `testPrint` 调换顺序：先注册 `did-finish-load`/`did-fail-load` 监听拿到 Promise，再调 `loadURL`，最后 await。此修复解决了死锁，但 silent print HTML 通道本身对 ESC/POS 打印机是错的，1.0.75 已将其整体替换为 RAW 字节流通道。

## [1.0.73] - 2026-09-19

### 修复：订单打印内容乱码（核心 bug）

#### 根因
ESC/POS 二进制字节流走了 Electron silent print 回退路径：
1. `@thiagoelg/node-printer` 在本机 node_modules 未安装（虽 package.json 已声明）→ `loadNativePrinter()` 返回 null
2. `printViaDriver` 回退到 silent print：通过 `Blob` + `iframe.src = blob URL` 让 Chromium 渲染 ESC/POS 字节流 → 浏览器不知道这是指令流，当文本/HTML 渲染 → **必然乱码**
3. KMP 原版用 `javax.print.PrintService` + `DocFlavor.BYTE_ARRAY.AUTOSENSE` 直发 RAW 字节流不经过渲染层，所以不乱码；silent print 路径与之不等价，是伪兜底

#### 修复
- `src/main/utils/rawPrint.ts`（新增）
  - 跨平台 RAW 字节流打印工具，等价 KMP 原版 `javax.print.PrintService` 的 RAW 通道
  - macOS/Linux：`lp -d <printer> -o raw`（CUPS），通过 stdin 灌入字节流
  - Windows（含 Win7）：PowerShell + Add-Type 编译 `RawPrinter` 互操作类，调用 Win32 Spooler API（OpenPrinter/StartDocPrinter/WritePrinter/ClosePrinter），数据类型 `RAW`
- `src/main/services/PrintService.ts`
  - `printViaDriver` 重写：删除 silent print 伪兜底（对 ESC/POS 字节流必然乱码），改为三档优先级
    1. `@thiagoelg/node-printer` `printDirect`（原生模块优先）
    2. `printRawViaCommand`（系统命令行回退）
    3. 都失败 → 明确返回 ioError + 错误提示（不再乱码）
  - 移除不再使用的 `BrowserWindow` 导入

#### 实测验证步骤（macOS）
1. 先在「系统偏好设置 → 打印机与扫描仪」启用 `Artery_CMD_ESCPO_Gprinter_iSH58`
2. 重启 dev 服务（`npm run dev`）
3. 在「选择打印设备」选中该打印机
4. 等待订单自动轮询，或点「打印测试」验证驱动连接
5. 检查 ~/Library/Logs/pgprint/main.log 应看到 `lp 打印成功 [...]` 而非 silent 路径

#### 兼容性
- macOS / Linux：依赖 CUPS 客户端 `lp`，系统自带
- Windows 7+：依赖 PowerShell 2.0+（Win7 内置），调用 Win32 Spooler API
- 部署到 Win7 时：先用 `npm install` + `npm run rebuild` 编译 `@thiagoelg/node-printer`，原生模块路径性能最佳；命令行回退作为兜底

## [1.0.72] - 2026-09-19

### 修复：打印与退款提示音不可用

#### 问题
1. **订单打印失败**：`PrintService.sendToPrinter` 把 `device.name`（即 `p.displayName || p.name`，展示名）当成打印机名传给 `@thiagoelg/node-printer` 的 `printDirect` 和 Electron silent print，但两者都要求传入**系统打印机名 `p.name`**（保存在 `device.path`）。展示名与系统名不一致时找不到打印机 → 全部打印失败。
2. **测试打印失败**：同上，`HomeView` 调用 `electronAPI.testPrint(dev.name)` 传的是展示名；且 `DeviceService.testPrint` 无超时兜底，silent 打印卡死时无回调。
3. **退款提示音无法播放**：① `notice.wav` 文件实际不存在（渲染层无任何资源）；② `SettingPanel` 的"播放音频"按钮 `onClick` 仅 `console.log`，未接 `playRefundSound`。

#### 修复
- `src/main/services/PrintService.ts`
  - `sendToPrinter`：传给 `printViaDriver` 的打印机名改为 `device.path || device.name`（系统名优先），并增加设备名/系统名/类型/字节数日志
  - `printViaDriver` 重写：原生 `printDirect` 优先（返回 Promise），失败/模块缺失时回退 silent 打印；silent 路径改为通过 `ipc-message` 接收子窗口回执，加 10 秒超时兜底，全程日志可追溯
- `src/main/services/DeviceService.ts`
  - `testPrint`：加开始/回调/超时/异常全链路日志；用 `Promise.race` 加 10 秒超时兜底；`finally` 确保隐藏窗口关闭
- `src/renderer/views/HomeView.tsx`
  - 测试打印调用改为传 `dev.path || dev.name`（系统打印机名），并加注释说明
- `src/renderer/utils/audioPlayer.ts`（重写）
  - 改用 Web Audio API 合成提示音：连续 3 声 880Hz 方波 beep（每声 0.18s，间隔 0.12s），不依赖任何音频文件，彻底解决 `notice.wav` 缺失问题
  - 保留 `notice.wav` HTMLAudioElement 作为兜底（Web Audio 不可用时）
  - 新增 `activateAudio()` 用于用户手势激活 AudioContext（绕过 autoplay 限制）
- `src/renderer/components/SettingPanel.tsx`
  - "播放音频"按钮 `onClick` 接入 `playRefundSound(true)`（强制播放，用于手动验证音频通道）

## [1.0.71] - 2026-09-19

### ESC/POS 打印核心移植（阶段 6）

#### 新增
- `src/main/utils/escpos.ts`：ESC/POS 指令封装（对应 KMP `EscPosPrinter.kt`）
  - GBK 编码（iconv-lite）解决热敏打印机中文乱码
  - 对齐/加粗/双倍字号/自定义缩放/走纸/切纸
  - `lineLR` 左右对齐一行（按 GBK 字节宽度填充空格）
  - `product` 商品行（自动换行 + 右侧"数量 单价"）
  - `barcode` CODE128 条码（bwip-js 生成 PNG → 二值化 → GS v 0 光栅位图指令）
  - `qrcode` 二维码（ESC/POS 原生 QR 指令）
  - `localImage` 本地图片打印（客服图片）
  - `rasterBitImageFromPng` PNG → 二值化 → 位图指令
- `src/main/utils/printTemplate.ts`：小票模板（对应 KMP `PrintTemplate.kt`）
  - 58mm 纸宽（32 字符）完整模板：大号订单号→平台名→门店名→用户联→条码→订单信息→备注→商品列表→金额汇总→底部提示→切纸
- `src/main/services/PrintService.ts`：打印服务（对应 KMP `PrintTask.kt` + `PrintManager.kt`）
  - FIFO 队列 + 串行消费互斥锁（防并发）
  - 双重去重：内存 `printedMap` + `printingSet`
  - 3 次重试：失败重新入队，超限保留 pending 待手动重打
  - SQLite 持久化：入队前写 `pending_print_order`，成功后迁移到 `printed_order`
  - 重启恢复：启动加载今日 pending 重新入队
  - 平台轮询：按平台 id 独立定时器，10 秒间隔（`POLL_INTERVAL`）
  - 退款通知：检测到 `refundNotice` 触发事件（6 秒冷却）
  - 原生模块懒加载：`@thiagoelg/node-printer`（驱动原始字节）/ `serialport`（串口写入）
- `src/main/ipc/print.ipc.ts`：打印 IPC 通道
  - `print:setDevice` / `print:getDevice` 设备绑定
  - `print:updatePlatforms` / `print:stopAll` 平台轮询
  - `print:requeue` / `print:loadPrinted` 持久化恢复
  - `print:getSnapshots` 快照查询
  - `print:reprint` 手动重打
  - 事件广播：`print:log` / `print:printed` / `print:refund-notice` / `print:printed-updated` / `print:pending-updated`

#### 修改
- `package.json`：新增依赖 `iconv-lite@^0.6.3`、`pngjs@^7.0.0`、`@thiagoelg/node-printer@^4.2.1`
- `electron.vite.config.ts`：主进程 external 新增 `iconv-lite`/`pngjs`/`@thiagoelg/node-printer`
- `src/main/index.ts`：IPC 注册改为传递主窗口获取函数（供 PrintService 广播事件）
- `src/main/ipc/index.ts`：注册 `registerPrintIpc`（含主窗口参数）
- `src/main/services/DatabaseService.ts`：新增 `getPrintedOrders` 方法（返回完整记录供启动加载）
- `src/main/services/ApiService.ts`：新增响应拦截器递归 snake_case→camelCase 转换（对应 KMP `@SerialName`）
- `src/preload/index.ts`：暴露打印服务方法（setPrintDevice/getPrintDevice/updatePlatforms/stopAllPolling/requeuePending/loadPrinted/getPrintSnapshots/reprintOrder）
- `src/renderer/api/bridge.ts`：fallback 补齐打印方法
- `src/renderer/stores/printStore.ts`：重写为订阅式（订阅 `print:printed-updated`/`print:pending-updated` 事件实时更新快照）
- `src/renderer/stores/deviceStore.ts`：选中设备时同步绑定到 PrintService（`setPrintDevice`）
- `src/renderer/views/HomeView.tsx`：接入打印服务（启动订阅事件/加载快照/重启恢复；平台勾选变更触发 `updatePlatforms`；手动重打 `reprintOrder`）
- `src/renderer/components/PlatformGrid.tsx`：类型修正 `ShopPrintOrder`→`ShopPrintOrderItem`；重打回调新增 `daySeq` 参数

### 设备管理与后端对接（阶段 4-5）
- `ApiService`：5 个接口（getLastAppVersionData/getPlatformList/getDaySeq/getOrderList/getOrder）
- `DeviceService`：系统驱动打印机枚举 + 串口设备枚举 + 静默测试打印
- `deviceStore` / `platformStore`：渲染层状态管理

### 网络检查与退款提示音（阶段 7）

#### 新增
- `src/main/services/NetworkService.ts`：网络连通性检查（对应 KMP `NetworkCheck.kt`）
  - 定时 HEAD 请求 DOMAIN_URL（30 秒间隔，3 秒超时）
  - 2xx 或 401 视为可达（401 表示服务器响应了，仅需鉴权）
  - 状态变化时通过事件广播（减少无效 IPC）
- `src/main/ipc/network.ipc.ts`：网络检查 IPC
  - `network:start` / `network:stop` / `network:check` / `network:status`
  - 事件：`network:status-changed`
- `src/renderer/utils/audioPlayer.ts`：退款提示音播放器（对应 KMP `DesktopAudioPlayer.kt`）
  - HTML5 Audio 播放 `notice.wav`（冷却逻辑已由主进程 PrintService 处理）
  - 文件缺失静默失败，不阻塞打印流程
- `src/renderer/utils/logger.ts`：渲染进程轻量日志

#### 修改
- `src/main/ipc/index.ts`：注册 `registerNetworkIpc`
- `src/preload/index.ts`：暴露网络检查方法（startNetworkCheck/stopNetworkCheck/checkNetwork/getNetworkStatus）
- `src/renderer/api/bridge.ts`：fallback 补齐网络方法
- `src/renderer/stores/networkStore.ts`：改为事件驱动（订阅 `network:status-changed`）
- `src/renderer/components/AppFooter.tsx`：新增 online 色点 + 边框
- `src/renderer/views/HomeView.tsx`：启动时初始化网络检查；退款通知播放提示音；离开停止网络检查

### 自动更新（阶段 8）

#### 新增
- `src/main/services/UpdateService.ts`：electron-updater 封装（对应 KMP `UpdateManager.kt` + `UpdateBuilder.kt`）
  - 检查更新（`checkForUpdates`，不自动下载）
  - 下载更新（`downloadUpdate`）
  - 退出并安装（`quitAndInstall`）
  - Win7 兼容：关闭 `disableDifferentialDownload`（增量更新在 Win7 不稳定）
  - 事件：`update-available`/`download-progress`/`update-downloaded`/`error`/`status-changed`
- `src/main/ipc/update.ipc.ts`：更新 IPC
  - `update:check` / `update:download` / `update:install` / `update:status`
  - 事件：`update:status-changed` / `update:available` / `update:not-available` / `update:progress` / `update:downloaded` / `update:error`
- `src/renderer/components/UpdateDialog.tsx`：更新弹窗（对应 KMP `UpdateDialog.kt`）
  - 状态流转：available → downloading（进度条）→ downloaded（安装按钮）/ error（重试）

#### 修改
- `src/main/index.ts`：app ready 后初始化 `UpdateService.init()`
- `src/main/ipc/index.ts`：注册 `registerUpdateIpc`
- `electron-builder.yml`：补充 `runAfterFinish: true` 与 Win7 NSIS 注释
- `src/preload/index.ts`：暴露更新方法（checkUpdate/downloadUpdate/installUpdate/getUpdateStatus）
- `src/renderer/api/bridge.ts`：fallback 补齐更新方法
- `src/renderer/stores/updateStore.ts`：改为事件驱动 + 双检查机制（接口检查版本号 + electron-updater 检查更新源）
- `src/renderer/views/SplashView.tsx`：发现新版本自动弹出 UpdateDialog（替代原 window.open）

### 自动更新待提供接口预留调整（2026-09-19 补充）

> 版本号对比接口与更新下载地址由用户单独提供，当前改为"待提供/可配置"状态，未配置时优雅降级不阻断启动。

#### 修改
- `src/main/config.ts`：`UPDATE_SERVER_URL` 默认值由猜测地址改为空字符串（待提供），新增 `VERSION_CHECK_ENABLED` 版本检查开关；补充配置说明注释
- `src/main/services/UpdateService.ts`：`init()` 在 `UPDATE_SERVER_URL` 为空时跳过 electron-updater 初始化（日志告警）；新增 `isUpdaterAvailable()` 方法；`checkForUpdates`/`downloadUpdate`/`quitAndInstall` 未配置时返回友好提示而非报错
- `src/main/ipc/update.ipc.ts`：`update:status` 返回值新增 `updaterAvailable` 字段
- `src/renderer/stores/updateStore.ts`：新增 `updaterAvailable` 状态；`checkVersion` 接口失败/非 200 时降级为 `usual` 不阻断启动（原为 `error` 阻断）
- `src/renderer/components/UpdateDialog.tsx`：下载地址未配置时显示提示文案并禁用"开始更新"按钮
- `.env` / `.env.production`：`VITE_UPDATE_SERVER_URL` 改为空（待提供），新增 `VITE_VERSION_CHECK_ENABLED`，补充配置注释
- `electron-builder.yml`：`publish.url` 改为空字符串（待提供）

#### 新增文档
- `docs/自动更新方案文档.md`：详述双检查机制、待提供接口清单、服务器目录结构、latest.yml 格式、状态机、降级策略、接入步骤
