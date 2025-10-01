@echo off
chcp 65001 >nul
echo ========================================
echo   Podcast Script Generator
echo ========================================
echo.
echo Starting server...
echo.
echo Server URL: http://127.0.0.1:8000
echo Press Ctrl+C to stop
echo.
node backend/server.js

pause
