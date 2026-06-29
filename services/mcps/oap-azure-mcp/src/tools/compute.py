"""Azure MCP — compute tools.

Virtual machine lifecycle tools.
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
    'azure_list_vms',
    'azure_get_vm',
    'azure_start_vm',
    'azure_stop_vm',
    'azure_restart_vm',
    'azure_delete_vm',
    'azure_deallocate_vm',
    'azure_resize_vm',
    'azure_create_vm',
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
        "goldenPrompts": ["list my vms", "show me vms", "what vms do i have"],
        "testFixture": None,
    },
)
async def azure_list_vms(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List virtual machines.

    Args:
        resource_group: Filter by resource group (lists all if not specified)
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)

        if resource_group:
            vms = list(client.virtual_machines.list(resource_group))
        else:
            vms = list(client.virtual_machines.list_all())

        return {
            "success": True,
            "count": len(vms),
            "virtual_machines": [
                {
                    "name": vm.name,
                    "location": vm.location,
                    "resource_group": vm.id.split('/')[4] if vm.id else None,
                    "vm_size": vm.hardware_profile.vm_size if vm.hardware_profile else None,
                    "os_type": vm.storage_profile.os_disk.os_type.value if vm.storage_profile and vm.storage_profile.os_disk else None,
                    "provisioning_state": vm.provisioning_state,
                    "tags": vm.tags or {}
                }
                for vm in vms
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
        "goldenPrompts": ["get vm details", "show me one vm"],
        "testFixture": None,
    },
)
async def azure_get_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    include_instance_view: bool = True,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get detailed information about a specific VM.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
        include_instance_view: Include power state and other runtime info
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)

        expand = "instanceView" if include_instance_view else None
        vm = client.virtual_machines.get(resource_group, name, expand=expand)

        result = {
            "name": vm.name,
            "id": vm.id,
            "location": vm.location,
            "vm_size": vm.hardware_profile.vm_size if vm.hardware_profile else None,
            "provisioning_state": vm.provisioning_state,
            "os_type": vm.storage_profile.os_disk.os_type.value if vm.storage_profile and vm.storage_profile.os_disk else None,
            "os_disk": vm.storage_profile.os_disk.name if vm.storage_profile and vm.storage_profile.os_disk else None,
            "tags": vm.tags or {}
        }

        if include_instance_view and vm.instance_view:
            statuses = vm.instance_view.statuses or []
            power_state = next((s.display_status for s in statuses if s.code and s.code.startswith("PowerState/")), "Unknown")
            result["power_state"] = power_state
            result["vm_agent_status"] = vm.instance_view.vm_agent.statuses[0].display_status if vm.instance_view.vm_agent and vm.instance_view.vm_agent.statuses else None

        return {
            "success": True,
            "vm": result,
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
async def azure_start_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Start a virtual machine.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_start(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' start operation initiated",
            "vm_name": name,
            "resource_group": resource_group,
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
async def azure_stop_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Stop (deallocate) a virtual machine.

    This deallocates the VM, stopping billing for compute (storage still billed).

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_deallocate(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' stop (deallocate) operation initiated",
            "vm_name": name,
            "resource_group": resource_group,
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
async def azure_restart_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Restart a virtual machine.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_restart(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' restart operation initiated",
            "vm_name": name,
            "resource_group": resource_group,
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
async def azure_delete_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Delete (destroy) a virtual machine.

    DESTRUCTIVE: this permanently deletes the VM. The OS disk, NIC, and
    public IP may be left orphaned (use the portal or a follow-up call to
    clean those up). HITL approval is required from the chatmode cascade
    before this tool is invoked.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_delete(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' delete operation initiated",
            "vm_name": name,
            "resource_group": resource_group,
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
async def azure_deallocate_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Deallocate a virtual machine (stops billing for compute).

    Equivalent to ``azure_stop_vm`` — kept under the explicit name so the
    Smart Router can match deallocate-specific prompts ("deallocate the
    web-01 VM to stop billing") without keyword-matching to "stop".

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_deallocate(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' deallocate operation initiated (compute billing stopped)",
            "vm_name": name,
            "resource_group": resource_group,
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
async def azure_resize_vm(
    name: str,
    resource_group: str,
    vm_size: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Resize a virtual machine to a new SKU.

    DESTRUCTIVE: this restarts the VM with new hardware. In-flight workloads
    are interrupted. The new SKU must be available in the VM's region. HITL
    approval is required from the chatmode cascade before this tool is invoked.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        vm_size: Target SKU (e.g. ``Standard_B2s``, ``Standard_D4s_v5``)
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        # Update path: change hardware_profile.vm_size on the VM resource.
        # The Azure SDK accepts a partial dict for begin_update.
        poller = client.virtual_machines.begin_update(
            resource_group,
            name,
            {"hardware_profile": {"vm_size": vm_size}},
        )

        return {
            "success": True,
            "message": f"VM '{name}' resize to {vm_size} initiated",
            "vm_name": name,
            "resource_group": resource_group,
            "vm_size": vm_size,
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
async def azure_create_vm(
    name: str,
    resource_group: str,
    location: str,
    image: str = "Canonical:0001-com-ubuntu-server-jammy:22_04-lts-gen2:latest",
    size: str = "Standard_B1s",
    admin_username: str = "azureuser",
    ssh_public_key: Optional[str] = None,
    admin_password: Optional[str] = None,
    vnet_name: Optional[str] = None,
    subnet_name: Optional[str] = None,
    create_public_ip: bool = True,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a basic Azure VM with a NIC, optional public IP, and a single OS
    disk. For Linux, pass an SSH public key (preferred). For Windows, pass an
    admin_password. The default image is Ubuntu 22.04 LTS Gen2.

    This is the minimal-viable VM create — for production VMs with managed
    identity, data disks, NSG rules, custom user data, etc, use a Bicep/ARM
    deployment instead.

    Args:
        name: VM name
        resource_group: Resource group (must already exist)
        location: Azure region
        image: URN — 'Publisher:Offer:Sku:Version' (default Ubuntu 22.04 LTS)
        size: VM SKU — Standard_B1s (cheapest), Standard_D2s_v5 (general), etc
        admin_username: Linux/Windows admin username
        ssh_public_key: SSH public key content (Linux only)
        admin_password: Admin password (Windows or Linux fallback)
        vnet_name: VNet to attach to (created if not specified — wires up a
                   default 10.0.0.0/16 vnet with subnet 10.0.0.0/24)
        subnet_name: Subnet within the vnet (default 'default')
        create_public_ip: Allocate a public IP (default True)
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        net_client = NetworkManagementClient(credential, sub_id)
        compute_client = ComputeManagementClient(credential, sub_id)

        # 1. VNet + subnet (create if not provided)
        actual_vnet = vnet_name or f"{name}-vnet"
        actual_subnet = subnet_name or "default"
        if not vnet_name:
            net_client.virtual_networks.begin_create_or_update(
                resource_group, actual_vnet,
                {
                    "location": location,
                    "address_space": {"address_prefixes": ["10.0.0.0/16"]},
                    "subnets": [{"name": actual_subnet, "address_prefix": "10.0.0.0/24"}],
                }
            ).result()

        subnet_id = (
            f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.Network/virtualNetworks/{actual_vnet}/subnets/{actual_subnet}"
        )

        # 2. Public IP
        ip_config: Dict[str, Any] = {"subnet": {"id": subnet_id}}
        if create_public_ip:
            pip = net_client.public_ip_addresses.begin_create_or_update(
                resource_group, f"{name}-pip",
                {"location": location, "public_ip_allocation_method": "Dynamic"}
            ).result()
            ip_config["public_ip_address"] = {"id": pip.id}

        # 3. NIC
        nic = net_client.network_interfaces.begin_create_or_update(
            resource_group, f"{name}-nic",
            {
                "location": location,
                "ip_configurations": [{"name": "ipconfig1", **ip_config}],
            }
        ).result()

        # 4. VM
        urn_parts = image.split(":")
        if len(urn_parts) != 4:
            return {"success": False, "error": f"Image URN must have 4 parts (Publisher:Offer:Sku:Version), got: {image}"}
        publisher, offer, sku, version = urn_parts

        os_profile: Dict[str, Any] = {
            "computer_name": name,
            "admin_username": admin_username,
        }
        if ssh_public_key:
            os_profile["linux_configuration"] = {
                "disable_password_authentication": True,
                "ssh": {"public_keys": [{
                    "path": f"/home/{admin_username}/.ssh/authorized_keys",
                    "key_data": ssh_public_key,
                }]},
            }
        elif admin_password:
            os_profile["admin_password"] = admin_password
        else:
            return {"success": False, "error": "Either ssh_public_key or admin_password is required"}

        vm_params: Dict[str, Any] = {
            "location": location,
            "tags": tags or {},
            "hardware_profile": {"vm_size": size},
            "storage_profile": {
                "image_reference": {
                    "publisher": publisher,
                    "offer": offer,
                    "sku": sku,
                    "version": version,
                },
            },
            "os_profile": os_profile,
            "network_profile": {"network_interfaces": [{"id": nic.id, "primary": True}]},
        }
        poller = compute_client.virtual_machines.begin_create_or_update(
            resource_group_name=resource_group,
            vm_name=name,
            parameters=vm_params,
        )
        vm = poller.result()
        return {
            "success": True,
            "vm": {
                "name": vm.name,
                "id": vm.id,
                "location": vm.location,
                "size": vm.hardware_profile.vm_size if vm.hardware_profile else None,
                "tags": vm.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
