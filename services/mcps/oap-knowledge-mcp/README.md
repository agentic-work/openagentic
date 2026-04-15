# OpenAgentic Knowledge MCP Server

A Model Context Protocol server that provides tool guidance and documentation for OpenAgentic platform MCPs. Based on the AWS Knowledge MCP pattern.

## Purpose

LLMs often struggle to know:
1. **Which tool** to use for a task (e.g., `azure_graph_execute` vs `azure_arm_execute`)
2. **How** to call the tool correctly (parameters, syntax)
3. **What** the common mistakes are

This MCP solves these problems by providing tools that teach LLMs about other tools.

## Tools

### `search_tool_documentation(query, top_k=5)`
Search for tool usage guidance by natural language query.

**Example:**
```
search_tool_documentation("how to list Azure AD users")
```

### `get_tool_examples(tool_name)`
Get detailed usage examples for a specific tool.

**Example:**
```
get_tool_examples("azure_graph_execute")
```

### `suggest_tools_for_task(task_description)`
Given a task, suggest which tools to use and how.

**Example:**
```
suggest_tools_for_task("Show me my Azure AD users")
```

### `list_available_mcps()`
List all available MCP servers and their capabilities.

## How It Works

1. User asks: "Show me my Azure AD users"
2. LLM is unsure which tool to use
3. LLM calls: `suggest_tools_for_task("Show me my Azure AD users")`
4. Gets back: "Use `azure_graph_execute(method='GET', path='/users')`"
5. LLM calls the correct tool with correct parameters

## Adding New Tool Knowledge

Edit `TOOL_KNOWLEDGE` dict in `server.py`:

```python
TOOL_KNOWLEDGE = {
    "new_tool_name": {
        "description": "What the tool does",
        "when_to_use": ["Use case 1", "Use case 2"],
        "examples": [
            {"task": "Do X", "call": "new_tool_name(param='value')"}
        ],
        "common_mistakes": ["Don't do this"],
        "related_tools": ["other_tool"]
    }
}
```

## Installation

```bash
pip install -r requirements.txt
```

## Running

```bash
python server.py
```

Or via MCP proxy configuration.

## Sources

- [AWS Knowledge MCP Server](https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server) - Inspiration for this pattern
- [MCP Server Instructions](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/) - Best practices
- [MCP Specification - Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
