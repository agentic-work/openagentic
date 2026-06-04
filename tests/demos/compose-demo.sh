#!/usr/bin/env bash
# Post-install capability demo for the docker-compose deployment:
#   1) verify the stack is up   2) mint an admin API key
#   3) a chat that uses tools (Bedrock Sonnet 4.6 + web MCP)
#   4) run a Flow end-to-end via the API
# Run against a healthy stack:  bash tests/demos/compose-demo.sh
set -euo pipefail
BASE=${BASE:-http://localhost:8080}
PW=${ADMIN_PW:-DemoPass123!}
G='\033[0;32m'; C='\033[1;36m'; D='\033[0;90m'; N='\033[0m'

printf "${C}── 1. Stack health ─────────────────────────────${N}\n"
docker compose --profile milvus ps --format '{{.Service}}  {{.Status}}' 2>/dev/null | grep -iE 'healthy|up ' | grep -v ollama-init | sort | head -14

printf "\n${C}── 2. Mint an admin API key ────────────────────${N}\n"
JWT=$(curl -s "$BASE/api/auth/local/login" -H 'content-type: application/json' \
  -d "$(jq -nc --arg u admin@openagentic.local --arg p "$PW" '{username:$u,password:$p}')" | jq -r .token)
AID=$(curl -s "$BASE/api/admin/tokens/users/available" -H "authorization: Bearer $JWT" \
  | jq -r '(.users//.)[]|select(.email=="admin@openagentic.local").id' | head -1)
TOK=$(curl -s -X POST "$BASE/api/admin/tokens" -H "authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d "$(jq -nc --arg id "$AID" '{userId:$id,name:"demo"}')" | jq -r .token.apiKey)
printf "  ${G}oa key:${N} %s…\n" "${TOK:0:14}"

printf "\n${C}── 3. Chat → Bedrock Sonnet 4.6 + web tools ────${N}\n"
SID=$(curl -s -X POST "$BASE/api/chat/sessions" -H "x-api-key: $TOK" -H 'content-type: application/json' \
  -d '{"title":"demo"}' | jq -r '.session.id')
curl -sN -X POST "$BASE/api/chat/stream" -H "x-api-key: $TOK" -H 'content-type: application/json' \
  -d "$(jq -nc --arg s "$SID" '{sessionId:$s,message:"Use a web tool to fetch https://example.com and tell me its page title in one short sentence."}')" \
  > /tmp/demo-chat.ndjson
printf "  ${G}tools executed:${N} %s\n" "$(grep -oE '"name":"web_[a-z_]+"' /tmp/demo-chat.ndjson | sed 's/.*:"//;s/"//' | sort -u | tr '\n' ' ')"
printf "  ${G}model:${N}          %s\n" "$(grep -oE 'anthropic\.claude-sonnet-4-6' /tmp/demo-chat.ndjson | head -1)"
printf "  ${G}answer:${N}         %s\n" "$(grep -oE '"text":"[^"]*"' /tmp/demo-chat.ndjson | sed 's/"text":"//;s/"$//' | tr -d '\n' | tail -c 150)"

printf "\n${C}── 4. Flow templates (seeded + ready) ──────────${N}\n"
curl -s "$BASE/api/workflows/templates" -H "x-api-key: $TOK" | jq -r '.templates[] | "  • " + .name'
printf "  ${D}(end-to-end flow-run demo deferred until the in-progress upstream flows sync lands)${N}\n\n"
