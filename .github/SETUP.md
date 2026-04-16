# GitHub Actions CI/CD Setup Guide

## Overview
This repository includes comprehensive GitHub Actions workflows for:
- Building and testing Docker images
- Security scanning (vulnerabilities, secrets, compliance)
- Automated deployment to Azure Kubernetes Service (AKS)

## Prerequisites

### Required GitHub Secrets
Configure the following secrets in your repository settings:

#### Azure Credentials
- `AZURE_CREDENTIALS` - Service Principal JSON for Azure authentication
  ```json
  {
    "clientId": "xxx",
    "clientSecret": "xxx",
    "subscriptionId": "815a115d-bf32-495c-a89f-b5ce6b349b57",
    "tenantId": "ee3d15bb-e175-4ee7-995d-d992aa3199f6"
  }
  ```

#### Azure Container Registry
- `ACR_USERNAME` - ACR admin username (openagenticacr)
- `ACR_PASSWORD` - ACR admin password

#### Security Scanning
- `SNYK_TOKEN` - (Optional) Snyk API token for dependency scanning

## Workflows

### 1. Build and Deploy (`build-and-deploy.yml`)
**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main`

**Features:**
- Detects changed services and only rebuilds affected components
- Runs security scans on source code and Docker images
- Uses Docker layer caching for faster builds
- Automatically deploys to AKS on successful main branch builds
- Includes rollback on deployment failure

**Jobs:**
1. `detect-changes` - Identifies which services need rebuilding
2. `security-scan` - Runs Trivy and TruffleHog security scans
3. `build-*` - Builds and pushes Docker images for each service
4. `deploy-to-aks` - Deploys to AKS using Helm
5. `notify` - Sends deployment status notifications

### 2. Security Scanning (`security-scan.yml`)
**Triggers:**
- Daily at midnight UTC
- Manual trigger via workflow_dispatch

**Features:**
- Dependency vulnerability scanning (npm audit, Snyk)
- Container security scanning (Hadolint, Grype)
- Code security analysis (CodeQL, Semgrep)
- License compliance checking
- Infrastructure security scanning (Checkov, Kubesec)
- SBOM (Software Bill of Materials) generation

## Setup Instructions

### 1. Create Azure Service Principal
```bash
az ad sp create-for-rbac \
  --name "github-actions-sp" \
  --role contributor \
  --scopes /subscriptions/815a115d-bf32-495c-a89f-b5ce6b349b57 \
  --sdk-auth
```

### 2. Grant ACR Access
```bash
az role assignment create \
  --assignee <service-principal-id> \
  --role "AcrPush" \
  --scope /subscriptions/815a115d-bf32-495c-a89f-b5ce6b349b57/resourceGroups/openagentic-aks-rg/providers/Microsoft.ContainerRegistry/registries/openagenticacr
```

### 3. Grant AKS Access
```bash
az role assignment create \
  --assignee <service-principal-id> \
  --role "Azure Kubernetes Service Cluster User Role" \
  --scope /subscriptions/815a115d-bf32-495c-a89f-b5ce6b349b57/resourceGroups/openagentic-aks-rg/providers/Microsoft.ContainerService/managedClusters/openagentic-aks-cluster
```

### 4. Configure GitHub Repository

1. Navigate to Settings > Secrets and variables > Actions
2. Add the required secrets listed above
3. Enable GitHub Actions in the repository
4. Configure branch protection rules for `main`:
   - Require pull request reviews
   - Require status checks to pass
   - Include administrators

## Workflow Features

### Smart Change Detection
The workflows use path filters to detect changes:
- API changes trigger API rebuild
- UI changes trigger UI rebuild
- Documentation changes trigger docs rebuild
- Helm chart changes trigger deployment validation

### Security Gates
All images must pass security scanning before deployment:
- No CRITICAL vulnerabilities allowed
- HIGH severity vulnerabilities logged but allowed
- Secret scanning blocks deployment if secrets found
- License compliance checking for legal requirements

### Automated Deployment
Main branch deployments include:
- Automatic image tagging with commit SHA
- Helm chart deployment with value overrides
- Health check verification
- Automatic rollback on failure
- Smoke test execution

### Caching Strategy
- Docker layer caching reduces build times
- GitHub Actions cache for dependencies
- ACR used as remote cache for Docker builds

## Monitoring

### Build Status
Check the Actions tab in GitHub for:
- Build status and logs
- Security scan results
- Deployment history

### Security Reports
- Vulnerability reports uploaded to GitHub Security tab
- SBOM artifacts available for download
- Compliance reports in workflow logs

## Troubleshooting

### Common Issues

1. **ACR Authentication Failures**
   - Verify ACR_USERNAME and ACR_PASSWORD secrets
   - Ensure admin access is enabled on ACR
   - Check Service Principal permissions

2. **AKS Deployment Failures**
   - Verify AZURE_CREDENTIALS secret format
   - Check AKS cluster is running
   - Ensure namespace exists
   - Verify Helm chart syntax

3. **Security Scan Failures**
   - Review vulnerability reports
   - Update base images if needed
   - Patch dependencies with `npm audit fix`

### Debug Mode
Enable debug logging:
1. Go to Settings > Secrets and variables > Actions
2. Add repository variable: `ACTIONS_RUNNER_DEBUG` = `true`
3. Add repository variable: `ACTIONS_STEP_DEBUG` = `true`

## Local Testing

Test workflows locally using [act](https://github.com/nektos/act):
```bash
# Install act
brew install act

# Test build workflow
act push -W .github/workflows/build-and-deploy.yml --secret-file .env.secrets

# Test security scan
act schedule -W .github/workflows/security-scan.yml
```

## Best Practices

1. **Secret Management**
   - Never commit secrets to the repository
   - Rotate secrets regularly
   - Use Azure Key Vault for production

2. **Image Tagging**
   - Always tag with commit SHA for traceability
   - Use semantic versioning for releases
   - Keep `latest` tag for development

3. **Security**
   - Run security scans on every build
   - Fix vulnerabilities promptly
   - Keep base images updated

4. **Performance**
   - Use multi-stage Docker builds
   - Leverage caching effectively
   - Parallelize independent jobs

## Support

For issues or questions:
1. Check workflow logs in GitHub Actions
2. Review this documentation
3. Contact: admin@example.com