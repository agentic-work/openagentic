#!/usr/bin/env bash
# Provisions the cloud identities required for the Azure / AWS / GCP MCPs.
# Assumes `az`, `aws`, and `gcloud` are already authenticated to the
# right tenant/account/project. See ./README.md, ./azure.md, ./aws.md, ./gcp.md.
#
# Outputs:
#   ~/.openagentic/cloud-secrets/azure.env
#   ~/.openagentic/cloud-secrets/aws.env
#   ~/.openagentic/cloud-secrets/gcp.env
#   ~/.openagentic/cloud-secrets/gcp-sa.json
set -euo pipefail

SECRETS="$HOME/.openagentic/cloud-secrets"
mkdir -p "$SECRETS"
chmod 700 "$SECRETS"

say() { printf '\n\033[1;35m▸\033[0m %s\n' "$*"; }

# ───────────────────────────── Azure ─────────────────────────────
say "Azure — App Registration + SP + Reader"
TENANT=$(az account show --query tenantId -o tsv)
SUB=$(az account show --query id -o tsv)

APP_JSON=$(az ad app create \
  --display-name "openagentic-readonly" \
  --sign-in-audience "AzureADMyOrg" -o json)
APP_ID=$(echo "$APP_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["appId"])')
APP_OBJ=$(echo "$APP_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

SECRET=$(az ad app credential reset --id "$APP_ID" --years 2 --query password -o tsv)

SP_OBJ=$(az ad sp create --id "$APP_ID" --query id -o tsv)
sleep 10

az role assignment create \
  --assignee-object-id "$SP_OBJ" --assignee-principal-type ServicePrincipal \
  --role "Reader" --scope "/subscriptions/$SUB" >/dev/null

cat > "$SECRETS/azure.env" <<EOF
AZURE_TENANT_ID=$TENANT
AZURE_SUBSCRIPTION_ID=$SUB
AZURE_CLIENT_ID=$APP_ID
AZURE_CLIENT_SECRET=$SECRET
AZURE_APP_OBJECT_ID=$APP_OBJ
AZURE_SP_OBJECT_ID=$SP_OBJ
EOF
chmod 600 "$SECRETS/azure.env"
say "Azure: wrote $SECRETS/azure.env"

# ───────────────────────────── AWS ─────────────────────────────
say "AWS — IAM user + ReadOnlyAccess"
aws iam create-user --user-name openagentic-mcp >/dev/null
aws iam attach-user-policy --user-name openagentic-mcp \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
KEY=$(aws iam create-access-key --user-name openagentic-mcp)
AKID=$(echo "$KEY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKey"]["AccessKeyId"])')
SK=$(echo "$KEY"   | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKey"]["SecretAccessKey"])')
cat > "$SECRETS/aws.env" <<EOF
AWS_ACCESS_KEY_ID=$AKID
AWS_SECRET_ACCESS_KEY=$SK
AWS_REGION=us-east-1
AWS_DEFAULT_REGION=us-east-1
EOF
chmod 600 "$SECRETS/aws.env"
say "AWS: wrote $SECRETS/aws.env"

# ───────────────────────────── GCP ─────────────────────────────
say "GCP — service account + read-only roles"
PROJECT=$(gcloud config get-value project)
SA="openagentic-mcp-gcp@$PROJECT.iam.gserviceaccount.com"
gcloud iam service-accounts create openagentic-mcp-gcp \
  --display-name="OpenAgentic MCP GCP" --project="$PROJECT" || true
for role in viewer logging.viewer monitoring.viewer cloudasset.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="roles/$role" --condition=None --quiet >/dev/null
done
gcloud iam service-accounts keys create "$SECRETS/gcp-sa.json" --iam-account="$SA"
chmod 600 "$SECRETS/gcp-sa.json"
cat > "$SECRETS/gcp.env" <<EOF
GOOGLE_APPLICATION_CREDENTIALS=$SECRETS/gcp-sa.json
GCP_PROJECT=$PROJECT
GCP_SERVICE_ACCOUNT=$SA
EOF
chmod 600 "$SECRETS/gcp.env"
say "GCP: wrote $SECRETS/gcp.env + $SECRETS/gcp-sa.json"

say "Done. Secrets live at $SECRETS (chmod 700, each file 600)."
