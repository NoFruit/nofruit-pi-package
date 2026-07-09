#!/usr/bin/env bash
set -e

echo "============================================"
echo "  Multi-Search Extension Setup"
echo "============================================"
echo ""

# Pick interpreter: prefer python3, fall back to python (Windows usually only has python)
if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo "[ERROR] Python not found. Please install Python 3.9+ first."
  exit 1
fi
echo "[OK] Python found: $($PY --version)"
echo ""

# Detect venv python across layouts: unix venv/bin/python, win venv/Scripts/python.exe
detect_venv() {
  for p in "venv/bin/python" "venv/Scripts/python.exe"; do
    [ -f "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

VENV_PY="$(detect_venv)" || true

if [ -n "$VENV_PY" ]; then
  echo "[SKIP] venv already exists ($VENV_PY)."
else
  echo "[1/3] Creating virtual environment..."
  "$PY" -m venv venv
  VENV_PY="$(detect_venv)" || { echo "[ERROR] venv python not found after creation."; exit 1; }
  echo "[OK] venv created ($VENV_PY)."
fi
echo ""

echo "[2/3] Installing Python dependencies..."
"$VENV_PY" -m pip install -r requirements.txt --quiet
echo "[OK] Dependencies installed."
echo ""

echo "[3/3] Compiling search..."
"$VENV_PY" -m PyInstaller --onefile --name search \
  --distpath dist --workpath build --specpath build --paths src \
  src/search.py --noconfirm
echo "[OK] Compiled."
echo ""

# Verify either name exists (PyInstaller appends .exe on Windows automatically)
if [ -f "dist/search" ]; then
  BINARY="dist/search"
elif [ -f "dist/search.exe" ]; then
  BINARY="dist/search.exe"
else
  echo "[ERROR] dist/search(.exe) not found after compilation."
  exit 1
fi

echo "============================================"
echo "  Setup Complete!"
echo "  Binary: $BINARY"
echo "============================================"
