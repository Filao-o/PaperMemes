@echo off
cd /d "%~dp0"

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b

echo Building...
call npm run build
if errorlevel 1 (
    echo Build failed. Aborting.
    pause
    exit /b 1
)

set /p msg="Commit message: "
git add -A
git commit -m "%msg%"
git push -u origin %BRANCH%
pause