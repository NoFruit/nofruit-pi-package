"""Bing Web search engine.

Scrapes Bing HTML search results. Handles Bing's base64-encoded redirect URLs.
No API key required.
"""

import base64
from urllib.parse import parse_qs, urlencode, urlparse

from lxml import html

from engines.base import EngineBase
from http_client import get_client
from utils import extract_text

BING_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
}


class BingEngine(EngineBase):
    name = "bing"
    category = "general"

    def search(self, query: str, max_results: int = 5) -> list[dict]:
        params = urlencode({"q": query})
        url = f"https://www.bing.com/search?{params}"

        # Use a session: visit homepage first to get cookies, then search
        with get_client() as client:
            # Set default headers for all requests
            client.headers.update(BING_HEADERS)

            # Visit homepage to establish session
            client.get("https://www.bing.com/")

            # Perform search
            resp = client.get(url)
            resp.raise_for_status()

            dom = html.fromstring(resp.text)
            results = []

            for item in dom.xpath('//li[contains(@class, "b_algo")]'):
                if len(results) >= max_results:
                    break

                link = item.xpath(".//h2/a")
                if not link:
                    continue

                href = link[0].attrib.get("href", "")
                title = extract_text(link)

                if not href or not title:
                    continue

                # Decode Bing redirect URLs
                if href.startswith("https://www.bing.com/ck/a?"):
                    qs = parse_qs(urlparse(href).query)
                    u_values = qs.get("u")
                    if u_values:
                        u_val = u_values[0]
                        if u_val.startswith("a1"):
                            encoded = u_val[2:]
                            # base64url without padding
                            encoded += "=" * (-len(encoded) % 4)
                            href = base64.urlsafe_b64decode(encoded).decode(
                                "utf-8", errors="replace"
                            )

                # Remove decorative icons from content
                content_els = item.xpath(".//p")
                for p in content_els:
                    for icon in p.xpath('.//span[@class="algoSlug_icon"]'):
                        icon.getparent().remove(icon)
                content = extract_text(content_els)

                results.append({
                    "engine": self.name,
                    "category": self.category,
                    "title": title,
                    "url": href,
                    "content": content,
                    "metadata": {},
                })

            return results
