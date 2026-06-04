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

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 15
Set Width 1480
Set Height 880
Set Padding 22
Set TypingSpeed 45ms
Set Foreground "#00FF66"
Set Background "#000000"
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
# tool indexing). If you did NOT pre-build, bump this to 300s+.
Sleep 150s

# ── prove it: log in + one chat that names the model (Bedrock answers) ──
Sleep 3s
Type "PW=$(grep '^ADMIN_SEED_PASSWORD=' .env | cut -d= -f2-)"
Enter
Sleep 400ms
Type "JWT=$(curl -s localhost:8080/api/auth/local/login -H 'content-type: application/json' -d \"{\\\"username\\\":\\\"admin@openagentic.local\\\",\\\"password\\\":\\\"$PW\\\"}\" | jq -r .token)"
Enter
Sleep 1500ms
Type "SID=$(curl -s localhost:8080/api/chat/sessions -H \"authorization: Bearer $JWT\" -H 'content-type: application/json' -d '{\"title\":\"demo\"}' | jq -r .session.id)"
Enter
Sleep 1500ms
Type "curl -sN localhost:8080/api/chat/stream -H \"authorization: Bearer $JWT\" -H 'content-type: application/json' -d \"{\\\"sessionId\\\":\\\"$SID\\\",\\\"message\\\":\\\"In one sentence, which model and provider is answering?\\\"}\" | grep -oE '\"model\":\"[^\"]+\"' | head -1"
Enter
Sleep 12s                # stream the answer; the printed line shows anthropic.claude-sonnet-4-6
Sleep 2s
