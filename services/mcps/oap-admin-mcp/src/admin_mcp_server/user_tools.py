

"""
User Management Tools for Admin MCP Server

These tools allow admins to manage OpenAgentic platform users.
"""

import logging
from typing import Any, Dict, Optional
from .server import mcp, prisma_client

logger = logging.getLogger("admin-mcp.user-tools")

# ============================================================================
# USER MANAGEMENT TOOLS
# ============================================================================

@mcp.tool(description="List all OpenAgentic platform users with pagination (NOT Azure AD/Entra ID users)")
async def admin_system_users_list_all(
    limit: int = 20,
    offset: int = 0
) -> Dict[str, Any]:
    """List all system users with pagination"""

    if not prisma_client:
        raise RuntimeError("Database connection not available")

    try:
        # Get users with pagination
        users = await prisma_client.user.find_many(
            take=limit,
            skip=offset,
            order_by={"created_at": "desc"},
            select={
                "id": True,
                "email": True,
                "name": True,
                "is_admin": True,
                "created_at": True,
                "last_login_at": True
            }
        )

        # Get total count
        total = await prisma_client.user.count()

        logger.info(f"Listed {len(users)} users (total: {total})")

        return {
            "success": True,
            "users": users,
            "total": total,
            "limit": limit,
            "offset": offset
        }
    except Exception as e:
        logger.error(f"Failed to list users: {e}")
        raise RuntimeError(f"Failed to list users: {str(e)}")

@mcp.tool(description="Get detailed information about a specific OpenAgentic platform user (NOT Azure AD/Entra ID user)")
async def admin_system_users_get_by_id(user_id: str) -> Dict[str, Any]:
    """Get user details by ID"""

    if not prisma_client:
        raise RuntimeError("Database connection not available")

    try:
        user = await prisma_client.user.find_unique(
            where={"id": user_id},
            include={
                "sessions": {
                    "take": 5,
                    "order_by": {"created_at": "desc"}
                }
            }
        )

        if not user:
            raise ValueError(f"User with ID '{user_id}' not found")

        logger.info(f"Retrieved user info: {user_id}")

        return {
            "success": True,
            "user": user
        }
    except Exception as e:
        logger.error(f"Failed to get user: {e}")
        raise RuntimeError(f"Failed to get user: {str(e)}")

    # admin_system_users_update_properties REMOVED - write operations not allowed in admin MCP
    # User management should be done through the Admin UI or API, not via MCP tools
