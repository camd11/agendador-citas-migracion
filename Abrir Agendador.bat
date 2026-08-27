@echo off
title Agendador de Citas - Migracion Colombia
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0AgendarCitaApp.ps1"
if errorlevel 1 (
  echo.
  echo Hubo un problema al abrir el programa.
  echo Tome una foto de este mensaje y enviela.
  pause
)
