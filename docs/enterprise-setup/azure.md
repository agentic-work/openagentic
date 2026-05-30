# Azure — App Registration + Reader role

What the Azure MCP needs to introspect your tenant:

1. An **App Registration** (client credentials flow — service principal auth)
2. A **Service Principal** backing the app reg
3. **Role assignments** on whatever subscriptions you want the MCP to read
4. Optionally: a **security group** that members of Entra ID can join for SSO-based access, plus the Enterprise App config to make the openagentic UI usable with Microsoft sign-in

For the reference deployment we provisioned everything to the your tenant against the `<YOUR_AZURE_SUBSCRIPTION_NAME>` subscription only — your environment/prod subscriptions were explicitly not touched.

## Preconditions

```bash
az login --tenant <your-tenant-id>
az account set --subscription <your-subscription-id>
az account show --query "{tenant:tenantId, sub:id, subName:name}" -o tsv
```

Write these two values down — the rest of the doc refers to them as `$TENANT` and `$SUB`.

## 1. Security group (for SSO role assignment later)

```bash
az ad group create \
  --display-name "openagentic-admins" \
  --mail-nickname "openagentic-admins" \
  --query "{id:id, name:displayName}" -o json
# → note group id as $GROUP_ID
```

## 2. App Registration

```bash
az ad app create \
  --display-name "openagentic-test" \
  --sign-in-audience "AzureADMyOrg" \
  --web-redirect-uris "http://localhost:8080/api/auth/microsoft/callback" \
  --enable-id-token-issuance true \
  --enable-access-token-issuance true
# → note appId as $APP_ID
```

If the openagentic UI will live at a different URL, add more redirect URIs:

```bash
az ad app update --id "$APP_ID" --web-redirect-uris \
  "http://localhost:8080/api/auth/microsoft/callback" \
  "https://openagentic.yourcompany.com/api/auth/microsoft/callback"
```

## 3. Client secret

```bash
az ad app credential reset --id "$APP_ID" --years 2 \
  --query "{password:password, appId:appId, tenant:tenant}" -o json
# → write password somewhere safe (you'll never see it again)
```

We pipe this straight into `~/.openagentic/cloud-secrets/azure.env`.

## 4. Service Principal for the App

```bash
az ad sp create --id "$APP_ID" \
  --query "{id:id, appId:appId}" -o json
# → note SP object id as $SP_OBJ_ID
#
# Azure can take ~10s to propagate the new SP before role assignment works:
sleep 10
```

## 5. Reader on the target subscription

```bash
az role assignment create \
  --assignee-object-id "$SP_OBJ_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Reader" \
  --scope "/subscriptions/$SUB"
```

For broader scope add more assignments (e.g. `roles/Contributor` on a resource group). Keep the SP away from production subscriptions.

## 6. Assign the `mcp-tester` user to the admin group (optional)

```bash
MCP_TESTER_ID=$(az ad user list \
  --query "[?contains(userPrincipalName,'mcp-tester')].id | [0]" -o tsv)
az ad group member add --group "$GROUP_ID" --member-id "$MCP_TESTER_ID"
```

## 7. Write secrets file

```bash
cat > ~/.openagentic/cloud-secrets/azure.env <<EOF
AZURE_TENANT_ID=$TENANT
AZURE_SUBSCRIPTION_ID=$SUB
AZURE_CLIENT_ID=$APP_ID
AZURE_CLIENT_SECRET=<paste from step 3>
AZURE_ADMIN_GROUP_ID=$GROUP_ID
AZURE_SP_OBJECT_ID=$SP_OBJ_ID
EOF
chmod 600 ~/.openagentic/cloud-secrets/azure.env
```

## Reference instance values (template)

| Key | Value |
|---|---|
| Tenant | `<YOUR_AZURE_TENANT_ID>` |
| Subscription | `<YOUR_AZURE_SUBSCRIPTION_ID>` (`<YOUR_AZURE_SUBSCRIPTION_NAME>`) |
| App Registration | `openagentic-readonly` — `<YOUR_APP_CLIENT_ID>` |
| App object id | `<YOUR_APP_OBJECT_ID>` |
| Service Principal object id | `<YOUR_SP_OBJECT_ID>` |
| Admin group | `openagentic-admins` — `<YOUR_GROUP_OBJECT_ID>` |
| Reader role assignment | `/subscriptions/<SUB_ID>/providers/Microsoft.Authorization/roleAssignments/<ASSIGNMENT_GUID>` |
| Secret | rotating 2yr, see `~/.openagentic/cloud-secrets/azure.env` |

## SSO wiring (Microsoft sign-in into openagentic)

The openagentic UI already supports Entra ID sign-in — turn it on by setting these in `.env`:

```env
AUTH_PROVIDER=all                       # or azure-ad for Microsoft-only
MICROSOFT_LOGIN_ENABLED=true
AZURE_AD_TENANT_ID=<your $TENANT>
AZURE_AD_CLIENT_ID=<your $APP_ID>
AZURE_AD_CLIENT_SECRET=<from step 3>
```

Then restart the `ui` and `api` containers. Users in the `openagentic-admins` group will sign in via Entra; other tenant users will be rejected unless you either:

- Make the App Registration multi-tenant (change sign-in-audience), or
- Add them to the `openagentic-admins` group.

## Teardown

```bash
az role assignment delete --assignee-object-id "$SP_OBJ_ID" --role Reader --scope "/subscriptions/$SUB"
az ad sp delete --id "$APP_ID"
az ad app delete --id "$APP_ID"
az ad group delete --group "$GROUP_ID"
rm ~/.openagentic/cloud-secrets/azure.env
```
