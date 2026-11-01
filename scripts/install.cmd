@echo off
setlocal
if defined VIBETRACE_NODE goto configured_node
where node.exe >nul 2>nul
if errorlevel 1 (
    echo VibeTrace requires Node.js 20+ before this installer can run.
    echo Install Node.js: winget install --exact --id OpenJS.NodeJS.LTS
    echo Or download it from https://nodejs.org/en/download
    echo Open a new terminal after installing, then run this command again.
    exit /b 1
)
node "%~dp0vibetrace.mjs" setup %*
exit /b %ERRORLEVEL%
:configured_node
"%VIBETRACE_NODE%" "%~dp0vibetrace.mjs" setup %*
exit /b %ERRORLEVEL%
