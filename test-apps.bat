@echo off
echo Testing apps setup...
echo.

echo ========================================
echo [SERVER] Building...
echo ========================================
pushd apps\server
call npm run build
if %errorlevel% equ 0 (
    echo ✓ Server builds successfully!
) else (
    echo ✗ Server build failed!
)
popd
echo.

echo ========================================
echo [UI] Building...
echo ========================================
pushd apps\ui
call npm run build
if %errorlevel% equ 0 (
    echo ✓ UI builds successfully!
) else (
    echo ✗ UI build failed!
)
popd
echo.

echo ========================================
echo Both apps tested!
echo ========================================
echo.
echo To run the server: cd apps\server ^&^& npm run dev
echo To run the UI: cd apps\ui ^&^& npm run dev