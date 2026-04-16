# Build System Summary

## What Was Fixed

### 1. Build Script Enhancements (`scripts/build-all.sh`)
**Issue**: The openagentic-manager Dockerfile expected `sdk/` and `openagentic-cli/` at the repo root, but the build script was only copying CLI artifacts to `services/openagentic-cli/`.

**Fix**:
- Now copies SDK from `/mnt/synology/Code/company/openagentic/sdk` → `./sdk/`
- Now copies CLI from `/mnt/synology/Code/company/openagentic/openagentic` → `./openagentic-cli/`
- Maintains backward compatibility by also copying to `services/openagentic-cli/`

### 2. Dockerfile Path Corrections (`services/openagentic-manager/Dockerfile`)
**Issue**: Dockerfile used incorrect relative paths expecting `openagentic-manager/` at repo root.

**Fix**: Updated all COPY commands to use `services/openagentic-manager/` since build context is repo root.

### 3. Build Artifact Management
**Updated `.dockerignore`**:
- Added exceptions for `sdk/` and `openagentic-cli/` at repo root
- Ensures these directories are included in Docker build context

**Updated `.gitignore`**:
- Added `/sdk/` and `/openagentic-cli/` to prevent committing build artifacts
- These directories are regenerated on every build

## Build Process Flow

```
1. Build SDK
   ├─ cd /mnt/synology/Code/company/openagentic/sdk
   ├─ npm install
   └─ npm run build

2. Build CLI (depends on SDK)
   ├─ cd /mnt/synology/Code/company/openagentic/openagentic
   ├─ npm install (links to SDK via file: dependency)
   └─ npm run build

3. Copy Artifacts to Repo Root
   ├─ Copy SDK → ./sdk/
   └─ Copy CLI → ./openagentic-cli/

4. Build Docker Images
   └─ openagentic-manager uses SDK and CLI from repo root
```

## Usage Examples

### Local Build (All Services)
```bash
./scripts/build-all.sh
```

### Local Build (Specific Service)
```bash
./scripts/build-all.sh openagentic-manager
./scripts/build-all.sh openagentic-api openagentic-ui
```

### Build and Push to GCR
```bash
./scripts/build-all.sh --buildpush
./scripts/build-all.sh --buildpush --tag v1.0.0
./scripts/build-all.sh --buildpush --registry gcr.io/my-project/openagentic
```

### Azure ACR Build (Cloud Build)
```bash
# Build all services in ACR
./scripts/build-all.sh --acr --acr-name myacr

# Build specific service
./scripts/build-all.sh --acr --acr-name myacr openagentic-manager

# Build with custom tag
./scripts/build-all.sh --acr --acr-name myacr --tag v1.0.0

# Using environment variable
export ACR_NAME=myacr
./scripts/build-all.sh --acr
```

### Skip NPM Builds (Use Existing)
```bash
# Useful when SDK/CLI haven't changed
./scripts/build-all.sh --skip-npm
```

### No Cache Build
```bash
./scripts/build-all.sh --no-cache
./scripts/build-all.sh --acr --acr-name myacr --no-cache
```

## Key Features

### ✅ Proper Dependency Chain
- SDK builds first
- CLI builds second (depends on SDK)
- Docker images build last (use pre-built SDK + CLI)

### ✅ Multi-Registry Support
- **GCR** (Google Container Registry): `--buildpush --registry gcr.io/...`
- **ACR** (Azure Container Registry): `--acr --acr-name myacr`
- **Local**: Default mode (no push)

### ✅ Selective Building
- Build all services: `./scripts/build-all.sh`
- Build specific services: `./scripts/build-all.sh openagentic-manager openagentic-api`

### ✅ ACR Cloud Builds
- Builds happen in Azure cloud (no local Docker needed)
- Faster for large codebases
- Automatically pushes to ACR
- Uses Azure credentials: `az login`

## Directory Structure

```
/mnt/synology/Code/company/
├── openagentic/           # External SDK and CLI source
│   ├── sdk/              # SDK source (outside repo)
│   └── openagentic/       # CLI source (outside repo)
└── cdc/agentic/          # Main repo
    ├── sdk/              # ← Copied by build script (gitignored)
    ├── openagentic-cli/   # ← Copied by build script (gitignored)
    ├── services/
    │   ├── openagentic-manager/
    │   │   └── Dockerfile  # Uses sdk/ and openagentic-cli/
    │   ├── openagentic-api/
    │   └── ...
    └── scripts/
        └── build-all.sh
```

## Validation

All changes maintain:
- ✅ Local Docker builds work
- ✅ GCR push (`--buildpush`) works
- ✅ ACR cloud builds (`--acr`) work
- ✅ Selective service builds work
- ✅ No hardcoded paths or models
- ✅ Build artifacts properly ignored in git

## Environment Variables for ACR

```bash
# Optional: Set default ACR
export ACR_NAME=myacr
export ACR_REGISTRY=myacr.azurecr.io

# Then simply:
./scripts/build-all.sh --acr
```
