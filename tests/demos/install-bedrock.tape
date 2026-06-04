# ─────────────────────────────────────────────────────────────────────────────
# openagentic — FULL compose install via the wizard, adding AWS Bedrock
# (Claude Sonnet 4.6) as the default chat + flows model. Green-on-black nerdfont.
#
# Render:   vhs tests/demos/install-bedrock.tape      (-> tests/demos/install-bedrock.gif)
# Speed up: lower the `Set TypingSpeed` and trim the `Sleep` lines (commented with
#           what each waits on). The big one is the Launch step (build+up+health).
#
# PREREQS for a clean record (do these BEFORE `vhs`):
#   1. cd /home/trent/agenticwork/openagentic
#   2. docker compose --profile milvus down -v --remove-orphans   # clean slate
#   3. rm -f .env                                                 # wizard writes fresh
#   4. docker compose --profile milvus build                     # pre-build so the
#         #  Launch step is fast in the recording (otherwise add minutes of Sleep)
#   5. ~/.aws/credentials must have a [default] profile with Bedrock access (us-east-1)
#      so the wizard's "Use my host AWS creds" path works (api mounts ~/.aws ro).
# ─────────────────────────────────────────────────────────────────────────────

Output tests/demos/install-bedrock.gif
Output tests/demos/install-bedrock.mp4

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 15
Set Width 1480
Set Height 880
Set Padding 22
Set TypingSpeed 45ms
# vhs v0.10 has no Set Foreground/Background — use a Set Theme JSON for true
# green-on-black (#00FF66 on #000000). Edit the colors here to taste.
Set Theme { "name": "phosphor", "background": "#000000", "foreground": "#00FF66", "cursor": "#00FF66", "selection": "#00351A", "black": "#000000", "red": "#FF5555", "green": "#00FF66", "yellow": "#D7FF55", "blue": "#5599FF", "magenta": "#FF55FF", "cyan": "#55FFFF", "white": "#CFE8CF", "brightBlack": "#1F5F3F", "brightRed": "#FF6E67", "brightGreen": "#5AF78E", "brightYellow": "#F4F99D", "brightBlue": "#6699FF", "brightMagenta": "#FF92D0", "brightCyan": "#9AEDFE", "brightWhite": "#EAFFEA" }
Set CursorBlink true

# ── intro ──
Type "#  openagentic install — wizard + AWS Bedrock (Claude Sonnet 4.6)"
Enter
Sleep 1500ms
Type "export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
Enter
Sleep 400ms
Type "bash install.sh --wizard"
Enter
Sleep 7s                 # node preflight + cloud-secret stubs + wizard launch

# ── 1/9 Deploy target ── (Docker is the default)
Sleep 2500ms
Enter

# ── 2/9 Admin account ── (accept admin@openagentic.local, then set a password)
Sleep 2500ms
Enter
Sleep 700ms
Type "DemoPass123!"
Enter

# ── 3/9 LLM strategy ── pick "Both" (Ollama embeddings + Bedrock chat) = 3rd item
Sleep 2500ms
Down
Sleep 350ms
Down
Sleep 350ms
Enter

# ── 4/9 Ollama ── accept the bundled container default (http://ollama:11434)
Sleep 2500ms
Enter

# ── 5/9 Providers — AWS Bedrock (Claude via IAM) ──
# With ~/.aws present the first option is "Use my host AWS creds (~/.aws)".
Sleep 2500ms
Enter
Sleep 1200ms
# region prompt — accept the prefilled us-east-1
Enter

# ── 6/9 MCP selection ── clear all, enable just web for the demo
Sleep 2500ms
Type "n"
Sleep 500ms
Space
Sleep 300ms
Enter

# ── 7/9 MCP auth ── web needs no creds → auto-advances
Sleep 2500ms

# ── 8/9 Review ── Launch (docker) is the default
Sleep 2500ms
Enter

# ── 9/9 Launch ── docker compose --profile milvus build (cached) + up + health poll.
# This is the long step. With images pre-built it's ~90-150s (Milvus + api boot +
# tool indexing). The wizard BLOCKS here until /api/health is green, then exits
# to the shell. With a pre-warmed stack (images built + volumes present) the
# wizard's up is a near-noop and health is immediate, so 60s is plenty. On a
# truly-cold first install bump this to 240s+ (the wizard polls health up to 5m).
Sleep 110s

# ── wizard done → show the running stack (Enter first dismisses any final screen) ──
Enter
Sleep 1500ms
Type "docker compose --profile milvus ps --format '{{.Service}}  {{.State}}  {{.Status}}'"
Enter
Sleep 6s
Type "curl -s localhost:8080/api/health | jq '{status, milvus: .milvus, providers}'"
Enter
Sleep 5s
