"""Azure MCP — identity tools.

Microsoft Graph (users/groups/apps) + RBAC role assignments.
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
    'azure_list_users',
    'azure_get_user',
    'azure_list_groups',
    'azure_list_apps',
    'azure_list_role_assignments',
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
        "goldenPrompts": ["list my users", "show me users", "what users do i have"],
        "testFixture": None,
    },
)
async def azure_list_users(
    filter_query: Optional[str] = None,
    top: int = 100,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure AD / Entra ID users.

    Args:
        filter_query: OData filter (e.g., "startswith(displayName,'John')")
        top: Maximum number of users to return
    """
    try:
        credential, user_info = require_user_token(meta, "graphAccessToken")

        graph_client = GraphServiceClient(credential)

        # Build request
        request = graph_client.users.get()

        # Note: Graph SDK pagination and filtering would be applied here
        # For now, return basic list
        users_response = await request

        users = []
        if users_response and users_response.value:
            for user in users_response.value[:top]:
                users.append({
                    "id": user.id,
                    "display_name": user.display_name,
                    "user_principal_name": user.user_principal_name,
                    "mail": user.mail,
                    "job_title": user.job_title,
                    "department": user.department,
                    "account_enabled": user.account_enabled
                })

        return {
            "success": True,
            "count": len(users),
            "users": users,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__}


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
        "goldenPrompts": ["get user details", "show me one user"],
        "testFixture": None,
    },
)
async def azure_get_user(
    user_id: str,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get details of a specific Azure AD user.

    Args:
        user_id: User ID or user principal name (email)
    """
    try:
        credential, user_info = require_user_token(meta, "graphAccessToken")

        graph_client = GraphServiceClient(credential)
        user = await graph_client.users.by_user_id(user_id).get()

        return {
            "success": True,
            "user": {
                "id": user.id,
                "display_name": user.display_name,
                "user_principal_name": user.user_principal_name,
                "mail": user.mail,
                "given_name": user.given_name,
                "surname": user.surname,
                "job_title": user.job_title,
                "department": user.department,
                "office_location": user.office_location,
                "mobile_phone": user.mobile_phone,
                "account_enabled": user.account_enabled,
                "created_date_time": user.created_date_time.isoformat() if user.created_date_time else None
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__}


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
        "goldenPrompts": ["list my groups", "show me groups", "what groups do i have"],
        "testFixture": None,
    },
)
async def azure_list_groups(
    filter_query: Optional[str] = None,
    top: int = 100,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure AD / Entra ID groups.

    Args:
        filter_query: OData filter
        top: Maximum number of groups to return
    """
    try:
        credential, user_info = require_user_token(meta, "graphAccessToken")

        graph_client = GraphServiceClient(credential)
        groups_response = await graph_client.groups.get()

        groups = []
        if groups_response and groups_response.value:
            for group in groups_response.value[:top]:
                groups.append({
                    "id": group.id,
                    "display_name": group.display_name,
                    "description": group.description,
                    "mail": group.mail,
                    "mail_enabled": group.mail_enabled,
                    "security_enabled": group.security_enabled,
                    "group_types": group.group_types or []
                })

        return {
            "success": True,
            "count": len(groups),
            "groups": groups,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__}


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
        "goldenPrompts": ["list my apps", "show me apps", "what apps do i have"],
        "testFixture": None,
    },
)
async def azure_list_apps(
    top: int = 100,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure AD app registrations.

    Args:
        top: Maximum number of apps to return
    """
    try:
        credential, user_info = require_user_token(meta, "graphAccessToken")

        graph_client = GraphServiceClient(credential)
        apps_response = await graph_client.applications.get()

        apps = []
        if apps_response and apps_response.value:
            for app in apps_response.value[:top]:
                apps.append({
                    "id": app.id,
                    "app_id": app.app_id,
                    "display_name": app.display_name,
                    "sign_in_audience": app.sign_in_audience,
                    "created_date_time": app.created_date_time.isoformat() if app.created_date_time else None,
                    "identifier_uris": app.identifier_uris or []
                })

        return {
            "success": True,
            "count": len(apps),
            "applications": apps,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__}


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
        "goldenPrompts": ["list my role assignments", "show me role assignments", "what role assignments do i have"],
        "testFixture": None,
    },
)
async def azure_list_role_assignments(
    scope: Optional[str] = None,
    principal_id: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure RBAC role assignments. Use for security audits, IAM reviews,
    and incident response (UC-028).

    Args:
        scope: Optional scope filter (e.g. '/subscriptions/<id>',
               '/subscriptions/<id>/resourceGroups/<name>'). Defaults to the
               full subscription.
        principal_id: Optional filter by user/group/SP object ID
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = AuthorizationManagementClient(credential, sub_id)
        actual_scope = scope or f"/subscriptions/{sub_id}"

        if principal_id:
            assignments = client.role_assignments.list_for_scope(
                scope=actual_scope,
                filter=f"principalId eq '{principal_id}'",
            )
        else:
            assignments = client.role_assignments.list_for_scope(scope=actual_scope)

        results = []
        for ra in assignments:
            results.append({
                "id": ra.id,
                "principal_id": ra.principal_id,
                "principal_type": ra.principal_type,
                "role_definition_id": ra.role_definition_id,
                "scope": ra.scope,
            })
        return {
            "success": True,
            "count": len(results),
            "scope": actual_scope,
            "role_assignments": results,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
