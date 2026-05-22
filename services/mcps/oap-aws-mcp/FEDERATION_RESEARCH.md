# Azure AD → IDC → AWS Federation: "user sees ALL their accounts"

Research deliverable 2026-05-12 — user ask: "research exactly how to setup actual
federation for Azure→sso→aws so users can see ALL of their account information
based on who they login as in az".

## TL;DR — what we have vs what's missing

| Layer | Setup state | What's working | What's missing for "see ALL accounts" |
|---|---|---|---|
| **Azure AD app reg** | ✓ in place | `api://392dc6aa-...` Application ID URI, `access_as_user` scope, `sub` claim emitted | nothing for federation; SCIM provisioning may not be on |
| **AWS Identity Center instance** | ✓ enabled (`ssoins-7223f59f5fe61fab`) | Org instance present | — |
| **Trusted Token Issuer (TTI)** | ✓ wired (`tti-e458d428-...`) | TTI maps AAD `sub` → IDC `userName` | depends on IDC user having a matching userName |
| **IDC Application + JWT Bearer grant** | ✓ wired (`apl-7223b5b5...`) | App accepts AAD JWTs scoped to `api://<client-id>` | — |
| **IDC user provisioning** | partial | mcp-tester user exists | not all users provisioned; SCIM should be on |
| **Permission Sets** | **gap** | unknown — `OBO_SETUP.md` doesn't document any | **NEEDED**: at least one PermissionSet (e.g. `ReadOnlyAccess`) created in IDC |
| **AccountAssignments** | **gap** | unknown — never enumerated | **NEEDED**: assign the user(s) the PermissionSet on every target account |
| **Multi-account iteration in code** | **bug** | `server.py:549` picks `roles[0]` from first account with roles | **NEEDED**: iterate all accounts × all roles per user; return per-account creds |
| **Org-wide views (Cost Explorer)** | **gap** | runs in whatever single account the picked role is in | **NEEDED**: management-account PermissionSet with `ce:GetCostAndUsage` + `organizations:ListAccounts` for cross-account cost rollups |
| **Direct-OIDC fallback** | **security hole** | unconditionally falls back to shared `OpenAgenticOBORole` if IDC fails | **MUST RIP** per user 2026-05-12 |

## Canonical AWS-recommended pattern

```
Azure AD                            AWS Identity Center                          AWS Accounts
                                                                                 (Organization)

┌──────────┐                       ┌─────────────────┐                       ┌──────────────────┐
│ AD User  │  ① ID token (JWT,      │ Trusted Token   │   ④ create_token_    │  AccountAssignment│
│ logs in  │ ──── aud=app reg ──→  │ Issuer (TTI)    │ with_iam (JWT bearer) │  - User           │
└──────────┘                       │ - issuer URL    │ ────────────────────→ │  - PermissionSet  │
       │                           │ - claim=sub     │                       │  - AccountId      │
       │                           │ - map=userName  │                       └─────────┬─────────┘
       │                           └────────┬────────┘                                 │
       │                                    │                                          │
       │   ② SCIM provision                 │   ⑤ list_accounts /                      │
       │   ────────────────────→            │   list_account_roles /                   │
       │                                    │   get_role_credentials                   │
       │                           ┌────────▼────────┐                                 │
       │                           │ Identity Store  │                                 │
       │                           │ - userName=upn  │                                 │
       │                           │ - groups        │                                 │
       │                           └────────┬────────┘                                 │
       │                                    │                                          │
       │                           ┌────────▼────────┐                       ┌─────────▼─────────┐
       │                           │ PermissionSet   │   ⑥ AssumeRole         │  Per-account IAM   │
       │                           │ - inline policy │ ────────────────────→ │  role (created by │
       │                           │ - managed       │                       │  permission set)   │
       │                           │   policies      │                       │  - short-lived    │
       │                           └─────────────────┘                       │    creds          │
       │                                                                     └─────────┬─────────┘
       │                                                                               │
       └─────────────────────────────────────────────────────────────────────────────→ AWS APIs
                                                                              ⑦ caller-identity =
                                                                                 AD user's IDC user
```

**Key insight**: A user "sees ALL their accounts" because:
1. **The same IDC user** has multiple AccountAssignments — one per account they should see.
2. Each AccountAssignment = (user, permission_set, account_id) triple.
3. PermissionSet defines what they can do (e.g. `ReadOnlyAccess` for "see everything").
4. The IDC `sso.list_accounts()` API enumerates ALL accounts where that user has at least one AccountAssignment.

For our oap-aws-mcp:
- **The IDC enumeration code (`server.py:519-580`) already calls `sso.list_accounts`** — it correctly returns ALL the user's accounts.
- **The bug**: it picks `roles[0]` from the FIRST account with roles, returns one set of creds. For per-account API calls, the code needs to: enumerate all (account, role) pairs, then for each per-tool invocation, pick the right (account, role) for that call — OR get separate creds for each account and let the tool decide.

## Setup runbook — close the gaps

### Step A — Create a baseline ReadOnly PermissionSet

```bash
INSTANCE_ARN="arn:aws:sso:::instance/ssoins-7223f59f5fe61fab"
REGION=us-east-1

# Create a permission set for read-only operators.
aws sso-admin create-permission-set \
  --instance-arn "$INSTANCE_ARN" \
  --name "OpenAgenticReadOnly" \
  --description "Read-only across all linked accounts for OpenAgentic chat users" \
  --session-duration "PT8H" \
  --region "$REGION"
# → returns PermissionSetArn (save as PS_ARN)

# Attach AWS-managed ReadOnlyAccess policy.
aws sso-admin attach-managed-policy-to-permission-set \
  --instance-arn "$INSTANCE_ARN" \
  --permission-set-arn "$PS_ARN" \
  --managed-policy-arn "arn:aws:iam::aws:policy/ReadOnlyAccess" \
  --region "$REGION"

# Optional: scope down further with an inline policy. Example below denies
# everything outside Bedrock + Cost Explorer + STS reads.
aws sso-admin put-inline-policy-to-permission-set \
  --instance-arn "$INSTANCE_ARN" \
  --permission-set-arn "$PS_ARN" \
  --inline-policy '{
    "Version": "2012-10-17",
    "Statement": [
      {"Effect":"Allow","Action":["bedrock:List*","bedrock:Get*","bedrock:Describe*"],"Resource":"*"},
      {"Effect":"Allow","Action":["ce:Get*","ce:Describe*","ce:List*"],"Resource":"*"},
      {"Effect":"Allow","Action":["organizations:ListAccounts","organizations:DescribeAccount"],"Resource":"*"},
      {"Effect":"Allow","Action":["sts:GetCallerIdentity"],"Resource":"*"}
    ]
  }' \
  --region "$REGION"
```

### Step B — Assign the PermissionSet to every account the user should see

```bash
# Get the user's PrincipalId from the identity store.
USER_PRINCIPAL_ID=$(aws identitystore get-user-id \
  --identity-store-id d-906625c867 \
  --alternate-identifier '{"UniqueAttribute":{"AttributePath":"userName","AttributeValue":"mcp-tester@openagentic.local"}}' \
  --region "$REGION" --query 'UserId' --output text)

# Enumerate accounts in the Organization (run from management account).
aws organizations list-accounts --region "$REGION" \
  --query 'Accounts[?Status==`ACTIVE`].Id' --output text \
  | tr '\t' '\n' \
  | while read ACCOUNT_ID; do
      aws sso-admin create-account-assignment \
        --instance-arn "$INSTANCE_ARN" \
        --target-id "$ACCOUNT_ID" \
        --target-type AWS_ACCOUNT \
        --permission-set-arn "$PS_ARN" \
        --principal-type USER \
        --principal-id "$USER_PRINCIPAL_ID" \
        --region "$REGION" >/dev/null
      echo "Assigned $USER_PRINCIPAL_ID → $ACCOUNT_ID"
    done
```

For groups (preferred — assign to a group once, add users via SCIM):

```bash
GROUP_ID=$(aws identitystore create-group \
  --identity-store-id d-906625c867 \
  --display-name "OpenAgentic-Operators-ReadOnly" \
  --description "Read-only access via OpenAgentic chat across all accounts" \
  --region "$REGION" --query 'GroupId' --output text)

# Assign group to each account
aws organizations list-accounts --region "$REGION" \
  --query 'Accounts[?Status==`ACTIVE`].Id' --output text | tr '\t' '\n' \
  | while read ACCOUNT_ID; do
      aws sso-admin create-account-assignment \
        --instance-arn "$INSTANCE_ARN" \
        --target-id "$ACCOUNT_ID" \
        --target-type AWS_ACCOUNT \
        --permission-set-arn "$PS_ARN" \
        --principal-type GROUP \
        --principal-id "$GROUP_ID" \
        --region "$REGION" >/dev/null
    done

# Add user to group (or let SCIM do this from Azure AD)
aws identitystore create-group-membership \
  --identity-store-id d-906625c867 \
  --group-id "$GROUP_ID" \
  --member-id "UserId=$USER_PRINCIPAL_ID" \
  --region "$REGION"
```

### Step C — Verify enumeration matches expectation

```bash
# As mcp-tester (with their IC access token), should now list all accounts.
aws sso list-accounts \
  --access-token "$IC_ACCESS_TOKEN" \
  --region "$REGION"

# For each account, list available roles.
for acc in $(aws sso list-accounts --access-token "$IC_ACCESS_TOKEN" --region "$REGION" \
              --query 'accountList[].accountId' --output text); do
  echo "=== $acc ==="
  aws sso list-account-roles \
    --access-token "$IC_ACCESS_TOKEN" \
    --account-id "$acc" \
    --region "$REGION" \
    --query 'roleList[].roleName' --output text
done
```

### Step D — Optional: SCIM provisioning so Azure group ↔ IDC group stays in sync

In Azure portal → Enterprise Apps → OpenAgentic → Provisioning → Automatic:
- SCIM endpoint: `https://scim.<region>.amazonaws.com/<tenant-id>/scim/v2/`
- Bearer token: paste from IDC SCIM enable flow
- Configure attribute mappings:
  - `userPrincipalName` → IDC `userName` (must match TTI's `IdentityStoreAttributePath`)
  - `objectId` → IDC `externalId`
  - Groups → IDC groups

This eliminates manual `identitystore create-user` / `create-group-membership` for every new AD user.

## Code changes — close the multi-account gap in oap-aws-mcp

### Change 1 (SEV-0 security): rip the direct-OIDC shared-role fallback

Source: `services/mcps/oap-aws-mcp/server.py:412-413` and `:458-461`. Both call `_get_credentials_via_direct_oidc(...)` unconditionally when IDC fails. That gives ANY AD user creds for `OpenAgenticOBORole` regardless of IDC mapping. Per user 2026-05-12: "we cnat have a fallback".

Replace both call sites with `return None` and surface a clean denial to the model. Delete `_get_credentials_via_direct_oidc` and `AWS_OBO_FALLBACK_TO_SERVICE` plumbing entirely.

Regression-test stub already drafted: `tests/test_no_shared_role_fallback.sh`.

### Change 2: multi-account credential enumeration

Today `_get_credentials_via_identity_center` returns ONE credentials object. Refactor:

```python
def get_all_user_credentials() -> Dict[str, AccountCreds]:
    """
    Returns { account_id: AccountCreds } for EVERY account+role the IDC user
    has assigned. Empty dict when IDC mapping returns no accounts.
    """
    ic_access_token = _exchange_aad_for_ic_token(...)  # already exists
    accounts = sso.list_accounts(accessToken=ic_access_token)['accountList']
    out = {}
    for account in accounts:
        roles = sso.list_account_roles(
            accessToken=ic_access_token,
            accountId=account['accountId'],
        )['roleList']
        if not roles:
            continue
        # Convention: take the highest-privilege role IF multiple (alphabetical
        # for stability), OR let the user opt in via per-call param.
        chosen_role = sorted(roles, key=lambda r: r['roleName'])[0]
        creds = sso.get_role_credentials(
            accessToken=ic_access_token,
            accountId=account['accountId'],
            roleName=chosen_role['roleName'],
        )['roleCredentials']
        out[account['accountId']] = AccountCreds(
            account_id=account['accountId'],
            account_name=account.get('accountName'),
            role_name=chosen_role['roleName'],
            access_key_id=creds['accessKeyId'],
            secret_access_key=creds['secretAccessKey'],
            session_token=creds['sessionToken'],
            expires_at_ms=creds['expiration'],
        )
    return out
```

### Change 3: per-tool account targeting

Add an optional `account_id` parameter to every aws_* tool that touches account-scoped resources:

```python
@mcp.tool()
async def aws_cost_by_service(
    days: int = 30,
    group_by: str = 'SERVICE',
    account_id: Optional[str] = None,  # NEW
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    ...
    If `account_id` is omitted AND the user has multiple accounts via IDC,
    runs against the AWS Organization management account (org-wide CE view).
    If `account_id` is provided, runs against THAT account's creds — must be
    one the user has IDC-assigned. Returns 401 otherwise.
    """
```

For org-wide cost rollups, the call goes against the management account's Cost Explorer (which automatically aggregates linked accounts). For per-account drill-down, the model passes `account_id`.

### Change 4: surface the account/role list to the model

Add a new always-available T1-ish tool:

```python
@mcp.tool()
async def aws_my_accounts() -> Dict[str, Any]:
    """
    Lists all AWS accounts + roles the authenticated user has via Identity
    Center. Returns: { accounts: [{id, name, roles: [...]}], default_account_id }.
    Call this BEFORE asking the user for an account_id — the user expects
    the model to already know which accounts they can see.
    """
```

The model uses this once per session to learn the user's account topology,
then dispatches per-account `aws_*` tools with the right `account_id`.

## TDD plan

1. `tests/test_no_shared_role_fallback.sh` — source-grep regression (already drafted)
2. `tests/test_multi_account_enumeration.py` — pytest with `moto` mocking IDC + STS; assert `get_all_user_credentials()` returns N entries when N accounts assigned, empty dict when 0
3. `tests/test_aws_my_accounts_tool.py` — pytest; assert tool returns the enumerated list + matches what's in the IDC mock
4. `tests/test_per_account_aws_cost_by_service.py` — pytest; assert `account_id` param routes to the right per-account creds; assert 401 when user passes an unassigned account

## Verification (live, post-deploy)

1. Run `aws sso-admin list-account-assignments --instance-arn $INSTANCE_ARN --account-id $ACCOUNT_ID --permission-set-arn $PS_ARN` for every linked account; assert mcp-tester is present
2. Re-run the gpt-oss:20b sankey prompt; expect model to call `aws_my_accounts` first, then `aws_cost_by_service(account_id=<mgmt-account>)`, then `compose_visual(template='sankey')`. No more synth+boto3 detour.
3. Re-run CloudTrail check: every API call attribution should be the AD user's IDC user (`assumed-role/OpenAgenticReadOnly_xxx/mcp-tester@openagentic.local`), not `assumed-role/OpenAgenticOBORole/...`.

## Decision points to confirm before code-fix

1. **Default role choice** when a user has multiple permission sets on one account: alphabetical first (stable, predictable) vs. most-privileged (surprise-y). Recommendation: alphabetical + log a warning + accept per-call override.
2. **Org-wide vs per-account default**: when `account_id` omitted, use management account for org-aggregate views (current AWS-recommended pattern) — only works if the user has a permission set on the org root.
3. **Trusted Identity Propagation (TIP)**: out of scope here. Cost Explorer isn't TIP-aware. Bedrock isn't either. S3 access-grants + Athena + Lake Formation are. Defer until a TIP-aware tool lands.
4. **Per-account cost in chat-mode UI**: when the model emits per-account sankey, the UI should show the account name/id in the node label so users know which account each flow represents.
