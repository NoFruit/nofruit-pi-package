"""Hacker News search engine.

Uses the HN Algolia API (no API key required).
"""

from urllib.parse import urlencode

from engines.base import EngineBase
from http_client import fetch


class HackerNewsEngine(EngineBase):
    name = "hackernews"
    category = "it"

    def search(self, query: str, max_results: int = 5) -> list[dict]:
        params = urlencode({
            "query": query,
            "hitsPerPage": max_results,
            "tags": "story",
        })
        url = f"https://hn.algolia.com/api/v1/search?{params}"

        resp = fetch(url)
        resp.raise_for_status()

        data = resp.json()
        results = []

        for hit in data.get("hits", []):
            if len(results) >= max_results:
                break

            object_id = hit.get("objectID", "")
            title = hit.get("title", "")
            points = hit.get("points") or 0
            num_comments = hit.get("num_comments") or 0
            author = hit.get("author", "")

            # Use URL if available, otherwise link to HN item page
            url_val = hit.get("url") or f"https://news.ycombinator.com/item?id={object_id}"

            # Content: try url, then story_text, then comment_text
            content = hit.get("story_text") or hit.get("comment_text") or ""
            # Strip HTML tags from content
            if content:
                import re
                content = re.sub(r"<[^>]+>", "", content).strip()

            results.append({
                "engine": self.name,
                "category": self.category,
                "title": title,
                "url": url_val,
                "content": content,
                "metadata": {
                    "points": points,
                    "comments": num_comments,
                    "author": author,
                    "hn_id": object_id,
                },
            })

        return results
