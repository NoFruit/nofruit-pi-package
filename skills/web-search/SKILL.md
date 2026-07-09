---
name: web-search
description: Search the web via multiple engines with automatic fallback and term refinement. Use when you need current information, documentation, or facts not in the training data.
---

# Web Search

## Objective

Perform web searches via two mechanisms, in order of preference:

1. **`multi_search` tool** - queries multiple search engines concurrently and returns structured JSON.
2. **Shell-based fallback** (`search.sh` / direct `curl`) - for engines not covered by the tool, or when the tool is unavailable.

---

## Available Engines

The `multi_search` tool accepts an `--engines` parameter (comma-separated). The list below is not exhaustive; any engine name may be passed, and unrecognized ones are silently skipped.

### International (preferred - requires proxy)

| Engine | In extension | Notes |
|--------|-------------|-------|
| `duckduckgo` | ✅ | General web |
| `github` | ✅ | Code repositories |
| `wikipedia` | ✅ | Encyclopedia |
| `bing` | ✅ | General web |
| `arxiv` | ✅ | Academic papers |
| `hackernews` | ✅ | Tech news & discussion |
| `google` | ❌ | General web |
| `stackoverflow` | ❌ | Programming Q&A |
| `reddit` | ❌ | Community discussion |

### Domestic Chinese (no proxy required)

| Engine | In extension | Notes |
|--------|-------------|-------|
| `baidu` | ❌ | General web |
| `sogou` | ❌ | General web |
| `360` | ❌ | General web |
| `zhihu` | ❌ | Q&A community |

---

## Proxy Check

Before any search, determine proxy availability:

```bash
# Ping the proxy endpoint
curl -s --connect-timeout 3 --max-time 3 -x http://127.0.0.1:7890 http://www.gstatic.com/generate_204 > /dev/null 2>&1 && echo "proxy_ok" || echo "proxy_fail"
```

- **Proxy reachable** -> use **International** engines.
- **Proxy unreachable** -> use **Domestic Chinese** engines, or fall back to direct connection for international engines that work without proxy.

---

## Search Strategy

### Phase 1: Extension (`multi_search` tool)

Perform **3 to 5 attempts maximum**, progressively broadening the search terms:

| Attempt | Search term strategy | Example |
|---------|-------------------|---------|
| 1 | Most specific: year + model name + rating/score + specific reviewer/organization + rank + target site | `2026 claude-4 benchmark rating lmarena score rank site:github.com` |
| 2 | Reduce one constraint: drop site or rank | `2026 claude-4 benchmark rating lmarena score` |
| 3 | Broader: year + model name + rating | `2026 claude-4 benchmark rating` |
| 4 (if needed) | Minimal: model name + rating | `claude-4 benchmark` |
| 5 (if needed) | Most broad: just model name + key aspect | `claude-4 evaluation` |

**Rules:**
- If any attempt returns useful results, **stop** - do not continue broadening.
- Vary engines between attempts (e.g., first `arxiv,github`, then `duckduckgo,bing`).
- Use `--max-results 5` for focused results, increase to `--max-results 10` on broader attempts.

### Phase 2: Shell Fallback

If Phase 1 exhausts all attempts and returns **zero useful results**, fall back to shell-based search targeting engines **not available in the `multi_search` tool** (e.g., `google`, `baidu`, `sogou`, `stackoverflow`, `reddit`, `zhihu`, `360`).

Perform **3 to 5 attempts maximum**, each using a **different engine**. **Do not change the search terms** - keep them at the broadest form from Phase 1 (typically the last attempt).

```bash
# Example structure - adapt URL, selectors, and parsing per engine
curl -s --proxy http://127.0.0.1:7890 \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  "https://www.google.com/search?q=<encoded-query>" \
  | python3 -c "
import sys, re, html
content = sys.stdin.read()
# Extract results - selectors vary per engine
...
"
```

If an engine fails (timeout, CAPTCHA, blocked), skip it and try the next one. If all 3–5 attempts fail, conclude that no results are obtainable and inform the user.

---

## Error Handling

Errors from the `multi_search` tool fall into two categories:

### Network errors (connection timeout, proxy refused, DNS failure)

- **First occurrence:** Switch proxy and retry once. For example, if using `http://127.0.0.1:7890`, try `http://127.0.0.1:1080` or disable proxy with `--no-proxy`.
- **Second occurrence (persistent):** **Stop.** Do not attempt further retries or fall through to Phase 2. Inform the user that the network is unreachable and ask them to check connectivity or proxy settings.

### Code errors (initialization failure, engine crash, parse error, any exception)

- **Do not retry.** Do not attempt to debug, fix, or work around the error. **Stop immediately** and inform the user that the search tool encountered an internal error, describe what happened briefly, and ask the user to intervene.

---

## Notes

- The `multi_search` tool requires `dist/search(.exe)` to exist. If missing, run `bash setup.sh` in the extension directory to compile it.
- `search.sh` in this skill directory provides a DuckDuckGo-only search as a minimal fallback when neither the `multi_search` tool nor custom curl commands are suitable.
- For full page content after finding a URL, use the `web-fetch` skill.
