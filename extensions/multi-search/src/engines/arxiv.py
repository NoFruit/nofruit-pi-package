"""arXiv search engine.

Uses the arXiv API (export.arxiv.org) to search academic papers.
No API key required.
"""

from datetime import datetime
from urllib.parse import urlencode

from lxml import etree
from lxml.etree import XPath

from engines.base import EngineBase
from http_client import fetch

ARXIV_NAMESPACES = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

XPATH_ENTRY = XPath("//atom:entry", namespaces=ARXIV_NAMESPACES)
XPATH_TITLE = XPath(".//atom:title", namespaces=ARXIV_NAMESPACES)
XPATH_ID = XPath(".//atom:id", namespaces=ARXIV_NAMESPACES)
XPATH_SUMMARY = XPath(".//atom:summary", namespaces=ARXIV_NAMESPACES)
XPATH_AUTHOR_NAME = XPath(".//atom:author/atom:name", namespaces=ARXIV_NAMESPACES)
XPATH_DOI = XPath(".//arxiv:doi", namespaces=ARXIV_NAMESPACES)
XPATH_PDF = XPath(".//atom:link[@title='pdf']", namespaces=ARXIV_NAMESPACES)
XPATH_PUBLISHED = XPath(".//atom:published", namespaces=ARXIV_NAMESPACES)

BASE_URL = "https://export.arxiv.org/api/query"


class ArxivEngine(EngineBase):
    name = "arxiv"
    category = "science"

    def search(self, query: str, max_results: int = 5) -> list[dict]:
        params = {
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": max_results,
        }
        url = f"{BASE_URL}?{urlencode(params)}"
        resp = fetch(url)
        resp.raise_for_status()

        dom = etree.fromstring(resp.content)
        results = []

        for entry in XPATH_ENTRY(dom):
            title_el = XPATH_TITLE(entry)
            title = title_el[0].text if title_el else ""

            id_el = XPATH_ID(entry)
            url_val = id_el[0].text if id_el else ""

            summary_el = XPATH_SUMMARY(entry)
            summary = summary_el[0].text if summary_el else ""

            authors = [a.text for a in XPATH_AUTHOR_NAME(entry) if a.text]

            doi_el = XPATH_DOI(entry)
            doi = doi_el[0].text if doi_el else ""

            pdf_el = XPATH_PDF(entry)
            pdf_url = pdf_el[0].attrib.get("href", "") if pdf_el else ""

            published_el = XPATH_PUBLISHED(entry)
            published = ""
            if published_el:
                try:
                    dt = datetime.strptime(published_el[0].text, "%Y-%m-%dT%H:%M:%SZ")
                    published = dt.strftime("%Y-%m-%d")
                except (ValueError, AttributeError):
                    published = published_el[0].text or ""

            results.append({
                "engine": self.name,
                "category": self.category,
                "title": title.strip(),
                "url": url_val.strip(),
                "content": summary.strip(),
                "metadata": {
                    "authors": authors,
                    "published": published,
                    "doi": doi,
                    "pdf_url": pdf_url,
                },
            })

        return results
