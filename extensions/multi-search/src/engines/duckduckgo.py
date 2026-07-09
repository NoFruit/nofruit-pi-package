"""DuckDuckGo HTML search engine.

Uses the no-JS HTML endpoint (POST to html.duckduckgo.com/html).
No API key required.
"""

from lxml import html

from engines.base import EngineBase
from http_client import get_client
from utils import extract_text


class DuckDuckGoEngine(EngineBase):
    name = "duckduckgo"
    category = "general"

    def search(self, query: str, max_results: int = 5) -> list[dict]:
        url = "https://html.duckduckgo.com/html/"
        data = {"q": query}

        with get_client() as client:
            resp = client.post(url, data=data)
        resp.raise_for_status()

        dom = html.fromstring(resp.text)
        results = []

        # Check for CAPTCHA
        if dom.xpath("//form[@id='challenge-form']"):
            return results

        # Select web-result divs (skip ads)
        for div_result in dom.xpath('//div[@id="links"]/div[contains(@class, "web-result")]'):
            if len(results) >= max_results:
                break

            link = div_result.xpath(".//h2/a")
            if not link:
                continue

            hrefs = div_result.xpath(".//h2/a/@href")
            if not hrefs:
                continue

            title = extract_text(link)
            href = hrefs[0]

            snippet_els = div_result.xpath('.//a[contains(@class, "result__snippet")]')
            content = extract_text(snippet_els) if snippet_els else ""

            if title and href:
                results.append({
                    "engine": self.name,
                    "category": self.category,
                    "title": title,
                    "url": href,
                    "content": content,
                    "metadata": {},
                })

        return results
