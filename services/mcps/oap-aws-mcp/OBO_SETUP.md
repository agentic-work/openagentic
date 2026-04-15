# AWS Identity Center + Azure AD OBO Setup Guide

This document describes all the commands needed to configure AWS Identity Center to accept Azure AD tokens for On-Behalf-Of (OBO) authentication.

## OpenAgentic AWS MCP Server

The OpenAgentic AWS MCP server is **forked from the official [awslabs/mcp aws-api-mcp-server](https://github.com/awslabs/mcp/tree/main/src/aws-api-mcp-server)** with added OBO support.

### Tools Available

| Tool | Description |
|------|-------------|
| `call_aws` | Execute AWS CLI commands (e.g., `aws ec2 describe-instances`) |
| `suggest_aws_commands` | Suggest CLI commands from natural language queries |
| `aws_list_accounts` | List AWS accounts accessible via Identity Center (requires OBO) |

### Key Features

1. **Compatible Interface**: Same `call_aws(cli_command="aws ...")` interface as official MCP
2. **OBO Authentication**: Exchanges Azure AD tokens for AWS credentials via Identity Center
3. **Fallback Credentials**: Uses `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` when OBO unavailable

## Overview

The OpenAgentic AWS MCP uses a **Trusted Token Issuer (TTI)** flow:

```
User Login → Azure AD Token → OpenAgentic API → MCP Proxy → OpenAgentic AWS MCP
                                                                  ↓
                                                    AWS Identity Center (TTI)
                                                                  ↓
                                                    create_token_with_iam()
                                                    (JWT Bearer Grant)
                                                                  ↓
                                                    AWS STS Credentials
                                                    (User's AWS permissions)
```

## Prerequisites

1. **AWS Account** with Identity Center enabled
2. **Azure AD Tenant** with app registration
3. **AWS CLI** configured with admin access
4. **Azure AD credentials** from OpenAgentic `.env`:
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID` (Application ID URI: `api://<client-id>`)

---

## AWS Setup Commands

### Step 1: Verify AWS Identity Center is Enabled

```bash
# Check if Identity Center is already enabled
aws sso-admin list-instances --region us-east-1
```

**Expected Output:**
```json
{
    "Instances": [
        {
            "InstanceArn": "arn:aws:sso:::instance/ssoins-XXXXXXXX",
            "IdentityStoreId": "d-XXXXXXXXX",
            "OwnerAccountId": "123456789012",
            "Status": "ACTIVE"
        }
    ]
}
```

**Why:** AWS Identity Center must be enabled before we can configure trusted token issuers.

---

### Step 2: Create Trusted Token Issuer for Azure AD

```bash
# Create TTI pointing to Azure AD OIDC endpoint
aws sso-admin create-trusted-token-issuer \
  --instance-arn "arn:aws:sso:::instance/ssoins-7223f59f5fe61fab" \
  --name "AzureAD-OpenAgentic" \
  --trusted-token-issuer-type "OIDC_JWT" \
  --trusted-token-issuer-configuration '{
    "OidcJwtConfiguration": {
      "IssuerUrl": "https://login.microsoftonline.com/ee3d15bb-e175-4ee7-995d-d992aa3199f6/v2.0",
      "ClaimAttributePath": "sub",
      "IdentityStoreAttributePath": "userName",
      "JwksRetrievalOption": "OPEN_ID_DISCOVERY"
    }
  }' \
  --region us-east-1
```

**Expected Output:**
```json
{
    "TrustedTokenIssuerArn": "arn:aws:sso::312347353495:trustedTokenIssuer/ssoins-XXXX/tti-XXXX"
}
```

**Why:** This tells AWS Identity Center to trust tokens issued by Azure AD. The `ClaimAttributePath: sub` maps the Azure AD subject claim to Identity Center users.

**Configuration Details:**
- `IssuerUrl`: Azure AD v2.0 OIDC endpoint for your tenant
- `ClaimAttributePath`: Which JWT claim identifies the user (Azure AD uses `sub`)
- `IdentityStoreAttributePath`: Which Identity Center attribute to match against (`userName`)
- `JwksRetrievalOption`: How to get Azure AD's public keys for signature verification

---

### Step 3: Create Application for Token Exchange

```bash
# Create customer-managed application in Identity Center
aws sso-admin create-application \
  --instance-arn "arn:aws:sso:::instance/ssoins-7223f59f5fe61fab" \
  --name "OpenAgentic-AWS-MCP" \
  --description "Token exchange for OpenAgentic AWS MCP operations" \
  --application-provider-arn "arn:aws:sso::aws:applicationProvider/custom" \
  --portal-options '{"Visibility": "DISABLED"}' \
  --region us-east-1
```

**Expected Output:**
```json
{
    "ApplicationArn": "arn:aws:sso::312347353495:application/ssoins-XXXX/apl-XXXX"
}
```

**Why:** This application receives token exchange requests. The `Visibility: DISABLED` hides it from the AWS access portal since it's only used programmatically.

---

### Step 4: Configure JWT Bearer Grant

```bash
# Enable JWT Bearer grant type for the application
aws sso-admin put-application-grant \
  --application-arn "arn:aws:sso::312347353495:application/ssoins-7223f59f5fe61fab/apl-7223b5b58262d170" \
  --grant-type "urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --grant '{
    "JwtBearer": {
      "AuthorizedTokenIssuers": [
        {
          "TrustedTokenIssuerArn": "arn:aws:sso::312347353495:trustedTokenIssuer/ssoins-7223f59f5fe61fab/tti-e458d428-e0e0-70d5-3b0a-fe6ccb64af16",
          "AuthorizedAudiences": ["api://392dc6aa-1404-49c0-8a24-4d6c9aa1fad3"]
        }
      ]
    }
  }' \
  --region us-east-1
```

**Why:** This configures which tokens the application accepts:
- `TrustedTokenIssuerArn`: Only accept tokens from our Azure AD TTI
- `AuthorizedAudiences`: Only accept tokens with this audience (must match Azure AD app's Application ID URI)

---

### Step 5: Add Access Scope (Optional)

```bash
# Allow the application to request STS AssumeRole
aws sso-admin put-application-access-scope \
  --application-arn "arn:aws:sso::312347353495:application/ssoins-7223f59f5fe61fab/apl-7223b5b58262d170" \
  --scope "sts:AssumeRole" \
  --region us-east-1
```

**Why:** Defines what AWS operations the exchanged token can request.

---

### Step 6: Verify Configuration

```bash
# List trusted token issuers
aws sso-admin list-trusted-token-issuers \
  --instance-arn "arn:aws:sso:::instance/ssoins-7223f59f5fe61fab" \
  --region us-east-1

# List applications
aws sso-admin list-applications \
  --instance-arn "arn:aws:sso:::instance/ssoins-7223f59f5fe61fab" \
  --region us-east-1

# List grants for application
aws sso-admin list-application-grants \
  --application-arn "arn:aws:sso::312347353495:application/ssoins-7223f59f5fe61fab/apl-7223b5b58262d170" \
  --region us-east-1
```

---

## Azure AD Setup (if not already configured)

### Verify App Registration

The OpenAgentic app registration should already exist. Verify:

1. **Application ID URI**: `api://392dc6aa-1404-49c0-8a24-4d6c9aa1fad3`
2. **Exposed API Scope**: `access_as_user`

### Required Azure AD Configuration

In Azure Portal → App Registrations → OpenAgentic Chat:

1. **Expose an API**:
   - Application ID URI: `api://<client-id>`
   - Add scope: `access_as_user`

2. **API Permissions** (Delegated):
   - Azure Service Management: `user_impersonation`
   - Microsoft Graph: `User.Read`, `openid`, `profile`

3. **Token Configuration**:
   - Add optional claim: `sub` (in ID tokens and Access tokens)

---

## Environment Variables

Add to `.env`:

```bash
# AWS Identity Center OBO Configuration
AWS_IC_INSTANCE_ARN=arn:aws:sso:::instance/ssoins-7223f59f5fe61fab
AWS_IC_APPLICATION_ARN=arn:aws:sso::312347353495:application/ssoins-7223f59f5fe61fab/apl-7223b5b58262d170

# Fallback credentials (when OBO not available)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<optional-fallback>
AWS_SECRET_ACCESS_KEY=<optional-fallback>
```

---

## User Provisioning

For OBO to work, users must exist in AWS Identity Center with matching identifiers.

### Option A: Manual User Creation

```bash
# Create user in Identity Center
aws identitystore create-user \
  --identity-store-id "d-906625c867" \
  --user-name "user@example.com" \
  --display-name "User Name" \
  --emails '[{"Value": "user@example.com", "Primary": true}]' \
  --region us-east-1
```

### Option B: SCIM Provisioning (Recommended)

Configure SCIM provisioning from Azure AD to automatically sync users:

1. In AWS Identity Center → Settings → Provisioning → Enable
2. Copy SCIM endpoint and token
3. In Azure AD → Enterprise Apps → OpenAgentic → Provisioning → Configure SCIM

---

## Testing OBO Flow

### Test with Fallback Credentials

```bash
# Via MCP Proxy - Get caller identity
curl -X POST http://localhost:8090/call \
  -H "Content-Type: application/json" \
  -d '{
    "server": "openagentic_aws",
    "tool": "call_aws",
    "arguments": {
      "cli_command": "aws sts get-caller-identity"
    }
  }'

# List EC2 instances
curl -X POST http://localhost:8090/call \
  -H "Content-Type: application/json" \
  -d '{
    "server": "openagentic_aws",
    "tool": "call_aws",
    "arguments": {
      "cli_command": "aws ec2 describe-instances --region us-east-1"
    }
  }'

# List S3 buckets
curl -X POST http://localhost:8090/call \
  -H "Content-Type: application/json" \
  -d '{
    "server": "openagentic_aws",
    "tool": "call_aws",
    "arguments": {
      "cli_command": "aws s3api list-buckets"
    }
  }'

# Suggest commands (no credentials required)
curl -X POST http://localhost:8090/call \
  -H "Content-Type: application/json" \
  -d '{
    "server": "openagentic_aws",
    "tool": "suggest_aws_commands",
    "arguments": {
      "query": "list all my ec2 instances"
    }
  }'
```

### Test OBO with Azure Token

```bash
# Get Azure AD token
AZURE_TOKEN=$(curl -X POST "https://login.microsoftonline.com/$AZURE_TENANT_ID/oauth2/v2.0/token" \
  -d "client_id=$AZURE_CLIENT_ID" \
  -d "scope=api://$AZURE_CLIENT_ID/.default" \
  -d "grant_type=client_credentials" \
  -d "client_secret=$AZURE_CLIENT_SECRET" | jq -r '.access_token')

# List accessible AWS accounts (requires OBO)
curl -X POST http://localhost:8090/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AZURE_TOKEN" \
  -d '{
    "server": "openagentic_aws",
    "tool": "aws_list_accounts",
    "arguments": {}
  }'

# Execute command with OBO credentials
curl -X POST http://localhost:8090/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AZURE_TOKEN" \
  -d '{
    "server": "openagentic_aws",
    "tool": "call_aws",
    "arguments": {
      "cli_command": "aws sts get-caller-identity"
    }
  }'
```

---

## Troubleshooting

### Token Exchange Fails

1. **Check TTI configuration**: Verify `IssuerUrl` matches your Azure AD tenant
2. **Check audience**: Token `aud` claim must match `AuthorizedAudiences`
3. **Check user mapping**: User `sub` claim must map to Identity Center `userName`

### No AWS Accounts Listed

1. **Check permission sets**: User must have permission sets assigned
2. **Check account assignments**: Permission sets must be assigned to AWS accounts

### Fallback Credentials Used

- OBO requires valid Azure AD token in request
- Check MCP proxy logs for "No userAccessToken in meta"

---

## Architecture Summary

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Azure AD      │     │  AWS Identity   │     │   AWS Services  │
│                 │     │     Center      │     │                 │
│  ┌───────────┐  │     │  ┌───────────┐  │     │  ┌───────────┐  │
│  │ User Auth │──┼─────┼─>│    TTI    │  │     │  │   EC2     │  │
│  └───────────┘  │     │  └─────┬─────┘  │     │  │   S3      │  │
│                 │     │        │        │     │  │  Lambda   │  │
│  ┌───────────┐  │     │  ┌─────▼─────┐  │     │  │   IAM     │  │
│  │   JWT     │──┼─────┼─>│   App     │──┼─────┼─>│   RDS     │  │
│  │  Token    │  │     │  │ (Token    │  │     │  │   EKS     │  │
│  └───────────┘  │     │  │ Exchange) │  │     │  │   ...     │  │
│                 │     │  └───────────┘  │     │  └───────────┘  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  STS Temporary  │
                    │  Credentials    │
                    └─────────────────┘
```

---

## Reference ARNs (OpenAgentic Production)

| Resource | ARN |
|----------|-----|
| Identity Center Instance | `arn:aws:sso:::instance/ssoins-7223f59f5fe61fab` |
| Identity Store | `d-906625c867` |
| Trusted Token Issuer | `arn:aws:sso::312347353495:trustedTokenIssuer/ssoins-7223f59f5fe61fab/tti-e458d428-e0e0-70d5-3b0a-fe6ccb64af16` |
| Application | `arn:aws:sso::312347353495:application/ssoins-7223f59f5fe61fab/apl-7223b5b58262d170` |
| AWS Account | `312347353495` |
| Azure AD Tenant | `ee3d15bb-e175-4ee7-995d-d992aa3199f6` |
| Azure AD App Client ID | `392dc6aa-1404-49c0-8a24-4d6c9aa1fad3` |
