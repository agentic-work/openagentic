# AWS — identity for the AWS MCP

A dedicated IAM user with `ReadOnlyAccess`, access key pair, creds written to `~/.openagentic/cloud-secrets/aws.env`. 1 minute, no console clicks. (openagentic auth is local username/password only — these are MCP service credentials, not user sign-in.)

## Read-only IAM user

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

### Values to record

| Key | Value |
|---|---|
| Account | `<YOUR_AWS_ACCOUNT_ID>` |
| IAM user | `openagentic-mcp` |
| User ARN | `arn:aws:iam::<YOUR_AWS_ACCOUNT_ID>:user/openagentic-mcp` |
| Managed policy | `arn:aws:iam::aws:policy/ReadOnlyAccess` |
| Access key | rotating, see `~/.openagentic/cloud-secrets/aws.env` |

### Teardown

```bash
aws iam delete-access-key --user-name openagentic-mcp --access-key-id $AKID
aws iam detach-user-policy --user-name openagentic-mcp --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
aws iam delete-user --user-name openagentic-mcp
rm ~/.openagentic/cloud-secrets/aws.env
```
