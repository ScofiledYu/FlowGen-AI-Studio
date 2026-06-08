@echo off
setlocal EnableExtensions
chcp 65001 >nul

REM ============================================================
REM  FlowGen — 任务计划程序专用（无窗口、日志写入 logs）
REM  程序目录: D:\apps\flowgen-ai-studio
REM
REM  任务计划程序 → 创建任务：
REM    名称: FlowGen AI Studio
REM    触发器: 启动时（或登录时）
REM    操作 → 启动程序:
REM      程序: D:\apps\flowgen-ai-studio\scripts\start-flowgen-task.bat
REM      起始于: D:\apps\flowgen-ai-studio
REM    常规: 不管用户是否登录都要运行（需填管理员密码）
REM          或使用「只在用户登录时运行」+ 你的账号
REM    设置: 如果任务已在运行，则不启动新实例
REM ============================================================

for %%I in ("%~dp0..") do set "APP_DIR=%%~fI"
set "MYSQL_SERVICE=MySQL57"
set "PORT=3001"
set "FLOWGEN_STORAGE=relational"
set "NODE_OPTIONS=--max-old-space-size=8192"

if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE_EXE=C:\Program Files\nodejs\node.exe"
) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
  set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
) else (
  set "NODE_EXE=node"
)

set "LOG_DIR=%APP_DIR%\logs"
set "LOG_FILE=%LOG_DIR%\flowgen-service.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul

>>"%LOG_FILE%" echo.
>>"%LOG_FILE%" echo ============================================================
>>"%LOG_FILE%" echo [FlowGen] %date% %time% task start
>>"%LOG_FILE%" echo [FlowGen] APP_DIR=%APP_DIR%

cd /d "%APP_DIR%" 2>>"%LOG_FILE%"
if errorlevel 1 (
  >>"%LOG_FILE%" echo [FlowGen] ERROR: cannot cd to %APP_DIR%
  endlocal
  exit /b 1
)

>>"%LOG_FILE%" echo [FlowGen] MySQL service: %MYSQL_SERVICE%
net start "%MYSQL_SERVICE%" >>"%LOG_FILE%" 2>&1

set "FLOWGEN_STORAGE=%FLOWGEN_STORAGE%"
set "NODE_OPTIONS=%NODE_OPTIONS%"
set "PORT=%PORT%"

>>"%LOG_FILE%" echo [FlowGen] PORT=%PORT% STORAGE=%FLOWGEN_STORAGE%
>>"%LOG_FILE%" echo [FlowGen] NODE_EXE=%NODE_EXE%
>>"%LOG_FILE%" echo [FlowGen] node server.js ...

"%NODE_EXE%" "%APP_DIR%\server.js" >>"%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

>>"%LOG_FILE%" echo [FlowGen] %date% %time% exited code=%EXIT_CODE%
endlocal
exit /b %EXIT_CODE%
