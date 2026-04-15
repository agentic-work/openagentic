# OPENAGENTIC.md - OpenAgentic Code Mode

You are operating in **OpenAgentic Code Mode**, a persistent AI development environment.

---

## Execution Style

- **Prefer direct implementation over plan mode.** When the user asks you to build something, build it immediately. Only use EnterPlanMode for genuinely complex multi-system architecture decisions.
- **Run tasks to completion.** Do not stop midway. If you launch background agents via the Task tool, always wait for and collect their results before summarizing.
- **Use parallel agents when beneficial.** For independent subtasks (research + implementation, testing + documentation), launch them in parallel but ALWAYS read their output files before proceeding.
- **Auto-run tests after writing code.** After creating or modifying code, automatically run the tests without asking for permission.
- **Keep working until done.** Don't ask "should I proceed?" — just proceed. The `--dangerously-skip-permissions` flag means you have full autonomy.

## Environment

```
/workspaces/<user-id>/          # Your persistent workspace (survives restarts)
├── projects/                   # Project directories
├── notebooks/                  # Jupyter notebooks (tutorial examples included)
├── .openagentic/                # Openagentic config (auto-managed)
│   ├── settings.json           # Settings (do not modify)
│   └── projects/               # Project memory
└── OPENAGENTIC.md               # This file — your project instructions
```

## Available Dev Tools

All tools are pre-installed and ready to use. **You control all of these — users cannot access the terminal directly.**

| Tool | Command | Notes |
|------|---------|-------|
| **Python 3** | `python3`, `pip` | System Python with pip |
| **uv** | `uv` | Fast Python package/env manager (preferred over pip) |
| **Node.js** | `node`, `npm` | v20 LTS |
| **Go** | `go` | Go compiler (1.23.x) |
| **Rust** | `rustc`, `cargo` | Stable toolchain via rustup |
| **PowerShell** | `pwsh` | Microsoft PowerShell (amd64 only) |
| **Git** | `git` | Full git support |
| **ripgrep** | `rg` | Fast code search |
| **Jupyter** | `python3 -m ipykernel` | Jupyter kernel for notebooks |
| **pytest** | `pytest` | Python test runner |
| **Homebrew** | `brew install <pkg>` | Install additional tools on-demand |

### Python Projects

Use `uv` for Python project management (much faster than pip):
```bash
uv init my-project          # Create new project
uv add pandas numpy         # Add dependencies
uv run python main.py       # Run with managed deps
uv run pytest               # Run tests
```

For Jupyter notebooks:
```bash
# Create and run notebooks in the notebooks/ directory
python3 -m jupyter nbconvert --to notebook --execute notebook.ipynb
```

### Go Projects

```bash
mkdir -p projects/my-go-app && cd projects/my-go-app
go mod init my-app
go run main.go
go test ./...
```

### Rust Projects

```bash
cargo init projects/my-rust-app
cd projects/my-rust-app
cargo run
cargo test
```

### PowerShell Scripts

```bash
pwsh -File script.ps1
pwsh -Command "Get-Process | Select-Object -First 5"
```

### Installing Additional Packages

Install language-specific packages to your home directory:
```bash
# Python (user-level)
pip install --user pandas numpy requests
uv add pandas numpy              # In uv-managed projects

# Go (installs to ~/go/bin)
go install golang.org/x/tools/gopls@latest

# Rust (installs to ~/.cargo/bin)
cargo install ripgrep bat fd-find

# Node.js (installs to ~/.npm-global/bin)
npm install -g typescript ts-node
```

## Security Rules

- Never expose API keys, passwords, or tokens in code
- Use environment variables for sensitive configuration
- Do not modify system files outside your workspace
- Do not attempt to escalate privileges
- Users cannot access the terminal — only you (the AI) execute commands

## Session Continuity

This workspace persists across sessions. When you reconnect:
- Your files are exactly as you left them
- Your conversation history is resumed via `--continue`
- Your `.openagentic/` memory and project context are preserved

To maintain context across sessions, keep this OPENAGENTIC.md updated with:
- Project-specific build/test commands
- Important file locations and architecture decisions
- Known issues and TODO items

---

*Auto-generated for OpenAgentic Code Mode. Customize for your project.*
