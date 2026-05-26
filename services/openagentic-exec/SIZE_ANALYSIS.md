# Openagentic Exec Container Size Analysis

## Current Components and Estimated Sizes

| Component | Estimated Size | Essential for AIOps? | Notes |
|-----------|---------------|---------------------|-------|
| Node.js 20 (base) | ~200MB | Yes | Required for exec daemon |
| Python 3 + pip | ~150MB | Yes | Core scripting |
| Go SDK | ~500MB | Moderate | Useful for K8s tools |
| PowerShell Core 7 | ~250MB | Low | Only for Windows-centric ops |
| kubectl | ~50MB | Yes | Core K8s tool |
| Helm | ~50MB | Yes | Core K8s tool |
| AWS CLI v2 | ~150MB | Moderate | AWS operations |
| Google Cloud SDK | ~400MB | Moderate | GCP operations |
| Azure CLI | ~450MB | Moderate | Azure operations |
| Terraform | ~100MB | Low | Can install on-demand |
| code-server | ~400MB | Yes | VS Code Web IDE |
| VS Code Extensions | ~300MB | Moderate | Some optional |
| Rust | ~300MB | Low | Rarely needed for AIOps |
| uv + Python packages | ~200MB | Yes | Core packages |
| Jupyter packages | ~150MB | Moderate | Data analysis |
| Build-essential | ~200MB | Moderate | For pip installs |
| Go tools (gopls, delve) | ~150MB | Low | Dev tools |
| CLI tools (fd, fzf, bat, gh) | ~50MB | Moderate | Nice-to-have |

**Estimated Total: ~4.0-4.5GB**

## Recommended Removals for a "Lite" Build

### Tier 1: Safe to Remove (saves ~600-800MB)

1. **PowerShell Core** (~250MB)
   - Rarely needed for cloud/K8s operations
   - Users can install via `pwsh` if needed

2. **Rust** (~300MB)
   - Not used for typical AIOps tasks
   - Users can install via `rustup` if needed

3. **golangci-lint** (~50MB)
   - Heavy linter, can install on-demand
   - Keep gopls and delve for debugging

4. **Some VS Code Extensions** (~100MB):
   - `ms-vscode.powershell` - Only needed with PowerShell
   - `ritwickdey.liveserver` - Web dev focused

### Tier 2: Optional Removals (environment-specific)

If your users primarily use ONE cloud:

1. **Google Cloud SDK** (~400MB) - Remove if not using GCP
2. **Azure CLI** (~450MB) - Remove if not using Azure
3. **AWS CLI** (~150MB) - Remove if not using AWS

### Tier 3: Keep (Essential)

These should NOT be removed:
- Node.js, Python, kubectl, helm
- code-server
- Core VS Code extensions (Python, Go, Kubernetes, Docker)
- uv package manager
- Git, jq, yq, ripgrep

## Implementation Options

### Option A: Single Multi-Cloud Image (Current)
- Keep all CLIs
- ~4.5GB image size
- Maximum compatibility

### Option B: Cloud-Specific Images
Create separate Dockerfiles:
- `Dockerfile.aws` - AWS + core tools (~2.5GB)
- `Dockerfile.azure` - Azure + core tools (~2.8GB)
- `Dockerfile.gcp` - GCP + core tools (~2.7GB)

### Option C: Modular Approach
Use build args to conditionally include tools:
```dockerfile
ARG INCLUDE_AWS=true
ARG INCLUDE_AZURE=true
ARG INCLUDE_GCP=true
ARG INCLUDE_POWERSHELL=false
ARG INCLUDE_RUST=false
```

## Quick Wins (No Risk)

Remove these now to save ~600MB:

```dockerfile
# REMOVE: PowerShell Core 7
# Lines 107-119 in Dockerfile

# REMOVE: Rust
# Lines 288-292 in Dockerfile

# REMOVE: Terraform (can install on-demand)
# Lines 179-188 in Dockerfile

# REMOVE: golangci-lint
# Line 283 in Dockerfile (keep gopls and delve)
```

## Conclusion

For a balanced approach, I recommend:
1. Remove PowerShell, Rust, Terraform, golangci-lint (saves ~700MB)
2. Keep all cloud CLIs for multi-cloud support
3. Keep Jupyter for data analysis
4. Keep all core VS Code extensions

This would reduce the image from ~4.5GB to ~3.8GB while maintaining full AIOps capability.
