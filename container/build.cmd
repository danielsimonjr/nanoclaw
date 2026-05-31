@echo off
setlocal

rem Build the NanoClaw agent container image (native Windows / cmd.exe).
rem Windows equivalent of build.sh. Usage: build.cmd [tag]

cd /d "%~dp0"

set "IMAGE_NAME=nanoclaw-agent"
set "TAG=%~1"
if "%TAG%"=="" set "TAG=latest"
if "%CONTAINER_RUNTIME%"=="" set "CONTAINER_RUNTIME=docker"

echo Building NanoClaw agent container image...
echo Image: %IMAGE_NAME%:%TAG%

%CONTAINER_RUNTIME% build -t "%IMAGE_NAME%:%TAG%" .
if errorlevel 1 exit /b 1

echo.
echo Build complete!
echo Image: %IMAGE_NAME%:%TAG%
echo.
echo Test with:
echo   echo {"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false} ^| %CONTAINER_RUNTIME% run -i %IMAGE_NAME%:%TAG%
