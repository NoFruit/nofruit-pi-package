"""Engine registry.

Add new engines here to make them available to the search CLI.
"""

from engines.arxiv import ArxivEngine
from engines.duckduckgo import DuckDuckGoEngine
from engines.github import GitHubEngine
from engines.hackernews import HackerNewsEngine
from engines.wikipedia import WikipediaEngine
from engines.bing import BingEngine

ENGINES: dict[str, type] = {
    "arxiv": ArxivEngine,
    "duckduckgo": DuckDuckGoEngine,
    "github": GitHubEngine,
    "hackernews": HackerNewsEngine,
    "wikipedia": WikipediaEngine,
    "bing": BingEngine,
}


def get_engine(name: str):
    """Get an engine instance by name, or None if not found."""
    cls = ENGINES.get(name)
    return cls() if cls else None


def list_engines() -> list[str]:
    """Return list of registered engine names."""
    return list(ENGINES.keys())
