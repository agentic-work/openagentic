#!/usr/bin/env bash
# openagentic helm deploy — post-install proof: kubectl pods + admin API (Bedrock chat + MCPs).
set -uo pipefail
NS=openagentic
G='\033[0;32m'; C='\033[1;36m'; D='\033[0;90m'; N='\033[0m'
PATH=/home/trent/go/bin:/usr/local/bin:$PATH

printf "${C}── 1. kubectl: every pod Running on the k3s cluster ────${N}\n"
kubectl get pods -n $NS -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName' --no-headers \
  | grep -v ollama-init | awk '{printf "  %-30s %-9s %s\n",$1,$2,$3}'

printf "\n${C}── 2. helm release ─────────────────────────────────────${N}\n"
helm status openagentic -n $NS 2>/dev/null | grep -E 'STATUS|REVISION|CHART' | sed 's/^/  /'

printf "\n${C}── 3. port-forward api + admin key ─────────────────────${N}\n"
kubectl port-forward -n $NS svc/api 18090:8000 >/tmp/pf.log 2>&1 & PF=$!; sleep 4
BASE=http://localhost:18090
printf "  ${G}health:${N} %s\n" "$(curl -s $BASE/api/health | python3 -c 'import sys,json;d=json.load(sys.stdin);print("status="+str(d.get("status")),"· milvus="+str(d.get("milvus",{}).get("status") if isinstance(d.get("milvus"),dict) else d.get("milvus")))' 2>/dev/null)"
JWT=$(curl -s $BASE/api/auth/local/login -H 'content-type: application/json' -d '{"username":"admin@openagentic.local","password":"DemoPass123!"}'|python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' 2>/dev/null)
AID=$(curl -s $BASE/api/admin/tokens/users/available -H "authorization: Bearer $JWT"|python3 -c 'import sys,json;d=json.load(sys.stdin);print([u["id"] for u in (d.get("users") or d) if u["email"]=="admin@openagentic.local"][0])' 2>/dev/null)
TOK=$(curl -s -X POST $BASE/api/admin/tokens -H "authorization: Bearer $JWT" -H 'content-type: application/json' -d "{\"userId\":\"$AID\",\"name\":\"demo\"}"|python3 -c 'import sys,json;print(json.load(sys.stdin)["token"]["apiKey"])' 2>/dev/null)
printf "  ${G}oa key:${N} %s…\n" "${TOK:0:14}"

printf "\n${C}── 4. live chat → AWS Bedrock Sonnet 4.6 ───────────────${N}\n"
SID=$(curl -s -X POST $BASE/api/chat/sessions -H "x-api-key: $TOK" -H 'content-type: application/json' -d '{"title":"d"}'|python3 -c 'import sys,json;print(json.load(sys.stdin)["session"]["id"])' 2>/dev/null)
curl -sN --max-time 50 -X POST $BASE/api/chat/stream -H "x-api-key: $TOK" -H 'content-type: application/json' -d "{\"sessionId\":\"$SID\",\"message\":\"Introduce yourself in one sentence — name the model and provider answering.\"}" > /tmp/hc.ndjson
printf "  ${G}model:${N}  %s\n" "$(grep -oE '"model":"[^"]*"' /tmp/hc.ndjson|sort -u|head -1|sed 's/"model":"//;s/"//')"
printf "  ${G}answer:${N} %s\n" "$(grep '"type":"text_delta"' /tmp/hc.ndjson|grep -oE '"text":"[^"]*"'|sed 's/"text":"//;s/"$//'|tr -d '\n'|head -c 150)"

printf "\n${C}── 5. MCP servers spawned (in-cluster ops) ─────────────${N}\n"
kubectl logs -n $NS -l app=mcp-proxy --tail=200 2>/dev/null | grep -oE 'list-tools-[a-z_]+' | sed 's/list-tools-/  • /' | sort -u | tr '\n' ' '; echo
kill $PF 2>/dev/null; true
