@echo off
cd /d "%~dp0"

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b

echo Pulling from origin/%BRANCH%...
git pull origin %BRANCH%
if errorlevel 1 (
    echo Pull failed.
    pause
    exit /b 1
)

echo Done.
pause
