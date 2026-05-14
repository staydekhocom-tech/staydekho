@echo off
title StayDekho Servers Setup

echo ==========================================
echo Cleaning up old processes...
echo ==========================================
call pm2 delete all

echo.
echo ==========================================
echo Starting Backend (Folder ke andar se)...
echo ==========================================
cd backend
call pm2 start server.js --name "backend"
cd ..

echo.
echo ==========================================
echo Starting Frontend UI...
echo ==========================================
call pm2 start frontend-server.js --name "frontend"

echo.
echo ==========================================
echo Saving setup permanently...
echo ==========================================
call pm2 save

echo.
echo ==========================================
echo ALL SET! StayDekho is LIVE on your laptop.
echo Go to Chrome and open: http://localhost:3000
echo ==========================================
timeout /t 5
