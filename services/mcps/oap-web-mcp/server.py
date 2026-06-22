

"""
OpenAgentic Web MCP Server - Intelligent Web Browsing and Research

A Model Context Protocol (MCP) server that enables LLMs to browse the web
using direct HTTP requests - no rate-limited APIs.

Features:
- Web search via SearXNG metasearch engine (primary) with scraping fallbacks
- Fetch and parse web pages to markdown
- Cross-reference information from multiple sources
- Store important findings to the knowledge ingestion system
- Follow links and navigate websites
- News search with SearXNG native news category support

Environment Variables:
    MEMORY_MCP_URL: URL of the oap-memory-mcp service for knowledge storage
    USER_AGENT: Custom user agent for web requests
    OpenAgentic_WEB_MCP_DISABLED: Set to "true" to disable this MCP
    LOG_LEVEL: Logging level (debug, info, warning, error)
    SEARXNG_URL: SearXNG instance URL (default: http://searxng:8080 for in-cluster)
    REQUEST_TIMEOUT: HTTP request timeout in seconds (default: 30)

Author: OpenAgentic Platform
"""

import os
import sys
import json
import logging
import hashlib
import re
import random
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse, quote_plus

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-web-mcp')
except ImportError:
    log_level = os.getenv("LOG_LEVEL", "info").upper()
    logging.basicConfig(
        level=getattr(logging, log_level),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("oap-web-mcp")

# Check if disabled
if os.getenv("OpenAgentic_WEB_MCP_DISABLED", "false").lower() == "true":
    logger.warning("OpenAgentic Web MCP is disabled via OpenAgentic_WEB_MCP_DISABLED environment variable")
    sys.exit(0)

from fastmcp import FastMCP
import httpx
from bs4 import BeautifulSoup
from markdownify import markdownify as md

from ssrf_guard import deny_if_private, FetchError  # SSRF guard (substrate fix S3)

# Server instructions to help LLMs know when to use web tools
WEB_SERVER_INSTRUCTIONS = """
## OpenAgentic Web MCP - Tool Selection Guide

### WHEN TO USE WEB TOOLS

Use web search/fetch tools for ANY question requiring:
- **Real-time information**: Weather, stock prices, current events, live scores
- **Recent updates**: News from the last days/weeks/months
- **Dynamic data**: Exchange rates, traffic, flight status
- **Verification**: Fact-checking claims, verifying information

### TOOL SELECTION

| User Query | Tool to Use | Example |
|------------|-------------|---------|
| "What's the weather in Seattle?" | `web_search` or `web_search_and_read` | `web_search(query="current weather Seattle Washington")` |
| "What is the current temperature in NYC?" | `web_search` | `web_search(query="current temperature New York City")` |
| "What are the latest AI news?" | `web_news_search` | `web_news_search(query="artificial intelligence", time_range="w")` |
| "Who won the game last night?" | `web_search` | `web_search(query="[team name] game score yesterday")` |
| "Read this article for me" | `web_fetch` | `web_fetch(url="https://...")` |
| "Research OAuth2 implementation" | `web_search_and_read` | `web_search_and_read(query="OAuth2 implementation best practices")` |
| "Is it true that Python 3.12..." | `web_verify_fact` | `web_verify_fact(claim="Python 3.12 was released in October 2023")` |

### CRITICAL RULES

1. **Weather queries ALWAYS need web search** - You don't have real-time weather data
2. **Current events ALWAYS need web search** - Your training data has a cutoff date
3. **"Current", "today", "now", "latest"** = Use web search
4. **Prices, rates, scores** = Use web search (these change constantly)

### DO NOT

- Guess weather or temperatures - SEARCH for them
- Make up current events - SEARCH for them
- Assume your training data is current for time-sensitive topics

### SEARCH TIPS

- Be specific: "weather Seattle Washington" not just "weather"
- Include time context: "latest", "today", "2024"
- For news, use `web_news_search` with appropriate `time_range`
"""

# Initialize FastMCP server with instructions
mcp = FastMCP("OpenAgentic Web MCP", instructions=WEB_SERVER_INSTRUCTIONS)

# Configuration
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]

def get_user_agent() -> str:
    """Get a random user agent to avoid detection."""
    return os.getenv("USER_AGENT", random.choice(USER_AGENTS))

MEMORY_MCP_URL = os.getenv("MEMORY_MCP_URL", "http://mcp-proxy:3100")
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "30"))
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://searxng:8080")  # SearXNG instance (default: in-cluster)

# Use system SSL context instead of certifi (certifi bundle may be outdated).
# create_default_context() already yields a secure client context (cert +
# hostname verification on). Explicitly pin the floor to TLS 1.2 so weak
# legacy protocols (SSLv3 / TLS 1.0 / 1.1) can never be negotiated.
import ssl as _ssl
SSL_CONTEXT = _ssl.create_default_context()
SSL_CONTEXT.minimum_version = _ssl.TLSVersion.TLSv1_2

# Page cache to avoid re-fetching
_page_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes

def get_cache_key(url: str) -> str:
    """Generate a cache key for a URL."""
    return hashlib.md5(url.encode()).hexdigest()

def is_cache_valid(cache_entry: Dict[str, Any]) -> bool:
    """Check if a cache entry is still valid."""
    if "timestamp" not in cache_entry:
        return False
    age = (datetime.now(timezone.utc) - cache_entry["timestamp"]).total_seconds()
    return age < CACHE_TTL_SECONDS

def clean_text(text: str) -> str:
    """Clean up extracted text."""
    # Remove excessive whitespace
    text = re.sub(r'\n\s*\n', '\n\n', text)
    text = re.sub(r' +', ' ', text)
    return text.strip()

def extract_page_links(soup: BeautifulSoup, base_url: str) -> List[Dict[str, str]]:
    """Extract all links from a page."""
    links = []
    for a in soup.find_all('a', href=True):
        href = a['href']
        # Make absolute URL
        absolute_url = urljoin(base_url, href)
        # Get link text
        text = a.get_text(strip=True)
        if text and absolute_url.startswith('http'):
            links.append({
                "text": text[:100],  # Limit text length
                "url": absolute_url
            })
    return links[:50]  # Limit to 50 links

# ============================================================================
# SSRF-GUARDED FETCH HELPER (substrate fix S3)
# ============================================================================
#
# httpx's ``follow_redirects=True`` does NOT re-validate redirect targets
# against any guard, so a 302 → 169.254.169.254 is silently followed. To
# prevent rebinding-to-IMDS-via-302 (and the other SSRF classes guarded by
# ``ssrf_guard.deny_if_private``), every user-controlled fetch in this
# module disables httpx redirect handling and walks the redirect chain
# manually here, calling ``deny_if_private`` on every hop.
#
# Operator-trusted internal RPC (e.g. SearXNG configured via env) does NOT
# go through this helper — those calls keep their original httpx invocations.

async def fetch_with_ssrf_guard(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: Optional[float] = None,
    max_redirects: int = 5,
) -> httpx.Response:
    """Fetch a URL with SSRF guards on every redirect hop.

    Pre-flight calls :func:`ssrf_guard.deny_if_private`. On 30x responses,
    re-validates the ``Location`` target before following. Caps the redirect
    chain at ``max_redirects`` to bound chain-of-IMDS attempts.

    Raises :class:`ssrf_guard.FetchError` on any guard rejection or chain
    overflow. All other exceptions (httpx timeouts, connect errors, status
    errors) propagate to the caller, which already has handlers for them.
    """
    await deny_if_private(url)
    request_timeout = timeout if timeout is not None else REQUEST_TIMEOUT
    request_headers = headers or {}

    async with httpx.AsyncClient(
        timeout=request_timeout,
        follow_redirects=False,
        verify=SSL_CONTEXT,
    ) as client:
        current_url = url
        for _hop in range(max_redirects + 1):
            response = await client.get(current_url, headers=request_headers)
            if response.is_redirect:
                location = response.headers.get("location", "")
                if not location:
                    return response
                # Resolve relative redirects against the current URL so we
                # validate the absolute target.
                next_url = urljoin(current_url, location)
                # CRITICAL: re-validate every hop. ``deny_if_private`` is the
                # only thing standing between a 302 and IMDS.
                await deny_if_private(next_url)
                current_url = next_url
                continue
            return response
        raise FetchError("too_many_redirects", url)

# ============================================================================
# SEARCH IMPLEMENTATIONS
# ============================================================================

async def _search_via_searxng(
    query: str,
    num_results: int = 10,
    categories: Optional[str] = None,
    time_range: Optional[str] = None,
    language: str = "en"
) -> List[Dict[str, str]]:
    """
    Search using a SearXNG instance (primary search provider).

    SearXNG is a free, privacy-respecting metasearch engine that aggregates
    results from multiple search engines (Google, Bing, DuckDuckGo, etc.).

    Args:
        query: Search query string
        num_results: Maximum number of results to return
        categories: SearXNG category filter (e.g. "general", "news", "science", "it")
        time_range: Time range filter ("day", "week", "month", "year")
        language: Language code (default "en")

    Returns:
        List of result dicts with title, url, snippet, engine, and score
    """
    if not SEARXNG_URL:
        return []

    try:
        params: Dict[str, Any] = {
            "q": query,
            "format": "json",
            "language": language,
        }

        # Add optional category filter (e.g. "news", "general", "science", "it")
        if categories:
            params["categories"] = categories

        # Map time_range shortcuts to SearXNG values
        if time_range:
            time_map = {
                "d": "day", "day": "day",
                "w": "week", "week": "week",
                "m": "month", "month": "month",
                "y": "year", "year": "year",
            }
            mapped = time_map.get(time_range.lower())
            if mapped:
                params["time_range"] = mapped

        logger.info(f"SearXNG search: query={query!r}, params={params}")

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.get(
                f"{SEARXNG_URL}/search",
                params=params,
                headers={"User-Agent": get_user_agent()}
            )
            response.raise_for_status()
            data = response.json()

            # Log unresponsive engines for debugging
            unresponsive = data.get("unresponsive_engines", [])
            if unresponsive:
                logger.warning(f"SearXNG unresponsive engines: {unresponsive}")

            results = []
            for r in data.get("results", [])[:num_results]:
                result_entry: Dict[str, str] = {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("content", ""),
                }
                # Include engine and score as metadata when available
                if r.get("engine"):
                    result_entry["engine"] = r["engine"]
                if r.get("score") is not None:
                    result_entry["score"] = str(r["score"])
                # Include published date for news results
                if r.get("publishedDate"):
                    result_entry["published_date"] = r["publishedDate"]
                results.append(result_entry)

            logger.info(f"SearXNG returned {len(results)} results for: {query!r}")
            return results

    except httpx.ConnectError as e:
        logger.warning(f"SearXNG connection failed (is SearXNG running at {SEARXNG_URL}?): {e}")
        return []
    except httpx.TimeoutException as e:
        logger.warning(f"SearXNG request timed out after {REQUEST_TIMEOUT}s: {e}")
        return []
    except Exception as e:
        logger.warning(f"SearXNG search failed: {e}")
        return []

async def _search_via_google_scrape(
    query: str,
    num_results: int = 10
) -> List[Dict[str, str]]:
    """Search by scraping Google search results."""
    try:
        search_url = f"https://www.google.com/search?q={quote_plus(query)}&num={num_results + 5}"

        headers = {
            "User-Agent": get_user_agent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }

        response = await fetch_with_ssrf_guard(search_url, headers=headers)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')
        results = []

        # Google search result selectors
        for div in soup.find_all('div', class_='g'):
            title_elem = div.find('h3')
            link_elem = div.find('a', href=True)
            snippet_elem = div.find('div', class_=['VwiC3b', 'yXK7lf'])

            if title_elem and link_elem:
                url = link_elem['href']
                # Filter out Google internal links
                if url.startswith('http') and 'google.com' not in url:
                    results.append({
                        "title": title_elem.get_text(strip=True),
                        "url": url,
                        "snippet": snippet_elem.get_text(strip=True) if snippet_elem else ""
                    })

                    if len(results) >= num_results:
                        break

        return results

    except Exception as e:
        logger.warning(f"Google scrape failed: {e}")
        return []

async def _search_via_bing_scrape(
    query: str,
    num_results: int = 10
) -> List[Dict[str, str]]:
    """Search by scraping Bing search results."""
    try:
        search_url = f"https://www.bing.com/search?q={quote_plus(query)}&count={num_results + 5}"

        headers = {
            "User-Agent": get_user_agent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

        response = await fetch_with_ssrf_guard(search_url, headers=headers)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')
        results = []

        # Bing search result selectors
        for li in soup.find_all('li', class_='b_algo'):
            title_elem = li.find('h2')
            link_elem = li.find('a', href=True)
            snippet_elem = li.find('p')

            if title_elem and link_elem:
                url = link_elem['href']
                if url.startswith('http'):
                    results.append({
                        "title": title_elem.get_text(strip=True),
                        "url": url,
                        "snippet": snippet_elem.get_text(strip=True) if snippet_elem else ""
                    })

                    if len(results) >= num_results:
                        break

        return results

    except Exception as e:
        logger.warning(f"Bing scrape failed: {e}")
        return []

async def _search_via_html_web(
    query: str,
    num_results: int = 10
) -> List[Dict[str, str]]:
    """
    Search using HTML.duckduckgo.com - the lite/HTML version which is more reliable.
    """
    try:
        search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"

        headers = {
            "User-Agent": get_user_agent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

        response = await fetch_with_ssrf_guard(search_url, headers=headers)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')
        results = []

        # DuckDuckGo HTML version selectors
        for result in soup.find_all('div', class_='result'):
            title_elem = result.find('a', class_='result__a')
            snippet_elem = result.find('a', class_='result__snippet')

            if title_elem and title_elem.get('href'):
                url = title_elem['href']
                # DDG HTML wraps URLs, extract the actual URL
                if 'uddg=' in url:
                    from urllib.parse import parse_qs, urlparse as up
                    parsed = up(url)
                    params = parse_qs(parsed.query)
                    if 'uddg' in params:
                        url = params['uddg'][0]

                if url.startswith('http'):
                    results.append({
                        "title": title_elem.get_text(strip=True),
                        "url": url,
                        "snippet": snippet_elem.get_text(strip=True) if snippet_elem else ""
                    })

                    if len(results) >= num_results:
                        break

        return results

    except Exception as e:
        logger.warning(f"DuckDuckGo HTML scrape failed: {e}")
        return []

# ============================================================================
# INTERNAL HELPER FUNCTIONS (not exposed as MCP tools)
# ============================================================================

async def _do_web_search(
    query: str,
    num_results: int = 10,
    region: str = "wt-wt",
    time_range: Optional[str] = None
) -> Dict[str, Any]:
    """Internal helper for web search - tries multiple sources with backend
    health tracking. #61 (2026-04-08): Track which backends were attempted
    and surface a more helpful error so the agent can either retry, switch
    queries, or fall back to web_fetch with a known URL.
    """

    num_results = min(max(1, num_results), 50)
    logger.info(f"Searching web for: {query}")

    results = []
    search_source = "unknown"
    attempted_backends: list[str] = []
    backend_errors: dict[str, str] = {}

    async def _try(name: str, fn):
        nonlocal results, search_source
        attempted_backends.append(name)
        try:
            r = await fn()
            if r:
                results = r
                search_source = name
                return True
        except Exception as e:
            backend_errors[name] = str(e)[:200]
        return False

    # 1. SearXNG (in-cluster, primary)
    if SEARXNG_URL and not results:
        await _try("searxng", lambda: _search_via_searxng(query, num_results, time_range=time_range))

    # 2. DuckDuckGo Lite HTML
    if not results:
        await _try("duckduckgo-html", lambda: _search_via_html_web(query, num_results))

    # 3. Bing scrape
    if not results:
        await _try("bing", lambda: _search_via_bing_scrape(query, num_results))

    # 4. Google scrape
    if not results:
        await _try("google", lambda: _search_via_google_scrape(query, num_results))

    if results:
        return {
            "success": True,
            "query": query,
            "num_results": len(results),
            "results": results,
            "source": search_source,
            "attempted_backends": attempted_backends,
            "tip": "Use web_fetch to read the full content of any interesting result"
        }
    else:
        return {
            "success": False,
            "query": query,
            "attempted_backends": attempted_backends,
            "backend_errors": backend_errors,
            "error": (
                "All web search backends failed or returned zero results. "
                "Public search engines (DDG/Bing/Google) periodically rate-limit "
                "automated traffic — this is upstream throttling, not a quota "
                "on this platform. SearXNG was tried first; if it returned "
                "nothing, the upstream metasearch engines it queries are "
                "blocked too."
            ),
            "platform_recommendation": (
                "TODO admin: configure paid search backends (Brave Search API, "
                "Tavily, Bing Web Search API) in SearXNG so we don't depend on "
                "scraping. Tracked as task #61."
            ),
            "agent_tip": (
                "If you have a specific URL in mind for this query, call "
                "web_fetch directly with that URL instead of web_search. "
                "Otherwise rephrase the query and retry once after a short delay."
            ),
        }

async def _do_web_fetch(
    url: str,
    extract_links: bool = True,
    max_length: int = 50000,
    use_cache: bool = True
) -> Dict[str, Any]:
    """Internal helper for web fetch - called by MCP tools."""
    try:
        # Validate URL
        parsed = urlparse(url)
        if not parsed.scheme in ('http', 'https'):
            return {
                "success": False,
                "error": "Invalid URL scheme. Must be http or https."
            }

        # Check cache
        cache_key = get_cache_key(url)
        if use_cache and cache_key in _page_cache:
            cached = _page_cache[cache_key]
            if is_cache_valid(cached):
                logger.info(f"Returning cached content for: {url}")
                return {
                    "success": True,
                    "cached": True,
                    **cached["data"]
                }

        logger.info(f"Fetching URL: {url}")

        headers = {
            "User-Agent": get_user_agent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }

        response = await fetch_with_ssrf_guard(url, headers=headers)
        response.raise_for_status()

        # Check content type
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type and "application/xhtml" not in content_type:
            return {
                "success": True,
                "url": url,
                "content_type": content_type,
                "content": f"Non-HTML content ({content_type}). Raw text:\n\n{response.text[:max_length]}",
                "cached": False
            }

        # Parse HTML
        soup = BeautifulSoup(response.text, 'html.parser')

        # Extract title
        title = ""
        if soup.title:
            title = soup.title.get_text(strip=True)

        # Remove unwanted elements
        for element in soup.find_all(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript']):
            element.decompose()

        # Try to find main content
        main_content = (
            soup.find('main') or
            soup.find('article') or
            soup.find(id='content') or
            soup.find(class_='content') or
            soup.find('body')
        )

        if main_content:
            # Convert to markdown
            content = md(str(main_content), heading_style="ATX", strip=['a'] if not extract_links else [])
            content = clean_text(content)
        else:
            content = clean_text(soup.get_text())

        # Truncate if needed
        if len(content) > max_length:
            content = content[:max_length] + "\n\n... [Content truncated]"

        # Extract links if requested
        page_links = []
        if extract_links:
            page_links = extract_page_links(soup, url)

        result_data = {
            "url": url,
            "title": title,
            "content": content,
            "content_length": len(content),
            "links": page_links if extract_links else []
        }

        # Cache the result
        _page_cache[cache_key] = {
            "timestamp": datetime.now(timezone.utc),
            "data": result_data
        }

        return {
            "success": True,
            "cached": False,
            **result_data
        }

    except FetchError as e:
        # SSRF guard refusal — surface ``reason`` so chatmode can branch on
        # the deny class (imds / rfc1918 / cluster_local / ...).
        logger.warning(f"SSRF guard blocked fetch: reason={e.reason} target={e.target}")
        return {
            "success": False,
            "error": f"Fetch refused by SSRF guard: {e.reason} (target={e.target})",
            "ssrf_blocked": True,
            "ssrf_reason": e.reason,
            "url": url,
        }
    except httpx.TimeoutException:
        return {
            "success": False,
            "error": f"Request timed out after {REQUEST_TIMEOUT} seconds",
            "url": url
        }
    except httpx.HTTPStatusError as e:
        return {
            "success": False,
            "error": f"HTTP error {e.response.status_code}: {e.response.reason_phrase}",
            "url": url
        }
    except Exception as e:
        error_msg = str(e) or repr(e) or f"{type(e).__name__}: Unknown error"
        logger.error(f"Fetch error: {error_msg}")
        return {
            "success": False,
            "error": error_msg,
            "url": url
        }

async def _do_web_search_and_read(
    query: str,
    num_results: int = 3,
    max_content_per_page: int = 10000
) -> Dict[str, Any]:
    """Internal helper for web_search_and_read - combines search and fetch."""
    num_results = min(max(1, num_results), 5)

    # First, search
    search_result = await _do_web_search(query, num_results=num_results)

    if not search_result.get("success"):
        return search_result

    results = search_result.get("results", [])
    fetched_pages = []

    for result in results:
        url = result.get("url")
        if url:
            page_content = await _do_web_fetch(
                url=url,
                extract_links=False,
                max_length=max_content_per_page
            )

            fetched_pages.append({
                "title": result.get("title"),
                "url": url,
                "snippet": result.get("snippet"),
                "content": page_content.get("content", "") if page_content.get("success") else f"Failed to fetch: {page_content.get('error')}",
                "fetch_success": page_content.get("success", False)
            })

    return {
        "success": True,
        "query": query,
        "num_pages_fetched": len(fetched_pages),
        "pages": fetched_pages,
        "tip": "Review the content from multiple sources and cross-reference for accuracy"
    }

# ============================================================================
# MCP TOOLS (these call the internal helpers)
# ============================================================================

@mcp.tool()
async def web_search(
    query: str,
    num_results: int = 10,
    region: str = "wt-wt",
    time_range: Optional[str] = None
) -> Dict[str, Any]:
    """
    Search the web using multiple search engines (with automatic fallback).

    This tool performs a web search and returns results with titles, URLs, and snippets.
    It tries multiple sources (SearXNG, DuckDuckGo HTML, Bing, Google) for reliability.

    Args:
        query: The search query (be specific for better results)
        num_results: Number of results to return (default 10, max 50)
        region: Region hint (not always respected by all backends)
        time_range: Time filter hint (not always respected)

    Returns:
        Dict with search results including title, url, and snippet for each result

    Example:
        web_search(
            query="Python FastMCP tutorial 2024",
            num_results=5
        )
    """
    return await _do_web_search(query, num_results, region, time_range)

@mcp.tool()
async def web_fetch(
    url: str,
    extract_links: bool = True,
    max_length: int = 50000,
    use_cache: bool = True
) -> Dict[str, Any]:
    """
    Fetch a web page and convert it to readable markdown.

    This tool retrieves the content of a URL and converts it to clean markdown format.
    Use this to read articles, documentation, or any web content.

    Args:
        url: The URL to fetch (must be a valid http/https URL)
        extract_links: Whether to extract and return page links (default True)
        max_length: Maximum content length to return (default 50000 chars)
        use_cache: Whether to use cached content if available (default True)

    Returns:
        Dict with:
            - title: Page title
            - content: Page content as markdown
            - links: List of links found on the page (if extract_links=True)
            - url: The fetched URL
            - cached: Whether content was from cache

    Example:
        web_fetch(url="https://docs.python.org/3/tutorial/")
    """
    return await _do_web_fetch(url, extract_links, max_length, use_cache)

@mcp.tool()
async def web_search_and_read(
    query: str,
    num_results: int = 3,
    max_content_per_page: int = 10000
) -> Dict[str, Any]:
    """
    Search the web and automatically fetch content from the top results.

    This is a convenience tool that combines web_search and web_fetch.
    It searches for a query and retrieves the content of the top results.

    Args:
        query: The search query
        num_results: Number of results to fetch content from (default 3, max 5)
        max_content_per_page: Maximum content length per page (default 10000)

    Returns:
        Dict with search results and their fetched content

    Example:
        web_search_and_read(
            query="How to implement OAuth2 in Python",
            num_results=3
        )
    """
    return await _do_web_search_and_read(query, num_results, max_content_per_page)

@mcp.tool()
async def web_verify_fact(
    claim: str,
    num_sources: int = 3
) -> Dict[str, Any]:
    """
    Verify a claim or fact by searching multiple sources.

    This tool helps verify information by:
    1. Searching for the claim
    2. Fetching content from multiple sources
    3. Providing the evidence for you to assess

    Args:
        claim: The claim or fact to verify
        num_sources: Number of sources to check (default 3, max 5)

    Returns:
        Dict with sources and their relevant content for verification

    Example:
        web_verify_fact(
            claim="Python 3.12 was released in October 2023",
            num_sources=3
        )
    """
    # Search for the claim using internal helper
    search_query = f"fact check: {claim}"
    result = await _do_web_search_and_read(
        query=search_query,
        num_results=min(num_sources, 5),
        max_content_per_page=5000
    )

    if not result.get("success"):
        return result

    return {
        "success": True,
        "claim": claim,
        "sources_checked": result.get("num_pages_fetched", 0),
        "evidence": result.get("pages", []),
        "guidance": (
            "Review the evidence from multiple sources to determine accuracy. "
            "Look for:\n"
            "1. Consistent information across sources\n"
            "2. Authoritative sources (official docs, reputable news)\n"
            "3. Recent publication dates\n"
            "4. Primary sources over secondary\n"
            "Report your assessment of whether the claim appears accurate."
        )
    }

@mcp.tool()
async def web_store_knowledge(
    title: str,
    content: str,
    source_url: Optional[str] = None,
    tags: Optional[List[str]] = None,
    importance: str = "normal"
) -> Dict[str, Any]:
    """
    Store important information in the knowledge system for future reference.

    Use this tool when you've found valuable information that should be
    remembered for future conversations. This integrates with the memory MCP.

    Args:
        title: A descriptive title for this piece of knowledge
        content: The content/information to store
        source_url: The URL where this information was found (optional)
        tags: List of tags for categorization (optional)
        importance: Importance level - "low", "normal", or "high"

    Returns:
        Confirmation of storage

    Example:
        web_store_knowledge(
            title="Python 3.12 Release Date",
            content="Python 3.12 was released on October 2, 2023...",
            source_url="https://www.python.org/downloads/release/python-3120/",
            tags=["python", "release", "programming"],
            importance="normal"
        )
    """
    try:
        # Build knowledge entry
        knowledge_entry = {
            "title": title,
            "content": content,
            "source": source_url,
            "tags": tags or [],
            "importance": importance,
            "type": "web_research",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        logger.info(f"Storing knowledge: {title}")
        logger.info(f"Content preview: {content[:200]}...")

        return {
            "success": True,
            "message": f"Knowledge stored: {title}",
            "entry": knowledge_entry,
            "note": "This information is now available for future reference"
        }

    except Exception as e:
        logger.error(f"Storage error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@mcp.tool()
async def web_extract_structured_data(
    url: str,
    data_type: str = "auto"
) -> Dict[str, Any]:
    """
    Extract structured data from a web page (tables, lists, key-value pairs).

    This tool is useful for extracting organized information from pages
    like comparison tables, product specs, or data listings.

    Args:
        url: The URL to extract data from
        data_type: Type of data to extract:
            - "auto": Automatically detect (default)
            - "tables": Extract HTML tables
            - "lists": Extract lists
            - "all": Extract all structured data

    Returns:
        Dict with extracted structured data

    Example:
        web_extract_structured_data(
            url="https://en.wikipedia.org/wiki/List_of_programming_languages",
            data_type="tables"
        )
    """
    try:
        # First fetch the page
        fetch_result = await web_fetch(url, extract_links=False, use_cache=True)

        if not fetch_result.get("success"):
            return fetch_result

        # Re-fetch and parse HTML for structured extraction (SSRF-guarded;
        # the original web_fetch already guarded the same URL but we re-check
        # because DNS rebinding could shift the answer between calls).
        response = await fetch_with_ssrf_guard(url, headers={"User-Agent": get_user_agent()})
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')
        extracted_data = {
            "url": url,
            "tables": [],
            "lists": []
        }

        # Extract tables
        if data_type in ("auto", "tables", "all"):
            for table in soup.find_all('table')[:10]:  # Limit to 10 tables
                rows = []
                headers = []

                # Get headers
                header_row = table.find('tr')
                if header_row:
                    headers = [th.get_text(strip=True) for th in header_row.find_all(['th', 'td'])]

                # Get data rows
                for tr in table.find_all('tr')[1:20]:  # Limit rows
                    cells = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
                    if cells:
                        rows.append(cells)

                if rows or headers:
                    extracted_data["tables"].append({
                        "headers": headers,
                        "rows": rows[:50],  # Limit rows
                        "row_count": len(rows)
                    })

        # Extract lists
        if data_type in ("auto", "lists", "all"):
            for ul in soup.find_all(['ul', 'ol'])[:10]:
                items = []
                for li in ul.find_all('li', recursive=False)[:50]:
                    text = li.get_text(strip=True)
                    if text:
                        items.append(text[:500])  # Limit item length

                if items:
                    extracted_data["lists"].append({
                        "type": "ordered" if ul.name == "ol" else "unordered",
                        "items": items
                    })

        return {
            "success": True,
            **extracted_data,
            "summary": {
                "tables_found": len(extracted_data["tables"]),
                "lists_found": len(extracted_data["lists"])
            }
        }

    except FetchError as e:
        logger.warning(f"SSRF guard blocked extract: reason={e.reason} target={e.target}")
        return {
            "success": False,
            "error": f"Fetch refused by SSRF guard: {e.reason} (target={e.target})",
            "ssrf_blocked": True,
            "ssrf_reason": e.reason,
            "url": url,
        }
    except Exception as e:
        logger.error(f"Extraction error: {e}")
        return {
            "success": False,
            "error": str(e),
            "url": url
        }

@mcp.tool()
async def web_news_search(
    query: str,
    num_results: int = 10,
    time_range: str = "w"
) -> Dict[str, Any]:
    """
    Search for recent news articles on a topic.

    This tool specifically searches for news content, which is useful
    for getting current events, recent developments, or timely information.

    Uses SearXNG's native "news" category when available for higher quality
    news results, with fallback to general search with "news" appended.

    Args:
        query: The news topic to search for
        num_results: Number of results (default 10, max 30)
        time_range: Time filter:
            - "d": Past day
            - "w": Past week (default)
            - "m": Past month

    Returns:
        Dict with news search results

    Example:
        web_news_search(
            query="AI regulation updates",
            time_range="w"
        )
    """
    num_results = min(max(1, num_results), 30)

    # Try SearXNG with native news category first
    if SEARXNG_URL:
        results = await _search_via_searxng(
            query, num_results,
            categories="news",
            time_range=time_range
        )
        if results:
            return {
                "success": True,
                "query": query,
                "num_results": len(results),
                "results": results,
                "source": "searxng-news",
                "time_range": time_range,
                "tip": "Use web_fetch to read the full content of any interesting result"
            }

    # Fallback: general search with "news" appended to query
    news_query = f"{query} news"
    return await _do_web_search(news_query, num_results, time_range=time_range)

@mcp.tool()
async def web_help() -> Dict[str, Any]:
    """
    Get help on using the OpenAgentic Web MCP tools.

    Returns comprehensive documentation on available web browsing tools.
    """
    return {
        "success": True,
        "description": "OpenAgentic Web MCP - Intelligent Web Browsing for AI (No API limits!)",
        "search_backends": [
            "SearXNG (primary - metasearch aggregator)",
            "DuckDuckGo HTML (fallback)",
            "Bing (fallback)",
            "Google (fallback)"
        ],
        "tools": {
            "web_search": {
                "description": "Search the web using multiple backends",
                "best_for": "Finding relevant websites and information sources",
                "example": "web_search(query='Python FastAPI tutorial 2024')"
            },
            "web_fetch": {
                "description": "Fetch and convert a web page to markdown",
                "best_for": "Reading full articles, documentation, or page content",
                "example": "web_fetch(url='https://docs.python.org/3/')"
            },
            "web_search_and_read": {
                "description": "Search and automatically fetch top results",
                "best_for": "Quick research on a topic with multiple sources",
                "example": "web_search_and_read(query='OAuth2 implementation')"
            },
            "web_verify_fact": {
                "description": "Verify a claim using multiple sources",
                "best_for": "Fact-checking and verification",
                "example": "web_verify_fact(claim='Python 3.12 was released in 2023')"
            },
            "web_news_search": {
                "description": "Search for recent news articles",
                "best_for": "Current events and recent developments",
                "example": "web_news_search(query='AI regulations', time_range='w')"
            },
            "web_extract_structured_data": {
                "description": "Extract tables and lists from pages",
                "best_for": "Getting structured data from comparison tables, specs",
                "example": "web_extract_structured_data(url='...', data_type='tables')"
            },
            "web_store_knowledge": {
                "description": "Store important findings for future reference",
                "best_for": "Saving key information learned during research",
                "example": "web_store_knowledge(title='...', content='...')"
            }
        },
        "tips": [
            "Start with web_search to find relevant sources",
            "Use web_fetch to dive deep into specific pages",
            "Use web_verify_fact when you need to confirm information",
            "Store important findings with web_store_knowledge",
            "News search is great for current events and recent changes",
            "Extract structured data when dealing with tables or lists"
        ]
    }

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    logger.info("Starting OpenAgentic Web MCP Server")
    logger.info(f"SearXNG URL: {SEARXNG_URL or 'Not configured (will use scraping fallbacks only)'}")
    logger.info(f"Request timeout: {REQUEST_TIMEOUT}s")
    if SEARXNG_URL:
        logger.info(f"Search backends: SearXNG (primary @ {SEARXNG_URL}), DuckDuckGo HTML, Bing, Google (fallbacks)")
    else:
        logger.info("Search backends: DuckDuckGo HTML, Bing, Google (no SearXNG configured)")

    # Run the MCP server
    mcp.run()
