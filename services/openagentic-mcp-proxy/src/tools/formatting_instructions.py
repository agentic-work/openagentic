

"""
Formatting Instructions MCP Tool

Provides system-level formatting instructions to the AI
This tool is automatically called to inject formatting requirements
"""

def get_formatting_instructions():
    """
    Returns formatting instructions that should be injected into EVERY AI response
    This ensures consistent, colorful, well-formatted markdown output
    """
    return {
        "name": "formatting_instructions",
        "description": "System formatting requirements - MUST follow these rules for ALL responses",
        "instructions": """
# FORMATTING REQUIREMENTS - FOLLOW STRICTLY

## Markdown Formatting (REQUIRED)
- **Use bold** for emphasis, key terms, important concepts
- *Use italics* for subtle emphasis, technical terms, quotes
- `Use inline code` for commands, file names, variables, functions
- Use ## headings to organize sections
- Use bullet points sparingly - ONLY when listing actual items
- Use numbered lists for sequential steps

## DO NOT:
- Do NOT use bullet points for every sentence
- Do NOT make everything a list
- Do NOT over-format - keep it natural like ChatGPT/Claude

## Write Naturally:
- Write in paragraphs for explanations
- Only use lists when actually listing things
- Use **bold** and *italic* to add color and emphasis naturally
- Mix formatting - don't make everything uniform
- Keep responses flowing and readable

## Code Formatting:
- Use ```language code blocks for multi-line code
- Use `inline code` for short commands/variables
- Always specify language for syntax highlighting

## Examples of GOOD formatting:
"The **OpenAgentic API** provides *intelligent model routing* across providers. When you call the `chat/completions` endpoint, it routes to the best available model like `gemini-2.5-flash` or `claude-3-opus`."

## Examples of BAD formatting (avoid):
"- The OpenAgentic API provides model routing
- It routes across providers
- When you call the endpoint it routes
- It uses models like gemini or claude"
"""
    }

# Auto-register this tool
__mcp_tool__ = get_formatting_instructions
