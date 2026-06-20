# GCP — service account for the GCP MCP

Read-only service account in whatever project the GCP MCP should introspect. Point it at the project you want introspected.

## Preconditions

```bash
gcloud auth login                       # if reauth is needed (non-interactive runs will fail)
gcloud config set project <YOUR_GCP_PROJECT>
gcloud config list --format="value(core.account,core.project)"
```

## 1. Create the service account

```bash
gcloud iam service-accounts create openagentic-mcp-gcp \
  --display-name="OpenAgentic MCP GCP" \
  --project=<YOUR_GCP_PROJECT>
# → SA email: openagentic-mcp-gcp@<YOUR_GCP_PROJECT>.iam.gserviceaccount.com
```

## 2. Grant read-only roles

```bash
SA=openagentic-mcp-gcp@<YOUR_GCP_PROJECT>.iam.gserviceaccount.com
for role in viewer logging.viewer monitoring.viewer cloudasset.viewer; do
  gcloud projects add-iam-policy-binding <YOUR_GCP_PROJECT> \
    --member="serviceAccount:$SA" \
    --role="roles/$role" \
    --condition=None --quiet
done
```

| Role | What the MCP uses it for |
|---|---|
| `roles/viewer` | Broad GET/LIST across most GCP resource types |
| `roles/logging.viewer` | Reading Cloud Logging entries |
| `roles/monitoring.viewer` | Reading metrics + alerting policies |
| `roles/cloudasset.viewer` | Inventory queries across all resources |

## 3. Create a JSON key

```bash
gcloud iam service-accounts keys create \
  ~/.openagentic/cloud-secrets/gcp-sa.json \
  --iam-account=$SA
chmod 600 ~/.openagentic/cloud-secrets/gcp-sa.json
```

## 4. Write the env file

```bash
cat > ~/.openagentic/cloud-secrets/gcp.env <<EOF
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.openagentic/cloud-secrets/gcp-sa.json
GCP_PROJECT=<YOUR_GCP_PROJECT>
GCP_SERVICE_ACCOUNT=$SA
EOF
chmod 600 ~/.openagentic/cloud-secrets/gcp.env
```

## 5. Verify

```bash
GOOGLE_APPLICATION_CREDENTIALS=~/.openagentic/cloud-secrets/gcp-sa.json \
  gcloud auth application-default print-access-token | head -c 40
# → ya29.… (prints a valid access token)
```

## Values to record

| Key | Value |
|---|---|
| Project | the GCP project you want introspected |
| Service account | `openagentic-mcp-gcp@<YOUR_GCP_PROJECT>.iam.gserviceaccount.com` |
| Roles | viewer / logging.viewer / monitoring.viewer / cloudasset.viewer |
| Key id | `<YOUR_KEY_ID>` (JSON key at `~/.openagentic/cloud-secrets/gcp-sa.json`) |
| Verified | `gcloud projects describe <YOUR_GCP_PROJECT>` returns name + project number |

## Workload Identity Federation (no keys, recommended long-term)

If the instance runs in k8s with Workload Identity enabled, you can drop the JSON key and bind the pod's k8s ServiceAccount to this GCP SA via annotations. Out of scope for the local Docker Compose path; covered by the helm chart deployment docs.

## Teardown

```bash
SA=openagentic-mcp-gcp@<YOUR_GCP_PROJECT>.iam.gserviceaccount.com
for role in viewer logging.viewer monitoring.viewer cloudasset.viewer; do
  gcloud projects remove-iam-policy-binding <YOUR_GCP_PROJECT> \
    --member="serviceAccount:$SA" --role="roles/$role" --quiet
done
# Delete all keys before deleting the SA
gcloud iam service-accounts keys list --iam-account=$SA --format="value(name)" | \
  xargs -I{} gcloud iam service-accounts keys delete {} --iam-account=$SA --quiet
gcloud iam service-accounts delete $SA --quiet
rm ~/.openagentic/cloud-secrets/gcp-sa.json ~/.openagentic/cloud-secrets/gcp.env
```
