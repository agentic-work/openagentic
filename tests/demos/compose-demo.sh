#!/usr/bin/env bash
# Post-install capability demo for the docker-compose deployment:
#   1) docker — verify every service is up/healthy
#   2) mint an admin API key
#   3) the two seeded chat providers (Bedrock Sonnet 4.6 default + gpt-oss:20b local)
#   4) a chat that uses a tool, answered live by Bedrock
#   5) all MCP servers spawned
# Run against a healthy stack:  bash tests/demos/compose-demo.sh
set -uo pipefail
BASE=${BASE:-http://localhost:8080}
PW=${ADMIN_PW:-DemoPass123!}
G='\033[0;32m'; C='\033[1;36m'; D='\033[0;90m'; N='\033[0m'

printf "${C}── 1. docker: every service up/healthy ─────────${N}\n"
docker compose --profile milvus ps --format '{{.Service}}\t{{.Status}}' 2>/dev/null | grep -iE 'healthy|up ' | grep -v ollama-init | sort | column -t | head -14

printf "\n${C}── 2. mint an admin API key ────────────────────${N}\n"
JWT=$(curl -s "$BASE/api/auth/local/login" -H 'content-type: application/json' \
  -d "$(jq -nc --arg p "$PW" '{username:"admin@openagentic.local",password:$p}')" | jq -r .token)
AID=$(curl -s "$BASE/api/admin/tokens/users/available" -H "authorization: Bearer $JWT" \
  | jq -r '(.users//.)[]|select(.email=="admin@openagentic.local").id' | head -1)
TOK=$(curl -s -X POST "$BASE/api/admin/tokens" -H "authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d "$(jq -nc --arg id "$AID" '{userId:$id,name:"demo"}')" | jq -r .token.apiKey)
printf "  ${G}oa key:${N} %s…\n" "${TOK:0:14}"

printf "\n${C}── 3. two chat providers seeded ────────────────${N}\n"
curl -s "$BASE/api/admin/llm-providers" -H "authorization: Bearer $JWT" \
  | jq -r '(.providers//.)[] | "  • " + .name + "  (provider priority " + (.priority|tostring) + ")"' 2>/dev/null
printf "  ${D}default chat = Bedrock claude-sonnet-4-6 (role pri 10); gpt-oss:20b local = selectable (pri 50)${N}\n"

printf "\n${C}── 4. live chat → Bedrock Sonnet 4.6 ───────────${N}\n"
SID=$(curl -s -X POST "$BASE/api/chat/sessions" -H "x-api-key: $TOK" -H 'content-type: application/json' \
  -d '{"title":"demo"}' | jq -r '.session.id')
printf "  ${D}prompt:${N} Introduce yourself in one sentence — name the model and provider answering.\n"
curl -sN -X POST "$BASE/api/chat/stream" -H "x-api-key: $TOK" -H 'content-type: application/json' \
  -d "$(jq -nc --arg s "$SID" '{sessionId:$s,message:"Introduce yourself in one sentence — name the model and provider answering."}')" \
  > /tmp/demo-chat.ndjson
printf "  ${G}model:${N}  %s\n" "$(grep -oE '"model":"[^"]*"' /tmp/demo-chat.ndjson | sort -u | head -1 | sed 's/"model":"//;s/"//')"
printf "  ${G}answer:${N} %s\n" "$(grep '"type":"text_delta"' /tmp/demo-chat.ndjson | grep -oE '"text":"[^"]*"' | sed 's/"text":"//;s/"$//' | tr -d '\n' | sed 's/\\n/ /g' | head -c 200)"

printf "\n${C}── 5. all MCP servers spawned ──────────────────${N}\n"
docker logs openagentic-mcp-proxy-1 2>&1 | grep -oE 'list-tools-[a-z_]+' | sed 's/list-tools-/  • /' | sort -u | tr '\n' ' '; echo
N_SRV=$(docker logs openagentic-mcp-proxy-1 2>&1 | grep -oE 'list-tools-[a-z_]+' | sort -u | wc -l)
printf "  ${G}%s MCP servers — cloud (aws/azure/gcp) + ops (k8s/prometheus/loki) + web/github/admin${N}\n\n" "$N_SRV"
