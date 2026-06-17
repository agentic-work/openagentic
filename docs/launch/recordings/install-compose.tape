# OpenAgentic — Docker Compose install (VHS recording)
# Render:  cd docs/launch/recordings && vhs install-compose.tape
Output install-compose.mp4
Output install-compose.gif

Require docker
Require curl

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 720
Set Padding 20
Set TypingSpeed 30ms

# cd to repo root off-camera so ./install.sh resolves
Hide
Type "cd /home/trent/agenticwork/openagentic && clear"
Enter
Sleep 500ms
Show

Type "# OpenAgentic — install with Docker Compose (the 5-minute path)"
Enter
Sleep 800ms
Type "# One line from a fresh machine:"
Enter
Sleep 600ms
Type "#   curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash"
Enter
Sleep 1500ms
Enter

Type "# install.sh --quick is the zero-config Docker path. Preflight first:"
Enter
Sleep 800ms
Type "./install.sh --help | head -20"
Enter
Sleep 3s

Type "# Bring the stack up (compose, milvus profile):"
Enter
Sleep 600ms
Type "docker compose --profile milvus up -d"
Enter
Sleep 4s

Type "# All services healthy + 371 MCP tools indexed:"
Enter
Sleep 600ms
Type "curl -s http://localhost:8080/api/health | jq '{status, database: .database.status, milvus: .milvus.status}'"
Enter
Sleep 3s

Type "# Open http://localhost:8080  —  log in as the seeded admin."
Enter
Sleep 2s
