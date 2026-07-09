#!/usr/bin/env bash
# Web search via DuckDuckGo HTML search
# Usage: ./search.sh "query"
set -euo pipefail

QUERY="$*"
if [ -z "$QUERY" ]; then
  echo "Usage: $0 <search query>"
  exit 1
fi

PROXY="${PROXY:-http://127.0.0.1:7890}"
CURL_OPTS=(-s --proxy "$PROXY" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# Try proxy first, fall back to direct
RESPONSE=$(curl "${CURL_OPTS[@]}" -d "q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$QUERY'''))")" "https://html.duckduckgo.com/html/" 2>/dev/null) || true
if [ -z "$RESPONSE" ]; then
  # Fallback: no proxy
  RESPONSE=$(curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
    -d "q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$QUERY'''))")" \
    "https://html.duckduckgo.com/html/" 2>/dev/null) || true
fi

if [ -z "$RESPONSE" ]; then
  echo "Error: No response from DuckDuckGo"
  exit 1
fi

# Parse results with python3
python3 -c "
import sys, re, html

content = sys.stdin.read()

# Extract result blocks
# Pattern: result__a for title+link, result__snippet for description
results = []

# Find all result items
# Each result has: result__url (link), result__a (title), result__snippet (description)
urls = re.findall(r'class=\"result__url\"[^>]*href=\"([^\"]+)\"', content)
titles = re.findall(r'class=\"result__a\"[^>]*>(.*?)</a>', content, re.DOTALL)
snippets = re.findall(r'class=\"result__snippet\"[^>]*>(.*?)</(?:a|span|div)>', content, re.DOTALL)

# Also try alternate patterns
if not urls:
    urls = re.findall(r'<a[^>]*class=\"[^\"]*result[^\"]*\"[^>]*href=\"(https?://[^\"]+)\"', content)
if not titles:
    titles = re.findall(r'<a[^>]*class=\"[^\"]*result[^\"]*\"[^>]*href=\"https?://[^\"]+\"[^>]*>(.*?)</a>', content, re.DOTALL)

# Clean and print
count = min(len(urls), len(titles)) if urls and titles else 0
if count == 0:
    # Try more aggressive extraction
    all_links = re.findall(r'<a[^>]*href=\"(https?://[^\"&]+(?:\.com|\.org|\.io|\.net|\.edu|\.gov|\.wiki|\.dev|\.app|\.cn|\.jp)[^\"]*)\"[^>]*>(.*?)</a>', content, re.DOTALL)
    seen = set()
    for href, title in all_links:
        t = re.sub(r'<[^>]+>', '', title).strip()
        if t and href not in seen and 'duckduckgo.com' not in href:
            seen.add(href)
            print(f'  [{len(seen)}] {t}')
            print(f'      URL: {html.unescape(href)}')
            print()
    if not seen:
        print('No results found.')
    sys.exit(0)

for i in range(count):
    title = re.sub(r'<[^>]+>', '', titles[i]).strip()
    url = html.unescape(urls[i])
    snippet = ''
    if i < len(snippets):
        snippet = re.sub(r'<[^>]+>', '', snippets[i]).strip()
    
    print(f'  [{i+1}] {title}')
    print(f'      URL: {url}')
    if snippet:
        print(f'      {snippet}')
    print()
" <<< "$RESPONSE"
