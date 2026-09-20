# PG到家小票打印系统（Electron 版）

> 比优特到家小票打印系统的 Electron 桌面端重写版本。将原 KMP（Compose Desktop）版本完整迁移至 Electron 平台，自动轮询外卖平台订单并驱动热敏打印机打印小票。**必须兼容 Windows 7 系统。**

## 一、项目简介

面向到店工作人员，主要功能：

- **启动检查**：Splash 启动页检查服务器版本信息，展示检查状态（检查中/有新版本/正常/异常）
- **门店登录**：输入门店号进入主页，本地持久化记住门店号，下次自动跳过
- **打印设备管理**：枚举系统驱动打印机和串口设备，单选切换当前打印设备，支持刷新
- **平台选择**：从服务器获取外卖平台列表（美团/京东等），多选勾选需监听的平台
- **自动轮询打印**：按选中平台每 10 秒轮询新订单，获取订单详情，ESC/POS 热敏打印，打印队列 + 双重去重（已打印 + 打印中）+ 3 次重试
- **SQLite 持久化**：已打印订单表（防重复）+ 待打印订单表（重启恢复）+ 取消订单表
- **小票模板**：订单号大号字 → 平台名 → 门店名 → 用户联 → CODE128 条码 → 订单信息 → 备注 → 商品列表 → 金额汇总 → 底部提示 → 客服图片 → 切纸
- **退款提示音**：检测到退款通知播放提示音（6 秒冷却防频繁）
- **网络检查**：定时 HEAD 请求检查服务器连通性，底部状态栏展示
- **崩溃日志**：未捕获异常写日志文件 + 弹窗提示 + 可打开日志目录
- **自动更新**：检查版本 → 下载安装包 → 覆盖安装 → 重启升级

## 二、技术栈

| 分类 | 技术 | 说明 |
| --- | --- | --- |
| 核心 | **Electron 22.3.27** | 锁定，最后支持 Win7/8/8.1（Chromium 108），不可升级 |
| 打包 | electron-builder 24.x | nsis 格式安装包 |
| 更新 | electron-updater 6.x | 全量 nsis 包，关闭 differentialDownload |
| 渲染层 | React 18 + TypeScript + MUI v6 | 与 Compose 编程模型一一对应 |
| 构建 | Vite 5 + electron-vite | 三进程独立构建（main/preload/renderer） |
| 状态 | Zustand | 类似 StateFlow |
| 存储 | electron-store | 配置持久化 |
| 日志 | electron-log | 分级 + 日期轮转 |
| 打印 | serialport + usb + node-thermal-printer | 设备枚举与 ESC/POS 指令 |
| 网络 | axios | HTTP 请求 |

## 三、目录结构

```
pgprintElectronversion/
├── src/
│   ├── main/                      # 主进程
│   │   ├── index.ts               # 入口：窗口/生命周期/Win7 兼容补丁/菜单
│   │   ├── config.ts              # 配置常量（域名/密钥/超时/轮询间隔）
│   │   ├── ipc/                   # IPC 通道注册
│   │   │   ├── index.ts
│   │   │   ├── api.ipc.ts
│   │   │   ├── print.ipc.ts
│   │   │   ├── device.ipc.ts
│   │   │   ├── store.ipc.ts
│   │   │   ├── network.ipc.ts
│   │   │   ├── update.ipc.ts
│   │   │   ├── clipboard.ipc.ts
│   │   │   └── kf-photo.ipc.ts
│   │   ├── services/              # 业务逻辑层
│   │   │   ├── ApiService.ts      # 后端接口（axios）
│   │   │   ├── PrintService.ts    # 打印队列/轮询/去重/重试/恢复
│   │   │   ├── DeviceService.ts   # 打印设备枚举
│   │   │   ├── JsonStore.ts       # 本地数据持久化（替代 SQLite）
│   │   │   ├── NetworkService.ts  # 连通性定时检查
│   │   │   └── UpdateService.ts   # electron-updater 封装
│   │   └── utils/                 # 工具层
│   │       ├── escpos.ts          # ESC/POS 指令封装
│   │       ├── printTemplate.ts   # 小票模板
│   │       ├── logger.ts          # electron-log 配置
│   │       ├── crash.ts           # crashReporter + uncaughtException
│   │       ├── version.ts         # 版本比较
│   │       └── win7-compat.ts     # Win7 兼容补丁
│   ├── preload/
│   │   └── index.ts               # contextBridge 安全暴露 IPC（加固版）
│   └── renderer/                  # 渲染进程
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── router/
│       ├── stores/                # Zustand stores
│       ├── views/                 # Splash/Login/Home 三页面
│       ├── components/            # 通用组件
│       ├── api/bridge.ts          # 封装 window.electronAPI
│       └── theme/
├── resources/                     # asar 外静态资源（图标/提示音）
├── docs/                          # 项目文档
├── electron-builder.yml           # 打包配置
├── electron.vite.config.ts        # 三进程构建配置
├── .env / .env.production         # 环境变量
└── CHANGELOG.md                   # 变更日志
```

## 四、快速开始

### 环境要求

- Node.js 16.x（匹配 Electron 22 的 Node ABI）
- 运行环境：Windows 7 SP1 + KB2533623 补丁

### 安装依赖

```bash
npm install
```

### 开发模式（带 HMR 热更新）

```bash
npm run dev
```

### 打包 Windows 安装包（nsis）

```bash
npm run build:win
```

产物在 `dist/` 目录，双击 `.exe` 安装。

### 仅构建不打包（调试构建产物）

```bash
npm run build
```

### 重编原生模块（针对 Electron 22 ABI）

当 `serialport` / `usb` 等原生模块版本变动时需重新编译：

```bash
npm run rebuild
```

## 五、Windows 7 兼容性要点

1. **Electron 版本锁定 22.3.27**：23+ 不再支持 Win7
2. **关闭 GPU 硬件加速**：`app.disableHardwareAcceleration()` + `--disable-gpu --no-sandbox` 启动参数，防老显卡驱动黑屏崩溃
3. **TLS 1.2**：服务器必须支持 TLS 1.2（Win7不支持 TLS 1.3）
4. **原生模块重编**：`serialport`/`usb` 用 `@electron/rebuild` 针对 Electron 22 ABI 编译
5. **electron-updater 全量包**：关闭 `differentialDownload`，nsis 全量覆盖安装
6. **系统要求**：Win7 SP1 + KB2533623 补丁（否则启动报错）

## 六、后端接口

- 域名：`http://<生产域名>`
- 接口前缀：`/index.php/Home/<接口前缀名>/`
- 鉴权密钥：`secret`（值见 `src/main/config.ts` 的 `API_SECRET`）

详见 [接口对接文档](docs/接口对接文档.md)。

## 七、项目文档

- [接口对接文档](docs/接口对接文档.md) — 接口地址/请求参数/返回结构/调用方式
- [页面功能流程文档](docs/页面功能流程文档.md) — 各页面功能/操作流程/状态流转
- [自动更新方案文档](docs/自动更新方案文档.md) — 更新流程/服务器配置/latest.yml
- [KMP 到 Electron 对照检查](docs/KMP到Electron对照检查文档.md) — 迁移对照
- [变更日志](CHANGELOG.md) — 版本演进记录

## 八、参考项目

原 KMP（Compose Desktop）版本：`/Users/mac/Documents/AndroidCompose/pgprint`

> ⚠️ 参考项目仅供查看对照，**绝对不允许修改**。原版版本 1.0.71。

## 九、问题排查

应用运行出问题时，优先查看日志文件：

- 路径：`%APPDATA%/pgprint-electron/logs/main.log`（Win7 通常在 `C:\Users\<用户>\AppData\Roaming\pgprint-electron\logs\`）
- 主进程崩溃：搜 `uncaughtException` / `[preload-error]`
- 接口问题：搜 `getDaySeq` / `getOrderList` / `[api]` 接口名
- preload 注入：搜 `[bridge]`（`已注入` = 正常，`未注入` = preload 崩溃）

也可在应用中按 `F12` 打开 DevTools 查看 Console。