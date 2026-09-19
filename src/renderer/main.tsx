import React from 'react'
import ReactDOM from 'react-dom/client'
// ⚠️ 必须用 HashRouter，不能用 BrowserRouter。
// 打包后主进程用 loadFile 加载本地 index.html，URL 形如
// file:///D:/.../resources/app.asar/out/renderer/index.html。
// BrowserRouter 依赖 History API 的 pathname 做路由匹配，在 file:// 协议下
// pathname 是文件绝对路径（含 index.html），路由表里的 "/" "/login" "/home"
// 全部匹配失败 → 兜底 Navigate 又在 file:// 下死循环 → 整个路由树不渲染 → 白屏。
// HashRouter 用 location.hash（#/#/login），与协议/pathname 无关，file:// 下稳定。
import { HashRouter } from 'react-router-dom'
import { ThemeProvider, CssBaseline } from '@mui/material'
import App from './App'
import { theme } from './theme/theme'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>
)