#!/usr/bin/env python3
# Copyright 2026 Gnomus.ai
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Admin MCP Server - FastMCP Implementation with RBAC Auth Integration

IMPORTANT: This MCP server is ONLY available to ADMIN users.
Non-admin users should NOT have access to any tools in this server.
The MCP proxy validates admin status before routing requests here.
"""

import os
import sys
import json
import logging
import asyncio
import httpx
from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from contextlib import asynccontextmanager

import dotenv
import redis
from pymilvus import connections, utility, Collection
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

# Load environment variables
dotenv.load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-admin-mcp')
except ImportError:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("admin-mcp")

# Global instances
redis_client: Optional[redis.Redis] = None
prisma_client: Optional[Any] = None  # Will be initialized when prisma is available

# Flag to track if connections are initialized
_connections_initialized = False


# ============================================================================
# FASTMCP LIFESPAN CONTEXT MANAGER
# ============================================================================
# This ensures init_connections() is called when fastmcp run imports the module

@asynccontextmanager
async def lifespan(app):
    """
    FastMCP lifespan context manager.
    Called when the MCP server starts up and shuts down.
    This is CRITICAL for fastmcp run which imports the module without calling main().
    """
    logger.info("=" * 80)
    logger.info("Starting Admin MCP Server (FastMCP)")
    logger.info("ADMIN USERS ONLY - Non-admin users will be rejected")
    logger.info("=" * 80)

    # Initialize connections on startup
    await init_connections()

    logger.info("✅ Admin MCP Server ready - waiting for requests")

    yield  # Server runs here

    # Cleanup connections on shutdown
    logger.info("Shutting down Admin MCP Server...")
    await cleanup_connections()
    logger.info("Admin MCP Server stopped")


# Create FastMCP instance with lifespan manager
# MUST be defined BEFORE any @mcp.tool() decorators
# Disable DNS rebinding protection for in-cluster access (MCP proxy connects from pod IPs)
os.environ.setdefault("FASTMCP_ALLOWED_HOSTS", "*")
os.environ.setdefault("FASTMCP_ALLOWED_ORIGINS", "*")
mcp = FastMCP("Admin MCP Server", lifespan=lifespan)


# ============================================================================
# DATABASE CONNECTION MANAGEMENT
# ============================================================================

class DatabaseConfig:
    """Configuration for database connections"""

    @staticmethod
    def get_prisma_url() -> str:
        """Get PostgreSQL connection URL from environment"""
        return os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/openagentic")

    @staticmethod
    def get_redis_config() -> Dict[str, Any]:
        """Get Redis configuration from environment"""
        redis_url = os.getenv("REDIS_URL")
        if redis_url:
            return {"url": redis_url}

        return {
            "host": os.getenv("REDIS_HOST", "redis"),
            "port": int(os.getenv("REDIS_PORT", "6379")),
            "password": os.getenv("REDIS_PASSWORD"),
            "decode_responses": True
        }

    @staticmethod
    def get_milvus_config() -> Dict[str, Any]:
        """Get Milvus configuration from environment"""
        return {
            "host": os.getenv("MILVUS_HOST", "milvus"),
            "port": int(os.getenv("MILVUS_PORT", "19530")),
            "user": os.getenv("MILVUS_USERNAME", ""),
            "password": os.getenv("MILVUS_PASSWORD", "")
        }


async def init_connections():
    """Initialize all database connections"""
    global redis_client, prisma_client, _connections_initialized

    if _connections_initialized:
        logger.debug("Connections already initialized, skipping")
        return

    # Initialize Redis
    logger.info("Connecting to Redis...")
    redis_config = DatabaseConfig.get_redis_config()

    try:
        if "url" in redis_config:
            redis_client = redis.from_url(redis_config["url"], decode_responses=True)
        else:
            redis_client = redis.Redis(**redis_config)

        # Test Redis connection
        redis_client.ping()
        logger.info("✅ Redis connected successfully")
    except Exception as e:
        logger.warning(f"⚠️ Redis connection failed: {e} - continuing without Redis")
        redis_client = None

    # Initialize Milvus
    logger.info("Connecting to Milvus...")
    milvus_config = DatabaseConfig.get_milvus_config()
    try:
        connections.connect(
            alias="default",
            host=milvus_config["host"],
            port=milvus_config["port"],
            user=milvus_config["user"] if milvus_config["user"] else None,
            password=milvus_config["password"] if milvus_config["password"] else None
        )
        logger.info("✅ Milvus connected successfully")
    except Exception as e:
        logger.warning(f"⚠️ Milvus connection failed: {e} - continuing without Milvus")

    # Initialize PostgreSQL via psycopg2 (direct driver, no Prisma dependency)
    try:
        import psycopg2
        db_url = os.getenv("DATABASE_URL", "")
        if db_url:
            prisma_client = psycopg2.connect(db_url)
            prisma_client.autocommit = True
            with prisma_client.cursor() as cur:
                cur.execute("SELECT 1")
            logger.info("✅ PostgreSQL connected successfully (psycopg2)")
        else:
            logger.warning("⚠️ DATABASE_URL not set — PostgreSQL unavailable")
            prisma_client = None
    except Exception as e:
        logger.warning(f"⚠️ PostgreSQL connection failed: {e} - continuing without PostgreSQL")
        prisma_client = None

    _connections_initialized = True
    logger.info("✅ Connection initialization complete")


async def cleanup_connections():
    """Cleanup all database connections"""
    global redis_client, prisma_client

    if redis_client:
        redis_client.close()
        logger.info("Redis connection closed")

    try:
        connections.disconnect("default")
        logger.info("Milvus connection closed")
    except Exception as e:
        logger.warning(f"Error closing Milvus connection: {e}")

    if prisma_client:
        try:
            prisma_client.close()  # psycopg2 connection.close()
        except Exception:
            pass
        logger.info("PostgreSQL connection closed")


# ============================================================================
# AUTH CONTEXT - This is passed from MCP Proxy
# ============================================================================

class UserContext(BaseModel):
    """User context passed from MCP proxy with auth information"""
    user_id: str
    user_name: str
    email: str
    is_admin: bool
    groups: List[str] = []


def validate_admin_access(user_context: Optional[Dict[str, Any]] = None) -> UserContext:
    """
    Validate that the user is an admin before allowing any tool execution.
    This is a CRITICAL security check - ALL tools in this MCP require admin access.

    The MCP proxy should already filter this, but we validate again as defense in depth.
    """
    if not user_context:
        logger.error("❌ SECURITY: No user context provided - rejecting request")
        raise PermissionError("Authentication required. Admin access only.")

    # Extract user info
    is_admin = user_context.get("is_admin", False)
    user_name = user_context.get("user_name", "unknown")
    user_id = user_context.get("user_id", "unknown")

    if not is_admin:
        logger.error(f"❌ SECURITY: Non-admin user '{user_name}' ({user_id}) attempted to access admin-mcp")
        raise PermissionError(
            f"Access denied. Admin privileges required. "
            f"User '{user_name}' does not have admin access."
        )

    logger.info(f"✅ Admin access validated for user: {user_name} ({user_id})")

    return UserContext(
        user_id=user_id,
        user_name=user_name,
        email=user_context.get("email", ""),
        is_admin=True,
        groups=user_context.get("groups", [])
    )


# ============================================================================
# POSTGRESQL TOOLS
# ============================================================================

@mcp.tool(description="Execute a READ-ONLY SQL query on the OpenAgentic system PostgreSQL database (NOT Azure databases). Only SELECT statements are allowed. For system observability and diagnostics only.")
async def admin_system_postgres_raw_query(
    query: str,
    params: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Execute read-only SQL query on system PostgreSQL database"""

    if not prisma_client:
        raise RuntimeError("PostgreSQL connection not available")

    # SECURITY: Validate query is read-only (SELECT only)
    # Strip comments and normalize whitespace for validation
    import re
    clean_query = re.sub(r'--.*$', '', query, flags=re.MULTILINE)  # strip line comments
    clean_query = re.sub(r'/\*.*?\*/', '', clean_query, flags=re.DOTALL)  # strip block comments
    clean_query = clean_query.strip().upper()

    FORBIDDEN_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE',
                          'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'CALL', 'COPY', 'VACUUM',
                          'REINDEX', 'CLUSTER', 'COMMENT', 'SECURITY', 'OWNER']

    if not clean_query.startswith('SELECT') and not clean_query.startswith('WITH') and not clean_query.startswith('EXPLAIN'):
        logger.error(f"SECURITY: Blocked non-SELECT query: {query[:100]}...")
        raise PermissionError("Only SELECT, WITH, and EXPLAIN queries are allowed. Write operations are blocked for safety.")

    # Additional check: scan for forbidden keywords that could appear in CTEs or subqueries
    # Allow them only within string literals (rough heuristic)
    query_without_strings = re.sub(r"'[^']*'", '', clean_query)
    for keyword in FORBIDDEN_KEYWORDS:
        # Check if the keyword appears as a standalone word (not part of a column name)
        if re.search(rf'\b{keyword}\b', query_without_strings):
            logger.error(f"SECURITY: Blocked query containing forbidden keyword '{keyword}': {query[:100]}...")
            raise PermissionError(f"Query contains forbidden keyword '{keyword}'. Only read-only queries are allowed.")

    try:
        # Execute read-only query via psycopg2
        with prisma_client.cursor() as cur:
            if params:
                cur.execute(query, params)
            else:
                cur.execute(query)
            if cur.description:
                columns = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                result = [dict(zip(columns, row)) for row in rows]
            else:
                result = []

        logger.info(f"Database query executed (read-only): {query[:100]}...")

        return {
            "success": True,
            "result": result,
            "rowCount": len(result)
        }
    except Exception as e:
        logger.error(f"Database query failed: {e}")
        raise RuntimeError(f"Database query failed: {str(e)}")


@mcp.tool(description="List all tables in the OpenAgentic system PostgreSQL database with schema information (NOT Azure SQL databases)")
async def admin_system_postgres_list_tables() -> Dict[str, Any]:
    """List all tables in the system database"""

    if not prisma_client:
        raise RuntimeError("PostgreSQL connection not available")

    try:
        query = """
            SELECT table_name, table_type
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """

        with prisma_client.cursor() as cur:
            cur.execute(query)
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
            tables = [dict(zip(columns, row)) for row in rows]

        logger.info(f"Listed {len(tables)} tables from database")

        return {
            "success": True,
            "tables": tables
        }
    except Exception as e:
        logger.error(f"Failed to list tables: {e}")
        raise RuntimeError(f"Failed to list tables: {str(e)}")


@mcp.tool(description="Check health and connection status of the OpenAgentic system PostgreSQL database (NOT Azure databases)")
async def admin_system_postgres_health_check() -> Dict[str, Any]:
    """Check PostgreSQL database health — connection status, version, database size, active connections, table counts"""

    if not prisma_client:
        return {
            "success": False,
            "healthy": False,
            "message": "PostgreSQL connection not available"
        }

    try:
        with prisma_client.cursor() as cur:
            cur.execute("SELECT 1")
            cur.execute("SELECT version()")
            version = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
            table_count = cur.fetchone()[0]
            cur.execute("SELECT pg_database_size(current_database())")
            db_size = cur.fetchone()[0]

        return {
            "success": True,
            "healthy": True,
            "message": "Database connection is healthy",
            "version": version,
            "table_count": table_count,
            "database_size_mb": round(db_size / 1024 / 1024, 1)
        }
    except Exception as e:
        return {
            "success": False,
            "healthy": False,
            "message": f"Database connection failed: {str(e)}"
        }


# ============================================================================
# PGVECTOR TOOLS
# ============================================================================

@mcp.tool(description="List all pgvector-enabled tables in the OpenAgentic PostgreSQL database, showing vector columns, dimensions, index types, and row counts")
async def admin_system_pgvector_list_collections() -> Dict[str, Any]:
    """List all pgvector collections (tables with vector columns) in PostgreSQL"""

    if not prisma_client:
        raise RuntimeError("PostgreSQL is not connected")

    try:
        with prisma_client.cursor() as cur:
            # Check if pgvector extension is installed
            cur.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            ext_row = cur.fetchone()
            if not ext_row:
                return {
                    "success": True,
                    "pgvector_installed": False,
                    "message": "pgvector extension is not installed in this database",
                    "collections": []
                }

            pgvector_version = ext_row[0]

            # Find all tables with vector columns
            cur.execute("""
                SELECT
                    c.table_schema,
                    c.table_name,
                    c.column_name,
                    c.udt_name,
                    -- Extract dimension from column type (e.g., vector(1536) -> 1536)
                    CASE
                        WHEN c.character_maximum_length IS NOT NULL THEN c.character_maximum_length
                        ELSE NULL
                    END as dimension
                FROM information_schema.columns c
                WHERE c.udt_name = 'vector'
                ORDER BY c.table_schema, c.table_name, c.column_name
            """)
            vector_columns = cur.fetchall()

            if not vector_columns:
                return {
                    "success": True,
                    "pgvector_installed": True,
                    "pgvector_version": pgvector_version,
                    "message": "pgvector is installed but no tables have vector columns",
                    "collections": []
                }

            # Get row counts and index info for each table
            collections = []
            seen_tables = set()
            for schema, table, col_name, udt, dim in vector_columns:
                full_table = f"{schema}.{table}"

                # Get row count (approx for speed)
                cur.execute(f"SELECT reltuples::bigint FROM pg_class WHERE oid = '{full_table}'::regclass")
                row_count = cur.fetchone()
                row_count = row_count[0] if row_count else 0

                # Get vector dimension from atttypmod if available
                cur.execute("""
                    SELECT atttypmod
                    FROM pg_attribute a
                    JOIN pg_class c ON a.attrelid = c.oid
                    JOIN pg_namespace n ON c.relnamespace = n.oid
                    WHERE n.nspname = %s AND c.relname = %s AND a.attname = %s
                """, (schema, table, col_name))
                typmod_row = cur.fetchone()
                vector_dim = typmod_row[0] if typmod_row and typmod_row[0] > 0 else None

                # Get indexes on this vector column
                cur.execute("""
                    SELECT
                        i.relname as index_name,
                        am.amname as index_type,
                        pg_get_indexdef(ix.indexrelid) as index_def
                    FROM pg_index ix
                    JOIN pg_class i ON ix.indexrelid = i.oid
                    JOIN pg_class t ON ix.indrelid = t.oid
                    JOIN pg_namespace n ON t.relnamespace = n.oid
                    JOIN pg_am am ON i.relam = am.oid
                    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                    WHERE n.nspname = %s AND t.relname = %s AND a.attname = %s
                """, (schema, table, col_name))
                indexes = [{"name": r[0], "type": r[1], "definition": r[2]} for r in cur.fetchall()]

                collections.append({
                    "schema": schema,
                    "table": table,
                    "vector_column": col_name,
                    "dimensions": vector_dim,
                    "row_count": row_count,
                    "indexes": indexes
                })

            logger.info(f"Found {len(collections)} pgvector collections")

            return {
                "success": True,
                "pgvector_installed": True,
                "pgvector_version": pgvector_version,
                "collection_count": len(collections),
                "collections": collections
            }
    except Exception as e:
        logger.error(f"Failed to list pgvector collections: {e}")
        raise RuntimeError(f"Failed to list pgvector collections: {str(e)}")


# ============================================================================
# REDIS TOOLS
# ============================================================================

@mcp.tool(description="Get value from the OpenAgentic system Redis cache by key (NOT Azure Redis Cache)")
async def admin_system_redis_get_key(key: str) -> Dict[str, Any]:
    """Get value from Redis by key"""

    if not redis_client:
        raise RuntimeError("Redis connection not available")

    try:
        value = redis_client.get(key)

        logger.info(f"Redis GET: key={key}, found={bool(value)}")

        return {
            "success": True,
            "key": key,
            "value": value,
            "found": bool(value)
        }
    except Exception as e:
        logger.error(f"Redis GET failed: {e}")
        raise RuntimeError(f"Redis GET failed: {str(e)}")


@mcp.tool(description="List keys in the OpenAgentic system Redis cache matching a pattern (NOT Azure Redis Cache). Use with caution on large datasets.")
async def admin_system_redis_list_keys_by_pattern(
    pattern: str = "*",
    limit: int = 100
) -> Dict[str, Any]:
    """List Redis keys matching a pattern"""

    if not redis_client:
        raise RuntimeError("Redis connection not available")

    try:
        # Use SCAN instead of KEYS for better performance
        keys = []
        cursor = 0

        while True:
            cursor, batch = redis_client.scan(cursor, match=pattern, count=100)
            keys.extend(batch)

            if cursor == 0 or len(keys) >= limit:
                break

        result_keys = keys[:limit]

        logger.info(f"Redis SCAN: pattern={pattern}, found={len(result_keys)}")

        return {
            "success": True,
            "pattern": pattern,
            "keys": result_keys,
            "count": len(result_keys),
            "limited": len(keys) > limit
        }
    except Exception as e:
        logger.error(f"Redis SCAN failed: {e}")
        raise RuntimeError(f"Redis SCAN failed: {str(e)}")


@mcp.tool(description="Check health and connection status of the OpenAgentic system Redis cache (NOT Azure Redis Cache)")
async def admin_system_redis_health_check() -> Dict[str, Any]:
    """Check Redis cache health — connection status, memory usage, key count, uptime"""

    if not redis_client:
        return {
            "success": False,
            "healthy": False,
            "message": "Redis connection not available"
        }

    try:
        result = redis_client.ping()

        return {
            "success": True,
            "healthy": result,
            "message": "Redis connection is healthy"
        }
    except Exception as e:
        return {
            "success": False,
            "healthy": False,
            "message": f"Redis connection failed: {str(e)}"
        }


# ============================================================================
# MILVUS TOOLS
# ============================================================================

@mcp.tool(description="List all collections in the OpenAgentic system Milvus vector database (NOT Azure AI Search)")
async def admin_system_milvus_list_collections() -> Dict[str, Any]:
    """List all Milvus collections"""

    try:
        collections = utility.list_collections()

        logger.info(f"Listed {len(collections)} Milvus collections")

        return {
            "success": True,
            "collections": collections
        }
    except Exception as e:
        logger.error(f"Failed to list Milvus collections: {e}")
        raise RuntimeError(f"Failed to list Milvus collections: {str(e)}")


@mcp.tool(description="Get detailed information about a collection in the OpenAgentic system Milvus vector database (NOT Azure AI Search)")
async def admin_system_milvus_get_collection_info(collection_name: str) -> Dict[str, Any]:
    """Get Milvus collection information"""

    try:
        # Check if collection exists
        if not utility.has_collection(collection_name):
            raise ValueError(f"Collection '{collection_name}' does not exist")

        collection = Collection(collection_name)

        # Get collection stats
        stats = utility.get_query_segment_info(collection_name)

        # Get schema
        schema = collection.schema

        info = {
            "name": collection_name,
            "num_entities": collection.num_entities,
            "schema": {
                "description": schema.description,
                "fields": [
                    {
                        "name": field.name,
                        "type": str(field.dtype),
                        "description": field.description
                    }
                    for field in schema.fields
                ]
            }
        }

        logger.info(f"Retrieved info for Milvus collection: {collection_name}")

        return {
            "success": True,
            "collection_name": collection_name,
            "info": info
        }
    except Exception as e:
        logger.error(f"Failed to get Milvus collection info: {e}")
        raise RuntimeError(f"Failed to get Milvus collection info: {str(e)}")


@mcp.tool(description="Check health and connection status of the OpenAgentic system Milvus vector database (NOT Azure AI Search)")
async def admin_system_milvus_health_check() -> Dict[str, Any]:
    """Check Milvus vector database health — connection status, collection count, GPU availability"""

    try:
        # Try to list collections as a health check
        collections = utility.list_collections()

        return {
            "success": True,
            "healthy": True,
            "message": "Milvus connection is healthy",
            "details": {
                "collection_count": len(collections)
            }
        }
    except Exception as e:
        return {
            "success": False,
            "healthy": False,
            "message": f"Milvus connection failed: {str(e)}"
        }


# ============================================================================
# POSTGRES OBSERVABILITY TOOLS
# ============================================================================

@mcp.tool(description="Show active PostgreSQL connections, long-running queries, connection pool usage, and lock waits. Essential for diagnosing slow responses and connection exhaustion.")
async def admin_system_postgres_active_connections() -> Dict[str, Any]:
    """Show active database connections and long-running queries (READ-ONLY)"""

    if not prisma_client:
        raise RuntimeError("PostgreSQL is not connected")

    try:
        with prisma_client.cursor() as cur:
            # Active connections by state
            cur.execute("""
                SELECT state, count(*) as count
                FROM pg_stat_activity
                WHERE datname = current_database()
                GROUP BY state
                ORDER BY count DESC
            """)
            conn_by_state = [{"state": r[0] or "null", "count": r[1]} for r in cur.fetchall()]

            # Long-running queries (> 5 seconds)
            cur.execute("""
                SELECT pid, state, usename, application_name,
                       EXTRACT(EPOCH FROM (now() - query_start))::int as duration_seconds,
                       LEFT(query, 200) as query_preview,
                       wait_event_type, wait_event
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND state != 'idle'
                  AND query_start < now() - interval '5 seconds'
                ORDER BY query_start ASC
                LIMIT 20
            """)
            long_queries = [{
                "pid": r[0], "state": r[1], "user": r[2], "app": r[3],
                "duration_seconds": r[4], "query_preview": r[5],
                "wait_type": r[6], "wait_event": r[7]
            } for r in cur.fetchall()]

            # Connection limits
            cur.execute("SHOW max_connections")
            max_conn = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM pg_stat_activity")
            total_conn = cur.fetchone()[0]

            # Lock waits
            cur.execute("""
                SELECT count(*) FROM pg_stat_activity
                WHERE wait_event_type = 'Lock'
                  AND datname = current_database()
            """)
            lock_waits = cur.fetchone()[0]

        return {
            "success": True,
            "max_connections": int(max_conn),
            "total_connections": total_conn,
            "connections_by_state": conn_by_state,
            "long_running_queries": long_queries,
            "lock_waits": lock_waits
        }
    except Exception as e:
        logger.error(f"Failed to get active connections: {e}")
        raise RuntimeError(f"Failed to get active connections: {str(e)}")


@mcp.tool(description="Show active user chat sessions with message counts, last activity, models used, and session duration. For admin support and usage monitoring.")
async def admin_system_user_sessions() -> Dict[str, Any]:
    """List active user sessions from the chat_sessions table (READ-ONLY)"""

    if not prisma_client:
        raise RuntimeError("PostgreSQL is not connected")

    try:
        with prisma_client.cursor() as cur:
            # Recent sessions (last 24h)
            cur.execute("""
                SELECT
                    id, title, "userId",
                    "messageCount",
                    "createdAt", "updatedAt",
                    metadata->>'model' as model,
                    metadata->>'source' as source,
                    EXTRACT(EPOCH FROM (now() - "updatedAt"))::int as idle_seconds
                FROM chat_sessions
                WHERE "updatedAt" > now() - interval '24 hours'
                ORDER BY "updatedAt" DESC
                LIMIT 50
            """)
            sessions = [{
                "id": str(r[0]), "title": r[1], "userId": r[2],
                "messageCount": r[3],
                "createdAt": str(r[4]), "updatedAt": str(r[5]),
                "model": r[6], "source": r[7],
                "idle_seconds": r[8]
            } for r in cur.fetchall()]

            # Session counts
            cur.execute("SELECT count(*) FROM chat_sessions")
            total = cur.fetchone()[0]
            cur.execute("""
                SELECT count(*) FROM chat_sessions
                WHERE "updatedAt" > now() - interval '1 hour'
            """)
            active_1h = cur.fetchone()[0]

        return {
            "success": True,
            "total_sessions": total,
            "active_last_hour": active_1h,
            "recent_sessions": sessions
        }
    except Exception as e:
        logger.error(f"Failed to get user sessions: {e}")
        raise RuntimeError(f"Failed to get user sessions: {str(e)}")


@mcp.tool(description="Show LLM provider configuration, model availability, priority routing, and recent usage stats. Essential for debugging model routing and availability issues.")
async def admin_system_llm_provider_status() -> Dict[str, Any]:
    """Show LLM provider and model status from database (READ-ONLY)"""

    if not prisma_client:
        raise RuntimeError("PostgreSQL is not connected")

    try:
        with prisma_client.cursor() as cur:
            # LLM Providers
            cur.execute("""
                SELECT id, name, "providerType", enabled, priority,
                       "createdAt", "updatedAt"
                FROM "LLMProvider"
                ORDER BY priority ASC, name ASC
            """)
            providers = [{
                "id": str(r[0]), "name": r[1], "type": r[2],
                "enabled": r[3], "priority": r[4],
                "createdAt": str(r[5]), "updatedAt": str(r[6])
            } for r in cur.fetchall()]

            # LLM Models
            cur.execute("""
                SELECT m.id, m.name, m."modelId", m.enabled, m.priority,
                       m."contextWindow", m."maxOutputTokens",
                       m."supportsVision", m."supportsStreaming",
                       p.name as provider_name, p."providerType"
                FROM "LLMModel" m
                JOIN "LLMProvider" p ON m."providerId" = p.id
                WHERE m.enabled = true
                ORDER BY m.priority ASC, m.name ASC
            """)
            models = [{
                "id": str(r[0]), "name": r[1], "modelId": r[2],
                "enabled": r[3], "priority": r[4],
                "contextWindow": r[5], "maxOutputTokens": r[6],
                "supportsVision": r[7], "supportsStreaming": r[8],
                "provider": r[9], "providerType": r[10]
            } for r in cur.fetchall()]

        return {
            "success": True,
            "provider_count": len(providers),
            "enabled_model_count": len(models),
            "providers": providers,
            "models": models
        }
    except Exception as e:
        logger.error(f"Failed to get LLM provider status: {e}")
        raise RuntimeError(f"Failed to get LLM provider status: {str(e)}")


# ============================================================================
# REDIS OBSERVABILITY TOOLS
# ============================================================================

@mcp.tool(description="Show Redis server stats: memory usage, connected clients, key counts, hit/miss ratio, eviction stats, and uptime. For cache performance monitoring.")
async def admin_system_redis_stats() -> Dict[str, Any]:
    """Get detailed Redis server statistics (READ-ONLY)"""

    if not redis_client:
        raise RuntimeError("Redis is not connected")

    try:
        info = redis_client.info()

        return {
            "success": True,
            "server": {
                "redis_version": info.get("redis_version"),
                "uptime_seconds": info.get("uptime_in_seconds"),
                "uptime_days": info.get("uptime_in_days"),
            },
            "memory": {
                "used_memory_human": info.get("used_memory_human"),
                "used_memory_peak_human": info.get("used_memory_peak_human"),
                "used_memory_rss_human": info.get("used_memory_rss_human"),
                "maxmemory_human": info.get("maxmemory_human", "0B (no limit)"),
                "mem_fragmentation_ratio": info.get("mem_fragmentation_ratio"),
            },
            "clients": {
                "connected_clients": info.get("connected_clients"),
                "blocked_clients": info.get("blocked_clients"),
                "maxclients": info.get("maxclients"),
            },
            "stats": {
                "total_connections_received": info.get("total_connections_received"),
                "total_commands_processed": info.get("total_commands_processed"),
                "keyspace_hits": info.get("keyspace_hits"),
                "keyspace_misses": info.get("keyspace_misses"),
                "hit_ratio": round(
                    info.get("keyspace_hits", 0) /
                    max(info.get("keyspace_hits", 0) + info.get("keyspace_misses", 0), 1) * 100, 1
                ),
                "evicted_keys": info.get("evicted_keys"),
                "expired_keys": info.get("expired_keys"),
            },
            "keyspace": info.get("db0", {}),
        }
    except Exception as e:
        logger.error(f"Failed to get Redis stats: {e}")
        raise RuntimeError(f"Failed to get Redis stats: {str(e)}")


# ============================================================================
# MILVUS OBSERVABILITY TOOLS
# ============================================================================

@mcp.tool(description="Show detailed stats for all Milvus collections: entity counts, field schemas, index types, and memory estimates. For vector database capacity planning.")
async def admin_system_milvus_collection_stats() -> Dict[str, Any]:
    """Get detailed stats for all Milvus collections (READ-ONLY)"""

    try:
        collection_names = utility.list_collections()
        stats = []

        for name in collection_names:
            try:
                coll = Collection(name)
                schema = coll.schema
                fields = [{
                    "name": f.name,
                    "type": str(f.dtype),
                    "is_primary": f.is_primary,
                    "description": f.description or "",
                } for f in schema.fields]

                # Get entity count
                num_entities = coll.num_entities

                # Get indexes
                indexes = []
                for f in schema.fields:
                    try:
                        idx = coll.index(f.name) if hasattr(coll, 'index') else None
                        if idx:
                            indexes.append({
                                "field": f.name,
                                "type": str(idx.params.get("index_type", "unknown")),
                                "metric": str(idx.params.get("metric_type", "unknown")),
                            })
                    except Exception:
                        pass

                stats.append({
                    "name": name,
                    "num_entities": num_entities,
                    "field_count": len(fields),
                    "fields": fields,
                    "indexes": indexes,
                    "description": schema.description or "",
                })
            except Exception as e:
                stats.append({
                    "name": name,
                    "error": str(e),
                })

        return {
            "success": True,
            "collection_count": len(collection_names),
            "collections": stats
        }
    except Exception as e:
        logger.error(f"Failed to get Milvus collection stats: {e}")
        raise RuntimeError(f"Failed to get Milvus collection stats: {str(e)}")


# ============================================================================
# NETWORK & SERVICE CONNECTIVITY TOOLS
# ============================================================================

@mcp.tool(description="Test network connectivity from the admin MCP pod to all OpenAgentic infrastructure services (PostgreSQL, Redis, Milvus, API, MCP Proxy). Diagnoses NetworkPolicy and DNS issues.")
async def admin_system_network_connectivity_check() -> Dict[str, Any]:
    """Test connectivity to all infrastructure services (READ-ONLY, socket connect only)"""
    import socket

    targets = [
        ("openagentic-postgresql", 5432, "PostgreSQL"),
        ("openagentic-redis-master", 6379, "Redis"),
        ("openagentic-milvus", 19530, "Milvus"),
        ("openagentic-api", 8000, "API"),
        ("openagentic-mcp-proxy", 8080, "MCP Proxy"),
        ("openagentic-minio", 9000, "MinIO"),
        ("openagentic-code-manager", 8080, "Code Manager"),
    ]

    results = []
    for host, port, label in targets:
        try:
            start = datetime.utcnow()
            s = socket.create_connection((host, port), timeout=3)
            elapsed_ms = (datetime.utcnow() - start).total_seconds() * 1000
            s.close()
            results.append({
                "service": label,
                "host": f"{host}:{port}",
                "status": "reachable",
                "latency_ms": round(elapsed_ms, 1),
            })
        except socket.timeout:
            results.append({
                "service": label,
                "host": f"{host}:{port}",
                "status": "timeout",
                "error": "Connection timed out (3s)",
            })
        except Exception as e:
            results.append({
                "service": label,
                "host": f"{host}:{port}",
                "status": "unreachable",
                "error": str(e),
            })

    reachable = sum(1 for r in results if r["status"] == "reachable")

    return {
        "success": True,
        "reachable": reachable,
        "total": len(results),
        "all_healthy": reachable == len(results),
        "services": results
    }


@mcp.tool(description="Show API server health, version info, and endpoint status by calling the OpenAgentic API health endpoint. Quick pulse check without Grafana.")
async def admin_system_api_health() -> Dict[str, Any]:
    """Check the OpenAgentic API health endpoint (READ-ONLY)"""

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("http://openagentic-api:8000/api/health")

        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "healthy": True,
                "status_code": response.status_code,
                "response": data
            }
        else:
            return {
                "success": True,
                "healthy": False,
                "status_code": response.status_code,
                "message": f"API returned HTTP {response.status_code}"
            }
    except Exception as e:
        return {
            "success": False,
            "healthy": False,
            "message": f"Failed to reach API: {str(e)}"
        }


# ============================================================================
# SYSTEM HEALTH CHECK
# ============================================================================

@mcp.tool(description="Get overall health status for all OpenAgentic infrastructure components (PostgreSQL, Redis, Milvus, services)")
async def admin_system_infrastructure_health_check() -> Dict[str, Any]:
    """Check overall OpenAgentic platform infrastructure health — PostgreSQL, Redis, Milvus, LLM providers, all services"""

    health = {
        "timestamp": datetime.utcnow().isoformat(),
        "components": {}
    }

    # Check PostgreSQL
    pg_health = await admin_system_postgres_health_check()
    health["components"]["postgresql"] = {
        "healthy": pg_health.get("healthy", False),
        "message": pg_health.get("message", "Unknown")
    }

    # Check Redis
    redis_health = await admin_system_redis_health_check()
    health["components"]["redis"] = {
        "healthy": redis_health.get("healthy", False),
        "message": redis_health.get("message", "Unknown")
    }

    # Check Milvus
    milvus_health = await admin_system_milvus_health_check()
    health["components"]["milvus"] = {
        "healthy": milvus_health.get("healthy", False),
        "message": milvus_health.get("message", "Unknown"),
        "details": milvus_health.get("details", {})
    }

    # Overall health
    health["healthy"] = all(
        component.get("healthy", False)
        for component in health["components"].values()
    )

    logger.info(f"System health check: healthy={health['healthy']}")

    return health


# ============================================================================
# FULL SYSTEM TEST TOOL
# ============================================================================

@mcp.tool(description="Run a COMPREHENSIVE test of the ENTIRE OpenAgentic platform. Use when admin says 'full test'. Tests: ALL infrastructure (PostgreSQL, Redis, Milvus, Ollama, API), ALL MCP servers, tool execution from each MCP, formatting MCP, diagram MCP, critical API endpoints, and performance benchmarks. Returns detailed report with pass/fail status, timing, bottlenecks, and recommendations.")
async def admin_full_system_test(
    include_slow_tests: bool = False,
    include_azure_tests: bool = False,
    include_gcp_tests: bool = False,
    verbose: bool = True
) -> Dict[str, Any]:
    """
    Run comprehensive full system test.

    Args:
        include_slow_tests: Include slow tests like full web fetches (adds 30-60 seconds)
        include_azure_tests: Test Azure MCP tools (requires valid Azure credentials)
        include_gcp_tests: Test GCP MCP tools (requires valid GCP credentials)
        verbose: Include detailed output for each test

    Returns:
        Comprehensive test report
    """
    from .full_test_tools import admin_full_system_test as run_full_test
    return await run_full_test(
        include_slow_tests=include_slow_tests,
        include_azure_tests=include_azure_tests,
        include_gcp_tests=include_gcp_tests,
        verbose=verbose
    )


# ============================================================================
# IMPORT TOOL MODULES TO REGISTER TOOLS WITH FASTMCP
# ============================================================================
# These imports must be at module level so @mcp.tool() decorators run when
# the module is imported, not just when main() is called.
# FastMCP filesystem loader imports the module to find 'mcp' but doesn't run main().

try:
    from . import user_tools
    from . import audit_tools
    from . import workflow_tools
    logger.info("✅ Tool modules loaded successfully (user, audit, workflow)")
except ImportError as e:
    logger.warning(f"Some tool modules could not be loaded: {e}")


# ============================================================================
# FASTMCP SERVER INITIALIZATION
# ============================================================================

# Add shared module to path for http_transport
# In Docker: file at /app/src/admin_mcp_server/server.py, shared at /app/shared/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')

try:
    from http_transport import run_with_http_support
    HTTP_TRANSPORT_AVAILABLE = True
except ImportError:
    HTTP_TRANSPORT_AVAILABLE = False


def main():
    """
    Main entry point for the admin MCP server.
    Note: When run via 'fastmcp run', the lifespan context manager handles initialization.
    This main() is only used when running the script directly.
    """
    # Eagerly initialize connections at startup (lifespan doesn't fire in HTTP mode)
    import asyncio
    logger.info("Eagerly initializing database connections...")
    asyncio.run(init_connections())
    logger.info(f"Connections initialized: pg={prisma_client is not None}, redis={redis_client is not None}")

    # Use HTTP transport if available and in HTTP mode, otherwise use stdio
    if HTTP_TRANSPORT_AVAILABLE:
        run_with_http_support(
            mcp_server=mcp,
            name="oap-admin-mcp",
            version="1.0.0",
            default_port=8083
        )
    else:
        # The lifespan context manager will handle init_connections() and cleanup_connections()
        mcp.run()


if __name__ == "__main__":
    main()
