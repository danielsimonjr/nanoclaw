@echo off
setlocal enabledelayedexpansion

rem setup.bat - Native Windows bootstrap for NanoClaw (cmd.exe, no bash needed).
rem Mirrors setup.sh: checks Node, installs dependencies, verifies the native
rem module, and emits the same structured status block. Under WSL or Git Bash,
rem use setup.sh instead.

set "PROJECT_ROOT=%~dp0"
rem strip trailing backslash
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"
set "LOG_FILE=%PROJECT_ROOT%\logs\setup.log"

if not exist "%PROJECT_ROOT%\logs" mkdir "%PROJECT_ROOT%\logs"

call :log "=== Bootstrap started (windows) ==="

set "PLATFORM=windows"
set "IS_WSL=false"
set "IS_ROOT=false"
net session >nul 2>&1 && set "IS_ROOT=true"

rem --- Node.js check ---
set "NODE_OK=false"
set "NODE_VERSION=not_found"
set "NODE_PATH=not_found"

where node >nul 2>&1
if %ERRORLEVEL%==0 (
  for /f "delims=" %%v in ('node -e "process.stdout.write(process.versions.node)" 2^>nul') do set "NODE_VERSION=%%v"
  for /f "delims=" %%p in ('where node 2^>nul') do (
    if "!NODE_PATH!"=="not_found" set "NODE_PATH=%%p"
  )
  rem Let node decide whether the major version is >= 20 (avoids batch parsing).
  node -e "process.exit(parseInt(process.versions.node,10)>=20?0:1)" >nul 2>&1
  if !ERRORLEVEL!==0 ( set "NODE_OK=true" ) else ( set "NODE_OK=false" )
  call :log "Node !NODE_VERSION! at !NODE_PATH! (ok=!NODE_OK!)"
) else (
  call :log "Node not found"
)

rem --- npm install ---
set "DEPS_OK=false"
set "NATIVE_OK=false"

if "%NODE_OK%"=="true" (
  pushd "%PROJECT_ROOT%"
  call :log "Running npm install"
  call npm install >> "%LOG_FILE%" 2>&1
  if !ERRORLEVEL!==0 (
    set "DEPS_OK=true"
    call :log "npm install succeeded"
    rem Verify native module (better-sqlite3)
    node -e "require('better-sqlite3')" >> "%LOG_FILE%" 2>&1
    if !ERRORLEVEL!==0 ( set "NATIVE_OK=true" & call :log "better-sqlite3 loads OK" ) else ( call :log "better-sqlite3 failed to load" )
  ) else (
    call :log "npm install failed"
  )
  popd
) else (
  call :log "Skipping npm install - Node not available"
)

rem better-sqlite3 ships prebuilt Windows binaries; native build tools are
rem usually unnecessary. NATIVE_OK is the real signal.
set "HAS_BUILD_TOOLS=true"

rem --- Status ---
set "STATUS=success"
if "%NODE_OK%"=="false" (
  set "STATUS=node_missing"
) else if "%DEPS_OK%"=="false" (
  set "STATUS=deps_failed"
) else if "%NATIVE_OK%"=="false" (
  set "STATUS=native_failed"
)

echo === NANOCLAW SETUP: BOOTSTRAP ===
echo PLATFORM: %PLATFORM%
echo IS_WSL: %IS_WSL%
echo IS_ROOT: %IS_ROOT%
echo NODE_VERSION: %NODE_VERSION%
echo NODE_OK: %NODE_OK%
echo NODE_PATH: %NODE_PATH%
echo DEPS_OK: %DEPS_OK%
echo NATIVE_OK: %NATIVE_OK%
echo HAS_BUILD_TOOLS: %HAS_BUILD_TOOLS%
echo STATUS: %STATUS%
echo LOG: logs/setup.log
echo === END ===

call :log "=== Bootstrap completed: %STATUS% ==="

if "%NODE_OK%"=="false" exit /b 2
if "%DEPS_OK%"=="false" exit /b 1
if "%NATIVE_OK%"=="false" exit /b 1
exit /b 0

:log
echo [%DATE% %TIME%] [bootstrap] %~1 >> "%LOG_FILE%"
goto :eof
