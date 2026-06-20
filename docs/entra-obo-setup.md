# Entra IdP + Cross-Cloud OBO — Setup Guide

How to make the cloud MCP tools (azure / aws / gcp) **run as the signed-in user**
instead of a shared service principal. A user logs in with Microsoft Entra; the
platform exchanges their token for short-lived, per-user cloud credentials
(Azure On-Behalf-Of, AWS web-identity, GCP Workload Identity Federation) so every
cloud action is attributed to *that user* with *their* permissions.

> **OFF BY DEFAULT.** This whole path is enterprise/advanced and inert unless
> `AUTH_PROVIDER=azure-ad`. A default install is local-auth only — nothing here runs.

## Identity model per cloud

| Cloud | Mechanism | Runs as |
|---|---|---|
| **Azure** | On-Behalf-Of (MSAL `acquireTokenOnBehalfOf`) → ARM token | the user (true delegated identity) |
| **AWS** | `AssumeRoleWithWebIdentity` against an IAM OIDC provider trusting Entra | the user (STS session named for them) |
| **GCP** | Workload Identity Federation → impersonate a read-only SA | the SA, with the user as the federated subject (audit records the subject) |

All three trust **one** Entra app registration and **one** issuer:
`https://login.microsoftonline.com/<TENANT_ID>/v2.0`.

---

## Prerequisites

- An Entra tenant where you're Global Admin (to create the app reg + grant admin consent).
- A **dedicated dev** AWS account and GCP project — **never** point this at production. Every RBAC grant below is read-only and scoped to the dev sub/account/project.
- A test user (e.g. `tester@<tenant>.onmicrosoft.com`) with **no MFA** if you want to mint tokens programmatically (ROPC) for testing.
- `az`, `aws`, `gcloud` CLIs authenticated.

Set these once:

```bash
TENANT_ID=<entra-tenant-guid>
AZURE_SUB_ID=<dev-subscription-guid>          # RBAC target — dev only
AWS_ACCOUNT_ID=<dev-aws-account>
GCP_PROJECT=<dev-gcp-project>
TESTER_UPN=tester@<tenant>.onmicrosoft.com
TESTER_OID=<tester-object-id>                 # az ad user show --id $TESTER_UPN --query id -o tsv
```

---

## Step 1 — Azure app registration (login + OBO)

```bash
# app reg (single-tenant) with the platform's redirect URIs
APP_ID=$(az ad app create --display-name openagentic-obo \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris http://localhost:8080/api/auth/microsoft/callback \
                      https://<your-host>/api/auth/microsoft/callback \
  --query appId -o tsv)
az ad sp create --id "$APP_ID"

# expose api://<APP_ID>/access_as_user  — THIS is the audience the user's token must carry
az ad app update --id "$APP_ID" --identifier-uris "api://$APP_ID"
#   (add the oauth2PermissionScope 'access_as_user' via Graph PATCH /applications/{objId})

# delegated permissions: ARM user_impersonation (for OBO→ARM) + Graph User.Read, then admin-consent
az ad app permission add --id "$APP_ID" --api 797f4846-ba00-4fd7-ba43-dac1f8f63013 \
  --api-permissions 41094075-9dad-400e-a0bd-54e686782033=Scope          # Azure Service Management user_impersonation
az ad app permission add --id "$APP_ID" --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope          # Graph User.Read
az ad app permission admin-consent --id "$APP_ID"                       # MUST succeed (Global Admin)

# client secret (store it in a secret manager / the gitignored env — never commit)
CLIENT_SECRET=$(az ad app credential reset --id "$APP_ID" --years 1 --query password -o tsv)

# ⚠️ CRITICAL: emit v2.0 ACCESS tokens. Default null = v1.0 (issuer sts.windows.net),
# which mismatches the v2.0 id-token issuer and breaks AWS/GCP federation consistency.
APP_OBJ_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$APP_OBJ_ID" \
  --headers 'Content-Type=application/json' --body '{"api":{"requestedAccessTokenVersion":2}}'

# group + assign the tester Reader on the DEV SUB ONLY
GROUP_OID=$(az ad group create --display-name openagentic-testers --mail-nickname openagentic-testers --query id -o tsv)
az ad group member add --group "$GROUP_OID" --member-id "$TESTER_OID"
az role assignment create --assignee-object-id "$TESTER_OID" --assignee-principal-type User \
  --role acdd72a7-3385-48ef-bd42-f606fba81ae7 --scope "/subscriptions/$AZURE_SUB_ID"   # Reader, dev sub only
```

### Decode the tester's real `sub` (REQUIRED before AWS + GCP)

The AWS trust and GCP WIF both match the token's `sub`. **Entra `sub` is a
*pairwise* pseudonymous id (unique per user **and** app) — it is NOT the user's
`oid`.** You must read the real value from an actual token.

```bash
# ROPC mint (test user, no MFA). NOTE: when an app requests a token for ITSELF the
# resource must be the GUID form `$APP_ID/.default`, NOT `api://$APP_ID/.default`
# (else AADSTS90009). If the account was admin-created, clear forceChangePassword first.
RESP=$(curl -s -X POST "https://login.microsoftonline.com/$TENANT_ID/oauth2/v2.0/token" \
  -d grant_type=password -d "client_id=$APP_ID" --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode "scope=openid $APP_ID/.default" \
  --data-urlencode "username=$TESTER_UPN" --data-urlencode "password=<tester-password>")
# decode access_token payload → sub/aud/iss. aud must == $APP_ID, iss must end /v2.0
TOKEN_SUB=<the sub claim>     # e.g. lpyaDMAW...   ← pin THIS in AWS + GCP, not the oid
```

---

## Step 2 — AWS (web-identity federation)

```bash
OIDC_HOST="login.microsoftonline.com/$TENANT_ID/v2.0"
OIDC_ARN="arn:aws:iam::$AWS_ACCOUNT_ID:oidc-provider/$OIDC_HOST"

# OIDC provider trusting Entra (skip if it already exists; just add the audience)
THUMB=$(echo | openssl s_client -servername login.microsoftonline.com \
  -connect login.microsoftonline.com:443 2>/dev/null | openssl x509 -fingerprint -sha1 -noout | sed 's/.*=//;s/://g')
aws iam create-open-id-connect-provider --url "https://$OIDC_HOST" \
  --client-id-list "$APP_ID" --thumbprint-list "$THUMB"

# role with web-identity trust — aud=APP_ID, sub=the REAL pairwise sub (not oid)
cat > trust.json <<EOF
{ "Version":"2012-10-17","Statement":[{"Effect":"Allow",
  "Principal":{"Federated":"$OIDC_ARN"},"Action":"sts:AssumeRoleWithWebIdentity",
  "Condition":{"StringEquals":{
    "$OIDC_HOST:aud":"$APP_ID",
    "$OIDC_HOST:sub":"$TOKEN_SUB" }}}]}
EOF
aws iam create-role --role-name OpenAgenticOBORole \
  --assume-role-policy-document file://trust.json --max-session-duration 3600
aws iam attach-role-policy --role-name OpenAgenticOBORole \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess           # dev account only

AWS_OBO_ROLE_ARN="arn:aws:iam::$AWS_ACCOUNT_ID:role/OpenAgenticOBORole"
```

> The platform feeds the Entra **id_token** (aud = `$APP_ID`) to
> `AssumeRoleWithWebIdentity` — *not* the access token. Verify:
> `aws sts assume-role-with-web-identity --role-arn $AWS_OBO_ROLE_ARN --role-session-name t --web-identity-token <id_token>`
> → returns `assumed-role/OpenAgenticOBORole/t`.

---

## Step 3 — GCP (Workload Identity Federation)

```bash
PROJNUM=$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')
gcloud services enable iam.googleapis.com sts.googleapis.com iamcredentials.googleapis.com

gcloud iam workload-identity-pools create oa-entra --location=global
gcloud iam workload-identity-pools providers create-oidc entra --location=global \
  --workload-identity-pool=oa-entra \
  --issuer-uri="https://login.microsoftonline.com/$TENANT_ID/v2.0" \
  --allowed-audiences="$APP_ID,api://$APP_ID" \
  --attribute-mapping="google.subject=assertion.sub,attribute.tid=assertion.tid" \
  --attribute-condition="assertion.tid=='$TENANT_ID'"            # pin the tenant

gcloud iam service-accounts create oa-readonly --display-name="OpenAgentic WIF (read-only)"
SA_EMAIL="oa-readonly@$GCP_PROJECT.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
  --member="serviceAccount:$SA_EMAIL" --role="roles/viewer"      # dev project only

# ⚠️ CRITICAL: for ONE subject the member is principal:// (SINGULAR).
# principalSet:// is for a SET (e.g. .../* or .../attribute.x/y) and is REJECTED for a bare subject.
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principal://iam.googleapis.com/projects/$PROJNUM/locations/global/workloadIdentityPools/oa-entra/subject/$TOKEN_SUB"

GCP_WORKLOAD_IDENTITY_AUDIENCE="//iam.googleapis.com/projects/$PROJNUM/locations/global/workloadIdentityPools/oa-entra/providers/entra"
GCP_WORKLOAD_IDENTITY_SA_EMAIL="$SA_EMAIL"
```

> WIF/IAM bindings take **30–90s** to propagate — the first impersonation can fail
> with `iam.serviceAccounts.getAccessToken denied` before it does. Wait and retry.

---

## Step 4 — Platform env

Supply these (compose: `.env` or `cloud-secrets/azure-obo.env`; helm: `values` +
the chart's Secret). Both name families are needed: `AZURE_AD_*` for the login/
validator, `AZURE_*` for the OBO MSAL client.

```bash
AUTH_PROVIDER=azure-ad
AZURE_AD_TENANT_ID=$TENANT_ID   ; AZURE_TENANT_ID=$TENANT_ID
AZURE_AD_CLIENT_ID=$APP_ID      ; AZURE_CLIENT_ID=$APP_ID
AZURE_AD_CLIENT_SECRET=$CLIENT_SECRET ; AZURE_CLIENT_SECRET=$CLIENT_SECRET
AZURE_AD_REDIRECT_URI=https://<your-host>/api/auth/microsoft/callback
AZURE_AD_AUTHORIZED_GROUPS=$GROUP_OID
AZURE_SUBSCRIPTION_ID=$AZURE_SUB_ID
AWS_OBO_ROLE_ARN=$AWS_OBO_ROLE_ARN ; AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID ; AWS_REGION=us-east-1
GCP_WORKLOAD_IDENTITY_AUDIENCE=$GCP_WORKLOAD_IDENTITY_AUDIENCE
GCP_WORKLOAD_IDENTITY_SA_EMAIL=$GCP_WORKLOAD_IDENTITY_SA_EMAIL
GCP_PROJECT_ID=$GCP_PROJECT
# hardening so a failed OBO errors cleanly instead of silently using a shared principal:
MCP_READ_ONLY_MODE=true
AWS_OBO_FALLBACK_TO_SERVICE=false
```

The code side is already in the repo (off-by-default): the Entra validator
(`auth/azureADAuth.ts`), the OBO broker + token services (`services/CredentialBroker.ts`,
`AzureOBOService.ts`, `AzureTokenService.ts`, `GCPCredentialService.ts`,
`llm-providers/AWSOIDCFederation.ts`), the per-user pass-through that injects
brokered creds into the tool call's `arguments.meta` (`services/buildChatV2Deps.ts`),
and the cloud MCP consumers that read `brokeredAzure/brokeredAws/brokeredGcp`.

---

## Verify (the three chains)

- **Azure** — OBO-exchange the tester's token (`grant_type=jwt-bearer`,
  `scope=https://management.azure.com/.default`, `requested_token_use=on_behalf_of`)
  → call ARM `…/resourcegroups` → lists the dev sub's groups as the user.
- **AWS** — `assume-role-with-web-identity` with the tester's **id_token** → STS creds.
- **GCP** — STS token-exchange (`sts.googleapis.com/v1/token`, the access token as
  `subject_token`) → `generateAccessToken` on the SA → read a project.

---

## Gotchas that cost real time

1. **`sub` ≠ `oid`.** Entra `sub` is pairwise per (user, app). Pin the real decoded `sub` in AWS/GCP trust, never the object id.
2. **v1.0 vs v2.0 issuer.** Without `requestedAccessTokenVersion=2`, access tokens are v1.0 (`sts.windows.net/<tenant>/`) while id tokens are v2.0 (`login.microsoftonline.com/<tenant>/v2.0`) — two issuers. Set it to 2 so everything is one v2.0 issuer.
3. **`principal://` vs `principalSet://`.** Singular for one subject; the Set form is rejected for a bare subject.
4. **ROPC self-token.** Requesting a token for your own app needs the GUID scope `$APP_ID/.default`, not `api://$APP_ID/.default` (AADSTS90009).
5. **Admin-created accounts** carry force-change-password — clear it (`forceChangePasswordNextSignIn:false`) or ROPC fails with AADSTS50126.
6. **WIF propagation** is 30–90s; retry the first impersonation.
7. **Don't let OBO fall back to the SP.** Set `AWS_OBO_FALLBACK_TO_SERVICE=false` + `MCP_READ_ONLY_MODE=true` so a failed run-as-user is a loud error, not a silent shared-principal success.

## Teardown

```bash
az ad app delete --id $APP_ID
az ad group delete --group $GROUP_OID
az role assignment delete --assignee $TESTER_OID --scope /subscriptions/$AZURE_SUB_ID --role Reader
aws iam detach-role-policy --role-name OpenAgenticOBORole --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
aws iam delete-role --role-name OpenAgenticOBORole
aws iam remove-client-id-from-open-id-connect-provider --open-id-connect-provider-arn $OIDC_ARN --client-id $APP_ID
gcloud iam service-accounts delete $SA_EMAIL
gcloud iam workload-identity-pools providers delete entra --location=global --workload-identity-pool=oa-entra
gcloud iam workload-identity-pools delete oa-entra --location=global   # 30-day soft-delete
```
