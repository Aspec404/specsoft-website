@echo off
setlocal enabledelayedexpansion
title SPECSOFT - Sync to Live Site
color 0A

echo.
echo  ============================================
echo    SPECSOFT(R) - Sync ^& Deploy
echo  ============================================
echo.

:: ---- Check that we're in a git repo ----
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    color 0C
    echo  [ERROR] This folder is not a Git repository.
    echo  Make sure sync.bat is in the root of your project folder.
    echo.
    pause
    exit /b 1
)

:: ---- Show what's changed ----
echo  [1/5] Checking for changes...
echo.
git status --short

:: ---- Check if there's anything to commit ----
git diff --quiet && git diff --cached --quiet
if not errorlevel 1 (
    color 0E
    echo.
    echo  [INFO] No changes detected. Nothing to push.
    echo.
    pause
    exit /b 0
)

:: ---- Ask for commit message ----
echo.
echo  --------------------------------------------
echo.
set "commitmsg="
set /p "commitmsg=  Commit message (press ENTER for auto): "

if "!commitmsg!"=="" (
    for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set "datepart=%%d-%%b-%%c"
    for /f "tokens=1-2 delims=:." %%a in ('time /t') do set "timepart=%%a:%%b"
    set "commitmsg=Auto-sync !datepart! !timepart!"
)

:: ---- Update Version File (This triggers the website popup) ----
echo.
echo  [2/5] Updating version.json for live site popup...
powershell -NoProfile -Command "$v = Get-Date -Format 'yyyyMMddHHmmss'; '{ \"version\": \"' + $v + '\" }' | Out-File -FilePath version.json -Encoding utf8"

:: ---- Stage all changes ----
echo  [3/5] Staging changes...
git add .
if errorlevel 1 (
    color 0C
    echo.
    echo  [ERROR] git add failed.
    pause
    exit /b 1
)

:: ---- Commit ----
echo  [4/5] Committing...
git commit -m "!commitmsg!"
if errorlevel 1 (
    color 0C
    echo.
    echo  [ERROR] git commit failed. Check the message above.
    pause
    exit /b 1
)

:: ---- Push ----
echo  [5/5] Pushing to GitHub...
git push
if errorlevel 1 (
    color 0C
    echo.
    echo  [ERROR] git push failed. Check your internet or GitHub login.
    pause
    exit /b 1
)

:: ---- Success ----
echo.
echo  ============================================
echo    SUCCESS! Pushed to GitHub.
echo.
echo    Netlify will auto-deploy in ~30 seconds.
echo    Active users will be prompted to refresh!
echo.
echo    Live site:
echo    https://specsoftdev.netlify.app
echo.
echo    Tip: press Ctrl+Shift+R on the live site
echo    to bypass cache and see the newest version.
echo  ============================================
echo.

:: ---- Optional: open the live site ----
choice /C YN /M "  Open the live site now"
if errorlevel 2 goto :end
start https://specsoftdev.netlify.app

:end
echo.
pause
endlocal