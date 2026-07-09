---
name: web-fetch
description: Fetch and extract readable content from a web page URL. Strips HTML tags, navigation, and clutter to return clean text. Use when you need full article content, documentation, or specific page data.
---

# Web Fetch

## Setup

No setup required. Uses curl and python3 (available in the environment).

## Usage

Fetch a page:

```bash
./fetch.sh "https://example.com/page"
```

Extracts the main content of the page as clean text, including:
- Page title
- Main text content (paragraphs, headings, code blocks)
- Links (shown as [text](url))

## Proxy

Uses `http://127.0.0.1:7890` proxy automatically if set via `PROXY` env var. Falls back to direct connection.

## Notes

- Powered by curl + python3 HTML cleaning
- Not a full browser — JavaScript-rendered content won't appear
- For API endpoints that return JSON, use curl directly instead
