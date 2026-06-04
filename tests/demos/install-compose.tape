# ─────────────────────────────────────────────────────────────────────────────
# openagentic — FULL clean compose install via the wizard:
#   • LLM strategy "Both" → gpt-oss:20b (local Ollama) + AWS Bedrock Sonnet 4.6
#     (Bedrock = default chat, gpt-oss:20b = selectable; nomic-embed-text embeddings)
#   • ALL 9 MCP servers (aws/azure/gcp via mounted host creds; k8s host kubeconfig;
#     web/github/prometheus/loki/admin) → deploy → every service healthy.
# Green-on-black nerdfont.
#
# Render:  vhs tests/demos/install-compose.tape   (-> tests/demos/install-compose.{gif,mp4})
#
# PREREQS (run BEFORE vhs — clean slate but KEEP the warm ollama-data volume so
# gpt-oss:20b + nomic-embed-text don't re-pull):
#   docker compose --profile milvus down --remove-orphans
#   docker volume rm openagentic_pg-data openagentic_milvus-data openagentic_minio-data \
#       openagentic_etcd-data openagentic_redis-data openagentic_prometheus-data 2>/dev/null
#   rm -f .env          # wizard writes a fresh one
#   ~/.aws ~/.azure ~/.config/gcloud ~/.kube present for the host-creds MCP paths
# ─────────────────────────────────────────────────────────────────────────────

Output tests/demos/install-compose.gif
Output tests/demos/install-compose.mp4

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 15
Set Width 1480
Set Height 880
Set Padding 22
Set TypingSpeed 45ms
Set Theme { "name": "phosphor", "background": "#000000", "foreground": "#00FF66", "cursor": "#00FF66", "selection": "#00351A", "black": "#000000", "red": "#FF5555", "green": "#00FF66", "yellow": "#D7FF55", "blue": "#5599FF", "magenta": "#FF55FF", "cyan": "#55FFFF", "white": "#CFE8CF", "brightBlack": "#1F5F3F", "brightRed": "#FF6E67", "brightGreen": "#5AF78E", "brightYellow": "#F4F99D", "brightBlue": "#6699FF", "brightMagenta": "#FF92D0", "brightCyan": "#9AEDFE", "brightWhite": "#EAFFEA" }
Set CursorBlink true

# ── intro ──
Type "#  openagentic install — wizard: gpt-oss:20b (Ollama) + AWS Bedrock Sonnet 4.6 + all 9 MCPs"
Enter
Sleep 1500ms
Type "export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
Enter
Sleep 400ms
Type "bash install.sh --wizard"
Enter
Sleep 8s                 # node preflight + cloud-secret stubs + wizard launch

# ── 1/9 Deploy target ── Docker is the default
Sleep 2500ms
Enter

# ── 2/9 Admin account ── accept admin@openagentic.local, then set a password
Sleep 2500ms
Enter
Sleep 700ms
Type "DemoPass123!"
Enter

# ── 3/9 LLM strategy ── pick "Both" (Ollama gpt-oss:20b + Bedrock) = 3rd item
Sleep 2500ms
Down
Sleep 350ms
Down
Sleep 350ms
Enter

# ── 4/9 Ollama ── accept the bundled container default (http://ollama:11434, gpt-oss:20b)
Sleep 2500ms
Enter

# ── 5/9 Providers — AWS Bedrock (Claude Sonnet 4.6 via IAM) ──
# With ~/.aws present the first option is "Use my host AWS creds (~/.aws)".
Sleep 2500ms
Enter
Sleep 1200ms
# region prompt — accept the prefilled us-east-1
Enter

# ── 6/9 MCP selection ── a = select ALL 9, then Enter
Sleep 2500ms
Type "a"
Sleep 700ms
Enter

# ── 7/9 MCP auth ── walks the 7 MCPs that need creds, in order:
# aws / azure / gcp  → "host creds (detected — recommended)" is the first option → Enter
# kubernetes         → host kubeconfig (~/.kube) detected → Enter
# github             → token field, left blank (spawns; surfaces "connect GitHub" on use)
# prometheus (URL/user/pass) → blank → falls back to compose default http://prometheus:9090
# loki (URL/user/pass)       → blank → compose default
Sleep 2800ms
Enter
Sleep 1500ms
Enter
Sleep 1500ms
Enter
Sleep 1500ms
Enter
Sleep 1500ms
Enter
Sleep 1300ms
Enter
Sleep 800ms
Enter
Sleep 700ms
Enter
Sleep 1100ms
Enter
Sleep 800ms
Enter
Sleep 700ms
Enter

# ── 8/9 Review ── Launch (docker) is the default
Sleep 3000ms
Enter

# ── 9/9 Launch ── docker compose --profile milvus build (cached) + up -d + health poll.
# First "Both" boot with all 9 MCPs: Milvus collections + Prisma schema push + full
# tool indexing + secondary-provider seed ≈ 3.5–6 min. The wizard blocks on
# /api/health (now polls up to 10 min, matching the 600s container healthcheck).
# Covers cached build (~60s) + up (~10s) + fresh-DB boot (~4-5 min) with margin.
Sleep 420s

# ── wizard done → show every service up ──
Enter
Sleep 2500ms
Type "docker compose --profile milvus ps --format '{{.Service}}   {{.Status}}' | grep -v ollama-init | sort"
Enter
Sleep 9s
