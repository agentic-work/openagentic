# OpenAgentic Code Mode Workspace

Welcome to your personal Code Mode workspace! This is a persistent, isolated development environment powered by OpenAgentic.

## What is Code Mode?

Code Mode provides you with:

1. **AI-Powered Development** - An intelligent coding assistant that can read, write, and modify files in your workspace
2. **Integrated VS Code** - Full Visual Studio Code environment running in your browser
3. **Persistent Storage** - Your files persist across sessions via cloud storage (MinIO)
4. **Isolated Environment** - Secure sandbox with no access to other users' workspaces

## Getting Started

### 1. Access Code Mode
- Navigate to OpenAgentic chat
- Click the "Code Mode" button or use the keyboard shortcut
- Wait for your environment to initialize (first time takes ~30 seconds)

### 2. Using the AI Assistant
- Type your coding requests in the chat panel
- The AI can:
  - Create and modify files
  - Execute terminal commands
  - Search and analyze code
  - Generate documentation
  - Debug and fix issues

### 3. Using VS Code
- Click "Open VS Code" to access the full IDE
- All standard VS Code features are available
- Extensions can be installed as needed
- Terminal access for running commands

## Workspace Layout

```
/workspaces/<your-user-id>/
├── projects/           # Create your project folders here
│   ├── my-app/         # Example project
│   └── ...
├── .openagentic/        # Configuration (auto-created)
├── OPENAGENTIC.md       # AI context file (customize for your projects)
└── README.md           # This file
```

## Tips & Best Practices

1. **Project Organization** - Create separate folders in `/projects/` for different projects
2. **AI Context** - Edit `OPENAGENTIC.md` to give the AI project-specific instructions
3. **Version Control** - Initialize git repos for important projects
4. **Persistence** - All files in this workspace persist across sessions

## Limitations

- No sudo/root access (sandboxed for security)
- No access to external networks except through MCP tools
- Resource limits apply to prevent runaway processes
- Workspace storage has quotas (check Admin Portal for limits)

## Troubleshooting

**Session won't start?**
- Try refreshing the page
- Check your internet connection
- Contact admin if issue persists

**Files disappeared?**
- Storage sync may be delayed
- Wait a few seconds and refresh VS Code
- Check the file tree for your changes

**AI not responding?**
- Check the connection status indicator
- Try sending a simple message first
- Review the startup logs for errors

## Support

For help or to report issues:
- Contact your OpenAgentic administrator
- Check the documentation at https://docs.openagentics.io
- Submit issues at https://github.com/agentic-work/agentic/issues

---

*This workspace is automatically provisioned by OpenAgentic Code Mode.*
