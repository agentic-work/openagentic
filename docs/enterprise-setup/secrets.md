# Secrets — where they live, how the MCPs read them

Never in the repo. Never in the `.env` at the repo root. Always under `~/.openagentic/cloud-secrets/`, chmod `0700` on the directory and `0600` on each file.

## Layout

```
~/.openagentic/cloud-secrets/
├── azure.env           # AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID
├── aws.env             # AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
├── gcp.env             # GOOGLE_APPLICATION_CREDENTIALS path, GCP_PROJECT
└── gcp-sa.json         # GCP service account JSON key (referenced by GOOGLE_APPLICATION_CREDENTIALS)
```

## How the MCP containers consume them

`docker-compose.yml` mounts the secrets directory read-only into the three cloud MCPs:

```yaml
services:
  oap-azure-mcp:
    volumes:
      - ~/.openagentic/cloud-secrets:/run/secrets/cloud:ro
    env_file:
      - ~/.openagentic/cloud-secrets/azure.env

  oap-aws-mcp:
    volumes:
      - ~/.openagentic/cloud-secrets:/run/secrets/cloud:ro
    env_file:
      - ~/.openagentic/cloud-secrets/aws.env

  oap-gcp-mcp:
    volumes:
      - ~/.openagentic/cloud-secrets:/run/secrets/cloud:ro
    env_file:
      - ~/.openagentic/cloud-secrets/gcp.env
    environment:
      GOOGLE_APPLICATION_CREDENTIALS: /run/secrets/cloud/gcp-sa.json
```

(The wizard writes the correct mounts when you launch via `install.sh`; the manual compose above is what to replicate if you're wiring things by hand.)

## Rotation

- **Azure** — `az ad app credential reset --id $APP_ID --years 2` and replace `AZURE_CLIENT_SECRET` in `azure.env`. The old secret stays valid until you `az ad app credential delete`.
- **AWS** — `aws iam create-access-key --user-name openagentic-mcp`, rotate in `aws.env`, then `aws iam delete-access-key --user-name openagentic-mcp --access-key-id <old>`.
- **GCP** — `gcloud iam service-accounts keys create …` → replace `gcp-sa.json` → `gcloud iam service-accounts keys delete <old>`.

## Never do this

- `git add .env` or `git add cloud-secrets/` — both are gitignored for a reason; don't `--force` past it.
- Paste any of these values into LLM prompts or docs.
- Share keys across users. Create a separate App Reg / IAM user / SA per openagentic instance.
