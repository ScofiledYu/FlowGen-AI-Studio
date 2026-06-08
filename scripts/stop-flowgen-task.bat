@echo off
setlocal EnableExtensions
chcp 65001 >nul

REM 停止 FlowGen（释放 3001 端口）
for %%I in ("%~dp0..") do set "APP_DIR=%%~fI"
set "PORT=3001"
set "LOG_FILE=%APP_DIR%\logs\flowgen-service.log"

if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs" 2>nul

>>"%LOG_FILE%" echo.
>>"%LOG_FILE%" echo [FlowGen] %date% %time% stop-flowgen-task PORT=%PORT%

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  >>"%LOG_FILE%" echo [FlowGen] taskkill PID %%P
  taskkill /PID %%P /F >>"%LOG_FILE%" 2>&1
)

endlocal
exit /b 0
