@echo off
title Agendador (modo consola)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0AgendarCita_consola.ps1"
pause
