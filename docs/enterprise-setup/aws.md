# AWS — identity for the AWS MCP

Two paths:

- **Quick path** (what we did for the reference instance) — a dedicated IAM user with `ReadOnlyAccess`, access key pair, creds written to `~/.openagentic/cloud-secrets/aws.env`. 1 minute, no console clicks.
- **Full IAM Identity Center + Azure AD federation** — for orgs where you want SSO-driven access and SCIM group sync. Requires console steps in two portals; captured at the bottom.

## Quick path (read-only IAM user)

### Preconditions

```bash
aws sts get-caller-identity     # confirm you're in the right account
```

### 1. Create IAM user

```bash
aws iam create-user --user-name openagentic-mcp
```

### 2. Attach ReadOnlyAccess

```bash
aws iam attach-user-policy \
  --user-name openagentic-mcp \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
```

### 3. Create access key

```bash
aws iam create-access-key --user-name openagentic-mcp > /tmp/aws-key.json
AKID=$(python3 -c "import json; print(json.load(open('/tmp/aws-key.json'))['AccessKey']['AccessKeyId'])")
SK=$(python3 -c "import json; print(json.load(open('/tmp/aws-key.json'))['AccessKey']['SecretAccessKey'])")
rm /tmp/aws-key.json
```

### 4. Write secrets

```bash
cat > ~/.openagentic/cloud-secrets/aws.env <<EOF
AWS_ACCESS_KEY_ID=$AKID
AWS_SECRET_ACCESS_KEY=$SK
AWS_REGION=us-east-1
AWS_DEFAULT_REGION=us-east-1
EOF
chmod 600 ~/.openagentic/cloud-secrets/aws.env
```

### 5. Verify

```bash
# Wait ~10s for the key to propagate
sleep 10
AWS_ACCESS_KEY_ID=$AKID AWS_SECRET_ACCESS_KEY=$SK aws sts get-caller-identity
# → Arn: arn:aws:iam::<account>:user/openagentic-mcp
```

### Reference instance values

| Key | Value |
|---|---|
| Account | `123456789012` (Organizations management) |
| IAM user | `openagentic-mcp` |
| User ARN | `arn:aws:iam::123456789012:user/openagentic-mcp` |
| Managed policy | `arn:aws:iam::aws:policy/ReadOnlyAccess` |
| Access key | rotating, see `~/.openagentic/cloud-secrets/aws.env` |

### Teardown

```bash
aws iam delete-access-key --user-name openagentic-mcp --access-key-id $AKID
aws iam detach-user-policy --user-name openagentic-mcp --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
aws iam delete-user --user-name openagentic-mcp
rm ~/.openagentic/cloud-secrets/aws.env
```

## Full path — IAM Identity Center federated to Entra ID (SSO)

Skip this unless you're wiring openagentic into an existing SSO setup. Needs the AWS Organizations management account + console access in both Azure and AWS. Ballpark 30–60 minutes of setup the first time.

### Outline

1. **AWS** — enable IAM Identity Center in the Organizations management account (`aws sso-admin list-instances` after enablement shows the instance ARN).
2. **Azure** — in Entra ID → Enterprise applications → New application → "AWS IAM Identity Center" from the gallery. Copy the Microsoft SAML endpoints + upload the AWS IdC SP metadata XML.
3. **AWS IdC** — External IdP → upload the Azure SAML metadata you exported.
4. **SCIM** — enable automatic provisioning from Azure to IdC; sync the `openagentic-admins` group.
5. **IdC Permission Set** — create `openagentic-mcp-read` with `ReadOnlyAccess`.
6. **Assign** the permission set to the synced group in the target account.

Once this is wired up, replace the IAM user in `aws.env` with an IdC-derived short-lived credential using `aws sso login` or the `aws-vault` flow. The MCP container will need the SSO refresh mechanism mounted in; that's out of scope for the read-only quick path.

### References

- [AWS docs — Enable IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/get-started-enable-identity-center.html)
- [Azure docs — AWS IAM Identity Center federation](https://learn.microsoft.com/en-us/entra/identity/saas-apps/aws-single-sign-on-tutorial)
- [AWS docs — SCIM provisioning from Azure AD](https://docs.aws.amazon.com/singlesignon/latest/userguide/azure-ad-idp.html)
