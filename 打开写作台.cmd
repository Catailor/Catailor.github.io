@echo off
pwsh -NoLogo -NoProfile -File "%~dp0tools\open-studio.ps1"
if errorlevel 1 pause
