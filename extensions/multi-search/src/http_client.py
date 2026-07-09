"""HTTP client wrapper with proxy support.

All external HTTP requests MUST go through the configured proxy.
"""

import os
import httpx

_DEFAULT_PROXY = os.environ.get("HTTP_PROXY", "http://127.0.0.1:7890")
PROXY = _DEFAULT_PROXY
DEFAULT_TIMEOUT = 15.0


def set_proxy(proxy_url: str | None):
    """Set the proxy URL for all subsequent requests.

    Pass None to disable proxy.
    Pass a string to use a custom proxy (e.g. "http://127.0.0.1:1080").
    """
    global PROXY
    PROXY = proxy_url

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def get_client(timeout: float | None = None, **kwargs) -> httpx.Client:
    """Create a synchronous httpx client with proxy and sensible defaults."""
    return httpx.Client(
        proxy=PROXY,
        timeout=timeout or DEFAULT_TIMEOUT,
        headers={"User-Agent": kwargs.pop("user_agent", DEFAULT_UA)},
        follow_redirects=True,
        **kwargs,
    )


def fetch(url: str, method: str = "GET", **kwargs) -> httpx.Response:
    """Simple synchronous fetch wrapper."""
    with get_client() as client:
        return client.request(method, url, **kwargs)


def get_async_client(timeout: float | None = None, **kwargs) -> httpx.AsyncClient:
    """Create an asynchronous httpx client with proxy and sensible defaults."""
    return httpx.AsyncClient(
        proxy=PROXY,
        timeout=timeout or DEFAULT_TIMEOUT,
        headers={"User-Agent": kwargs.pop("user_agent", DEFAULT_UA)},
        follow_redirects=True,
        **kwargs,
    )
