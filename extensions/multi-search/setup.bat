@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   Multi-Search Extension Setup
echo ============================================
echo.

:: Check if Python is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.9+ first.
    exit /b 1
)
echo [OK] Python found:
python --version
echo.

:: Step 1: Create virtual environment
if exist "venv\Scripts\python.exe" (
    echo [SKIP] venv already exists.
) else (
    echo [1/3] Creating virtual environment...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create venv.
        exit /b 1
    )
    echo [OK] venv created.
)
echo.

:: Step 2: Install dependencies
echo [2/3] Installing Python dependencies...
venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    exit /b 1
)
echo [OK] Dependencies installed.
echo.

:: Step 3: Compile with PyInstaller
echo [3/3] Compiling search.exe...
if exist "dist\search.exe" (
    echo [INFO] dist\search.exe already exists, overwriting...
)
venv\Scripts\python.exe -m PyInstaller --onefile --name search --distpath dist --workpath build --specpath build --paths src src/search.py --noconfirm 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] PyInstaller compilation failed.
    exit /b 1
)
echo [OK] dist\search.exe compiled.
echo.

:: Verify
if exist "dist\search.exe" (
    echo ============================================
    echo   Setup Complete!
    echo   Binary: dist\search.exe
    echo ============================================
) else (
    echo [ERROR] dist\search.exe not found after compilation.
    exit /b 1
)

endlocal