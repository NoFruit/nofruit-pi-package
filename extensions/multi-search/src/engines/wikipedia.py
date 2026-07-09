"""Wikipedia search engine.

Uses the Wikipedia opensearch API for multi-result search.
No API key required.
"""

from urllib.parse import urlencode

from engines.base import EngineBase
from http_client import fetch

WIKI_UA = "MultiSearchBot/1.0 (https://github.com/user/multi-search; mailto:user@example.com)"


class WikipediaEngine(EngineBase):
    name = "wikipedia"
    category = "general"

    def search(self, query: str, max_results: int = 5) -> list[dict]:
        params = urlencode({
            "action": "opensearch",
            "search": query,
            "limit": max_results,
            "namespace": 0,
            "format": "json",
        })
        url = f"https://en.wikipedia.org/w/api.php?{params}"

        resp = fetch(url, headers={"User-Agent": WIKI_UA})
        if resp.status_code == 403:
            # Some proxies may block; return empty
            return []
        resp.raise_for_status()

        data = resp.json()
        results = []

        # opensearch returns: [query, [titles], [snippets], [urls]]
        if len(data) < 4:
            return results

        titles = data[1] if len(data) > 1 else []
        snippets = data[2] if len(data) > 2 else []
        urls = data[3] if len(data) > 3 else []

        for i in range(min(len(titles), len(urls), max_results)):
            title = titles[i]
            url_val = urls[i]
            snippet = snippets[i] if i < len(snippets) else ""

            results.append({
                "engine": self.name,
                "category": self.category,
                "title": title,
                "url": url_val,
                "content": snippet,
                "metadata": {},
            })

        return results
