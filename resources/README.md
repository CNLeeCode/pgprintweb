# resources/ 外置资源目录

此目录下的文件通过 `electron-builder.yml` 的 `extraResources` 配置，
打包后**原样复制到安装目录的 `resources/` 子目录**（位于 asar 包外），
应用升级（electron-updater 全量 nsis 包覆盖安装）时会随新包一起部署。

## 适用场景

必须放在 asar 外的文件：
- **媒体文件**（音频/视频）：Chromium 媒体栈不走 asar patch，asar 内的 wav/mp3
  会被 HTMLAudioElement 加载失败，必须放 asar 外
- **需要运行时读取的原始文件**：如本应用的 `notice.wav` 退款提示音

## 当前文件清单

| 文件 | 用途 | 加载方 |
|------|------|--------|
| `notice.wav` | 退款通知提示音 | 渲染进程 `audioPlayer.ts` 通过 `file://` 协议加载 |

## notice.wav 规格建议

- 格式：WAV PCM（无压缩，Win7 Chromium 108 原生支持，无需解码器）
- 时长：1-2 秒
- 采样率：22050Hz / 44100Hz
- 声道：单声道
- 音量：已归一化（避免过大爆音）

## 开发环境访问路径

| 环境 | 路径 |
|------|------|
| 开发 | `<项目根>/resources/notice.wav` |
| 打包后 | `<安装目录>/resources/notice.wav`（即 `process.resourcesPath/notice.wav`） |

路径解析由 `src/preload/index.ts` 的 `noticeWavUrl` 字段统一处理，
通过 `contextBridge` 同步暴露给渲染进程，`audioPlayer.ts` 直接使用。