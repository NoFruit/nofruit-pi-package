"""Engine interface definition.

All search engines must implement the EngineBase abstract class.
"""

from abc import ABC, abstractmethod


class EngineBase(ABC):
    """Base class for all search engines."""

    name: str = ""
    category: str = ""

    @abstractmethod
    def search(self, query: str, max_results: int = 5) -> list[dict]:
        """Execute a search and return results.

        Each result dict must follow this format:
        {
            "engine": self.name,
            "category": self.category,
            "title": str,
            "url": str,
            "content": str,       # snippet / description
            "metadata": {}        # engine-specific fields
        }
        """
        pass
