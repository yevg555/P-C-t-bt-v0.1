@echo off
setlocal enabledelayedexpansion

echo Testing all packages...
echo.

echo ========================================
echo [CORE]
echo ========================================
pushd packages\core
call npx tsc
call node dist\index.js
popd
echo.

echo ========================================
echo [EXECUTION]
echo ========================================
pushd packages\execution
call npx tsc
call node dist\index.js
popd
echo.

echo ========================================
echo [FEEDS]
echo ========================================
pushd packages\feeds
call npx tsc
call node dist\index.js
popd
echo.

echo ========================================
echo [STORAGE]
echo ========================================
pushd packages\storage
call npx tsc
call node dist\index.js
popd
echo.

echo ========================================
echo All packages tested successfully!
echo ========================================