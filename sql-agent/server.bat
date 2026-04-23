@echo off
setlocal enabledelayedexpansion
set PORT=3000
set PID_FILE=server.pid

if "%1"=="start" goto start
if "%1"=="stop" goto stop
if "%1"=="restart" goto restart
if "%1"=="status" goto status
goto menu

:start
echo.
echo Starting server...
call :check_pid_file
if defined SAVED_PID (
    call :verify_process !SAVED_PID!
    if defined PID (
        echo Server already running ^(PID: !PID!^)
        goto :end
    ) else (
        echo Stale PID file found, cleaning up...
        del /q "%PID_FILE%" 2>nul
    )
)

call :check_port
if defined PID (
    echo Server already running ^(PID: !PID!^)
    goto :end
)

echo Starting server with ts-node...
start /B cmd /c "npm start"
echo Waiting for server to start...
ping 127.0.0.1 -n 3 >nul

call :check_port
if defined PID (
    echo !PID! > "%PID_FILE%"
    echo Server started successfully ^(PID: !PID!^)
    echo URL: http://localhost:%PORT%
) else (
    echo Failed to start server
    echo Check server.log for details
)
goto :end

:stop
echo.
echo Stopping server...
call :check_pid_file
if defined SAVED_PID (
    call :verify_process !SAVED_PID!
    if defined PID (
        taskkill /F /PID !PID! >nul 2>&1
        echo Server stopped ^(PID: !PID!^)
        del /q "%PID_FILE%" 2>nul
        goto :end
    )
)

call :check_port
if defined PID (
    taskkill /F /PID !PID! >nul 2>&1
    echo Server stopped ^(PID: !PID!^)
    del /q "%PID_FILE%" 2>nul
) else (
    echo Server not running
)
goto :end

:restart
echo.
echo Restarting server...
call :stop
ping 127.0.0.1 -n 2 >nul
call :start
goto :end

:status
echo.
call :check_pid_file
if defined SAVED_PID (
    call :verify_process !SAVED_PID!
    if defined PID (
        echo Server is running ^(PID: !PID!^)
        echo URL: http://localhost:%PORT%
        goto :end
    )
)

call :check_port
if defined PID (
    echo Server is running ^(PID: !PID!^)
    echo URL: http://localhost:%PORT%
) else (
    echo Server is not running
)
goto :end

:menu
echo.
echo ========================================
echo   Dunhuang Agent - Server Manager
echo ========================================
echo.
echo   1. Start Server
echo   2. Stop Server
echo   3. Restart Server
echo   4. Status
echo   0. Exit
echo.
set /p choice=Select option (0-4):
if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto restart
if "%choice%"=="4" goto status
goto :end

:check_port
set PID=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do set PID=%%a
goto :eof

:check_pid_file
set SAVED_PID=
if exist "%PID_FILE%" (
    set /p SAVED_PID=^<"%PID_FILE%"
)
goto :eof

:verify_process
set PID=
for /f "tokens=1" %%a in ('tasklist /FI "PID eq %1" /NH 2^>nul ^| findstr /C:"%1"') do set PID=%%a
goto :eof

:end
