# OpenAgentic Build Scripts

Scripts for building and deploying OpenAgentic container images.

## build-all.sh

Main build script that supports:
- Local Docker builds
- Google Container Registry (GCR) push
- Azure Container Registry (ACR) cloud builds

### Prerequisites

**For local builds:**
- Docker with BuildKit support
- docker-compose

**For GCR push (`--buildpush`):**
- Docker authenticated to GCR (`gcloud auth configure-docker`)

**For Azure ACR builds (`--acr`):**
- Azure CLI installed (`az`)
- Logged in to Azure (`az login`)
- Access to the target ACR

### Usage

```bash
./scripts/build-all.sh [OPTIONS] [SERVICE...]
```

### Options

| Option | Description |
|--------|-------------|
| `--buildpush` | Build images locally and push to registry (Docker push) |
| `--acr` | Use Azure ACR build (builds in cloud, pushes to ACR) |
| `--acr-name <name>` | Azure ACR name (e.g., `myacr`) - required with `--acr` |
| `--acr-registry <url>` | Full ACR registry URL (e.g., `myacr.azurecr.io`). Auto-derived from `--acr-name` if not provided |
| `--registry <url>` | Container registry URL for `--buildpush` mode |
| `--tag <tag>` | Image tag (default: `latest`) |
| `--no-cache` | Build without cache |
| `--skip-npm` | Skip npm builds (SDK/CLI) |
| `--help` | Show help message |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ACR_NAME` | Default Azure ACR name |
| `ACR_REGISTRY` | Default Azure ACR registry URL |

### Services

You can optionally specify which services to build:

- `openagentic-api` - API service
- `openagentic-ui` - UI service
- `openagentic-mcp-proxy` - MCP Proxy service
- `openagentic-manager` - Code Manager service

If no services are specified, all services are built.

### Examples

#### Local Development

```bash
# Build all services locally
./scripts/build-all.sh

# Build specific services
./scripts/build-all.sh openagentic-api openagentic-ui

# Build without npm (faster if SDK/CLI unchanged)
./scripts/build-all.sh --skip-npm

# Build without Docker cache
./scripts/build-all.sh --no-cache
```

#### Google Container Registry (GCR)

```bash
# Build and push to default GCR
./scripts/build-all.sh --buildpush

# Build and push to custom registry
./scripts/build-all.sh --buildpush --registry gcr.io/my-project/openagentic

# Build and push with specific tag
./scripts/build-all.sh --buildpush --tag v1.0.0
```

#### Azure Container Registry (ACR)

ACR builds happen in Azure cloud - no local Docker build required. Images are built and pushed directly to ACR.

```bash
# Build all services in ACR
./scripts/build-all.sh --acr --acr-name myacr

# Build specific service
./scripts/build-all.sh --acr --acr-name myacr openagentic-api

# Build with specific tag
./scripts/build-all.sh --acr --acr-name myacr --tag v1.0.0

# Build without cache
./scripts/build-all.sh --acr --acr-name myacr --no-cache

# Skip npm builds (useful if SDK/CLI haven't changed)
./scripts/build-all.sh --acr --acr-name myacr --skip-npm
```

#### Using Environment Variables

```bash
# Set defaults
export ACR_NAME=myacr

# Now --acr-name is optional
./scripts/build-all.sh --acr
./scripts/build-all.sh --acr --tag v1.0.0
```

### Deploying to AKS

After building with `--acr`, update your Helm values to use the ACR images:

```yaml
# values-aks.yaml
images:
  api:
    repository: myacr.azurecr.io/openagentic-api
    tag: v1.0.0
  ui:
    repository: myacr.azurecr.io/openagentic-ui
    tag: v1.0.0
  # ... etc
```

Then deploy:

```bash
helm upgrade --install openagentic ./helm/openagenticchat-v3 \
  -f ./helm/openagenticchat-v3/values-aks.yaml \
  --namespace openagentic
```

### Troubleshooting

**ACR build fails with permission error:**
```bash
# Ensure you're logged in
az login

# Verify ACR access
az acr show --name myacr
```

**ACR build times out:**
```bash
# ACR builds have a default timeout of 60 minutes
# For large builds, you may need to adjust platform settings
az acr build --registry myacr --timeout 7200 ...
```

**Docker build fails locally:**
```bash
# Ensure BuildKit is enabled
export DOCKER_BUILDKIT=1

# Clean up Docker cache
docker system prune -af
```
