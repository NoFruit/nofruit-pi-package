#!/usr/bin/env bash
# Fetch and extract readable content from a URL
# Usage: ./fetch.sh "https://example.com/page"
set -euo pipefail

URL="$*"
if [ -z "$URL" ]; then
  echo "Usage: $0 <url>"
  exit 1
fi

PROXY="${PROXY:-http://127.0.0.1:7890}"
CURL_OPTS=(-s --proxy "$PROXY" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -L --max-time 15)

# Try proxy first, fall back to direct
RESPONSE=$(curl "${CURL_OPTS[@]}" "$URL" 2>/dev/null) || true
if [ -z "$RESPONSE" ]; then
  RESPONSE=$(curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -L --max-time 15 "$URL" 2>/dev/null) || true
fi

if [ -z "$RESPONSE" ]; then
  echo "Error: No response from $URL"
  exit 1
fi

# Use python3 script to extract content
DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$DIR/extract.py" <<< "$RESPONSE"
