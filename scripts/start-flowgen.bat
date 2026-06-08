@echo off
chcp 65001 >nul
title FlowGen AI Studio
setlocal EnableExtensions

REM ============================================================
REM  FlowGen 生产环境 — 双击启动 / 启动文件夹快捷方式
REM  程序目录: D:\apps\flowgen-ai-studio
REM ============================================================

for %%I in ("%~dp0..") do set "APP_DIR=%%~fI"
set "MYSQL_SERVICE=MySQL57"
set "PORT=3001"
set "FLOWGEN_STORAGE=relational"
set "NODE_OPTIONS=--max-old-space-size=8192"

set "EXIT_CODE=0"

cd /d "%APP_DIR%" || (
  echo [FlowGen] 错误：程序目录不存在
  echo           %APP_DIR%
  set "EXIT_CODE=1"
  goto :fail
)

if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=C:\Program Files\nodejs;%PATH%"
) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
  set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
)

where node >nul 2>&1 || (
  echo [FlowGen] 错误：未找到 node.exe
  set "EXIT_CODE=1"
  goto :fail
)

where npm >nul 2>&1 || (
  echo [FlowGen] 错误：未找到 npm
  set "EXIT_CODE=1"
  goto :fail
)

echo [FlowGen] %date% %time%
echo [FlowGen] 工作目录: %CD%
echo [FlowGen] 启动 MySQL: %MYSQL_SERVICE%
net start "%MYSQL_SERVICE%" >nul 2>&1
if errorlevel 1 echo [FlowGen] 提示：MySQL 可能已在运行

echo [FlowGen] http://localhost:%PORT%
echo [FlowGen] 健康检查: http://localhost:%PORT%/flowgen-api/health/db
echo [FlowGen] 关闭本窗口即停止服务
echo.

call npm start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [FlowGen] 服务已退出，错误码 %EXIT_CODE%
pause
endlocal
exit /b %EXIT_CODE%

:fail
pause
endlocal
exit /b 1
