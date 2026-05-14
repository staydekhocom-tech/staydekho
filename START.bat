@echo off
title StayDekho - Starting Servers
echo.
echo  ==========================================
echo   StayDekho - Starting...
echo  ==========================================
echo.

:: Check Node is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo  ERROR: Node.js not found. Install from nodejs.org
  pause
  exit
)

:: Install backend dependencies if not already installed
if not exist "backend\node_modules" (
  echo  Installing backend packages (first time only)...
  cd backend
  npm install
  cd ..
)

echo  Starting Backend API on port 5000...
start "StayDekho Backend" cmd /k "cd /d "%~dp0backend" && node server.js"

timeout /t 2 /nobreak >nul

echo  Starting Frontend on port 3000...
start "StayDekho Frontend" cmd /k "cd /d "%~dp0" && npx --yes serve -l 3000 ."

timeout /t 3 /nobreak >nul

echo  Opening browser...
start http://localhost:3000

echo.
echo  ==========================================
echo   Done! Browser mein site open ho gayi.
echo   Band karne ke liye dono CMD windows band karo.
echo  ==========================================
echo.
