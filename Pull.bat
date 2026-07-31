@echo off
cd /d "C:\Users\Lucas\Desktop\PapersMemes-Website\PPM"
if errorlevel 1 (
  echo ERREUR : dossier introuvable.
  pause
  exit /b 1
)
git pull origin HEAD
pause
