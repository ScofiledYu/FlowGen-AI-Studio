@echo off
setlocal EnableExtensions
REM FlowGen stack boot: MySQL -> PM2 (blue/green) -> Nginx
REM Copy to D:\apps\start-flowgen.bat on server; edit paths below.
REM Run scheduled task as the same user who ran pm2 save (not SYSTEM).

set "MYSQL_SVC=MySQL57"
set "NGINX_DIR=D:\nginx"
set "PM2_CMD=D:\tools\npm\pm2.cmd"
set "APPS_DIR=D:\apps"
if not defined PM2_HOME set "PM2_HOME=%USERPROFILE%\.pm2"
set "MYSQL_WAIT_SEC=8"
set "NODE_WAIT_SEC=5"

call :log FlowGen stack startup begin.

REM --- 1) MySQL (must be first) ---
sc query %MYSQL_SVC% | find /I "RUNNING" >nul
if errorlevel 1 (
  call :log Starting %MYSQL_SVC%...
  net start %MYSQL_SVC%
  if errorlevel 1 (
    call :log ERROR: %MYSQL_SVC% failed to start.
    exit /b 1
  )
  timeout /t %MYSQL_WAIT_SEC% /nobreak >nul
) else (
  call :log %MYSQL_SVC% already running.
  timeout /t 3 /nobreak >nul
)

REM --- 2) PM2 / FlowGen (3001 blue + 3002 green) ---
if not exist "%PM2_CMD%" (
  call :log ERROR: PM2 not found: %PM2_CMD%
  exit /b 1
)

set "NEED_PM2=0"
call :check_ports || set "NEED_PM2=1"

if "%NEED_PM2%"=="1" (
  if not exist "%PM2_HOME%\dump.pm2" (
    call :log ERROR: %PM2_HOME%\dump.pm2 not found. Run pm2 save while blue+green are online.
    exit /b 1
  )
  call :log FlowGen ports not listening, running pm2 resurrect...
  cd /d "%APPS_DIR%"
  set "PM2_HOME=%PM2_HOME%"
  call "%PM2_CMD%" resurrect
  timeout /t %NODE_WAIT_SEC% /nobreak >nul
  call :check_ports
  if errorlevel 1 (
    call :log ERROR: ports 3001/3002 still not listening after pm2 resurrect.
    call :log Check pm2 status and dump.pm2; task user must match pm2 save user.
    exit /b 1
  )
  call :log FlowGen ports 3001/3002 are listening.
) else (
  call :log FlowGen ports 3001/3002 already listening.
)

REM --- 3) Nginx (after Node is up) ---
tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
if errorlevel 1 (
  if not exist "%NGINX_DIR%\nginx.exe" (
    call :log ERROR: nginx.exe not found in %NGINX_DIR%
    exit /b 1
  )
  call :log Starting Nginx...
  cd /d "%NGINX_DIR%"
  start "" nginx.exe
  timeout /t 2 /nobreak >nul
) else (
  call :log Nginx already running.
)

call :log FlowGen stack startup done.
exit /b 0

:log
set "TS=%date% %time:~0,8%"
set "TS=%TS: =0%"
echo [%TS%] %*
exit /b 0

:check_ports
netstat -ano | findstr /R /C:":3001 " | findstr LISTENING >nul || exit /b 1
netstat -ano | findstr /R /C:":3002 " | findstr LISTENING >nul || exit /b 1
exit /b 0
