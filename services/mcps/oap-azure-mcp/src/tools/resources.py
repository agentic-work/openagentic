"""Azure MCP — resources tools.

Subscriptions, resource groups, and batch RG inventory.
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
    'azure_list_subscriptions',
    'azure_list_resource_groups',
    'azure_get_resource_group_inventory',
    'azure_create_resource_group',
    'azure_delete_resource_group',
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
        "goldenPrompts": ["list my subscriptions", "show me subscriptions", "what subscriptions do i have"],
        "testFixture": None,
    },
)
async def azure_list_subscriptions(
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List the Azure AD tenant subscriptions visible to the caller.

    Resource: Azure subscriptions (sometimes called "subs" or "billing accounts").
    Read-only. Uses the configured service principal credential.
    RBAC-filtered: if the user has no role assignments on any subscription, the
    list is empty (an error of fact, not a permissions bug).

    Trigger phrases: "list my subscriptions", "show me my Azure subs",
    "what subscriptions do I have", "azure billing accounts", "what tenant am I in".

    Example: azure_list_subscriptions()  # caller's primary tenant, all visible subs

    Returns:
        { success, count, subscriptions: [
            { id, name, state: "Enabled"|"Disabled"|"Warned"|..., tenant_id }
          ], executed_as }

    Adjacent tools:
      - Drill into one sub: azure_list_resource_groups(subscription_id=...)
      - Cross-sub KQL: azure_resource_graph_query(subscriptions=[id, ...], kql=...)
      - Cost view: azure_cost_query(subscription_id=..., lookback_days=30)
    """
    try:
        credential, user_info = require_user_token(meta)

        client = SubscriptionClient(credential)
        subscriptions = list(client.subscriptions.list())

        # #572 — Azure SDK's Subscription.tenant_id is often None for the
        # primary listing path (only populated for true cross-tenant
        # Lighthouse delegations). Fall back to the validated JWT's `tid`
        # claim from user_info (require_user_token decoded it at line 163)
        # — that's the authenticated user's home tenant, which matches the
        # subs the service principal can see. Last-resort literal "unknown"
        # was harming UI rendering of subscription tables.
        user_tid = user_info.get("tid", "") if isinstance(user_info, dict) else ""
        return {
            "success": True,
            "count": len(subscriptions),
            "subscriptions": [
                {
                    "id": sub.subscription_id,
                    "name": sub.display_name,
                    "state": sub.state.value if hasattr(sub.state, 'value') else str(sub.state) if sub.state else "Unknown",
                    "tenant_id": (
                        getattr(sub, "tenant_id", None)
                        or sub.additional_properties.get("tenantId")
                        or user_tid
                        or "unknown"
                    ),
                }
                for sub in subscriptions
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
        "goldenPrompts": ["list my resource groups", "show me resource groups", "what resource groups do i have"],
        "testFixture": None,
    },
)
async def azure_list_resource_groups(
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List the resource groups in an Azure subscription visible to the caller.

    Resource: Azure resource groups ("RGs") — logical containers for
    deployments. Read-only. RBAC-filtered. Useful as the second step after
    azure_list_subscriptions, or to answer "what resource groups do I have
    in <sub>?" / "does <rg-name> already exist?".

    Trigger phrases: "list my resource groups", "show me my RGs",
    "list resource groups in <sub>", "what RGs do I have", "azure rg list".

    Example:
      azure_list_resource_groups(subscription_id="11111111-2222-3333-4444-555555555555")
      # subscription_id=None → falls back to AZURE_SUBSCRIPTION_ID server env

    Args:
        subscription_id: Subscription UUID. Get from azure_list_subscriptions.
                         When omitted, server-side default applies.

    Returns:
        { success, subscription_id, count, resource_groups: [
            { name, location, provisioning_state, tags }
          ], executed_as }

    Adjacent tools:
      - Create one: azure_create_resource_group(name, location)
      - Drill networking: azure_list_vnets(resource_group=<rg>)
      - Cross-RG KQL: azure_resource_graph_query(kql="Resources | where ...")
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        client = ResourceManagementClient(credential, sub_id)
        rgs = list(client.resource_groups.list())

        return {
            "success": True,
            "subscription_id": sub_id,
            "count": len(rgs),
            "resource_groups": [
                {
                    "name": rg.name,
                    "location": rg.location,
                    "provisioning_state": rg.properties.provisioning_state if rg.properties else None,
                    "tags": rg.tags or {}
                }
                for rg in rgs
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
        "averageLatencyMs": 4000,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [
            "what's in resource group {name}",
            "show me everything in rg {name}",
            "audit resource group {name}",
            "list all resources in {name}",
            "full inventory of {rg}",
            "give me an overview of resource group {name}",
        ],
        "testFixture": None,
    },
)
async def azure_get_resource_group_inventory(
    resource_group: str,
    subscription_id: Optional[str] = None,
    include: Optional[List[str]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Fetch ALL resource types in a resource group in ONE parallel call.

    Use this whenever you need to enumerate resources in an RG instead of
    chaining 10+ separate azure_list_* calls. Categories run in parallel via
    asyncio.gather; per-category failures degrade gracefully (each returns
    either {count, items} or {error}).

    Args:
        resource_group: Resource group name (required).
        subscription_id: Azure subscription ID (default: DEFAULT_SUBSCRIPTION_ID).
        include: Optional list of category names to fetch. If None, fetches all.

    Returns a dict with `categories` keyed by category name, each containing
    `{count, items}` on success or `{error, type}` on failure. `errors` is a
    flat list of any per-category failures for quick scanning.
    """
    # Fail-fast: validate `include` against the known category set BEFORE any
    # Azure SDK call (no point auto-resolving subscription_id just to reject
    # a typo). The fetcher dict below is the source of truth; this literal
    # mirror is OK because changes to either must be made together — the
    # behavior test `test_inventory_rejects_unknown_category` guards parity.
    _VALID_CATEGORIES = {
        "vms", "disks", "snapshots", "vmss",
        "network_interfaces", "virtual_networks", "network_security_groups",
        "public_ip_addresses", "load_balancers", "application_gateways",
        "storage_accounts", "key_vaults", "aks_clusters",
        "web_apps", "app_service_plans", "role_assignments",
        # 2026-05-15: added AIF / Front Door / Container Apps / App Insights so
        # the model can enumerate them via this one tool instead of needing
        # per-type fan-out (which won't exist in this MCP at all for several).
        "cognitive_services", "cdn_profiles",
        "container_apps", "app_insights",
    }
    if include is not None:
        unknown_early = [c for c in include if c not in _VALID_CATEGORIES]
        if unknown_early:
            return {
                "success": False,
                "error": f"Unknown categories: {unknown_early}. Valid: {sorted(_VALID_CATEGORIES)}",
            }

    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        auto_resolved_sub: Optional[str] = None

        # Auto-resolve subscription_id when caller didn't provide one and no
        # env default exists. Without this, Azure SDK throws InvalidSubscriptionId
        # and the model has no way to recover unless azure_list_subscriptions
        # happens to be in its top-K tool shortlist — which it often isn't.
        # We list the service principal's accessible subs and either:
        #   1 sub  → auto-pick it (transparent: result annotated)
        #   >1 sub → return structured error with `available_subscriptions`
        #            so the model can pick + retry without a follow-up tool
        #   0 sub  → clear error (NOT a leaked SDK InvalidSubscriptionId)
        if not sub_id:
            sub_client = SubscriptionClient(credential)
            try:
                available = await _in_thread(
                    lambda: list(sub_client.subscriptions.list())
                )
            except Exception as e:
                return {
                    "success": False,
                    "error": f"Could not list user subscriptions to auto-resolve: {e}",
                    "type": type(e).__name__,
                }
            if len(available) == 0:
                return {
                    "success": False,
                    "error": (
                        "No accessible Azure subscriptions for this user. "
                        "Cannot run inventory without a subscription_id."
                    ),
                }
            if len(available) > 1:
                return {
                    "success": False,
                    "error": (
                        "subscription_id is required: the user has multiple "
                        "accessible subscriptions. Re-call with one of the "
                        "IDs from `available_subscriptions`."
                    ),
                    "available_subscriptions": [
                        {
                            "id": s.subscription_id,
                            "name": getattr(s, "display_name", None),
                        }
                        for s in available
                    ],
                }
            sub_id = available[0].subscription_id
            auto_resolved_sub = sub_id

        compute = ComputeManagementClient(credential, sub_id)
        network = NetworkManagementClient(credential, sub_id)
        storage = StorageManagementClient(credential, sub_id)
        keyvault = KeyVaultManagementClient(credential, sub_id)
        aks = ContainerServiceClient(credential, sub_id)
        web = WebSiteManagementClient(credential, sub_id)
        authz = AuthorizationManagementClient(credential, sub_id)

        async def _vms():
            items = await _in_thread(lambda: list(compute.virtual_machines.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": v.name,
                        "location": v.location,
                        "vm_size": v.hardware_profile.vm_size if v.hardware_profile else None,
                        "os_type": v.storage_profile.os_disk.os_type.value
                        if v.storage_profile and v.storage_profile.os_disk and v.storage_profile.os_disk.os_type
                        else None,
                        "provisioning_state": v.provisioning_state,
                        "tags": v.tags or {},
                    }
                    for v in items
                ],
            }

        async def _disks():
            items = await _in_thread(lambda: list(compute.disks.list_by_resource_group(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": d.name,
                        "location": d.location,
                        "disk_size_gb": d.disk_size_gb,
                        "sku": d.sku.name if d.sku else None,
                        "disk_state": d.disk_state,
                        "tags": d.tags or {},
                    }
                    for d in items
                ],
            }

        async def _snapshots():
            items = await _in_thread(lambda: list(compute.snapshots.list_by_resource_group(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": s.name,
                        "location": s.location,
                        "disk_size_gb": s.disk_size_gb,
                        "time_created": s.time_created.isoformat() if s.time_created else None,
                        "tags": s.tags or {},
                    }
                    for s in items
                ],
            }

        async def _vmss():
            items = await _in_thread(
                lambda: list(compute.virtual_machine_scale_sets.list(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": s.name,
                        "location": s.location,
                        "sku": s.sku.name if s.sku else None,
                        "capacity": s.sku.capacity if s.sku else None,
                        "tags": s.tags or {},
                    }
                    for s in items
                ],
            }

        async def _network_interfaces():
            items = await _in_thread(lambda: list(network.network_interfaces.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": n.name,
                        "location": n.location,
                        "mac_address": n.mac_address,
                        "ip_configurations": [
                            {
                                "name": ip.name,
                                "private_ip": ip.private_ip_address,
                                "public_ip_id": ip.public_ip_address.id if ip.public_ip_address else None,
                            }
                            for ip in (n.ip_configurations or [])
                        ],
                    }
                    for n in items
                ],
            }

        async def _virtual_networks():
            items = await _in_thread(lambda: list(network.virtual_networks.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": v.name,
                        "location": v.location,
                        "address_space": list(v.address_space.address_prefixes) if v.address_space else [],
                        "subnets": [
                            {"name": s.name, "address_prefix": s.address_prefix}
                            for s in (v.subnets or [])
                        ],
                        "tags": v.tags or {},
                    }
                    for v in items
                ],
            }

        async def _nsgs():
            items = await _in_thread(lambda: list(network.network_security_groups.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": n.name,
                        "location": n.location,
                        "rule_count": len(n.security_rules or []),
                        "tags": n.tags or {},
                    }
                    for n in items
                ],
            }

        async def _public_ips():
            items = await _in_thread(lambda: list(network.public_ip_addresses.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": p.name,
                        "location": p.location,
                        "ip_address": p.ip_address,
                        "allocation_method": p.public_ip_allocation_method,
                        "tags": p.tags or {},
                    }
                    for p in items
                ],
            }

        async def _load_balancers():
            items = await _in_thread(lambda: list(network.load_balancers.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": lb.name,
                        "location": lb.location,
                        "sku": lb.sku.name if lb.sku else None,
                        "frontend_count": len(lb.frontend_ip_configurations or []),
                        "tags": lb.tags or {},
                    }
                    for lb in items
                ],
            }

        async def _app_gateways():
            items = await _in_thread(lambda: list(network.application_gateways.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": g.name,
                        "location": g.location,
                        "sku": g.sku.name if g.sku else None,
                        "tier": g.sku.tier if g.sku else None,
                        "operational_state": g.operational_state,
                        "tags": g.tags or {},
                    }
                    for g in items
                ],
            }

        async def _storage_accounts():
            items = await _in_thread(
                lambda: list(storage.storage_accounts.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": s.name,
                        "location": s.location,
                        "kind": s.kind,
                        "sku": s.sku.name if s.sku else None,
                        "allow_blob_public_access": s.allow_blob_public_access,
                        "minimum_tls_version": s.minimum_tls_version,
                        "tags": s.tags or {},
                    }
                    for s in items
                ],
            }

        async def _key_vaults():
            items = await _in_thread(lambda: list(keyvault.vaults.list_by_resource_group(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": k.name,
                        "location": k.location,
                        "vault_uri": k.properties.vault_uri if k.properties else None,
                        "enable_rbac_authorization": (
                            k.properties.enable_rbac_authorization if k.properties else None
                        ),
                        "public_network_access": (
                            k.properties.public_network_access if k.properties else None
                        ),
                        "tags": k.tags or {},
                    }
                    for k in items
                ],
            }

        async def _aks_clusters():
            items = await _in_thread(
                lambda: list(aks.managed_clusters.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": c.name,
                        "location": c.location,
                        "kubernetes_version": c.kubernetes_version,
                        "node_pool_count": len(c.agent_pool_profiles or []),
                        "provisioning_state": c.provisioning_state,
                        "tags": c.tags or {},
                    }
                    for c in items
                ],
            }

        async def _web_apps():
            items = await _in_thread(lambda: list(web.web_apps.list_by_resource_group(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": w.name,
                        "location": w.location,
                        "kind": w.kind,
                        "state": w.state,
                        "default_host_name": w.default_host_name,
                        "https_only": w.https_only,
                        "tags": w.tags or {},
                    }
                    for w in items
                ],
            }

        async def _app_service_plans():
            items = await _in_thread(
                lambda: list(web.app_service_plans.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": p.name,
                        "location": p.location,
                        "kind": p.kind,
                        "sku": p.sku.name if p.sku else None,
                        "tier": p.sku.tier if p.sku else None,
                        "number_of_workers": p.number_of_workers,
                        "tags": p.tags or {},
                    }
                    for p in items
                ],
            }

        async def _role_assignments():
            scope = f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            items = await _in_thread(
                lambda: list(authz.role_assignments.list_for_scope(scope))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": r.name,
                        "role_definition_id": r.role_definition_id,
                        "principal_id": r.principal_id,
                        "principal_type": r.principal_type,
                        "scope": r.scope,
                    }
                    for r in items
                ],
            }

        # 2026-05-15: AIF/Front Door/Container Apps/App Insights fetchers — see
        # `_VALID_CATEGORIES` comment for context. Each one builds its SDK
        # client lazily so a missing SDK only kills that one category, not the
        # whole inventory.
        async def _cognitive_services():
            if CognitiveServicesManagementClient is None:
                raise RuntimeError("azure-mgmt-cognitiveservices SDK not installed")
            client = CognitiveServicesManagementClient(credential, sub_id)
            items = await _in_thread(
                lambda: list(client.accounts.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": a.name,
                        "location": a.location,
                        # `kind` distinguishes AIServices (AIF), OpenAI, FormRecognizer, etc.
                        "kind": getattr(a, "kind", None),
                        "sku": getattr(a.sku, "name", None) if getattr(a, "sku", None) else None,
                        "endpoint": getattr(getattr(a, "properties", None), "endpoint", None),
                        "tags": a.tags or {},
                    }
                    for a in items
                ],
            }

        async def _cdn_profiles():
            # Covers Azure Front Door Standard/Premium (Microsoft.Cdn provider)
            # and classic CDN profiles. Classic Microsoft.Network/frontDoors needs
            # a separate SDK and is rare in new deployments — not in scope here.
            if CdnManagementClient is None:
                raise RuntimeError("azure-mgmt-cdn SDK not installed")
            client = CdnManagementClient(credential, sub_id)
            items = await _in_thread(
                lambda: list(client.profiles.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": p.name,
                        "location": p.location,
                        # sku.name marks Front Door (Standard_AzureFrontDoor /
                        # Premium_AzureFrontDoor) vs classic CDN (Standard_Microsoft etc).
                        "sku": getattr(p.sku, "name", None) if getattr(p, "sku", None) else None,
                        "kind": getattr(p, "kind", None),
                        "tags": p.tags or {},
                    }
                    for p in items
                ],
            }

        async def _container_apps():
            if ContainerAppsAPIClient is None:
                raise RuntimeError("azure-mgmt-appcontainers SDK not installed")
            client = ContainerAppsAPIClient(credential, sub_id)
            items = await _in_thread(
                lambda: list(client.container_apps.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": c.name,
                        "location": c.location,
                        "provisioning_state": getattr(c, "provisioning_state", None),
                        "tags": c.tags or {},
                    }
                    for c in items
                ],
            }

        async def _app_insights():
            client = ApplicationInsightsManagementClient(credential, sub_id)
            items = await _in_thread(
                lambda: list(client.components.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": c.name,
                        "location": c.location,
                        "kind": getattr(c, "kind", None),
                        "application_type": getattr(c, "application_type", None),
                        "tags": c.tags or {},
                    }
                    for c in items
                ],
            }

        # Category registry: name → fetcher coroutine factory.
        fetchers = {
            "vms": _vms,
            "disks": _disks,
            "snapshots": _snapshots,
            "vmss": _vmss,
            "network_interfaces": _network_interfaces,
            "virtual_networks": _virtual_networks,
            "network_security_groups": _nsgs,
            "public_ip_addresses": _public_ips,
            "load_balancers": _load_balancers,
            "application_gateways": _app_gateways,
            "storage_accounts": _storage_accounts,
            "key_vaults": _key_vaults,
            "aks_clusters": _aks_clusters,
            "web_apps": _web_apps,
            "app_service_plans": _app_service_plans,
            "role_assignments": _role_assignments,
            "cognitive_services": _cognitive_services,
            "cdn_profiles": _cdn_profiles,
            "container_apps": _container_apps,
            "app_insights": _app_insights,
        }

        selected = include or list(fetchers.keys())
        unknown = [c for c in selected if c not in fetchers]
        if unknown:
            return {
                "success": False,
                "error": f"Unknown categories: {unknown}. Valid: {sorted(fetchers.keys())}",
            }

        names = [c for c in selected if c in fetchers]
        results = await asyncio.gather(
            *[fetchers[c]() for c in names], return_exceptions=True
        )

        categories: Dict[str, Any] = {}
        errors: List[Dict[str, str]] = []
        total_count = 0
        for name, result in zip(names, results):
            if isinstance(result, BaseException):
                categories[name] = {"error": str(result), "type": type(result).__name__}
                errors.append({"category": name, "error": str(result), "type": type(result).__name__})
            else:
                categories[name] = result
                total_count += result.get("count", 0)

        result_payload: Dict[str, Any] = {
            "success": True,
            "resource_group": resource_group,
            "subscription_id": sub_id,
            "total_count": total_count,
            "categories": categories,
            "errors": errors,
            "executed_as": user_info,
        }
        if auto_resolved_sub:
            result_payload["auto_resolved_subscription_id"] = auto_resolved_sub
        return result_payload
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if "user_info" in dir() else None)


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
async def azure_create_resource_group(
    name: str,
    location: str,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a new Azure resource group. This is idempotent — calling again with
    the same name + location just returns the existing one.

    Typically the FIRST step when provisioning any Azure scenario. Everything
    else (VNets, App Gateways, Front Doors, VMs, storage...) lives inside a
    resource group.

    Args:
        name: Resource group name. Naming rules: alphanumeric + hyphens + underscores,
              1-90 chars. Suggested pattern: `rg-<purpose>-<env>-<random>`.
              Example: "rg-fd-demo-eastus-7c3a".
        location: Azure region slug (lowercase, no spaces).
                  Examples: "eastus", "westus2", "westeurope", "centralus", "eastus2".
                  Some resources (e.g. Front Door profile) are global — use "global" for those.
        tags: Optional dict for billing/ownership (e.g. {"owner": "team-x", "env": "dev"}).
        subscription_id: Optional override. When omitted, uses the logged-in user's
                         default subscription from AZURE_SUBSCRIPTION_ID.

    Returns:
        { success: True, resource_group: { name, location, id, tags }, executed_as }

    Chain with: `azure_create_vnet` (put networking in this RG),
                `azure_create_storage_account`, `azure_create_key_vault`,
                `azure_create_vm`, `azure_create_app_gateway`, etc.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ResourceManagementClient(credential, sub_id)

        rg = client.resource_groups.create_or_update(
            name,
            {"location": location, "tags": tags or {}}
        )

        return {
            "success": True,
            "resource_group": {
                "name": rg.name,
                "location": rg.location,
                "id": rg.id,
                "tags": rg.tags
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_delete_resource_group(
    name: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Delete a resource group and all its resources.

    WARNING: This is destructive and cannot be undone!

    Args:
        name: Resource group name to delete
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ResourceManagementClient(credential, sub_id)

        # Start async delete operation
        poller = client.resource_groups.begin_delete(name)

        return {
            "success": True,
            "message": f"Resource group '{name}' deletion started",
            "operation_id": poller.operation_id if hasattr(poller, 'operation_id') else None,
            "note": "Deletion is async and may take several minutes to complete",
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
