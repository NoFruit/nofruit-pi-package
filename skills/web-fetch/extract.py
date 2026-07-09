#!/usr/bin/env python3
"""Extract readable content from HTML. Reads from stdin, prints clean text."""
import sys
import re
import html as html_mod

def main():
    content = sys.stdin.read()

    # Detect if it's JSON (API response)
    if content.strip().startswith('{') or content.strip().startswith('['):
        try:
            import json
            data = json.loads(content)
            print(json.dumps(data, indent=2, ensure_ascii=False)[:5000])
            if len(json.dumps(data)) > 5000:
                print('... (truncated, full response length: {} chars)'.format(len(content)))
            return
        except Exception:
            pass

    # Extract title
    title_match = re.search(r'<title[^>]*>(.*?)</title>', content, re.DOTALL)
    if title_match:
        title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
        print(f'Title: {title}')
        print()

    # Try to find main content area
    main_patterns = [
        r'<article[^>]*>(.*?)</article>',
        r'<main[^>]*>(.*?)</main>',
        r'<div[^>]*class="[^"]*(?:content|article|post|entry|main|body|text)[^"]*"[^>]*>(.*?)</div>',
        r'<div[^>]*id="[^"]*(?:content|article|post|entry|main|body|text)[^"]*"[^>]*>(.*?)</div>',
    ]

    main_content = None
    for pattern in main_patterns:
        matches = re.findall(pattern, content, re.DOTALL)
        if matches:
            main_content = max(matches, key=len)
            break

    if not main_content:
        body_match = re.search(r'<body[^>]*>(.*?)</body>', content, re.DOTALL)
        if body_match:
            main_content = body_match.group(1)
        else:
            main_content = content

    # Clean the content
    main_content = re.sub(
        r'<(?:script|style|nav|footer|header|aside|noscript|iframe|form)[^>]*>.*?</(?:script|style|nav|footer|header|aside|noscript|iframe|form)>',
        '', main_content, flags=re.DOTALL)
    main_content = re.sub(r'<!--.*?-->', '', main_content, flags=re.DOTALL)
    main_content = re.sub(r'<svg[^>]*>.*?</svg>', '', main_content, flags=re.DOTALL)

    # Extract text blocks
    blocks = []

    # Headings
    for tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
        for m in re.finditer(f'<{tag}[^>]*>(.*?)</{tag}>', main_content, re.DOTALL):
            text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            if text:
                prefix = '#' * int(tag[1])
                blocks.append(f'{prefix} {text}')

    # Paragraphs
    for m in re.finditer(r'<p[^>]*>(.*?)</p>', main_content, re.DOTALL):
        text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        if text and len(text) > 20:
            blocks.append(text)

    # List items
    for m in re.finditer(r'<li[^>]*>(.*?)</li>', main_content, re.DOTALL):
        text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        if text:
            blocks.append(f'  \u2022 {text}')

    # Code blocks
    for m in re.finditer(r'<pre[^>]*>(.*?)</pre>', main_content, re.DOTALL):
        code = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        if code:
            blocks.append('```\n{}\n```'.format(code[:1000]))

    # Links
    links = re.findall(r'<a[^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>', main_content, re.DOTALL)
    if links:
        blocks.append('')
        blocks.append('--- Links ---')
        seen = set()
        for href, text in links[:20]:
            t = re.sub(r'<[^>]+>', '', text).strip()
            if t and href not in seen:
                seen.add(href)
                blocks.append('  [{}]({})'.format(t, html_mod.unescape(href)))

    output = '\n\n'.join(blocks)

    # Truncate if too long
    max_chars = 8000
    if len(output) > max_chars:
        output = output[:max_chars] + '\n\n... (truncated, full text ~{} chars)'.format(len(output))

    print(output)

if __name__ == '__main__':
    main()
