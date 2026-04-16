# OpenAgentic Chat Helm Deployment Guide

This guide covers deploying OpenAgentic Chat using Helm on different environments.

## Available Values Files

### 1. Local Kubernetes (`values-local.yaml`)
- **Environment**: Development/Testing
- **Target**: Any local Kubernetes (minikube, kind, Docker Desktop, k3s)
- **Features**: Full stack deployment with all dependencies
- **Storage**: Uses `standard` storage class (works with most local K8s)
- **Access**: NodePort services + optional Ingress

### 2. AWS EKS (`values-aws.yaml`)
- **Environment**: Production
- **Target**: AWS EKS with external services
- **Features**: Production-grade with external RDS, ElastiCache, etc.
- **Storage**: AWS EBS (`gp3` storage class)
- **Access**: ALB Ingress with SSL termination

### 3. Existing Configurations
- `values-aks.yaml`: Azure AKS deployment (testing/staging)
- `values-gke.yaml`: Google GKE deployment (production)

## Quick Deployment

### Local Kubernetes Deployment

```bash
# Prerequisites
# - Local Kubernetes cluster (minikube, kind, Docker Desktop)
# - Helm 3.x installed
# - kubectl configured for your cluster

# 1. Create namespace
kubectl create namespace openagentic

# 2. Install with local values
helm install openagenticchat ./helm/openagenticchat-v3 \
  --namespace openagentic \
  --values helm/openagenticchat-v3/values-local.yaml

# 3. Access the application
# Option A: Using NodePort (default)
echo "UI: http://localhost:30000"
echo "API: http://localhost:30001"
echo "MCP: http://localhost:30002"
echo "PgAdmin: http://localhost:30080"
echo "Grafana: http://localhost:30030"

# Option B: Using Ingress (requires ingress controller)
# Install nginx ingress first:
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# Then access via: http://localhost
```

### AWS EKS Deployment

```bash
# Prerequisites
# - EKS cluster with ALB Load Balancer Controller
# - External RDS PostgreSQL instance
# - External ElastiCache Redis (optional)
# - ECR repositories for images
# - ACM certificates for TLS
# - Proper IAM roles and IRSA setup

# 1. Create namespace
kubectl create namespace openagentic

# 2. Set up secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name openagenticchat/postgresql \
  --description "PostgreSQL credentials" \
  --secret-string '{"password":"your-secure-password"}'

aws secretsmanager create-secret \
  --name openagenticchat/api \
  --description "API service secrets" \
  --secret-string '{"JWT_SECRET":"your-jwt-secret","API_SECRET_KEY":"your-api-key"}'

# 3. Install External Secrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets-system \
  --create-namespace

# 4. Update values file with your configuration
cp helm/openagenticchat-v3/values-aws.yaml my-values.yaml
# Edit my-values.yaml with your AWS account ID, RDS endpoints, etc.

# 5. Install with AWS values
helm install openagenticchat ./helm/openagenticchat-v3 \
  --namespace openagentic \
  --values my-values.yaml \
  --set aws.accountId=123456789012 \
  --set postgresql.external.host=your-rds-endpoint.amazonaws.com \
  --set redis.external.host=your-elasticache-endpoint.amazonaws.com

# 6. Verify deployment
kubectl get pods -n openagentic
kubectl get ingress -n openagentic
```

## Configuration Requirements

### Local Deployment
- **Storage**: Uses `standard` storage class
- **Images**: Pulls from Docker Hub or local registry
- **Dependencies**: All services deployed in-cluster
- **Secrets**: Hardcoded development values
- **Resources**: Minimal resource requirements

### AWS Deployment
- **ECR Setup**: Images must be in ECR
- **External Services**: RDS, ElastiCache recommended
- **IAM Roles**: Service accounts need proper IRSA
- **Secrets**: AWS Secrets Manager integration
- **Certificates**: ACM certificates for TLS
- **Storage**: EBS GP3 volumes

## Required External Resources for AWS

### 1. RDS PostgreSQL
```bash
# Example RDS creation
aws rds create-db-instance \
  --db-instance-identifier openagentic-postgres \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.4 \
  --master-username openagentic \
  --master-user-password YourSecurePassword \
  --allocated-storage 100 \
  --storage-type gp3 \
  --storage-encrypted \
  --vpc-security-group-ids sg-xxxxxxxxx \
  --db-subnet-group-name your-db-subnet-group \
  --backup-retention-period 7 \
  --multi-az
```

### 2. ElastiCache Redis
```bash
# Example ElastiCache creation
aws elasticache create-replication-group \
  --replication-group-id openagentic-redis \
  --description "OpenAgentic Chat Redis" \
  --node-type cache.t3.medium \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-clusters 2 \
  --cache-subnet-group-name your-cache-subnet-group \
  --security-group-ids sg-xxxxxxxxx
```

### 3. ECR Repositories
```bash
# Create ECR repositories
aws ecr create-repository --repository-name openagenticchat/api
aws ecr create-repository --repository-name openagenticchat/ui
aws ecr create-repository --repository-name openagenticchat/mcp-orchestrator
aws ecr create-repository --repository-name openagenticchat/docs
```

### 4. IAM Roles for IRSA
```bash
# Example IRSA setup for API service
eksctl create iamserviceaccount \
  --cluster=your-cluster-name \
  --namespace=openagentic \
  --name=openagenticchat-api \
  --attach-policy-arn=arn:aws:iam::aws:policy/SecretsManagerReadWrite \
  --attach-policy-arn=arn:aws:iam::aws:policy/AmazonBedrockFullAccess \
  --approve
```

## Environment Variables Reference

### Required for Local
- `NODE_ENV=development`
- Database credentials (auto-configured)
- Service URLs (auto-configured)

### Required for AWS
- `AWS_REGION`
- Database connection strings (from secrets)
- Azure AD credentials (if using)
- Vault configuration

## Troubleshooting

### Common Issues

1. **Storage Class Not Found**
   ```bash
   # Check available storage classes
   kubectl get storageclass
   
   # Update values file with correct storage class
   ```

2. **Images Not Pulling**
   ```bash
   # For ECR, ensure proper authentication
   aws ecr get-login-password --region us-east-1 | \
   docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
   ```

3. **External Services Connection**
   ```bash
   # Test database connection
   kubectl run postgres-test --image=postgres:15 --rm -it --restart=Never \
     -- psql postgresql://username:password@your-rds-endpoint:5432/openagenticchat
   ```

4. **Ingress Not Working**
   ```bash
   # Check ingress controller
   kubectl get pods -n ingress-nginx
   
   # For AWS ALB, ensure Load Balancer Controller is installed
   kubectl get pods -n kube-system | grep aws-load-balancer-controller
   ```

## Monitoring and Observability

### Local Deployment
- Grafana: http://localhost:30030 (admin/localadmin123)
- Prometheus metrics: http://localhost:30090
- Application logs: `kubectl logs -f deployment/openagenticchat-api -n openagentic`

### AWS Deployment
- CloudWatch integration for logs
- AWS Managed Prometheus for metrics
- Grafana dashboard via ingress
- X-Ray tracing (if enabled)

## Scaling and Updates

### Updating Deployment
```bash
# Update with new values
helm upgrade openagenticchat ./helm/openagenticchat-v3 \
  --namespace openagentic \
  --values your-values.yaml

# Rollback if needed
helm rollback openagenticchat 1 --namespace openagentic
```

### Manual Scaling
```bash
# Scale API service
kubectl scale deployment openagenticchat-api --replicas=5 -n openagentic

# Scale UI service  
kubectl scale deployment openagenticchat-ui --replicas=3 -n openagentic
```

## Security Considerations

### Local Development
- Uses development secrets (not for production)
- No network policies by default
- Simplified authentication

### Production AWS
- All secrets in AWS Secrets Manager
- Network policies enabled
- Pod security policies enforced
- WAF integration available
- IAM roles for service accounts (IRSA)

## Support

For deployment issues:
- Email: hello@openagentic.io
- GitHub Issues: https://github.com/openagentic/openagenticchat/issues
- Documentation: https://docs.openagentic.io