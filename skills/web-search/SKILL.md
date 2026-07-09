---
name: web-search
description: Search the web via multiple engines with automatic fallback and term refinement. Use when you need current information, documentation, or facts not in the training data.
---

# Web Search

## Objective

This skill's purpose is to perform web searches. It uses two mechanisms in order of preference:

1. **`multi_search` extension tool** — a compiled binary that queries multiple search engines concurrently and returns structured JSON results. This is the primary path.
2. **Shell-based fallback** (`search.sh` / direct `curl` commands) — for engines not covered by the extension, or when the extension is unavailable.

---

## Available Engines

The `multi_search` tool accepts an `--engines` parameter (comma-separated). The list below is not exhaustive; you may pass any engine name. If an engine is not recognized, it is silently skipped.

### International (preferred — requires proxy)

| Engine | In extension | Notes |
|--------|-------------|-------|
| `duckduckgo` | ✅ | General web, no API key |
| `github` | ✅ | Code repositories |
| `wikipedia` | ✅ | Encyclopedia |
| `bing` | ✅ | General web |
| `arxiv` | ✅ | Academic papers |
| `hackernews` | ✅ | Tech news & discussion |
| `google` | ❌ | Use shell fallback |
| `stackoverflow` | ❌ | Use shell fallback |
| `reddit` | ❌ | Use shell fallback |

### Domestic Chinese (no proxy required)

| Engine | In extension | Notes |
|--------|-------------|-------|
| `baidu` | ❌ | Use shell fallback |
| `sogou` | ❌ | Use shell fallback |
| `360` | ❌ | Use shell fallback |
| `zhihu` | ❌ | Use shell fallback |

---

## Proxy Check — Determines Which Engine Set to Use

Before any search, determine proxy availability:

```bash
# Ping the proxy endpoint (adjust host:port to actual proxy address)
curl -s --connect-timeout 3 --max-time 3 -x http://127.0.0.1:7890 http://www.gstatic.com/generate_204 > /dev/null 2>&1 && echo "proxy_ok" || echo "proxy_fail"
```

- **Proxy reachable** → use **International** engines (preferred set).
- **Proxy unreachable** → use **Domestic Chinese** engines, or fall back to direct connection for international engines that work without proxy.

---

## Search Strategy

### Phase 1: Extension (`multi_search` tool) — Primary Path

Use the `multi_search` tool. Perform **3 to 5 attempts maximum**, progressively broadening the search terms:

| Attempt | Search term strategy | Example |
|---------|-------------------|---------|
| 1 | Most specific: year + model name + rating/score + specific reviewer/organization + rank + target site | `2026 claude-4 benchmark rating lmarena score rank site:github.com` |
| 2 | Reduce one constraint: drop site or rank | `2026 claude-4 benchmark rating lmarena score` |
| 3 | Broader: year + model name + rating | `2026 claude-4 benchmark rating` |
| 4 (if needed) | Minimal: model name + rating | `claude-4 benchmark` |
| 5 (if needed) | Most broad: just model name + key aspect | `claude-4 evaluation` |

**Rules:**
- If any attempt returns useful results, **stop** — do not continue broadening.
- Vary engines between attempts (e.g., first `arxiv,github`, then `duckduckgo,bing`).
- Use `--max-results 5` for focused results, increase to `--max-results 10` on broader attempts.

### Phase 2: Shell Fallback — Engines Not in Extension

If Phase 1 exhausts all attempts and returns **zero useful results**, fall back to shell-based search targeting engines **not available in the extension** (e.g., `google`, `baidu`, `sogou`, `stackoverflow`, `reddit`, `zhihu`, `360`).

Perform **3 to 5 attempts maximum**, each using a **different engine**. **Do not change the search terms** — keep them at the broadest form from Phase 1 (typically the last attempt). The goal is to cast a wide net across different sources.

```bash
# Example structure — adapt URL, selectors, and parsing per engine
curl -s --proxy http://127.0.0.1:7890 \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  "https://www.google.com/search?q=<encoded-query>" \
  | python3 -c "
import sys, re, html
content = sys.stdin.read()
# Extract results — selectors vary per engine
...
"
```

If an engine fails (timeout, CAPTCHA, blocked), skip it and try the next one. If all 3–5 attempts fail, conclude that no results are obtainable and inform the user.

---

## Error Handling

Errors from the `multi_search` extension fall into two categories:

### Network errors (connection timeout, proxy refused, DNS failure)

- **First occurrence:** Switch proxy and retry once. For example, if using `http://127.0.0.1:7890`, try `http://127.0.0.1:1080` or disable proxy with `--no-proxy`.
- **Second occurrence (persistent):** **Stop.** Do not attempt further retries or fall through to Phase 2. Inform the user that the network is unreachable and ask them to check connectivity or proxy settings.

### Code errors (initialization failure, engine crash, parse error, any exception)

- **Do not retry.** Do not attempt to debug, fix, or work around the error. **Stop immediately** and inform the user that the search tool encountered an internal error, describe what happened briefly, and ask the user to intervene.

This applies regardless of when the error occurs — during initialization, during search, or during result processing.

---

## Notes

- The `multi_search` extension requires `dist/search.exe` to exist. If missing, run `setup.bat` (Windows) or `setup.sh` (Unix) in the extension directory to compile it.
- `search.sh` in this skill directory provides a DuckDuckGo-only search as a minimal fallback when neither the extension nor custom curl commands are suitable.
- For full page content after finding a URL, use the `web-fetch` skill.
