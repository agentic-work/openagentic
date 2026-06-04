# openagentic on k3s via Helm — exact commands that worked

The verbatim sequence used to bring OSS openagentic up on the local multi-node **k3s**
cluster (images served from the in-cluster **Harbor**) and prove it works. Run from the
repo root. Prereqs: `kubectl` context = the k3s cluster, `docker`, `helm`, and `~/.aws`
holding IAM creds with Bedrock access.

## 0. The three gotchas that actually mattered
1. **Mixed-arch cluster** (3× amd64: dalek/data/hal, 5× arm64: k8a–e). The OSS images are
   **amd64-only**, so without an arch nodeSelector, ui/workflows land on arm64 and
   `CrashLoopBackOff` with `exec format error`. Fix: `nodeSelector: kubernetes.io/arch: amd64`.
2. **AWS creds must live in the in-cluster Secret** — k3s has no host `~/.aws` mount, so
   Bedrock needs `secrets.awsAccessKeyId/awsSecretAccessKey` in the values (empty/garbage
   keys → `BedrockServiceException: The security token included in the request is invalid`).
3. **api Service port is `8000`** (not 3001) for the port-forward.

## 1. Build the 5 OSS service images
```bash
cd ~/agenticwork/openagentic
docker compose --profile milvus build      # builds api, ui, workflows, mcp-proxy, proxy
```

## 2. Push to the in-cluster Harbor (project: openagentic)
```bash
# admin creds reused from the cluster's existing harbor pull secret
HPASS=$(kubectl get secret harbor-creds -n agentic-dev -o jsonpath='{.data.\.dockerconfigjson}' \
  | base64 -d | python3 -c 'import sys,json;print(list(json.load(sys.stdin)["auths"].values())[0]["password"])')
echo "$HPASS" | docker login harbor.agenticwork.io -u admin --password-stdin

for s in api ui workflows mcp-proxy proxy; do
  docker tag  "ghcr.io/agentic-work/openagentic-${s}:latest" "harbor.agenticwork.io/openagentic/openagentic-${s}:1.0.0"
  docker push "harbor.agenticwork.io/openagentic/openagentic-${s}:1.0.0"
done
# NOTE: in zsh, brace the var before :latest — bare $s:latest triggers the :l (lowercase) modifier.
```

## 3. Namespace + Harbor pull secret
```bash
kubectl create namespace openagentic
kubectl create secret docker-registry harbor-creds -n openagentic \
  --docker-server=harbor.agenticwork.io --docker-username=admin --docker-password="$HPASS"
```

## 4. Values overlay  (helm/openagentic/values-local-k8s.yaml — gitignored: secrets)
Key fields (full file is gitignored because it holds secrets):
```yaml
image:
  registry: harbor.agenticwork.io/openagentic
  tag: "1.0.0"
imagePullSecrets:
  - name: harbor-creds
secrets:
  adminEmail: admin@openagentic.local
  adminPassword: "DemoPass123!"
  awsAccessKeyId: "<from ~/.aws>"        # k3s has no host ~/.aws mount
  awsSecretAccessKey: "<from ~/.aws>"
  awsRegion: us-east-1
  # + generated postgresPassword/jwtSecret/signingSecret/internalApiKey/frontendSecret
bootstrapProvider:                        # Bedrock Sonnet 4.6 = default chat/flows model
  enabled: true
  type: aws-bedrock
  chatModel: anthropic.claude-sonnet-4-6
ollama:
  embedModel: nomic-embed-text            # embeddings in-cluster (CPU)
  chatModel: gpt-oss:20b
  chatHost: "http://10.2.10.142:11434"    # hal GPU node already serves gpt-oss:20b
mcps:
  enabled: "web,knowledge,admin,kubernetes,prometheus"
  kubernetes: { enabled: true }           # pod SA token + read-only RBAC
  prometheus: { enabled: true, url: "http://prometheus:9090" }
milvus:     { enabled: true }
prometheus: { enabled: true }
nodeSelector:
  kubernetes.io/arch: amd64               # CRITICAL on the mixed-arch cluster
ingress:
  enabled: true
  className: nginx
  host: openagentic.agenticwork.io
```

## 5. Install
```bash
helm upgrade --install openagentic ./helm/openagentic -n openagentic \
  -f helm/openagentic/values-local-k8s.yaml --wait --timeout 12m
```

## 6. Prove it works
```bash
kubectl get pods -n openagentic                       # all 13 Running on amd64 nodes
helm status openagentic -n openagentic                # STATUS: deployed

kubectl port-forward -n openagentic svc/api 18080:8000 &
BASE=http://localhost:18080
curl -s $BASE/api/health | jq '{status, milvus}'      # status healthy, milvus connected

JWT=$(curl -s $BASE/api/auth/local/login -H 'content-type: application/json' \
  -d '{"username":"admin@openagentic.local","password":"DemoPass123!"}' | jq -r .token)
AID=$(curl -s $BASE/api/admin/tokens/users/available -H "authorization: Bearer $JWT" \
  | jq -r '.users[]|select(.email=="admin@openagentic.local").id')
TOK=$(curl -s -X POST $BASE/api/admin/tokens -H "authorization: Bearer $JWT" \
  -H 'content-type: application/json' -d "{\"userId\":\"$AID\",\"name\":\"k8s\"}" | jq -r .token.apiKey)
SID=$(curl -s -X POST $BASE/api/chat/sessions -H "x-api-key: $TOK" \
  -H 'content-type: application/json' -d '{"title":"t"}' | jq -r .session.id)
curl -sN -X POST $BASE/api/chat/stream -H "x-api-key: $TOK" -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"message\":\"Name the model and provider answering.\"}"
#   → model anthropic.claude-sonnet-4-6 — "I'm Claude Sonnet 4.6, by Anthropic, on OpenAgentic."

kubectl logs -n openagentic -l app=mcp-proxy | grep -oE 'list-tools-[a-z_]+' | sort -u
#   → web, admin, kubernetes, prometheus, aws_knowledge  (in-cluster ops MCPs)
```

`tests/demos/helm-deploy.sh` and `tests/demos/helm-test.sh` wrap steps 3/5/6 as runnable
scripts. Verified live: all 13 pods Running, Bedrock Sonnet 4.6 chat works, ops MCPs spawn.
