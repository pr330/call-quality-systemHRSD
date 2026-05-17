@echo off
title نظام تقييم جودة المكالمات
echo تشغيل نظام تقييم جودة المكالمات...
echo.

if not exist node_modules (
  echo تثبيت مكتبة إرسال البريد لأول مرة...
  npm install
)

node server.js
pause
