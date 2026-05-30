Output demos/install-setup.gif

Set FontSize 16
Set Width 1300
Set Height 760
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 40ms

Env WIZARD_DRY_RUN "1"

Hide
  Type "export HOME=$(mktemp -d)"
  Enter
  Type "export PS1='$ '"
  Enter
  Type "clear"
  Enter
  Sleep 400ms
Show

Type "# openagentic install — Ink wizard walkthrough (WIZARD_DRY_RUN=1)"
Enter
Sleep 1.5s

Type "./tools/setup/node_modules/.bin/tsx tools/setup/src/index.tsx"
Enter

# ── step 1/9: deploy target ─────────────────────────────────────────────
# "Where do you want to run openagentic?"
# ❯ Docker   (local / single machine)
#   Helm     (production / kubernetes)
Sleep 4s
Enter

# ── step 2/9: admin account ─────────────────────────────────────────────
# "Create your admin account" — email pre-filled with admin@openagentic.local
Sleep 3.5s
Enter
Sleep 700ms
Type "hunter2!!"
Enter

# ── step 3/9: LLM strategy ──────────────────────────────────────────────
# "How should the platform call LLMs?"
# ❯ Local Ollama only
#   Cloud LLMs only
#   Both Ollama + cloud LLMs  ← 3rd option (two downs)
#   Skip for now
Sleep 3.5s
Down
Sleep 500ms
Down
Sleep 500ms
Enter

# ── step 4/9: Ollama host ───────────────────────────────────────────────
# "Where is your Ollama?" — default host.docker.internal:11434
Sleep 3.5s
Enter

# ── step 5/9: LLM providers ─────────────────────────────────────────────
# "LLM providers (all optional)"
# ❯ Anthropic API key  — type key then Enter, Tab to skip rest
Sleep 3s
Type "sk-ant-test"
Enter
Sleep 700ms
Tab

# ── step 6/9: MCP selection ─────────────────────────────────────────────
# "Which MCPs do you want enabled?"
# 'n' to clear all → Space to re-enable web → Enter
Sleep 3.5s
Type "n"
Sleep 600ms
Space
Sleep 600ms
Enter

# ── step 7/9: MCP auth (web requires no creds → auto-advances) ──────────
Sleep 3s

# ── step 8/9: Review & launch ────────────────────────────────────────────
# "Review & launch" — summary table
# ❯ Launch docker    ← default
#   Cancel
Sleep 3.5s
Enter

# ── step 9/9: Launch (dry-run) ───────────────────────────────────────────
# "Bringing up openagentic (dry-run)"
# WIZARD_DRY_RUN=1 — only .env is written; no containers are touched.
Sleep 4s
