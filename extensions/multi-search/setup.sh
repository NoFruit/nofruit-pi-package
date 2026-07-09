#!/usr/bin/env bash
set -e

echo "============================================"
echo "  Multi-Search Extension Setup"
echo "============================================"
echo ""

# Check if Python is available
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] Python3 not found. Please install Python 3.9+ first."
    exit 1
fi
echo "[OK] Python found: $(python3 --version)"
echo ""

# Step 1: Create virtual environment
if [ -f "venv/bin/python" ]; then
    echo "[SKIP] venv already exists."
else
    echo "[1/3] Creating virtual environment..."
    python3 -m venv venv
    echo "[OK] venv created."
fi
echo ""

# Step 2: Install dependencies
echo "[2/3] Installing Python dependencies..."
venv/bin/python -m pip install -r requirements.txt --quiet
echo "[OK] Dependencies installed."
echo ""

# Step 3: Compile with PyInstaller
echo "[3/3] Compiling search..."
if [ -f "dist/search" ]; then
    echo "[INFO] dist/search already exists, overwriting..."
fi
venv/bin/python -m PyInstaller --onefile --name search --distpath dist --workpath build --specpath build --paths src src/search.py --noconfirm 2>/dev/null
echo "[OK] dist/search compiled."
echo ""

# Verify
if [ -f "dist/search" ]; then
    echo "============================================"
    echo "  Setup Complete!"
    echo "  Binary: dist/search"
    echo "============================================"
else
    echo "[ERROR] dist/search not found after compilation."
    exit 1
fi