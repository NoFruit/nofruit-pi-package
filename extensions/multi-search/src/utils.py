"""Lightweight replacements for searx.utils functions.

All are thin wrappers around lxml native methods.
"""

from lxml import html, etree


def eval_xpath(dom, expr):
    """dom.xpath(expr) alias."""
    return dom.xpath(expr)


def eval_xpath_list(dom, expr):
    """Same as eval_xpath, returns a list."""
    return dom.xpath(expr)


def eval_xpath_getindex(dom, expr, index, default=None):
    """Return the index-th result of xpath expr, or default if not found."""
    result = dom.xpath(expr)
    if result and len(result) > index:
        return result[index]
    return default


def extract_text(element):
    """Extract text content from an element, equivalent to searx.utils.extract_text."""
    if element is None:
        return ""
    if isinstance(element, list):
        return " ".join(extract_text(el) for el in element)
    return (element.text_content() or "").strip()
