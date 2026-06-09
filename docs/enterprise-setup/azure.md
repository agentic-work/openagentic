# Azure — App Registration + Reader role

What the Azure MCP needs to introspect your tenant:

1. An **App Registration** (client credentials flow — service principal auth)
2. A **Service Principal** backing the app reg
3. **Role assignments** on whatever subscriptions you want the MCP to read

The same Service Principal also powers the SP-based Azure **cost dashboard** in the admin console. (openagentic auth is local username/password only — there is no Microsoft/Entra user sign-in.)

For the reference deployment we provisioned everything to your tenant against the `<YOUR_AZURE_SUBSCRIPTION_NAME>` subscription only — your environment/prod subscriptions were explicitly not touched.

## Preconditions

```bash
az login --tenant <your-tenant-id>
az account set --subscription <your-subscription-id>
az account show --query "{tenant:tenantId, sub:id, subName:name}" -o tsv
```

Write these two values down — the rest of the doc refers to them as `$TENANT` and `$SUB`.

## 1. App Registration

```bash
az ad app create \
  --display-name "openagentic-readonly" \
  --sign-in-audience "AzureADMyOrg"
# → note appId as $APP_ID
```

## 2. Client secret

```bash
az ad app credential reset --id "$APP_ID" --years 2 \
  --query "{password:password, appId:appId, tenant:tenant}" -o json
# → write password somewhere safe (you'll never see it again)
```

We pipe this straight into `~/.openagentic/cloud-secrets/azure.env`.

## 3. Service Principal for the App

```bash
az ad sp create --id "$APP_ID" \
  --query "{id:id, appId:appId}" -o json
# → note SP object id as $SP_OBJ_ID
#
# Azure can take ~10s to propagate the new SP before role assignment works:
sleep 10
```

## 4. Reader on the target subscription

```bash
az role assignment create \
  --assignee-object-id "$SP_OBJ_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Reader" \
  --scope "/subscriptions/$SUB"
```

For broader scope add more assignments (e.g. `roles/Contributor` on a resource group). Keep the SP away from production subscriptions.

## 5. Write secrets file

```bash
cat > ~/.openagentic/cloud-secrets/azure.env <<EOF
AZURE_TENANT_ID=$TENANT
AZURE_SUBSCRIPTION_ID=$SUB
AZURE_CLIENT_ID=$APP_ID
AZURE_CLIENT_SECRET=<paste from the client-secret step>
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
| Reader role assignment | `/subscriptions/<SUB_ID>/providers/Microsoft.Authorization/roleAssignments/<ASSIGNMENT_GUID>` |
| Secret | rotating 2yr, see `~/.openagentic/cloud-secrets/azure.env` |

## Teardown

```bash
az role assignment delete --assignee-object-id "$SP_OBJ_ID" --role Reader --scope "/subscriptions/$SUB"
az ad sp delete --id "$APP_ID"
az ad app delete --id "$APP_ID"
rm ~/.openagentic/cloud-secrets/azure.env
```
