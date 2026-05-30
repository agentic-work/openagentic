# OpenAgentic Web MCP Server

Intelligent web browsing and research capabilities for LLMs. This MCP server enables AI to browse the web like a human would - searching, reading pages, verifying information, and storing knowledge.

## Features

- **Web Search**: Search using DuckDuckGo (no API key required)
- **Page Fetching**: Fetch and convert web pages to clean markdown
- **Search & Read**: Combine search with automatic content fetching
- **Fact Verification**: Cross-reference claims across multiple sources
- **News Search**: Search for recent news articles
- **Structured Data Extraction**: Extract tables and lists from pages
- **Knowledge Storage**: Store findings to the memory system

## Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web using DuckDuckGo |
| `web_fetch` | Fetch a web page and convert to markdown |
| `web_search_and_read` | Search and automatically fetch top results |
| `web_verify_fact` | Verify a claim using multiple sources |
| `web_news_search` | Search for recent news articles |
| `web_extract_structured_data` | Extract tables and lists from pages |
| `web_store_knowledge` | Store important findings for future reference |
| `web_help` | Get help on using the web tools |

## Installation

### Dependencies

```bash
pip install -r requirements.txt
```

Or with pip:
```bash
pip install fastmcp httpx beautifulsoup4 markdownify duckduckgo-search pydantic python-dotenv
```

### Running Locally

```bash
python server.py
```

### Running with FastMCP

```bash
fastmcp run -t stdio server.py
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level (debug, info, warning, error) |
| `REQUEST_TIMEOUT` | `30` | HTTP request timeout in seconds |
| `MEMORY_MCP_URL` | `http://mcp-proxy:3100` | URL for knowledge storage integration |
| `USER_AGENT` | Chrome-like | Custom user agent for web requests |
| `OpenAgentic_WEB_MCP_DISABLED` | `false` | Set to `true` to disable this MCP |

## Usage Examples

### Web Search
```python
# Search for Python tutorials
web_search(
    query="Python FastMCP tutorial 2024",
    num_results=5,
    time_range="m"  # Past month
)
```

### Fetch a Page
```python
# Fetch and read a documentation page
web_fetch(
    url="https://docs.python.org/3/tutorial/",
    extract_links=True
)
```

### Search and Read
```python
# Research a topic with multiple sources
web_search_and_read(
    query="How to implement OAuth2 in Python",
    num_results=3
)
```

### Verify a Fact
```python
# Cross-reference information
web_verify_fact(
    claim="Python 3.12 was released in October 2023",
    num_sources=3
)
```

### News Search
```python
# Get recent news
web_news_search(
    query="AI regulation updates",
    time_range="w"  # Past week
)
```

### Extract Structured Data
```python
# Extract tables from a page
web_extract_structured_data(
    url="https://en.wikipedia.org/wiki/List_of_programming_languages",
    data_type="tables"
)
```

### Store Knowledge
```python
# Save important findings
web_store_knowledge(
    title="Python 3.12 Release Info",
    content="Released October 2, 2023 with performance improvements...",
    source_url="https://python.org/downloads/release/python-3120/",
    tags=["python", "release"],
    importance="normal"
)
```

## Why This Replaces fetch MCP

The standard `mcp-server-fetch` MCP was unreliable and limited:
- Often failed to fetch pages
- No search capability
- No intelligent content extraction
- No fact verification

This MCP provides:
- Reliable page fetching with proper error handling
- Built-in web search via DuckDuckGo
- Content cleaning and markdown conversion
- Multi-source fact verification
- Knowledge storage integration
- News-specific search

## Architecture

```
┌─────────────────┐
│   LLM Request   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  OpenAgentic Web MCP    │
├─────────────────┤
│ ┌─────────────┐ │
│ │ DuckDuckGo  │ │ ── Web Search
│ └─────────────┘ │
│ ┌─────────────┐ │
│ │   httpx     │ │ ── Page Fetching
│ └─────────────┘ │
│ ┌─────────────┐ │
│ │BeautifulSoup│ │ ── HTML Parsing
│ └─────────────┘ │
│ ┌─────────────┐ │
│ │  markdownify│ │ ── MD Conversion
│ └─────────────┘ │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Memory MCP     │ ── Knowledge Storage (optional)
└─────────────────┘
```

## License

MIT - OpenAgentic Platform
