; =============================================================================
; NSIS 自定义安装脚本（electron-builder nsis.include 钩子）
; =============================================================================
;
; 用途：
;   修复 electron-builder NSIS 模板在 /S 静默安装模式下不创建桌面/开始菜单
;   快捷方式的问题，保证 UpgradeService.quitAndInstall 用
;   "installer.exe /S --updated" 静默覆盖升级后，用户依然能在桌面和开始菜单
;   看到 pgprinter 图标。
;
; 根因：
;   electron-builder 24.x 的 nsis 模板把桌面/开始菜单快捷方式的创建逻辑
;   放在向导页面的 show 函数里（MUI_PAGE_INSTFILES Page Pre/Show 钩子），
;   nsis 在 silent 模式（/S）下会跳过所有页面函数，导致：
;     - 首次安装：用户走完向导 → 快捷方式正常创建 ✅
;     - 自动更新：installer /S --updated 静默走完 → 没有快捷方式 ❌
;   结果就是 Win7 真机升级到新版本后，用户每次开打印程序都得手动进
;   Program Files\pgprinter\pgprinter.exe 双击，体验严重劣化。
;
; 方案 C 修复：
;   用 electron-builder 提供的 `customInstall` 注入宏。该宏在 install
;   Section 中被直接调用（不经过页面函数），silent 模式也必定执行。
;   在宏内部用 NSIS CreateShortCut 指令显式创建快捷方式，与向导模式创建的
;   完全等价（同名同目标，覆盖式创建不会冲突）。
;
; 路径说明：
;   - $INSTDIR                   安装目录（如 C:\Program Files\pgprinter）
;   - ${APP_EXECUTABLE_FILENAME} 主程序文件名（pgprinter.exe，electron-builder 注入）
;   - ${APP_FILENAME}            安装目录/快捷方式名（pgprinter，electron-builder 注入）
;   - ${SHORTCUT_NAME}           快捷方式名（pgprinter，对应 nsis.shortcutName）
;   - $DESKTOP                   桌面目录
;   - $SMPROGRAMS                开始菜单顶级目录
;
; 兼容性：
;   - 与 perMachine=true 配合，SetShellVarContext all 让快捷方式写入
;     All Users 桌面/开始菜单，所有 Windows 用户都能看到。
;   - 卸载阶段由 electron-builder 模板默认删除快捷方式（按相同命名识别），
;     不需要在 customUnInstall 重复清理。
;
; 参考：
;   https://www.electron.build/configuration/nsis.html#custom-nsis-script
; =============================================================================

!macro customInstall
  ; 静默模式同样执行：customInstall 在 Section "Install" 中被调用，
  ; 不依赖 nsis 页面回调和 wizard 状态
  SetShellVarContext all

  ; ----- 桌面快捷方式 -----
  ; 同名 .lnk 已存在时直接覆盖，保证升级后指向新版 exe
  CreateShortCut \
    "$DESKTOP\${SHORTCUT_NAME}.lnk" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" \
    "" "" 0

  ; ----- 开始菜单快捷方式 -----
  ; 创建子目录后写入同名 .lnk，对应 productName 子目录
  CreateDirectory "$SMPROGRAMS\${APP_FILENAME}"
  CreateShortCut \
    "$SMPROGRAMS\${APP_FILENAME}\${SHORTCUT_NAME}.lnk" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" \
    "" "" 0
!macroend