"""GitHub repository search engine.

Uses the GitHub REST API (no API key required for public search).
"""

from urllib.parse import urlencode

from engines.base import EngineBase
from http_client import fetch


class GitHubEngine(EngineBase):
    name = "github"
    category = "it"

    def search(self, query: str, max_results: int = 5) -> list[dict]:
        params = urlencode({"q": query, "sort": "stars", "order": "desc", "per_page": max_results})
        url = f"https://api.github.com/search/repositories?{params}"

        resp = fetch(url, headers={"Accept": "application/vnd.github.v3+json"})
        resp.raise_for_status()

        data = resp.json()
        results = []

        for item in data.get("items", []):
            if len(results) >= max_results:
                break

            owner = item.get("owner", {}) or {}
            license_info = item.get("license") or {}
            topics = item.get("topics") or []

            content_parts = [s for s in [item.get("language"), item.get("description")] if s]
            content = " / ".join(content_parts)

            results.append({
                "engine": self.name,
                "category": self.category,
                "title": item.get("full_name", ""),
                "url": item.get("html_url", ""),
                "content": content,
                "metadata": {
                    "stars": item.get("stargazers_count", 0),
                    "language": item.get("language", ""),
                    "license": license_info.get("name", ""),
                    "topics": topics,
                    "owner": owner.get("login", ""),
                    "updated_at": item.get("updated_at", ""),
                },
            })

        return results
