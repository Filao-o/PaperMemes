@echo off
cd /d "%~dp0"

echo Fetching latest changes from main...
git fetch origin main
if errorlevel 1 (
    echo Fetch failed.
    pause
    exit /b 1
)

git merge origin/main
if errorlevel 1 (
    echo Merge failed. Resolve conflicts manually.
    pause
    exit /b 1
)

echo Done. Building...
call npm run build
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo All good. Reload the extension in Chrome.
pause
