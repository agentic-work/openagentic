# OpenAgentic OpenAgentic MCP Server

MCP server that proxies code execution requests to the OpenAgentic Manager service.

## Purpose

This MCP enables the LLM in OpenAgentic to **actually execute code** instead of just pretending to run it. It provides:

- **`execute_code`** - Write and run code (Python, Go, JS, Bash, etc.)
- **`run_shell_command`** - Execute shell commands
- **`write_file`** - Create files in user's workspace
- **`read_file`** - Read files from workspace
- **`list_files`** - List directory contents
- **`get_session_info`** - Check session status
- **`stop_session`** - Terminate session

## Architecture

```
User (OpenAgentic UI)
        │
        ▼
  OpenAgentic API
        │
        ▼
    MCP Proxy ──────► oap-openagentic-mcp (this server)
        │                      │
        │                      ▼
        │              OpenAgentic Manager
        │                      │
        │                      ▼
        └─────────────► PTY Session (sandboxed)
                               │
                               ▼
                           Ollama LLM
```

## Key Features

1. **Per-User Isolation**: Each user gets their own PTY session and workspace
2. **RBAC Ready**: User ID passed through for access control
3. **Real Execution**: Code actually runs - files created, output captured
4. **Multiple Languages**: Python, JavaScript, TypeScript, Go, Bash, Rust
5. **Session Management**: Sessions persist across tool calls

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAGENTIC_MANAGER_URL` | `http://openagentic-openagentic-manager:3050` | Manager service URL |

## Usage Example

The LLM can use this MCP to execute code:

```python
# Execute Python code
execute_code(
    code='print("Hello, World!")',
    language='python',
    user_id='user123'
)

# Run a shell command
run_shell_command(
    command='ls -la',
    user_id='user123'
)

# Write and execute a Go program
execute_code(
    code='''
package main

import "fmt"

func main() {
    fmt.Println("Hello from Go!")
}
''',
    language='go',
    user_id='user123'
)
```

## Running Locally

```bash
pip install -r requirements.txt
python server.py
```

## Running with MCP Proxy

Add to MCP proxy configuration:

```json
{
  "mcpServers": {
    "openagentic": {
      "command": "python",
      "args": ["/path/to/oap-openagentic-mcp/server.py"],
      "env": {
        "OPENAGENTIC_MANAGER_URL": "http://openagentic-openagentic-manager:3050"
      }
    }
  }
}
```

## Tools Reference

### execute_code

Execute source code in a sandboxed environment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | Source code to execute |
| `language` | string | No | Language (python, javascript, go, bash, etc.) |
| `user_id` | string | No | User identifier for isolation |
| `filename` | string | No | Custom filename |
| `timeout_seconds` | int | No | Execution timeout |

### run_shell_command

Execute a shell command.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | Yes | Shell command to run |
| `user_id` | string | No | User identifier |
| `working_directory` | string | No | Directory to run in |

### write_file / read_file

File operations in the user's workspace.

### list_files

List directory contents (optionally recursive).

### get_session_info / stop_session

Session management operations.
