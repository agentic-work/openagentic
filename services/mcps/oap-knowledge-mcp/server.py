

"""
OpenAgentic Knowledge MCP Server

A Model Context Protocol server that provides tool guidance and documentation
for OpenAgentic platform MCPs. Helps LLMs understand how to use tools correctly.

Based on AWS Knowledge MCP pattern - provides:
- search_tool_documentation: Search for tool usage guidance
- get_tool_examples: Get specific examples for a tool
- suggest_tools_for_task: Recommend tools for a given task
- list_available_mcps: List all MCPs and their purposes

This server acts as a "meta-MCP" that teaches LLMs about other MCPs.
"""

import os
import json
import logging
from typing import Optional, Dict, Any, List
from fastmcp import FastMCP

# Configure structured logging via shared observability module
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-knowledge-mcp')
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oap-knowledge-mcp")

# =============================================================================
# SERVER INSTRUCTIONS
# =============================================================================
# These instructions are injected into the LLM's system prompt

KNOWLEDGE_SERVER_INSTRUCTIONS = """
## OpenAgentic Knowledge MCP - Your Tool Guide

This is a META-MCP that helps you use other OpenAgentic tools correctly.

### WHEN TO USE THIS MCP

Use this MCP when you're unsure:
- **Which tool** to use for a task
- **How** to call a tool correctly
- **What** the common mistakes are

### AVAILABLE TOOLS

| Tool | Purpose |
|------|---------|
| `suggest_tools_for_task` | Given a task, get tool recommendations |
| `get_tool_examples` | Get detailed examples for a specific tool |
| `search_tool_documentation` | Search all tool docs by keyword |
| `list_available_mcps` | List all MCPs and their capabilities |

### WORKFLOW

1. **Unsure which tool?** -> `suggest_tools_for_task("your task description")`
2. **Know the tool but need syntax?** -> `get_tool_examples("tool_name")`
3. **Looking for specific capability?** -> `search_tool_documentation("your query")`

### CRITICAL TOOL SELECTION RULES

These rules are CRITICAL - get them wrong and your call will fail:

| Task Type | CORRECT Tool | WRONG Tool |
|-----------|--------------|------------|
| Azure AD users/groups | `azure_list_users` / `azure_list_groups` / `azure_get_user` | `azure_create_*` / `azure_list_vms` |
| Azure VMs/storage/networking | typed `azure_create_*` / `azure_list_*` / `azure_get_*` | hand-crafted ARM JSON |
| Azure resource discovery | `azure_resource_graph_query` | looping `azure_list_*` calls |
| Weather/news/current events | `web_search` | (guessing from training data) |
| Read specific URL | `web_fetch` | `web_search` |

### EXAMPLES

```
# "Show me my Azure AD users"
suggest_tools_for_task("list Azure AD users")
# Returns: use azure_graph_execute(method="GET", path="/users")

# "What's the weather in Seattle?"
suggest_tools_for_task("current weather Seattle")
# Returns: use web_search(query="current weather Seattle")
```
"""

# Create MCP server with instructions
mcp = FastMCP("OpenAgentic Knowledge MCP", instructions=KNOWLEDGE_SERVER_INSTRUCTIONS)

# =============================================================================
# TOOL KNOWLEDGE BASE
# =============================================================================
# This is the "brain" that teaches LLMs how to use OpenAgentic tools.
# Each entry contains: description, examples, common mistakes, related tools

TOOL_KNOWLEDGE = {
    # =========================================================================
    # AZURE MCP TOOLS
    # =========================================================================
    "azure_graph_execute": {
        "description": "Execute Microsoft Graph API operations for Azure AD/Entra ID. Use this for ALL identity operations: users, groups, applications, service principals.",
        "when_to_use": [
            "Listing Azure AD users",
            "Getting current user info (whoami)",
            "Managing groups and memberships",
            "Listing app registrations",
            "Managing service principals",
            "Any Azure Active Directory / Entra ID operation"
        ],
        "examples": [
            {
                "task": "List all Azure AD users",
                "call": 'azure_graph_execute(method="GET", path="/users")'
            },
            {
                "task": "Get my profile (who am I)",
                "call": 'azure_graph_execute(method="GET", path="/me")'
            },
            {
                "task": "List all groups",
                "call": 'azure_graph_execute(method="GET", path="/groups")'
            },
            {
                "task": "Find users named John",
                "call": "azure_graph_execute(method=\"GET\", path=\"/users?$filter=startswith(displayName,'John')\")"
            },
            {
                "task": "List app registrations",
                "call": 'azure_graph_execute(method="GET", path="/applications")'
            },
            {
                "task": "List service principals",
                "call": 'azure_graph_execute(method="GET", path="/servicePrincipals")'
            }
        ],
        "common_mistakes": [
            "Using the Azure management tools (azure_list_vms / azure_create_*) for AD operations — those are for infrastructure, not identity. Use azure_graph_execute for users, groups, apps.",
            "Forgetting the leading slash in path - path should be '/users' not 'users'",
            "Using POST for read operations - use GET for listing/reading"
        ],
        "related_tools": ["azure_list_users", "azure_list_groups", "azure_keyvault_secret"]
    },

    "azure_list_subscriptions": {
        "description": "List Azure subscriptions accessible to the current user. Typed tool — no ARM JSON required.",
        "when_to_use": ["Getting list of subscriptions", "Finding subscription IDs"],
        "examples": [
            {"task": "List my Azure subscriptions", "call": "azure_list_subscriptions()"}
        ],
        "common_mistakes": [],
        "related_tools": ["azure_list_resource_groups"]
    },

    "azure_list_resource_groups": {
        "description": "List resource groups in a subscription.",
        "when_to_use": ["Listing resource groups", "Finding resource group names"],
        "examples": [
            {"task": "List resource groups", "call": 'azure_list_resource_groups(subscription_id="your-sub-id")'}
        ],
        "common_mistakes": ["Forgetting subscription_id parameter"],
        "related_tools": ["azure_list_subscriptions", "azure_create_resource_group"]
    },

    "azure_create_resource_group": {
        "description": "Create (or idempotently upsert) a resource group.",
        "when_to_use": ["Starting any Azure deployment", "Grouping related resources for single-call cleanup"],
        "examples": [
            {"task": "Create RG in eastus", "call": 'azure_create_resource_group(name="rg-demo", location="eastus")'}
        ],
        "common_mistakes": ["Passing a region like 'East US' instead of slug 'eastus'"],
        "related_tools": ["azure_create_vnet", "azure_create_vm", "azure_create_app_gateway"]
    },

    "azure_create_app_gateway": {
        "description": "Create an Application Gateway v2 with a public IP, single listener, one backend pool, and one routing rule. Accepts 100+ backend addresses.",
        "when_to_use": ["Provisioning an L7 gateway to front a large set of servers", "Building Front Door → App Gateway enterprise edges"],
        "examples": [
            {"task": "Create Std_v2 App Gateway",
             "call": 'azure_create_app_gateway(name="agw-demo", resource_group="rg-demo", location="eastus", vnet_name="vnet-demo", subnet_name="appgw-subnet", backend_addresses=["svc1.internal", "svc2.internal"])'}
        ],
        "common_mistakes": [
            "Subnet shared with other resources — App Gateway v2 REQUIRES a dedicated /24+ subnet",
            "Expecting HTTPS to work — this tool only wires port 80 listener"
        ],
        "related_tools": ["azure_create_vnet", "azure_create_subnet", "azure_create_front_door"]
    },

    "azure_create_front_door": {
        "description": "Create Azure Front Door Standard/Premium profile with default endpoint, optional origin group + origin.",
        "when_to_use": ["Adding a global edge in front of backend workloads", "Fronting an App Gateway"],
        "examples": [
            {"task": "Create Standard FD wired to an App Gateway",
             "call": 'azure_create_front_door(name="fd-demo", resource_group="rg-demo", origin_hostname="<appgw-frontend-ip>")'}
        ],
        "common_mistakes": [
            "Omitting origin_hostname and expecting routing — you need origins to actually serve traffic",
            "Passing a private-only hostname — Front Door origins must be publicly reachable"
        ],
        "related_tools": ["azure_create_app_gateway", "azure_list_front_doors", "azure_get_front_door"]
    },

    # =========================================================================
    # WEB TOOLS
    # =========================================================================
    "web_search": {
        "description": "Search the web for real-time information. Use for current events, weather, news, documentation lookups.",
        "when_to_use": [
            "Getting current weather",
            "Finding latest news",
            "Looking up documentation",
            "Any real-time information need",
            "Searching for tutorials or guides"
        ],
        "examples": [
            {"task": "Get weather in Seattle", "call": 'web_search(query="current weather Seattle")'},
            {"task": "Find Kubernetes docs", "call": 'web_search(query="Kubernetes deployment tutorial")'},
            {"task": "Latest AWS announcements", "call": 'web_search(query="AWS re:Invent 2024 announcements")'}
        ],
        "common_mistakes": [
            "Using for static knowledge questions the LLM already knows",
            "Too vague queries - be specific"
        ],
        "related_tools": ["web_fetch", "web_news_search"]
    },

    "web_fetch": {
        "description": "Fetch and read content from a specific URL. Use when you have a direct link.",
        "when_to_use": [
            "Reading a specific documentation page",
            "Fetching content from a known URL",
            "User provides a link to read"
        ],
        "examples": [
            {"task": "Read AWS S3 docs", "call": 'web_fetch(url="https://docs.aws.amazon.com/s3/")'}
        ],
        "common_mistakes": ["Using web_search when you have exact URL"],
        "related_tools": ["web_search"]
    },

    "web_news_search": {
        "description": "Search for recent news articles. Better than web_search for time-sensitive topics.",
        "when_to_use": [
            "Finding recent news",
            "Current events",
            "Latest developments in a topic"
        ],
        "examples": [
            {"task": "Latest AI news", "call": 'web_news_search(query="artificial intelligence", time_range="w")'}
        ],
        "common_mistakes": ["Using web_search for news when web_news_search is better"],
        "related_tools": ["web_search"]
    },

    # =========================================================================
    # AWS TOOLS
    # =========================================================================
    "call_aws": {
        "description": "Execute AWS CLI commands. Use for any AWS operation.",
        "when_to_use": [
            "Managing EC2 instances",
            "Working with S3 buckets",
            "Lambda operations",
            "Any AWS CLI command"
        ],
        "examples": [
            {"task": "List EC2 instances", "call": 'call_aws(cli_command="aws ec2 describe-instances")'},
            {"task": "List S3 buckets", "call": 'call_aws(cli_command="aws s3 ls")'},
            {"task": "Who am I in AWS", "call": 'call_aws(cli_command="aws sts get-caller-identity")'}
        ],
        "common_mistakes": [
            "Forgetting to start command with 'aws'",
            "Wrong region specification"
        ],
        "related_tools": ["aws_identity", "aws_list_ec2", "aws_list_s3"]
    },

    "aws_identity": {
        "description": "Get your current AWS identity. Shortcut for 'aws sts get-caller-identity'.",
        "when_to_use": ["Checking AWS identity", "Who am I in AWS"],
        "examples": [
            {"task": "Who am I in AWS", "call": "aws_identity()"}
        ],
        "common_mistakes": [],
        "related_tools": ["call_aws"]
    },

    # =========================================================================
    # DIAGRAM TOOLS
    # =========================================================================
    "create_diagram": {
        "description": "Create architectural diagrams, flowcharts, sequence diagrams using Mermaid syntax.",
        "when_to_use": [
            "Creating architecture diagrams",
            "Drawing flowcharts",
            "Sequence diagrams",
            "Any visual diagram request"
        ],
        "examples": [
            {
                "task": "Create a simple flowchart",
                "call": '''create_diagram(diagram_type="flowchart", code="""
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
""")'''
            }
        ],
        "common_mistakes": ["Wrong Mermaid syntax", "Not specifying diagram_type"],
        "related_tools": []
    }
}

# =============================================================================
# MCP REGISTRY - List of all OpenAgentic MCPs
# =============================================================================
MCP_REGISTRY = {
    "oap-azure-mcp": {
        "description": "Azure cloud operations via typed SDK tools (azure_create_*, azure_list_*, azure_get_*) and Graph API",
        "primary_tools": ["azure_create_resource_group", "azure_create_vnet", "azure_create_app_gateway", "azure_create_front_door", "azure_list_resource_groups", "azure_graph_execute", "azure_keyvault_secret", "azure_cost_query"],
        "use_cases": ["Azure infrastructure management", "Azure AD/Entra ID operations", "Cost analysis"]
    },
    "oap-aws-mcp": {
        "description": "AWS cloud operations",
        "primary_tools": ["call_aws", "aws_identity", "aws_list_ec2", "aws_list_s3", "aws_cost_summary"],
        "use_cases": ["AWS infrastructure management", "EC2, S3, Lambda operations", "Cost tracking"]
    },
    "oap-web-mcp": {
        "description": "Web search and content fetching",
        "primary_tools": ["web_search", "web_fetch", "web_news_search"],
        "use_cases": ["Real-time information", "Weather", "News", "Documentation lookup"]
    },
    "oap-diagram-mcp": {
        "description": "Diagram generation using Mermaid",
        "primary_tools": ["create_diagram"],
        "use_cases": ["Architecture diagrams", "Flowcharts", "Sequence diagrams"]
    },
    "oap-admin-mcp": {
        "description": "OpenAgentic platform administration",
        "primary_tools": ["system_health", "user_list", "audit_logs"],
        "use_cases": ["System monitoring", "User management", "Audit logs"]
    },
    "oap-memory-mcp": {
        "description": "Conversation memory and knowledge storage",
        "primary_tools": ["memory_store", "memory_recall", "memory_search"],
        "use_cases": ["Storing user preferences", "Recalling past conversations", "Knowledge management"]
    },
    "oap-knowledge-mcp": {
        "description": "This MCP! Tool guidance and documentation for other MCPs",
        "primary_tools": ["suggest_tools_for_task", "get_tool_examples", "search_tool_documentation", "list_available_mcps"],
        "use_cases": ["Learning how to use tools", "Finding the right tool for a task", "Getting tool examples"]
    }
}

# =============================================================================
# MCP TOOLS
# =============================================================================

@mcp.tool()
async def search_tool_documentation(query: str, top_k: int = 5) -> Dict[str, Any]:
    """
    Search for tool usage documentation and guidance.

    Use this when you need to learn how to use a tool or find the right tool for a task.

    Args:
        query: Natural language description of what you want to do
        top_k: Maximum number of results to return (default: 5)

    Returns:
        Relevant tool documentation with examples
    """
    query_lower = query.lower()
    results = []

    for tool_name, knowledge in TOOL_KNOWLEDGE.items():
        score = 0

        # Check description match
        if any(word in knowledge["description"].lower() for word in query_lower.split()):
            score += 2

        # Check when_to_use match
        for use_case in knowledge.get("when_to_use", []):
            if any(word in use_case.lower() for word in query_lower.split()):
                score += 3

        # Check example tasks
        for example in knowledge.get("examples", []):
            if any(word in example["task"].lower() for word in query_lower.split()):
                score += 4

        # Boost for exact tool name match
        if tool_name.lower() in query_lower:
            score += 10

        # Specific keyword boosts
        if "azure ad" in query_lower or "entra" in query_lower or "user" in query_lower:
            if tool_name == "azure_graph_execute":
                score += 20

        if "weather" in query_lower or "search" in query_lower or "news" in query_lower:
            if tool_name in ["web_search", "web_fetch", "web_news_search"]:
                score += 15

        if "aws" in query_lower or "ec2" in query_lower or "s3" in query_lower:
            if tool_name in ["call_aws", "aws_identity", "aws_list_ec2", "aws_list_s3"]:
                score += 15

        if score > 0:
            results.append({
                "tool_name": tool_name,
                "score": score,
                "description": knowledge["description"],
                "examples": knowledge.get("examples", [])[:2],  # Top 2 examples
                "when_to_use": knowledge.get("when_to_use", [])[:3]
            })

    # Sort by score and return top_k
    results.sort(key=lambda x: x["score"], reverse=True)

    return {
        "query": query,
        "results": results[:top_k],
        "total_matches": len(results)
    }

@mcp.tool()
async def get_tool_examples(tool_name: str) -> Dict[str, Any]:
    """
    Get detailed usage examples for a specific tool.

    Use this when you know which tool you need but want to see how to call it correctly.

    Args:
        tool_name: Name of the tool (e.g., 'azure_graph_execute', 'web_search')

    Returns:
        Detailed examples, common mistakes, and related tools
    """
    # Try exact match first
    if tool_name in TOOL_KNOWLEDGE:
        knowledge = TOOL_KNOWLEDGE[tool_name]
        return {
            "tool_name": tool_name,
            "found": True,
            "description": knowledge["description"],
            "when_to_use": knowledge.get("when_to_use", []),
            "examples": knowledge.get("examples", []),
            "common_mistakes": knowledge.get("common_mistakes", []),
            "related_tools": knowledge.get("related_tools", [])
        }

    # Try fuzzy match
    tool_name_lower = tool_name.lower()
    for name, knowledge in TOOL_KNOWLEDGE.items():
        if tool_name_lower in name.lower() or name.lower() in tool_name_lower:
            return {
                "tool_name": name,
                "found": True,
                "matched_from": tool_name,
                "description": knowledge["description"],
                "when_to_use": knowledge.get("when_to_use", []),
                "examples": knowledge.get("examples", []),
                "common_mistakes": knowledge.get("common_mistakes", []),
                "related_tools": knowledge.get("related_tools", [])
            }

    return {
        "tool_name": tool_name,
        "found": False,
        "message": f"No documentation found for tool '{tool_name}'. Available tools: {list(TOOL_KNOWLEDGE.keys())}"
    }

@mcp.tool()
async def suggest_tools_for_task(task_description: str = "", task: str = "") -> Dict[str, Any]:
    """
    Given a task description, suggest which tools to use and how.

    Use this when you're unsure which tool to use for a particular task.

    Args:
        task_description: Natural language description of what you want to accomplish
        task: Alias for task_description (workflow templates may use either name)

    Returns:
        Suggested tools with usage guidance
    """
    # Accept either parameter name (templates may pass "task" instead of "task_description")
    effective_description = task_description or task
    if not effective_description:
        return {
            "error": "Either 'task_description' or 'task' parameter is required",
            "suggestions": []
        }
    task_lower = effective_description.lower()
    suggestions = []

    # Azure AD / Identity patterns
    if any(kw in task_lower for kw in ["azure ad", "entra", "user", "group", "identity", "directory", "who am i", "my profile", "service principal", "app registration"]):
        suggestions.append({
            "tool": "azure_graph_execute",
            "confidence": "high",
            "reason": "Azure AD/Entra ID operations require Microsoft Graph API",
            "example": TOOL_KNOWLEDGE["azure_graph_execute"]["examples"][0]
        })

    # Azure infrastructure patterns
    if any(kw in task_lower for kw in ["vm", "virtual machine", "storage", "vnet", "network", "resource group", "subscription", "database", "app service", "front door", "app gateway", "application gateway"]):
        # Route to the most specific typed tool the knowledge base has for the task.
        if "resource group" in task_lower:
            primary = "azure_create_resource_group" if "create" in task_lower else "azure_list_resource_groups"
        elif "front door" in task_lower:
            primary = "azure_create_front_door" if "create" in task_lower else "azure_list_front_doors"
        elif "app gateway" in task_lower or "application gateway" in task_lower:
            primary = "azure_create_app_gateway" if "create" in task_lower else "azure_list_app_gateways"
        elif "vnet" in task_lower or "network" in task_lower:
            primary = "azure_create_vnet" if "create" in task_lower else "azure_list_vnets"
        elif "subscription" in task_lower:
            primary = "azure_list_subscriptions"
        else:
            primary = "azure_list_resource_groups"
        if primary in TOOL_KNOWLEDGE:
            suggestions.append({
                "tool": primary,
                "confidence": "high",
                "reason": "Azure infrastructure operation — use the typed tool",
                "example": TOOL_KNOWLEDGE[primary]["examples"][0]
            })

    # AWS patterns
    if any(kw in task_lower for kw in ["aws", "ec2", "s3", "lambda", "dynamodb", "cloudformation", "iam"]):
        suggestions.append({
            "tool": "call_aws",
            "confidence": "high",
            "reason": "AWS operations use the AWS CLI",
            "example": TOOL_KNOWLEDGE["call_aws"]["examples"][0]
        })

    # AWS identity patterns
    if any(kw in task_lower for kw in ["who am i aws", "aws identity", "aws account"]):
        suggestions.append({
            "tool": "aws_identity",
            "confidence": "high",
            "reason": "Quick way to check AWS identity",
            "example": TOOL_KNOWLEDGE["aws_identity"]["examples"][0]
        })

    # Web/real-time patterns
    if any(kw in task_lower for kw in ["weather", "news", "search", "current", "latest", "today", "documentation", "tutorial"]):
        suggestions.append({
            "tool": "web_search",
            "confidence": "high",
            "reason": "Real-time information requires web search",
            "example": TOOL_KNOWLEDGE["web_search"]["examples"][0]
        })

    # URL patterns
    if "http" in task_lower or "url" in task_lower or "link" in task_lower:
        suggestions.append({
            "tool": "web_fetch",
            "confidence": "medium",
            "reason": "Fetching specific URL content",
            "example": TOOL_KNOWLEDGE["web_fetch"]["examples"][0]
        })

    # Diagram patterns
    if any(kw in task_lower for kw in ["diagram", "flowchart", "architecture", "sequence", "draw", "visualize"]):
        suggestions.append({
            "tool": "create_diagram",
            "confidence": "high",
            "reason": "Visual diagrams use Mermaid syntax",
            "example": TOOL_KNOWLEDGE["create_diagram"]["examples"][0]
        })

    if not suggestions:
        # Return search guidance
        return {
            "task": effective_description,
            "suggestions": [],
            "guidance": "No specific tool match found. Try using search_tool_documentation with more specific keywords.",
            "available_mcps": list(MCP_REGISTRY.keys())
        }

    return {
        "task": effective_description,
        "suggestions": suggestions,
        "total_suggestions": len(suggestions)
    }

@mcp.tool()
async def list_available_mcps() -> Dict[str, Any]:
    """
    List all available MCP servers and their capabilities.

    Use this to understand what MCPs are available and what they can do.

    Returns:
        List of MCPs with descriptions and primary tools
    """
    return {
        "mcps": MCP_REGISTRY,
        "total_mcps": len(MCP_REGISTRY),
        "usage_hint": "Use suggest_tools_for_task(task) to find the right tool for your task, or get_tool_examples(tool_name) for detailed usage."
    }

# =============================================================================
# SERVER STARTUP
# =============================================================================

if __name__ == "__main__":
    logger.info("Starting OpenAgentic Knowledge MCP Server...")
    logger.info(f"Loaded {len(TOOL_KNOWLEDGE)} tool knowledge entries")
    logger.info(f"Registered {len(MCP_REGISTRY)} MCPs")

    mcp.run()
