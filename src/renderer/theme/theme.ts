import { PaletteMode, createTheme } from '@mui/material/styles'

/**
 * MUI 主题（对应 KMP Theme.kt + AppColors）
 * 配色与 Compose Material3 原版保持一致
 */
export const AppColors = {
  primary: '#0057C2',
  primaryDark: '#073AB5',
  windowBackground: '#F2F2F2',
  headerBackground: '#ECEDF9',
  successGreen: '#4CAF50',
  errorRed: '#F44336',
  pendingOrange: '#FF9800',
  textPrimary: '#333333',
  textSecondary: '#666666',
  textHint: '#999999',
  white: '#FFFFFF'
} as const

export const theme = createTheme({
  palette: {
    mode: 'light' as PaletteMode,
    primary: { main: AppColors.primary, dark: AppColors.primaryDark },
    success: { main: AppColors.successGreen },
    error: { main: AppColors.errorRed },
    warning: { main: AppColors.pendingOrange },
    background: { default: AppColors.windowBackground, paper: AppColors.white },
    text: {
      primary: AppColors.textPrimary,
      secondary: AppColors.textSecondary
    }
  },
  typography: {
    fontFamily: '"Noto Sans", "Microsoft YaHei", "微软雅黑", Roboto, sans-serif',
    h5: { fontSize: 28, fontWeight: 700 },
    h6: { fontSize: 18, fontWeight: 600 },
    body2: { fontSize: 14 }
  },
  shape: { borderRadius: 5 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 12, fontWeight: 600 }
      }
    },
    MuiPaper: {
      styleOverrides: { root: { borderRadius: 5 } }
    }
  }
})