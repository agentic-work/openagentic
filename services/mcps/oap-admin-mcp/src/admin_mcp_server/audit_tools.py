# Proprietary and confidential. Unauthorized copying prohibited.

"""
Audit Log Query Tools for Admin MCP Server

These tools allow admins to query and analyze audit logs.
"""

import logging
from typing import Any, Dict, Optional, List
from datetime import datetime
from .server import mcp, prisma_client

logger = logging.getLogger("admin-mcp.audit-tools")

# ============================================================================
# AUDIT LOG QUERY TOOLS
# ============================================================================

@mcp.tool(description="Get detailed user activity from both admin audit logs and user query audit logs with comprehensive filtering")
async def admin_audit_get_user_activity(
    user_id: Optional[str] = None,
    email: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    event_type: Optional[str] = None,
    action: Optional[str] = None,
    success: Optional[bool] = None,
    limit: int = 100,
    include_details: bool = True
) -> Dict[str, Any]:
    """Get user activity from audit logs"""

    if not prisma_client:
        raise RuntimeError("Database connection not available")

    try:
        # Build filters
        filters = {}

        if start_date:
            filters["created_at"] = {"gte": datetime.fromisoformat(start_date)}
        if end_date:
            if "created_at" in filters:
                filters["created_at"]["lte"] = datetime.fromisoformat(end_date)
            else:
                filters["created_at"] = {"lte": datetime.fromisoformat(end_date)}

        results = []

        # Query AdminAuditLog table
        try:
            admin_filters = filters.copy()
            if user_id:
                admin_filters["admin_user_id"] = user_id
            if email:
                admin_filters["admin_email"] = email
            if action:
                admin_filters["action"] = {"contains": action, "mode": "insensitive"}

            admin_logs = await prisma_client.adminauditlog.find_many(
                where=admin_filters,
                include={"user": {"select": {"id": True, "name": True, "email": True}}},
                order_by={"created_at": "desc"},
                take=min(limit, 500)
            )

            for log in admin_logs:
                details = log.details if include_details else {}
                results.append({
                    "type": "admin_audit",
                    "id": log.id,
                    "userId": log.admin_user_id,
                    "userEmail": log.admin_email or (log.user.email if log.user else None),
                    "userName": log.user.name if log.user else "Unknown",
                    "action": log.action,
                    "resourceType": log.resource_type,
                    "resourceId": log.resource_id,
                    "ipAddress": log.ip_address,
                    "timestamp": log.created_at.isoformat(),
                    "details": details,
                    "eventType": details.get("eventType", "ADMIN_ACTION") if details else "ADMIN_ACTION",
                    "success": details.get("success", True) if details else True
                })
        except Exception as e:
            logger.error(f"Failed to query AdminAuditLog: {e}")

        # Query UserQueryAudit table
        try:
            user_filters = filters.copy()
            if user_id:
                user_filters["user_id"] = user_id
            if success is not None:
                user_filters["success"] = success

            user_logs = await prisma_client.userqueryaudit.find_many(
                where=user_filters,
                include={"user": {"select": {"id": True, "name": True, "email": True}}},
                order_by={"created_at": "desc"},
                take=min(limit, 500)
            )

            for log in user_logs:
                # Filter by email if specified (post-query filter)
                if email and (not log.user or log.user.email != email):
                    continue

                results.append({
                    "type": "user_query_audit",
                    "id": log.id,
                    "userId": log.user_id,
                    "userEmail": log.user.email if log.user else None,
                    "userName": log.user.name if log.user else "Unknown",
                    "action": f"User Query: {log.query_type}",
                    "query": log.raw_query,
                    "intent": log.intent,
                    "sessionId": log.session_id,
                    "messageId": log.message_id,
                    "mcpServer": log.mcp_server,
                    "toolsCalled": log.tools_called,
                    "success": log.success,
                    "errorMessage": log.error_message,
                    "errorCode": log.error_code,
                    "ipAddress": log.ip_address,
                    "userAgent": log.user_agent,
                    "timestamp": log.created_at.isoformat(),
                    "eventType": "USER_QUERY"
                })
        except Exception as e:
            logger.error(f"Failed to query UserQueryAudit: {e}")

        # Sort by timestamp and limit
        results.sort(key=lambda x: x["timestamp"], reverse=True)
        limited_results = results[:limit]

        # Apply additional filters
        filtered_results = limited_results
        if event_type:
            filtered_results = [r for r in filtered_results if r.get("eventType") == event_type]
        if success is not None:
            filtered_results = [r for r in filtered_results if r.get("success") == success]

        logger.info(f"User activity query completed: {len(filtered_results)} records")

        return {
            "success": True,
            "totalRecords": len(results),
            "returnedRecords": len(filtered_results),
            "records": filtered_results
        }
    except Exception as e:
        logger.error(f"Failed to get user activity: {e}")
        raise RuntimeError(f"Failed to get user activity: {str(e)}")

@mcp.tool(description="Get all user chat messages and interactions from audit logs with advanced filtering and search")
async def admin_audit_get_user_chats(
    user_id: Optional[str] = None,
    search_query: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    mcp_server: Optional[str] = None,
    tools_used: Optional[str] = None,
    session_id: Optional[str] = None,
    failures_only: bool = False,
    limit: int = 200
) -> Dict[str, Any]:
    """Get user chat history from audit logs"""

    if not prisma_client:
        raise RuntimeError("Database connection not available")

    try:
        # Build filters
        filters = {}

        if user_id:
            filters["user_id"] = user_id
        if start_date:
            filters["created_at"] = {"gte": datetime.fromisoformat(start_date)}
        if end_date:
            if "created_at" in filters:
                filters["created_at"]["lte"] = datetime.fromisoformat(end_date)
            else:
                filters["created_at"] = {"lte": datetime.fromisoformat(end_date)}
        if mcp_server:
            filters["mcp_server"] = mcp_server
        if session_id:
            filters["session_id"] = session_id
        if failures_only:
            filters["success"] = False

        user_logs = await prisma_client.userqueryaudit.find_many(
            where=filters,
            include={"user": {"select": {"id": True, "name": True, "email": True}}},
            order_by={"created_at": "desc"},
            take=min(limit, 1000)
        )

        results = [
            {
                "id": log.id,
                "userId": log.user_id,
                "userEmail": log.user.email if log.user else None,
                "userName": log.user.name if log.user else "Unknown",
                "queryType": log.query_type,
                "rawQuery": log.raw_query,
                "intent": log.intent,
                "sessionId": log.session_id,
                "messageId": log.message_id,
                "mcpServer": log.mcp_server,
                "toolsCalled": log.tools_called,
                "success": log.success,
                "errorMessage": log.error_message,
                "errorCode": log.error_code,
                "ipAddress": log.ip_address,
                "userAgent": log.user_agent,
                "timestamp": log.created_at.isoformat()
            }
            for log in user_logs
        ]

        # Apply text search filters
        if search_query:
            search_lower = search_query.lower()
            results = [
                r for r in results
                if (r.get("rawQuery") and search_lower in r["rawQuery"].lower()) or
                   (r.get("intent") and search_lower in r["intent"].lower()) or
                   (r.get("toolsCalled") and search_lower in str(r["toolsCalled"]).lower())
            ]

        if tools_used:
            tools_lower = tools_used.lower()
            results = [
                r for r in results
                if r.get("toolsCalled") and tools_lower in str(r["toolsCalled"]).lower()
            ]

        logger.info(f"User chats query completed: {len(results)} records")

        return {
            "success": True,
            "totalRecords": len(results),
            "records": results
        }
    except Exception as e:
        logger.error(f"Failed to get user chats: {e}")
        raise RuntimeError(f"Failed to get user chats: {str(e)}")

@mcp.tool(description="Get comprehensive login/logout history with geographic and security analysis")
async def admin_audit_get_login_history(
    user_id: Optional[str] = None,
    email: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    auth_type: str = "all",
    failed_only: bool = False,
    include_ip_analysis: bool = True,
    limit: int = 500
) -> Dict[str, Any]:
    """Get login/logout history from audit logs"""

    if not prisma_client:
        raise RuntimeError("Database connection not available")

    try:
        # Build filters
        filters = {}

        if user_id:
            filters["admin_user_id"] = user_id
        if email:
            filters["admin_email"] = email
        if start_date:
            filters["created_at"] = {"gte": datetime.fromisoformat(start_date)}
        if end_date:
            if "created_at" in filters:
                filters["created_at"]["lte"] = datetime.fromisoformat(end_date)
            else:
                filters["created_at"] = {"lte": datetime.fromisoformat(end_date)}

        # Query login/logout events
        filters["action"] = {
            "in": [
                "Token validation successful",
                "Login token validation successful",
                "Azure AD OAuth login successful",
                "User logout successful"
            ]
        }

        login_logs = await prisma_client.adminauditlog.find_many(
            where=filters,
            include={"user": {"select": {"id": True, "name": True, "email": True}}},
            order_by={"created_at": "desc"},
            take=min(limit, 1000)
        )

        results = []
        for log in login_logs:
            details = log.details or {}
            is_login = "login" in log.action.lower() or "validation" in log.action.lower()
            is_logout = "logout" in log.action.lower()
            success_val = details.get("success", True)

            results.append({
                "id": log.id,
                "userId": log.admin_user_id,
                "userEmail": log.admin_email or (log.user.email if log.user else None),
                "userName": log.user.name if log.user else "Unknown",
                "action": log.action,
                "type": "LOGIN" if is_login else ("LOGOUT" if is_logout else "OTHER"),
                "success": success_val,
                "authType": details.get("authType", "unknown"),
                "endpoint": details.get("endpoint", ""),
                "ipAddress": log.ip_address,
                "userAgent": details.get("userAgent", ""),
                "timestamp": log.created_at.isoformat(),
                "sessionId": details.get("sessionId"),
                "isAdmin": details.get("isAdmin"),
                "groupCount": details.get("groupCount"),
                "tenantId": details.get("tenantId")
            })

        # Apply filters
        if auth_type != "all":
            results = [r for r in results if r.get("authType") == auth_type]
        if failed_only:
            results = [r for r in results if not r.get("success")]

        # IP Analysis
        ip_analysis = None
        if include_ip_analysis and results:
            ip_counts = {}
            user_agent_counts = {}

            for record in results:
                if record.get("ipAddress"):
                    ip = record["ipAddress"]
                    ip_counts[ip] = ip_counts.get(ip, 0) + 1
                if record.get("userAgent"):
                    ua = record["userAgent"]
                    user_agent_counts[ua] = user_agent_counts.get(ua, 0) + 1

            ip_analysis = {
                "uniqueIPs": len(ip_counts),
                "topIPs": sorted(
                    [{"ip": ip, "count": count} for ip, count in ip_counts.items()],
                    key=lambda x: x["count"],
                    reverse=True
                )[:10],
                "uniqueUserAgents": len(user_agent_counts),
                "topUserAgents": sorted(
                    [{"userAgent": ua, "count": count} for ua, count in user_agent_counts.items()],
                    key=lambda x: x["count"],
                    reverse=True
                )[:5]
            }

        logger.info(f"Login history query completed: {len(results)} records")

        return {
            "success": True,
            "totalRecords": len(results),
            "records": results,
            "ipAnalysis": ip_analysis
        }
    except Exception as e:
        logger.error(f"Failed to get login history: {e}")
        raise RuntimeError(f"Failed to get login history: {str(e)}")

@mcp.tool(description="Get comprehensive error analysis from audit logs with categorization and trends")
async def admin_audit_get_error_analysis(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    error_type: Optional[str] = None,
    user_id: Optional[str] = None,
    include_stack_traces: bool = False,
    group_by: str = "error_type",
    limit: int = 1000
) -> Dict[str, Any]:
    """Get error analysis from audit logs"""

    if not prisma_client:
        raise RuntimeError("Database connection not available")

    try:
        # Build filters
        filters = {"success": False}

        if start_date:
            filters["created_at"] = {"gte": datetime.fromisoformat(start_date)}
        if end_date:
            if "created_at" in filters:
                filters["created_at"]["lte"] = datetime.fromisoformat(end_date)
            else:
                filters["created_at"] = {"lte": datetime.fromisoformat(end_date)}
        if user_id:
            filters["user_id"] = user_id

        error_logs = await prisma_client.userqueryaudit.find_many(
            where=filters,
            include={"user": {"select": {"id": True, "name": True, "email": True}}},
            order_by={"created_at": "desc"},
            take=min(limit, 2000)
        )

        results = [
            {
                "id": log.id,
                "userId": log.user_id,
                "userEmail": log.user.email if log.user else None,
                "userName": log.user.name if log.user else "Unknown",
                "errorMessage": log.error_message,
                "errorCode": log.error_code,
                "queryType": log.query_type,
                "rawQuery": log.raw_query if include_stack_traces else (log.raw_query[:200] if log.raw_query else None),
                "mcpServer": log.mcp_server,
                "timestamp": log.created_at.isoformat(),
                "ipAddress": log.ip_address
            }
            for log in error_logs
        ]

        # Apply error type filter
        if error_type:
            error_type_lower = error_type.lower()
            results = [
                r for r in results
                if (r.get("errorMessage") and error_type_lower in r["errorMessage"].lower()) or
                   (r.get("errorCode") and error_type_lower in r["errorCode"].lower())
            ]

        # Group analysis
        analysis = {}
        if group_by == "error_type":
            error_groups = {}
            for error in results:
                key = error.get("errorCode") or (error.get("errorMessage", "").split("\n")[0] if error.get("errorMessage") else "Unknown Error")
                error_groups[key] = error_groups.get(key, 0) + 1

            analysis["errorsByType"] = sorted(
                [(k, v) for k, v in error_groups.items()],
                key=lambda x: x[1],
                reverse=True
            )[:20]
        elif group_by == "user":
            user_groups = {}
            for error in results:
                key = error.get("userEmail") or error.get("userId") or "Unknown User"
                user_groups[key] = user_groups.get(key, 0) + 1

            analysis["errorsByUser"] = sorted(
                [(k, v) for k, v in user_groups.items()],
                key=lambda x: x[1],
                reverse=True
            )[:20]

        logger.info(f"Error analysis completed: {len(results)} errors")

        return {
            "success": True,
            "totalErrors": len(results),
            "errors": results,
            "analysis": analysis
        }
    except Exception as e:
        logger.error(f"Failed to get error analysis: {e}")
        raise RuntimeError(f"Failed to get error analysis: {str(e)}")

@mcp.tool(description="Get comprehensive usage statistics and analytics from audit logs")
async def admin_audit_get_usage_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    time_granularity: str = "day",
    include_user_breakdown: bool = True,
    include_mcp_usage: bool = True,
    include_geo_analysis: bool = False,
    top_n: int = 20
) -> Dict[str, Any]:
    """Get usage statistics from audit logs"""

    if not prisma_client:
        raise RuntimeError("Database connection not available")

    try:
        # Build filters
        filters = {}

        if start_date:
            filters["created_at"] = {"gte": datetime.fromisoformat(start_date)}
        if end_date:
            if "created_at" in filters:
                filters["created_at"]["lte"] = datetime.fromisoformat(end_date)
            else:
                filters["created_at"] = {"lte": datetime.fromisoformat(end_date)}

        # Get data
        user_query_data = await prisma_client.userqueryaudit.find_many(
            where=filters,
            include={"user": {"select": {"id": True, "name": True, "email": True}}},
            order_by={"created_at": "desc"}
        )

        admin_audit_data = await prisma_client.adminauditlog.find_many(
            where=filters,
            include={"user": {"select": {"id": True, "name": True, "email": True}}},
            order_by={"created_at": "desc"}
        )

        # Calculate statistics
        statistics = {
            "period": {"startDate": start_date, "endDate": end_date},
            "totals": {
                "userQueries": len(user_query_data),
                "adminActions": len(admin_audit_data),
                "successfulQueries": sum(1 for q in user_query_data if q.success),
                "failedQueries": sum(1 for q in user_query_data if not q.success),
                "uniqueUsers": len(set(
                    [q.user_id for q in user_query_data if q.user_id] +
                    [a.admin_user_id for a in admin_audit_data if a.admin_user_id]
                ))
            }
        }

        # User breakdown
        if include_user_breakdown:
            user_activity = {}

            for query in user_query_data:
                user_id = query.user_id
                if not user_id:
                    continue

                if user_id not in user_activity:
                    user_activity[user_id] = {
                        "userId": user_id,
                        "userEmail": query.user.email if query.user else "Unknown",
                        "userName": query.user.name if query.user else "Unknown",
                        "queries": 0,
                        "adminActions": 0,
                        "successfulQueries": 0,
                        "failedQueries": 0,
                        "lastActivity": query.created_at.isoformat()
                    }

                user_activity[user_id]["queries"] += 1
                if query.success:
                    user_activity[user_id]["successfulQueries"] += 1
                else:
                    user_activity[user_id]["failedQueries"] += 1

            for action in admin_audit_data:
                user_id = action.admin_user_id
                if not user_id:
                    continue

                if user_id not in user_activity:
                    user_activity[user_id] = {
                        "userId": user_id,
                        "userEmail": action.admin_email or (action.user.email if action.user else "Unknown"),
                        "userName": action.user.name if action.user else "Unknown",
                        "queries": 0,
                        "adminActions": 0,
                        "successfulQueries": 0,
                        "failedQueries": 0,
                        "lastActivity": action.created_at.isoformat()
                    }

                user_activity[user_id]["adminActions"] += 1

            statistics["topUsers"] = sorted(
                user_activity.values(),
                key=lambda x: x["queries"] + x["adminActions"],
                reverse=True
            )[:top_n]

        # MCP usage breakdown
        if include_mcp_usage:
            mcp_usage = {}
            tool_usage = {}

            for query in user_query_data:
                if query.mcp_server:
                    mcp_usage[query.mcp_server] = mcp_usage.get(query.mcp_server, 0) + 1

                if query.tools_called and isinstance(query.tools_called, list):
                    for tool in query.tools_called:
                        if isinstance(tool, str):
                            tool_usage[tool] = tool_usage.get(tool, 0) + 1
                        elif isinstance(tool, dict) and "name" in tool:
                            tool_usage[tool["name"]] = tool_usage.get(tool["name"], 0) + 1

            statistics["mcpUsage"] = {
                "totalMcpCalls": sum(mcp_usage.values()),
                "topMcpServers": sorted(
                    [(k, v) for k, v in mcp_usage.items()],
                    key=lambda x: x[1],
                    reverse=True
                )[:10],
                "topTools": sorted(
                    [(k, v) for k, v in tool_usage.items()],
                    key=lambda x: x[1],
                    reverse=True
                )[:top_n]
            }

        # Geographic analysis
        if include_geo_analysis:
            ip_counts = {}

            for query in user_query_data:
                if query.ip_address:
                    ip_counts[query.ip_address] = ip_counts.get(query.ip_address, 0) + 1

            for action in admin_audit_data:
                if action.ip_address:
                    ip_counts[action.ip_address] = ip_counts.get(action.ip_address, 0) + 1

            statistics["geoAnalysis"] = {
                "uniqueIPs": len(ip_counts),
                "topIPs": sorted(
                    [(k, v) for k, v in ip_counts.items()],
                    key=lambda x: x[1],
                    reverse=True
                )[:top_n]
            }

        logger.info(f"Usage statistics completed")

        return {
            "success": True,
            "statistics": statistics
        }
    except Exception as e:
        logger.error(f"Failed to get usage statistics: {e}")
        raise RuntimeError(f"Failed to get usage statistics: {str(e)}")
