@echo off
cd /d "C:\Users\Lucas\Desktop\PapersMemes-Website\PPM"
if errorlevel 1 (
  echo ERREUR : dossier introuvable.
  pause
  exit /b 1
)
git add -A
set /p MSG="Message de commit : "
git commit -m "%MSG%"
git push origin HEAD
pause
