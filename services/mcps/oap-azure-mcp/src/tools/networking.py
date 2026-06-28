"""Azure MCP — networking tools.

VNets, NSGs, App Gateways, Load Balancers, Front Doors (+ create_*).
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
    'azure_list_vnets',
    'azure_list_nsgs',
    'azure_list_app_gateways',
    'azure_get_app_gateway',
    'azure_app_gateway_backend_health',
    'azure_app_gateway_start',
    'azure_app_gateway_stop',
    'azure_list_load_balancers',
    'azure_list_front_doors',
    'azure_get_front_door',
    'azure_create_vnet',
    'azure_create_subnet',
    'azure_create_nsg',
    'azure_create_app_gateway',
    'azure_create_front_door',
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
        "goldenPrompts": ["list my vnets", "show me vnets", "what vnets do i have"],
        "testFixture": None,
    },
)
async def azure_list_vnets(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Virtual Networks (VNets) visible to the user. Returns each VNet's
    address space, subnet names, and location.

    Use this to:
      - Verify a VNet you just created.
      - Find an existing VNet's subnets before dropping a VM or App Gateway in.
      - Audit VNet sprawl.

    Args:
        resource_group: Optional — scope to one RG. Omit to list all across sub.
        subscription_id: Optional override.

    Returns:
        { success, count, virtual_networks: [
            { name, location, resource_group, address_space: [...cidrs],
              subnets: [...names], provisioning_state, tags }
          ], executed_as
        }

    Chain with:
      - `azure_create_subnet` to add subnets to an existing VNet.
      - `azure_list_nsgs` to see NSGs available to attach.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        if resource_group:
            vnets = list(client.virtual_networks.list(resource_group))
        else:
            vnets = list(client.virtual_networks.list_all())

        return {
            "success": True,
            "count": len(vnets),
            "virtual_networks": [
                {
                    "name": vnet.name,
                    "location": vnet.location,
                    "resource_group": vnet.id.split('/')[4] if vnet.id else None,
                    "address_space": vnet.address_space.address_prefixes if vnet.address_space else [],
                    "subnets": [s.name for s in (vnet.subnets or [])],
                    "provisioning_state": vnet.provisioning_state,
                    "tags": vnet.tags or {}
                }
                for vnet in vnets
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
        "goldenPrompts": ["list my nsgs", "show me nsgs", "what nsgs do i have"],
        "testFixture": None,
    },
)
async def azure_list_nsgs(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Network Security Groups (NSGs) — host firewalls for subnets / NICs —
    visible to the user. Includes per-NSG rule counts so you can quickly
    spot empty NSGs or over-permissive ones.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        if resource_group:
            nsgs = list(client.network_security_groups.list(resource_group))
        else:
            nsgs = list(client.network_security_groups.list_all())

        return {
            "success": True,
            "count": len(nsgs),
            "network_security_groups": [
                {
                    "name": nsg.name,
                    "location": nsg.location,
                    "resource_group": nsg.id.split('/')[4] if nsg.id else None,
                    "security_rules_count": len(nsg.security_rules) if nsg.security_rules else 0,
                    "default_rules_count": len(nsg.default_security_rules) if nsg.default_security_rules else 0,
                    "provisioning_state": nsg.provisioning_state,
                    "tags": nsg.tags or {}
                }
                for nsg in nsgs
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
        "goldenPrompts": ["list my app gateways", "show me app gateways", "what app gateways do i have"],
        "testFixture": None,
    },
)
async def azure_list_app_gateways(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all Application Gateways visible to the logged-in user. RBAC-filtered:
    only returns gateways the user has at least Reader on.

    Use this to:
      - Verify a gateway you just created (`azure_create_app_gateway`) is live.
      - Survey what enterprise gateways exist before planning a Front Door.
      - Check operational_state (Running/Stopped) and provisioning_state (Succeeded/Failed).

    Args:
        resource_group: Optional — filter to one RG. Omit to list ALL across the sub.
        subscription_id: Optional override.

    Returns:
        { success, count, application_gateways: [
            { name, location, resource_group, sku (name/tier/capacity),
              operational_state, provisioning_state,
              backend_pools_count, http_listeners_count, rules_count, tags }
          ], executed_as
        }

    Pair with: `azure_get_app_gateway(name, resource_group)` for full detail
               (listeners, backend pools, rules, probes, WAF) on a single gateway.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        if resource_group:
            gateways = list(client.application_gateways.list(resource_group))
        else:
            gateways = list(client.application_gateways.list_all())

        return {
            "success": True,
            "count": len(gateways),
            "application_gateways": [
                {
                    "name": gw.name,
                    "location": gw.location,
                    "resource_group": gw.id.split('/')[4] if gw.id else None,
                    "sku": {
                        "name": gw.sku.name if gw.sku else None,
                        "tier": gw.sku.tier if gw.sku else None,
                        "capacity": gw.sku.capacity if gw.sku else None
                    } if gw.sku else None,
                    "operational_state": gw.operational_state,
                    "provisioning_state": gw.provisioning_state,
                    "backend_pools_count": len(gw.backend_address_pools) if gw.backend_address_pools else 0,
                    "http_listeners_count": len(gw.http_listeners) if gw.http_listeners else 0,
                    "rules_count": len(gw.request_routing_rules) if gw.request_routing_rules else 0,
                    "tags": gw.tags or {}
                }
                for gw in gateways
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
        "goldenPrompts": ["get app gateway details", "show me one app gateway"],
        "testFixture": None,
    },
)
async def azure_get_app_gateway(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get detailed information about an Application Gateway.

    Args:
        name: Application Gateway name
        resource_group: Resource group containing the App Gateway
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)
        gw = client.application_gateways.get(resource_group, name)

        return {
            "success": True,
            "application_gateway": {
                "name": gw.name,
                "id": gw.id,
                "location": gw.location,
                "sku": {
                    "name": gw.sku.name if gw.sku else None,
                    "tier": gw.sku.tier if gw.sku else None,
                    "capacity": gw.sku.capacity if gw.sku else None
                } if gw.sku else None,
                "operational_state": gw.operational_state,
                "provisioning_state": gw.provisioning_state,
                "enable_http2": gw.enable_http2,
                "enable_fips": gw.enable_fips,
                "frontend_ip_configurations": [
                    {
                        "name": fip.name,
                        "private_ip": fip.private_ip_address,
                        "private_ip_allocation": fip.private_ip_allocation_method,
                        "public_ip_id": fip.public_ip_address.id if fip.public_ip_address else None
                    }
                    for fip in (gw.frontend_ip_configurations or [])
                ],
                "frontend_ports": [
                    {"name": fp.name, "port": fp.port}
                    for fp in (gw.frontend_ports or [])
                ],
                "backend_address_pools": [
                    {
                        "name": pool.name,
                        "addresses": [
                            addr.fqdn or addr.ip_address
                            for addr in (pool.backend_addresses or [])
                        ]
                    }
                    for pool in (gw.backend_address_pools or [])
                ],
                "backend_http_settings": [
                    {
                        "name": settings.name,
                        "port": settings.port,
                        "protocol": settings.protocol,
                        "cookie_based_affinity": settings.cookie_based_affinity,
                        "request_timeout": settings.request_timeout,
                        "probe_name": settings.probe.id.split('/')[-1] if settings.probe else None
                    }
                    for settings in (gw.backend_http_settings_collection or [])
                ],
                "http_listeners": [
                    {
                        "name": listener.name,
                        "protocol": listener.protocol,
                        "host_name": listener.host_name,
                        "host_names": listener.host_names,
                        "require_server_name_indication": listener.require_server_name_indication,
                        "frontend_port": listener.frontend_port.id.split('/')[-1] if listener.frontend_port else None,
                        "ssl_certificate": listener.ssl_certificate.id.split('/')[-1] if listener.ssl_certificate else None
                    }
                    for listener in (gw.http_listeners or [])
                ],
                "request_routing_rules": [
                    {
                        "name": rule.name,
                        "rule_type": rule.rule_type,
                        "priority": rule.priority,
                        "http_listener": rule.http_listener.id.split('/')[-1] if rule.http_listener else None,
                        "backend_address_pool": rule.backend_address_pool.id.split('/')[-1] if rule.backend_address_pool else None,
                        "backend_http_settings": rule.backend_http_settings.id.split('/')[-1] if rule.backend_http_settings else None,
                        "url_path_map": rule.url_path_map.id.split('/')[-1] if rule.url_path_map else None,
                        "redirect_configuration": rule.redirect_configuration.id.split('/')[-1] if rule.redirect_configuration else None
                    }
                    for rule in (gw.request_routing_rules or [])
                ],
                "probes": [
                    {
                        "name": probe.name,
                        "protocol": probe.protocol,
                        "host": probe.host,
                        "path": probe.path,
                        "interval": probe.interval,
                        "timeout": probe.timeout,
                        "unhealthy_threshold": probe.unhealthy_threshold,
                        "match_status_codes": probe.match.status_codes if probe.match else None
                    }
                    for probe in (gw.probes or [])
                ],
                "ssl_certificates": [
                    {"name": cert.name}
                    for cert in (gw.ssl_certificates or [])
                ],
                "waf_configuration": {
                    "enabled": gw.web_application_firewall_configuration.enabled,
                    "firewall_mode": gw.web_application_firewall_configuration.firewall_mode,
                    "rule_set_type": gw.web_application_firewall_configuration.rule_set_type,
                    "rule_set_version": gw.web_application_firewall_configuration.rule_set_version
                } if gw.web_application_firewall_configuration else None,
                "tags": gw.tags or {}
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
        "averageLatencyMs": 5000,
        "failureModes": ["auth_expired"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_app_gateway_backend_health(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get backend health status for an Application Gateway.

    This shows the health of each backend server in each pool.

    Args:
        name: Application Gateway name
        resource_group: Resource group containing the App Gateway
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        # This is a long-running operation
        poller = client.application_gateways.begin_backend_health(resource_group, name)
        health = poller.result()

        backend_pools = []
        for pool in (health.backend_address_pools or []):
            pool_health = {
                "name": pool.backend_address_pool.id.split('/')[-1] if pool.backend_address_pool else "Unknown",
                "servers": []
            }
            for http_setting in (pool.backend_http_settings_collection or []):
                setting_name = http_setting.backend_http_settings.id.split('/')[-1] if http_setting.backend_http_settings else "Unknown"
                for server in (http_setting.servers or []):
                    pool_health["servers"].append({
                        "address": server.address,
                        "health": server.health.value if server.health else "Unknown",
                        "health_probe_log": server.health_probe_log,
                        "http_setting": setting_name
                    })
            backend_pools.append(pool_health)

        return {
            "success": True,
            "application_gateway": name,
            "backend_pools": backend_pools,
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
async def azure_app_gateway_start(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Start an Application Gateway.

    Args:
        name: Application Gateway name
        resource_group: Resource group containing the App Gateway
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)
        poller = client.application_gateways.begin_start(resource_group, name)

        return {
            "success": True,
            "message": f"Application Gateway '{name}' start operation initiated",
            "name": name,
            "resource_group": resource_group,
            "note": "This operation may take several minutes to complete",
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
async def azure_app_gateway_stop(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Stop an Application Gateway.

    Stopping an App Gateway stops billing for compute but the resource remains.

    Args:
        name: Application Gateway name
        resource_group: Resource group containing the App Gateway
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)
        poller = client.application_gateways.begin_stop(resource_group, name)

        return {
            "success": True,
            "message": f"Application Gateway '{name}' stop operation initiated",
            "name": name,
            "resource_group": resource_group,
            "note": "This operation may take several minutes to complete",
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
        "goldenPrompts": ["list my load balancers", "show me load balancers", "what load balancers do i have"],
        "testFixture": None,
    },
)
async def azure_list_load_balancers(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Load Balancers.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        if resource_group:
            lbs = list(client.load_balancers.list(resource_group))
        else:
            lbs = list(client.load_balancers.list_all())

        return {
            "success": True,
            "count": len(lbs),
            "load_balancers": [
                {
                    "name": lb.name,
                    "location": lb.location,
                    "resource_group": lb.id.split('/')[4] if lb.id else None,
                    "sku": lb.sku.name if lb.sku else None,
                    "provisioning_state": lb.provisioning_state,
                    "frontend_ip_count": len(lb.frontend_ip_configurations) if lb.frontend_ip_configurations else 0,
                    "backend_pool_count": len(lb.backend_address_pools) if lb.backend_address_pools else 0,
                    "rules_count": len(lb.load_balancing_rules) if lb.load_balancing_rules else 0,
                    "tags": lb.tags or {}
                }
                for lb in lbs
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
        "goldenPrompts": ["list my front doors", "show me front doors", "what front doors do i have"],
        "testFixture": None,
    },
)
async def azure_list_front_doors(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List ALL Azure Front Door profiles across the subscription — covers both
    the legacy "Classic" Front Door (Microsoft.Network/frontdoors) AND modern
    "Standard/Premium" Front Door (Microsoft.Cdn/profiles with AzureFrontDoor SKU).
    Uses Azure Resource Graph under the hood for unified discovery.

    Use this to:
      - Verify a Front Door you just created (`azure_create_front_door`).
      - Audit existing global edges before designing a new one.
      - Tell Classic from Standard/Premium — each `tier` field is set
        ("Classic" | "Standard" | "Premium").

    Args:
        subscription_id: Optional override.
        resource_group: Optional — scope to one RG instead of the whole sub.

    Returns:
        { success, count, front_doors: [
            { name, type, tier, location, resourceGroup, id, sku, properties }
          ], executed_as
        }

    Pair with: `azure_get_front_door(name, resource_group)` for one-profile
               detail (endpoint host, origin groups, origins, routes).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        # Use Resource Graph for unified Classic + Standard/Premium discovery
        rg_filter = f"and resourceGroup =~ '{resource_group}'" if resource_group else ""
        kql = f"""
        Resources
        | where type =~ 'microsoft.network/frontdoors' or type =~ 'microsoft.cdn/profiles'
        | where subscriptionId == '{sub_id}' {rg_filter}
        | extend tier = case(
            type =~ 'microsoft.network/frontdoors', 'Classic',
            type =~ 'microsoft.cdn/profiles' and sku.name startswith 'Standard_AzureFrontDoor', 'Standard',
            type =~ 'microsoft.cdn/profiles' and sku.name startswith 'Premium_AzureFrontDoor', 'Premium',
            'CDN'
        )
        | project name, type, tier, location, resourceGroup, id, sku = sku.name, properties
        """
        client = ResourceGraphClient(credential)
        request = QueryRequest(query=kql, subscriptions=[sub_id], options=QueryRequestOptions(top=1000, result_format="objectArray"))
        response = client.resources(request)
        return {
            "success": True,
            "subscription_id": sub_id,
            "count": len(response.data) if hasattr(response, 'data') else 0,
            "front_doors": response.data,
            "executed_as": user_info,
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
        "goldenPrompts": ["get front door details", "show me one front door"],
        "testFixture": None,
    },
)
async def azure_get_front_door(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get detailed configuration for a specific Front Door profile, including
    routing rules, backend pools, frontend hosts, WAF policies, and health probes.

    Args:
        name: Front Door name
        resource_group: Resource group containing the Front Door
        subscription_id: Subscription scope
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        # Try Standard/Premium (microsoft.cdn) first, fall back to Classic (microsoft.network)
        import requests
        token = credential.get_token("https://management.azure.com/.default").token
        headers = {"Authorization": f"Bearer {token}"}

        # Standard/Premium AFD
        std_url = f"https://management.azure.com/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Cdn/profiles/{name}?api-version=2023-05-01"
        resp = await asyncio.to_thread(requests.get, std_url, headers=headers, timeout=20)
        if resp.status_code == 200:
            return {"success": True, "tier": "Standard/Premium", "front_door": resp.json(), "executed_as": user_info}

        # Classic AFD
        cls_url = f"https://management.azure.com/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/frontDoors/{name}?api-version=2021-06-01"
        resp = await asyncio.to_thread(requests.get, cls_url, headers=headers, timeout=20)
        if resp.status_code == 200:
            return {"success": True, "tier": "Classic", "front_door": resp.json(), "executed_as": user_info}

        return {"success": False, "error": f"Front Door '{name}' not found in resource group '{resource_group}'", "executed_as": user_info}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
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
async def azure_create_vnet(
    name: str,
    resource_group: str,
    location: str,
    address_space: str = "10.0.0.0/16",
    subnets: Optional[List[Dict[str, str]]] = None,
    subscription_id: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Virtual Network (VNet) with one or more subnets in a single call.

    Use this when setting up the networking foundation for any multi-resource Azure
    scenario (VMs, AKS, App Gateway, container envs, private endpoints, etc.).
    The VNet's resource group must exist first — call `azure_create_resource_group` if needed.

    Args:
        name: VNet name. Alphanumeric + hyphens, 2-64 chars. Example: "vnet-demo-eastus".
        resource_group: Must already exist. Call `azure_create_resource_group` first.
        location: Azure region (must match the RG's region). Example: "eastus", "westus2".
        address_space: CIDR block for the whole VNet. Default "10.0.0.0/16" (65k IPs).
                       Use smaller blocks (e.g. "10.10.0.0/20") when peering many VNets.
        subnets: List of subnet dicts in format `[{"name": "...", "address_prefix": "x.x.x.x/y"}]`.
                 Defaults to a single "default" subnet at "10.0.0.0/24".
                 ENTERPRISE EXAMPLE (App Gateway + workloads + Azure Bastion):
                 [
                   {"name": "appgw-subnet",   "address_prefix": "10.0.1.0/24"},
                   {"name": "workload-subnet","address_prefix": "10.0.2.0/23"},
                   {"name": "AzureBastionSubnet", "address_prefix": "10.0.250.0/26"}
                 ]
                 NOTE: App Gateway v2 REQUIRES a dedicated /24 or larger subnet with no
                 other resources in it. Azure Bastion REQUIRES a subnet literally named
                 "AzureBastionSubnet" at /26 or larger.
        subscription_id: Optional override.
        tags: Optional tags.

    Returns:
        { success, vnet: { name, id, location, address_space, subnets: [{name, address_prefix}] },
          executed_as }

    Chain with: `azure_create_subnet` (add more subnets later),
                `azure_create_nsg` (secure subnets with inbound/outbound rules),
                `azure_create_app_gateway` (references a subnet by name),
                `azure_create_vm` (drops NIC into one of the subnets).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = NetworkManagementClient(credential, sub_id)

        subnet_list = subnets or [{"name": "default", "address_prefix": "10.0.0.0/24"}]
        vnet_params = {
            "location": location,
            "tags": tags or {},
            "address_space": {"address_prefixes": [address_space]},
            "subnets": [{"name": s["name"], "address_prefix": s["address_prefix"]} for s in subnet_list],
        }
        vnet = await _in_thread(lambda: client.virtual_networks.begin_create_or_update(
            resource_group, name, vnet_params
        ).result())
        return {
            "success": True,
            "vnet": {
                "name": vnet.name, "id": vnet.id, "location": vnet.location,
                "address_space": [p for p in (vnet.address_space.address_prefixes if vnet.address_space else [])],
                "subnets": [{"name": s.name, "address_prefix": s.address_prefix} for s in (vnet.subnets or [])],
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
async def azure_create_subnet(
    vnet_name: str,
    subnet_name: str,
    resource_group: str,
    address_prefix: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Add a single subnet to an existing VNet. Use this when you need to extend
    a VNet with additional network segments after the initial VNet creation —
    for example, to add a dedicated App Gateway subnet, Bastion subnet,
    Private Endpoint subnet, or a new workload tier.

    For creating the VNet with subnets in one call, use `azure_create_vnet` with
    its `subnets` parameter instead — this tool is just for adding to existing VNets.

    Args:
        vnet_name: Existing VNet name.
        subnet_name: New subnet name. Common conventions:
                     - "appgw-subnet" / "gateway-subnet" — for App Gateway (/24 min, dedicated)
                     - "AzureBastionSubnet" — REQUIRED name for Bastion (/26 min)
                     - "workload-subnet" — for VMs / workloads
                     - "pe-subnet" — for Private Endpoints
        resource_group: VNet's resource group.
        address_prefix: CIDR range. MUST be within the VNet's address_space AND
                        non-overlapping with existing subnets.
                        Examples: "10.0.1.0/24" (256 IPs), "10.0.10.0/22" (1024 IPs).
        subscription_id: Optional override.

    Returns:
        { success, subnet: { name, id, address_prefix }, executed_as }

    Chain with: `azure_create_nsg` (then associate with subnet),
                `azure_create_app_gateway` (pass this subnet's name).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = NetworkManagementClient(credential, sub_id)
        subnet = await _in_thread(lambda: client.subnets.begin_create_or_update(
            resource_group, vnet_name, subnet_name,
            {"address_prefix": address_prefix}
        ).result())
        return {
            "success": True,
            "subnet": {"name": subnet.name, "id": subnet.id, "address_prefix": subnet.address_prefix},
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
async def azure_create_nsg(
    name: str,
    resource_group: str,
    location: str,
    rules: Optional[List[Dict[str, Any]]] = None,
    subscription_id: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a Network Security Group (NSG) with optional inbound / outbound
    security rules. NSGs are the equivalent of host-level firewalls and can
    be associated with subnets or NICs.

    Rules are evaluated in priority order (lowest priority wins), then the
    default rules apply. Always give each rule a unique priority in the
    100–4000 range.

    Args:
        name: NSG name. Example: "nsg-web-tier".
        resource_group: Must exist.
        location: Must match the resource group's region.
        rules: List of rule dicts. Each rule supports:
               - name: unique within the NSG (e.g., "Allow-HTTP-Internet")
               - priority: 100-4096, lower = evaluated first (default 1000)
               - direction: "Inbound" | "Outbound" (default "Inbound")
               - access: "Allow" | "Deny" (default "Allow")
               - protocol: "Tcp" | "Udp" | "Icmp" | "*" (default "Tcp")
               - source_address_prefix: "Internet" | "VirtualNetwork" | CIDR | "*"
               - destination_address_prefix: same options
               - source_port_range: "*" or number (default "*")
               - destination_port_range: "*" | "80" | "443" | "80,443" | "1000-2000"
               COMMON PATTERNS:
               • Public HTTPS: {name:"Allow-HTTPS", priority:100, protocol:"Tcp",
                 source_address_prefix:"Internet", destination_port_range:"443"}
               • App Gateway health probes: {name:"Allow-GWHealth", priority:110,
                 source_address_prefix:"GatewayManager", destination_port_range:"65200-65535"}
               • Block everything else: {name:"Deny-All-Inbound", priority:4096,
                 access:"Deny", source_address_prefix:"*", destination_address_prefix:"*",
                 destination_port_range:"*"}
        subscription_id: Optional override.
        tags: Optional tags.

    Returns:
        { success, nsg: { name, id, location, rules: [...] }, executed_as }

    Chain with: `azure_create_vnet` / `azure_create_subnet` (associate NSG
                with a subnet by configuring the subnet later), or attach to
                a NIC during VM creation.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = NetworkManagementClient(credential, sub_id)

        security_rules = []
        for r in (rules or []):
            security_rules.append({
                "name": r["name"],
                "priority": r.get("priority", 1000),
                "direction": r.get("direction", "Inbound"),
                "access": r.get("access", "Allow"),
                "protocol": r.get("protocol", "Tcp"),
                "source_address_prefix": r.get("source_address_prefix", "*"),
                "destination_address_prefix": r.get("destination_address_prefix", "*"),
                "source_port_range": r.get("source_port_range", "*"),
                "destination_port_range": r.get("destination_port_range", "443"),
            })

        nsg_params = {
            "location": location,
            "tags": tags or {},
            "security_rules": security_rules,
        }
        nsg = await _in_thread(lambda: client.network_security_groups.begin_create_or_update(
            resource_group, name, nsg_params
        ).result())
        return {
            "success": True,
            "nsg": {
                "name": nsg.name, "id": nsg.id, "location": nsg.location,
                "rules": [{"name": r.name, "priority": r.priority, "direction": r.direction,
                           "access": r.access, "protocol": r.protocol}
                          for r in (nsg.security_rules or [])],
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
async def azure_create_app_gateway(
    name: str,
    resource_group: str,
    location: str,
    vnet_name: str,
    subnet_name: str,
    sku_name: str = "Standard_v2",
    sku_tier: str = "Standard_v2",
    capacity: int = 1,
    frontend_port: int = 80,
    backend_addresses: Optional[List[str]] = None,
    subscription_id: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Application Gateway v2 with a public IP, a single HTTP
    listener, one backend pool (holds ALL your backend_addresses), one HTTP
    settings, and one routing rule. Supports 100+ backend endpoints in the
    single pool — perfect for fronting a large set of servers behind one L7.

    Provisioning takes 6-12 minutes (App Gateway v2 is slow). The call blocks
    until the gateway reaches a terminal provisioning state.

    PRE-REQUISITES (call these first if they don't exist):
      1. `azure_create_resource_group(name, location)`
      2. `azure_create_vnet(name=vnet_name, ..., subnets=[{"name": subnet_name,
           "address_prefix": "10.0.1.0/24"}])`  ← subnet must be DEDICATED to
           the App Gateway, /24 or larger, with NO OTHER resources in it.

    Args:
        name: App Gateway name. Alphanumeric + hyphens, 1-80 chars.
              Example: "agw-web-eastus".
        resource_group: Must already exist.
        location: Must match the VNet's region.
        vnet_name: Existing VNet name.
        subnet_name: Existing subnet in that VNet, DEDICATED for the gateway.
                     If shared with other resources, provisioning will fail.
        sku_name: "Standard_v2" for basic L7, or "WAF_v2" to enable Web
                  Application Firewall. Default "Standard_v2".
        sku_tier: Must match sku_name ("Standard_v2" or "WAF_v2").
        capacity: Fixed instance count, 1-10. Use 2+ for HA in prod.
                  Default 1 (dev/test). Auto-scaling requires different config
                  and is not supported by this tool — use capacity instead.
        frontend_port: Single listener port. Default 80 (HTTP). For HTTPS use 443
                       but then you also need a cert binding — not exposed here;
                       provision with port 80 first and add HTTPS via the portal
                       or a follow-up patch if needed.
        backend_addresses: List of backend IP addresses OR FQDNs. All go into one
                           backend pool. Enterprise scale examples:
                           • ["10.0.2.4", "10.0.2.5", ...100+ IPs for VM pool]
                           • ["app01.internal", "app02.internal", ...]
                           • ["my-apim.azure-api.net", "my-webapp.azurewebsites.net"]
                           Default: ["10.0.0.4"] (placeholder).
        subscription_id: Optional override.
        tags: Optional tags.

    Returns:
        {
          success, app_gateway: {
            name, id, location, sku (name, tier, capacity),
            provisioning_state,   ← "Succeeded" means ready
            frontend_ip,          ← public IP address (use this as Front Door origin!)
            backend_pool_count, rule_count
          },
          executed_as
        }

    Chain with:
      • `azure_create_front_door(origin_hostname=<frontend_ip or FQDN>)` to
        add a global edge in front of the gateway.
      • `azure_app_gateway_backend_health` to check that the pool members
        are reachable once the gateway is up.
      • `azure_get_app_gateway` to re-read full config.

    LIMITATIONS of this tool (by design — keep it simple):
      - Single backend pool, single listener, single routing rule.
      - For multi-path routing (e.g., /api/* → pool A, /static/* → pool B),
        path-based rules, URL rewrites, WAF policy attachment, SSL bindings:
        create the basic gateway here, then edit in the portal or via az cli
        (mention this limitation to the user).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = NetworkManagementClient(credential, sub_id)

        subnet_id = (
            f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.Network/virtualNetworks/{vnet_name}/subnets/{subnet_name}"
        )

        # Create a public IP for the App Gateway frontend
        # Public IP is fast — ~15s, safe to wait inline.
        pip_name = f"{name}-pip"
        pip = await _in_thread(lambda: client.public_ip_addresses.begin_create_or_update(
            resource_group, pip_name,
            {"location": location, "sku": {"name": "Standard"}, "public_ip_allocation_method": "Static"}
        ).result())
        # Capture the IP up front so we can return it even if we don't block on
        # App Gateway completion (see below).
        pip_ip_address = pip.ip_address

        backends = [{"ip_address": addr} for addr in (backend_addresses or ["10.0.0.4"])]

        agw_params = {
            "location": location,
            "tags": tags or {},
            "sku": {"name": sku_name, "tier": sku_tier, "capacity": capacity},
            "gateway_ip_configurations": [{
                "name": "appGatewayIpConfig",
                "subnet": {"id": subnet_id},
            }],
            "frontend_ip_configurations": [{
                "name": "appGatewayFrontendIP",
                "public_ip_address": {"id": pip.id},
            }],
            "frontend_ports": [{"name": "port_80", "port": frontend_port}],
            "backend_address_pools": [{"name": "defaultBackendPool", "backend_addresses": backends}],
            "backend_http_settings_collection": [{
                "name": "defaultHTTPSettings",
                "port": 80, "protocol": "Http",
                "cookie_based_affinity": "Disabled",
                "request_timeout": 30,
            }],
            "http_listeners": [{
                "name": "defaultListener",
                "frontend_ip_configuration": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/frontendIPConfigurations/appGatewayFrontendIP"
                },
                "frontend_port": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/frontendPorts/port_80"
                },
                "protocol": "Http",
            }],
            "request_routing_rules": [{
                "name": "defaultRule",
                "rule_type": "Basic",
                "priority": 100,
                "http_listener": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/httpListeners/defaultListener"
                },
                "backend_address_pool": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/backendAddressPools/defaultBackendPool"
                },
                "backend_http_settings": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/backendHttpSettingsCollection/defaultHTTPSettings"
                },
            }],
        }
        # App Gateway v2 provisioning takes 6-12 minutes — longer than the typical
        # Azure AD access token lifetime remaining at dispatch time. If we block
        # on `.result()` the token can expire mid-LRO and we get ExpiredAuthenticationToken.
        # Instead: kick off the LRO, return immediately with the public IP and
        # "provisioning_state: Creating". The agent can call `azure_list_app_gateways`
        # or `azure_get_app_gateway` later to check completion.
        poller = await _in_thread(lambda: client.application_gateways.begin_create_or_update(
            resource_group, name, agw_params
        ))
        # At this point Azure has accepted the request (201 Accepted). The
        # gateway is being provisioned asynchronously. Don't block on
        # `.result()` — just return the initial status + known fields.
        initial_state = None
        try:
            if hasattr(poller, 'status'):
                initial_state = poller.status()
        except Exception:
            initial_state = None
        expected_agw_id = (
            f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.Network/applicationGateways/{name}"
        )
        return {
            "success": True,
            "app_gateway": {
                "name": name,
                "id": expected_agw_id,
                "location": location,
                "sku": {"name": sku_name, "tier": sku_tier, "capacity": capacity},
                "provisioning_state": initial_state or "Creating",
                "frontend_ip": pip_ip_address,
                "backend_pool_count": 1,  # single default pool in this tool
                "rule_count": 1,          # single default rule
                "backend_address_count": len(backends),
            },
            "is_long_running": True,
            "async_poll_hint": f"Call azure_get_app_gateway(name='{name}', resource_group='{resource_group}') "
                               f"or azure_list_app_gateways(resource_group='{resource_group}') in 3-8 minutes "
                               f"to verify provisioning_state='Succeeded'.",
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
async def azure_create_front_door(
    name: str,
    resource_group: str,
    sku: str = "Standard_AzureFrontDoor",
    origin_hostname: Optional[str] = None,
    subscription_id: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Front Door Standard/Premium profile. Front Door is a global
    L7 load balancer that sits at the Microsoft edge — clients get low-latency
    TLS termination + caching + WAF, then requests flow to your origins (which
    can be App Gateways, App Services, storage, or any public endpoint).

    This tool provisions: the PROFILE + a default ENDPOINT (host name is
    auto-generated, e.g. "my-fd-xxx.azurefd.net"). If you pass `origin_hostname`,
    it ALSO creates a default origin group + origin pointing to it with
    sensible health-probe and load-balancing defaults.

    Provisioning takes 1-3 minutes for the profile, another ~30s per child.

    PRE-REQUISITES:
      1. `azure_create_resource_group(name, location="global" or any region)`
         — Front Door profiles live at resource-group scope even though they're
         global; the RG location can be any region.

    Args:
        name: Front Door profile name. GLOBAL uniqueness NOT required (the
              endpoint host name has a random suffix). 2-64 chars, alphanumeric + hyphens.
              Example: "fd-enterprise-prod".
        resource_group: Must exist.
        sku: "Standard_AzureFrontDoor" (default) or "Premium_AzureFrontDoor".
             Premium adds: managed WAF, Private Link origins, bot protection.
             Use Premium for prod compliance scenarios; Standard for dev/test.
        origin_hostname: OPTIONAL. Public hostname or IP of the ORIGIN that
                         Front Door will forward requests to.
                         Common values:
                         • "<appgw-name>-pip.<region>.cloudapp.azure.com"  (App Gateway public IP FQDN)
                         • "<appservice>.azurewebsites.net"
                         • "<storage>.blob.core.windows.net"
                         • "<raw ip>"  (if your App Gateway uses a static IP)
                         If provided, origin_group "default-origin-group" and
                         origin "default-origin" are auto-wired with HTTP/80
                         + HTTPS/443 + health probe GET / on HTTPS every 60s.
                         If omitted, you'll need to add origins later via portal/CLI.
        subscription_id: Optional override.
        tags: Optional tags.

    Returns:
        {
          success,
          front_door: {
            name, id, sku, provisioning_state,
            endpoint,             ← e.g. "fd-xxx-a1b2c3.azurefd.net" — point DNS at this
            [origin_group],       ← only if origin_hostname was given
            [origin]              ← the hostname you passed
          },
          executed_as
        }

    Chain with:
      • `azure_list_front_doors` to verify the profile is visible.
      • `azure_get_front_door(profile_name=name)` to fetch full config incl. routes.
      • DNS: add a CNAME from your custom domain → the returned `endpoint`.
      • Custom-domain attachment + routing rules are currently portal-only from
        this tool — mention that to the user if needed.

    COMMON PATTERN (FD → App Gateway → VMs):
      1. `azure_create_app_gateway(...)` — returns `app_gateway.frontend_ip`.
      2. Front Door accepts that raw IP as `origin_hostname`, OR if you want a
         stable FQDN, provision the App Gateway with a DNS label set on its
         public IP (portal/CLI step today — not exposed via a typed tool).
      3. `azure_create_front_door(origin_hostname="<ip_or_fqdn_from_step_1>")`.
    """
    # Each sub-step wraps its own try/except so a child failure (e.g. endpoint
    # or origin-group hiccup) doesn't mask the fact that the PROFILE did land.
    # Gap 1 from docs/releases/0.6.5-evidence/temporal-plan-landing.md: FastMCP
    # surfaced INTERNAL_ERROR even when Azure CDN reported success, because the
    # Azure SDK occasionally raises non-AzureError exceptions from LRO polling.
    user_info: Optional[Dict[str, Any]] = None
    partial_errors: List[str] = []
    try:
        from azure.mgmt.cdn import CdnManagementClient
        from azure.mgmt.cdn.models import (
            Profile, Sku as CdnSku,
            AFDEndpoint,
            AFDOriginGroup, AFDOrigin,
            LoadBalancingSettingsParameters, HealthProbeParameters,
        )

        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = CdnManagementClient(credential, sub_id)

        # 1. PROFILE — if this fails, the whole tool fails.
        profile = await _in_thread(lambda: client.profiles.begin_create(
            resource_group, name,
            Profile(location="global", sku=CdnSku(name=sku), tags=tags or {})
        ).result())

        # 2. DEFAULT ENDPOINT — best-effort. If LRO flakes, fall back to a
        # verify-by-get after a short pause; Azure's control plane is eventually
        # consistent for child resources of a just-created profile.
        endpoint_name = f"{name}-endpoint"
        endpoint_host: Optional[str] = None
        try:
            endpoint = await _in_thread(lambda: client.afd_endpoints.begin_create(
                resource_group, name, endpoint_name,
                AFDEndpoint(location="global")
            ).result())
            endpoint_host = getattr(endpoint, "host_name", None)
        except Exception as e:
            partial_errors.append(f"endpoint_create: {type(e).__name__}: {e}")
            # Verify-by-get fallback: the create may have succeeded even though
            # the LRO poller raised. Give Azure 3s then probe.
            await asyncio.sleep(3)
            try:
                fetched = await _in_thread(lambda: client.afd_endpoints.get(
                    resource_group, name, endpoint_name
                ))
                endpoint_host = getattr(fetched, "host_name", None)
            except Exception:
                pass
        if not endpoint_host:
            endpoint_host = f"{endpoint_name}-<random>.z01.azurefd.net"

        result = {
            "success": True,
            "front_door": {
                "name": profile.name, "id": profile.id,
                "sku": profile.sku.name if profile.sku else None,
                "provisioning_state": profile.provisioning_state,
                "endpoint": endpoint_host,
            },
            "executed_as": user_info,
        }

        # 3. Optional origin group + origin — also best-effort.
        if origin_hostname:
            og_name = "default-origin-group"
            try:
                await _in_thread(lambda: client.afd_origin_groups.begin_create(
                    resource_group, name, og_name,
                    AFDOriginGroup(
                        load_balancing_settings=LoadBalancingSettingsParameters(
                            sample_size=4, successful_samples_required=3,
                            additional_latency_in_milliseconds=50,
                        ),
                        health_probe_settings=HealthProbeParameters(
                            probe_path="/", probe_protocol="Https",
                            probe_interval_in_seconds=60,
                        ),
                    )
                ).result())
                result["front_door"]["origin_group"] = og_name
            except Exception as e:
                partial_errors.append(f"origin_group_create: {type(e).__name__}: {e}")

            try:
                await _in_thread(lambda: client.afd_origins.begin_create(
                    resource_group, name, og_name, "default-origin",
                    AFDOrigin(host_name=origin_hostname, http_port=80, https_port=443)
                ).result())
                result["front_door"]["origin"] = origin_hostname
            except Exception as e:
                partial_errors.append(f"origin_create: {type(e).__name__}: {e}")

        if partial_errors:
            result["partial_errors"] = partial_errors
            result["note"] = "Profile landed. Non-fatal child-resource warnings — verify with azure_get_front_door."
        return result
    except ImportError:
        return {"success": False, "error": "azure-mgmt-cdn package not installed. pip install azure-mgmt-cdn"}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info)
    except Exception as e:
        # Catch-all: broader than AzureError so we don't let random SDK
        # exceptions bubble up as FastMCP INTERNAL_ERROR. If the profile
        # might already exist, probe for it before declaring failure.
        try:
            from azure.mgmt.cdn import CdnManagementClient
            credential2, user_info2 = require_user_token(meta)
            probe_client = CdnManagementClient(credential2, subscription_id or DEFAULT_SUBSCRIPTION_ID)
            fetched_profile = await _in_thread(lambda: probe_client.profiles.get(resource_group, name))
            return {
                "success": True,
                "front_door": {
                    "name": fetched_profile.name,
                    "id": fetched_profile.id,
                    "sku": fetched_profile.sku.name if fetched_profile.sku else None,
                    "provisioning_state": fetched_profile.provisioning_state,
                    "endpoint": f"{name}-endpoint-<random>.z01.azurefd.net",
                },
                "executed_as": user_info2,
                "note": f"Creation raised {type(e).__name__} but profile exists — treating as success.",
                "partial_errors": [f"{type(e).__name__}: {e}"],
            }
        except Exception:
            return {"success": False, "error": f"{type(e).__name__}: {e}", "executed_as": user_info}
