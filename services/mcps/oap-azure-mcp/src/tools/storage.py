"""Azure MCP — storage tools.

Storage accounts, containers, and blobs.
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
    'azure_list_storage_accounts',
    'azure_list_containers',
    'azure_list_blobs',
    'azure_create_storage_account',
    'azure_storage_account_set_public_access',
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
        "goldenPrompts": ["list my storage accounts", "show me storage accounts", "what storage accounts do i have"],
        "testFixture": None,
    },
)
async def azure_list_storage_accounts(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List storage accounts.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = StorageManagementClient(credential, sub_id)

        if resource_group:
            accounts = list(client.storage_accounts.list_by_resource_group(resource_group))
        else:
            accounts = list(client.storage_accounts.list())

        return {
            "success": True,
            "count": len(accounts),
            "storage_accounts": [
                {
                    "name": sa.name,
                    "location": sa.location,
                    "resource_group": sa.id.split('/')[4] if sa.id else None,
                    "kind": sa.kind.value if sa.kind else None,
                    "sku": sa.sku.name if sa.sku else None,
                    "access_tier": sa.access_tier.value if sa.access_tier else None,
                    "provisioning_state": sa.provisioning_state.value if sa.provisioning_state else None,
                    "primary_endpoints": {
                        "blob": sa.primary_endpoints.blob if sa.primary_endpoints else None,
                        "file": sa.primary_endpoints.file if sa.primary_endpoints else None,
                    } if sa.primary_endpoints else None,
                    "tags": sa.tags or {}
                }
                for sa in accounts
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
        "goldenPrompts": ["list my containers", "show me containers", "what containers do i have"],
        "testFixture": None,
    },
)
async def azure_list_containers(
    storage_account: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List blob containers in a storage account.

    Args:
        storage_account: Storage account name
        resource_group: Resource group containing the storage account
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta, "storageAccessToken")
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        # Use data plane with the service principal credential
        account_url = f"https://{storage_account}.blob.core.windows.net"
        blob_client = BlobServiceClient(account_url=account_url, credential=credential)

        containers = list(blob_client.list_containers())

        return {
            "success": True,
            "storage_account": storage_account,
            "count": len(containers),
            "containers": [
                {
                    "name": c.name,
                    "last_modified": c.last_modified.isoformat() if c.last_modified else None,
                    "public_access": c.public_access
                }
                for c in containers
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
        "goldenPrompts": ["list my blobs", "show me blobs", "what blobs do i have"],
        "testFixture": None,
    },
)
async def azure_list_blobs(
    storage_account: str,
    container_name: str,
    prefix: Optional[str] = None,
    max_results: int = 100,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List blobs in a container.

    Args:
        storage_account: Storage account name
        container_name: Container name
        prefix: Optional blob name prefix filter
        max_results: Maximum number of blobs to return
    """
    try:
        credential, user_info = require_user_token(meta, "storageAccessToken")

        account_url = f"https://{storage_account}.blob.core.windows.net"
        blob_client = BlobServiceClient(account_url=account_url, credential=credential)
        container_client = blob_client.get_container_client(container_name)

        blobs = []
        for blob in container_client.list_blobs(name_starts_with=prefix):
            blobs.append({
                "name": blob.name,
                "size": blob.size,
                "content_type": blob.content_settings.content_type if blob.content_settings else None,
                "last_modified": blob.last_modified.isoformat() if blob.last_modified else None
            })
            if len(blobs) >= max_results:
                break

        return {
            "success": True,
            "storage_account": storage_account,
            "container": container_name,
            "count": len(blobs),
            "blobs": blobs,
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
async def azure_create_storage_account(
    name: str,
    resource_group: str,
    location: str,
    sku: str = "Standard_LRS",
    kind: str = "StorageV2",
    allow_blob_public_access: bool = False,
    enable_https_traffic_only: bool = True,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Storage Account.

    Storage account names must be globally unique, 3-24 characters, lowercase
    letters and numbers only. SKU controls redundancy:
      Standard_LRS (cheapest, single region 3 copies),
      Standard_ZRS (zone-redundant in one region),
      Standard_GRS (geo-redundant across regions, 2x cost),
      Premium_LRS (SSD-backed, fast).

    Set allow_blob_public_access=True if you intend to host publicly-readable
    blobs (e.g. a static site or public download). Default is False (private).

    Args:
        name: Storage account name (3-24 lowercase alphanumeric, globally unique)
        resource_group: Resource group
        location: Azure region
        sku: SKU code (Standard_LRS, Standard_ZRS, Standard_GRS, Premium_LRS)
        kind: 'StorageV2' (recommended), 'BlobStorage', 'FileStorage'
        allow_blob_public_access: Enable public read access on blob containers
        enable_https_traffic_only: Force HTTPS for all storage operations
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = StorageManagementClient(credential, sub_id)
        params: Dict[str, Any] = {
            "location": location,
            "sku": {"name": sku},
            "kind": kind,
            "allow_blob_public_access": allow_blob_public_access,
            "enable_https_traffic_only": enable_https_traffic_only,
            "minimum_tls_version": "TLS1_2",  # Security: enforce TLS 1.2 minimum
            "tags": tags or {},
        }
        poller = client.storage_accounts.begin_create(
            resource_group_name=resource_group,
            account_name=name,
            parameters=params,
        )
        account = poller.result()
        return {
            "success": True,
            "storage_account": {
                "name": account.name,
                "id": account.id,
                "location": account.location,
                "sku": account.sku.name if account.sku else None,
                "kind": account.kind,
                "allow_blob_public_access": account.allow_blob_public_access,
                "primary_endpoints": {
                    "blob": account.primary_endpoints.blob if account.primary_endpoints else None,
                    "file": account.primary_endpoints.file if account.primary_endpoints else None,
                } if account.primary_endpoints else None,
                "tags": account.tags,
            },
            "executed_as": user_info,
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
async def azure_storage_account_set_public_access(
    name: str,
    resource_group: str,
    allow_blob_public_access: bool,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Toggle public blob access on an existing Storage Account.

    This is the account-level switch — even with this enabled, individual blob
    containers default to private and need their own public-access setting.

    Args:
        name: Storage account name
        resource_group: Resource group
        allow_blob_public_access: True to enable, False to disable
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = StorageManagementClient(credential, sub_id)
        updated = client.storage_accounts.update(
            resource_group_name=resource_group,
            account_name=name,
            parameters={"allow_blob_public_access": allow_blob_public_access},
        )
        return {
            "success": True,
            "storage_account": {
                "name": updated.name,
                "id": updated.id,
                "allow_blob_public_access": updated.allow_blob_public_access,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
