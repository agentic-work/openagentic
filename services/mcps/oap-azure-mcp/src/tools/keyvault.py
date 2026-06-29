"""Azure MCP — keyvault tools.

Key Vault and secret tools.
"""

import os
import sys
import json
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, List

# Make the package root importable so `from _core import *` resolves both
# under `python -m src.server` (Docker) and `import server` (tests).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _core import *  # noqa: F401,F403

__all__ = [
    'azure_list_keyvaults',
    'azure_list_secrets',
    'azure_get_secret',
    'azure_set_secret',
    'azure_create_key_vault',
]


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my keyvaults", "show me keyvaults", "what keyvaults do i have"],
        "testFixture": None,
    },
)
async def azure_list_keyvaults(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Key Vaults.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = KeyVaultManagementClient(credential, sub_id)

        if resource_group:
            vaults = list(client.vaults.list_by_resource_group(resource_group))
        else:
            vaults = list(client.vaults.list_by_subscription())

        return {
            "success": True,
            "count": len(vaults),
            "key_vaults": [
                {
                    "name": v.name,
                    "location": v.location,
                    "resource_group": v.id.split('/')[4] if v.id else None,
                    "vault_uri": v.properties.vault_uri if v.properties else None,
                    "sku": v.properties.sku.name if v.properties and v.properties.sku else None,
                    "soft_delete_enabled": v.properties.enable_soft_delete if v.properties else None,
                    "tags": v.tags or {}
                }
                for v in vaults
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my secrets", "show me secrets", "what secrets do i have"],
        "testFixture": None,
    },
)
async def azure_list_secrets(
    vault_name: str,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List secrets in a Key Vault (names only, not values).

    Args:
        vault_name: Key Vault name (without .vault.azure.net)
    """
    try:
        credential, user_info = require_user_token(meta, "keyvaultAccessToken")

        vault_url = f"https://{vault_name}.vault.azure.net"
        client = SecretClient(vault_url=vault_url, credential=credential)

        secrets = list(client.list_properties_of_secrets())

        return {
            "success": True,
            "vault_name": vault_name,
            "count": len(secrets),
            "secrets": [
                {
                    "name": s.name,
                    "enabled": s.enabled,
                    "created_on": s.created_on.isoformat() if s.created_on else None,
                    "updated_on": s.updated_on.isoformat() if s.updated_on else None,
                    "content_type": s.content_type
                }
                for s in secrets
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get secret details", "show me one secret"],
        "testFixture": None,
    },
)
async def azure_get_secret(
    vault_name: str,
    secret_name: str,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get a secret value from Key Vault.

    Args:
        vault_name: Key Vault name (without .vault.azure.net)
        secret_name: Name of the secret
    """
    try:
        credential, user_info = require_user_token(meta, "keyvaultAccessToken")

        vault_url = f"https://{vault_name}.vault.azure.net"
        client = SecretClient(vault_url=vault_url, credential=credential)

        secret = client.get_secret(secret_name)

        return {
            "success": True,
            "vault_name": vault_name,
            "secret": {
                "name": secret.name,
                "value": secret.value,
                "content_type": secret.properties.content_type,
                "enabled": secret.properties.enabled,
                "created_on": secret.properties.created_on.isoformat() if secret.properties.created_on else None,
                "updated_on": secret.properties.updated_on.isoformat() if secret.properties.updated_on else None
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_set_secret(
    vault_name: str,
    secret_name: str,
    secret_value: str,
    content_type: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Set a secret value in Key Vault.

    Args:
        vault_name: Key Vault name (without .vault.azure.net)
        secret_name: Name of the secret
        secret_value: Value to set
        content_type: Optional content type (e.g., 'text/plain', 'application/json')
    """
    try:
        credential, user_info = require_user_token(meta, "keyvaultAccessToken")

        vault_url = f"https://{vault_name}.vault.azure.net"
        client = SecretClient(vault_url=vault_url, credential=credential)

        secret = client.set_secret(secret_name, secret_value, content_type=content_type)

        return {
            "success": True,
            "vault_name": vault_name,
            "message": f"Secret '{secret_name}' set successfully",
            "secret": {
                "name": secret.name,
                "version": secret.properties.version,
                "created_on": secret.properties.created_on.isoformat() if secret.properties.created_on else None
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_key_vault(
    name: str,
    resource_group: str,
    location: str,
    tenant_id: Optional[str] = None,
    sku: str = "standard",
    enable_rbac_authorization: bool = True,
    soft_delete_retention_days: int = 7,
    purge_protection: bool = False,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Key Vault for storing secrets, keys, and certificates.

    Vault names must be globally unique, 3-24 characters, alphanumeric and
    hyphens (no underscores). RBAC authorization (default true) is the modern
    auth model — set to False only if you specifically need access policies.

    Args:
        name: Vault name (globally unique, 3-24 chars, alphanumeric+hyphens)
        resource_group: Resource group
        location: Azure region
        tenant_id: Azure AD tenant ID (defaults to AZURE_TENANT_ID env var)
        sku: 'standard' (cheap) or 'premium' (HSM-backed keys)
        enable_rbac_authorization: True for RBAC (modern), False for access policies
        soft_delete_retention_days: 7-90 days (default 7)
        purge_protection: True to prevent permanent deletion (default False)
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        tenant = tenant_id or os.environ.get("AZURE_TENANT_ID", "")
        if not tenant:
            return {"success": False, "error": "tenant_id not provided and AZURE_TENANT_ID env var not set"}

        client = KeyVaultManagementClient(credential, sub_id)
        params: Dict[str, Any] = {
            "location": location,
            "tags": tags or {},
            "properties": {
                "tenant_id": tenant,
                "sku": {"family": "A", "name": sku},
                "enable_rbac_authorization": enable_rbac_authorization,
                "enable_soft_delete": True,
                "soft_delete_retention_in_days": soft_delete_retention_days,
                "enable_purge_protection": purge_protection or None,  # API quirk: only set if True
                "access_policies": [] if enable_rbac_authorization else None,
            },
        }
        poller = client.vaults.begin_create_or_update(
            resource_group_name=resource_group,
            vault_name=name,
            parameters=params,
        )
        vault = poller.result()
        return {
            "success": True,
            "key_vault": {
                "name": vault.name,
                "id": vault.id,
                "location": vault.location,
                "vault_uri": vault.properties.vault_uri if vault.properties else None,
                "rbac_enabled": vault.properties.enable_rbac_authorization if vault.properties else None,
                "tags": vault.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
