Output demos/install-helm.gif

Set FontSize 16
Set Width 1320
Set Height 800
Set Padding 22
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 32ms

# Hidden setup: isolated HOME + a local git mirror so the real github clone
# command resolves to this checkout (fast, no auth) for the recording.
Hide
  Type "export HOME=$(mktemp -d); export PS1='$ '"
  Enter
  Type 'git config --global url."file:///home/trent/agenticwork/openagentic".insteadOf https://github.com/agentic-work/openagentic.git'
  Enter
  Type "cd $HOME && clear"
  Enter
  Sleep 400ms
Show

Type "# Install openagentic on Kubernetes — Helm"
Enter
Sleep 1.2s

Type "git clone https://github.com/agentic-work/openagentic.git"
Enter
Sleep 2.5s

Type "cd openagentic"
Enter
Sleep 600ms

Type "# render + validate the chart (no cluster needed)"
Enter
Sleep 1s
Type "helm install openagentic ./helm/openagentic -n openagentic --create-namespace --dry-run=client | sed -n '1,6p'"
Enter
Sleep 2.5s

Type "# what it deploys:"
Enter
Sleep 800ms
Type "helm template ./helm/openagentic | grep -E '^kind:' | sort | uniq -c | sort -rn"
Enter
Sleep 3s

Type "# go live — drop --dry-run, add -f helm/openagentic/values-local-k8s.yaml"
Enter
Sleep 2.5s
