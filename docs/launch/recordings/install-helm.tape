# OpenAgentic — Kubernetes / Helm install (VHS recording)
# Render:  cd docs/launch/recordings && vhs install-helm.tape
Output install-helm.mp4
Output install-helm.gif

Require helm
Require kubectl

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 720
Set Padding 20
Set TypingSpeed 30ms

# cd to repo root off-camera so ./install.sh + ./helm paths resolve
Hide
Type "cd ~/openagentic && clear"
Enter
Sleep 500ms
Show

Type "# OpenAgentic — install on Kubernetes with Helm"
Enter
Sleep 800ms
Type "# One line:  ./install.sh --helm   (clones + helm upgrade --install)"
Enter
Sleep 1200ms
Enter

Type "# Images come from Harbor; the chart wires nginx ingress + the *.agenticwork.io cert."
Enter
Sleep 800ms
Type "helm upgrade --install openagentic ./helm/openagentic -n openagentic --create-namespace -f helm/openagentic/values-open.yaml | head -6"
Enter
Sleep 4s

Type "# Pods (Harbor images, api + ui + mcp-proxy + workflows + deps):"
Enter
Sleep 600ms
Type "kubectl get pods -n openagentic"
Enter
Sleep 3s

Type "# Ingress for open.agenticwork.io (nginx, wildcard TLS):"
Enter
Sleep 600ms
Type "kubectl get ingress -n openagentic"
Enter
Sleep 3s

Type "# Live over the public hostname, served by the *.agenticwork.io cert:"
Enter
Sleep 600ms
Type "curl -s https://open.agenticwork.io/api/health | jq '{status, database: .database.status, milvus: .milvus.status}'"
Enter
Sleep 3s

Type "# https://open.agenticwork.io is live."
Enter
Sleep 2s
