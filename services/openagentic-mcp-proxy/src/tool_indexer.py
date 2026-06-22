
"""
ToolIndexer — mcp-proxy now owns the MCP-tools index (Milvus + pgvector).

ARCHITECTURE (post-#1058 → #1059 decouple):
  Before: api did all the indexing on startup. mcp-proxy fetched /tools and
          forwarded queries. Indexing was a 100s blocking step on the api
          bootstrap, and a partial-failure on Milvus insert would loop the
          api forever (rowCount:0 → re-index → rowCount:0 → ...).
  After:  mcp-proxy owns the WRITER path. After the FastAPI server binds its
          port (lifespan post-yield), an asyncio task fires this indexer
          fire-and-forget. The api owns ONLY the READER path; its bootstrap
          has zero indexing work and comes Ready in ~30s.

What this module does:
  1. Calls our OWN MCPManager.aggregate_tools() to enumerate all backend
     tools (no HTTP self-call — direct in-process read).
  2. Embeds each tool's name+description via OLLAMA_BASE_URL nomic-embed-text.
     If Ollama is unreachable or the embedding model is missing, logs a WARN
     and returns — tool_search degrades to API-forwarder fallback; api stays
     Ready.
  3. Upserts to PostgreSQL pgvector `mcp_tools` table (api side already has
     ToolPgvectorSearchService that queries the same table — same SoT).
  4. Upserts to Milvus `mcp_tools` collection (api side ToolSemanticCacheService
     queries the same collection — same SoT).

Both sinks are independent; either failing is logged WARN, the other still
proceeds. The READ path on api falls back across pgvector → Milvus → empty,
so degraded write is graceful.

NEVER raises. The lifespan task wraps it in a try/except and the api is
already designed to read whatever happens to be in the shared DB tables.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("mcp-proxy.tool_indexer")

# ---------------------------------------------------------------------------
# Config — env-driven so helm/values controls everything; safe defaults so
# the module imports cleanly even when env is unset (no top-level raises).
# ---------------------------------------------------------------------------
def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()

def _embedding_model() -> str:
    # Mirror api's env precedence: EMBEDDING_MODEL > OLLAMA_EMBEDDING_MODEL > default.
    return (
        _env("EMBEDDING_MODEL")
        or _env("OLLAMA_EMBEDDING_MODEL")
        or "nomic-embed-text"
    )

def _api_base_url() -> str:
    return (_env("API_BASE_URL") or "http://openagentic-api:8000").rstrip("/")

def _internal_secret() -> str:
    return _env("INTERNAL_SERVICE_SECRET", "")

def _embedding_dim() -> int:
    raw = _env("EMBEDDING_DIMENSIONS") or _env("EMBEDDING_DIMENSION") or "768"
    try:
        return int(raw)
    except ValueError:
        return 768

def _milvus_endpoint() -> tuple[str, int]:
    # `or` guards against MILVUS_HOST being set to empty string (helm template
    # renders the key even when value unset → env=""); getenv default only
    # kicks in if key is missing.
    host = _env("MILVUS_HOST") or "milvus"
    try:
        port = int(_env("MILVUS_PORT") or "19530")
    except ValueError:
        port = 19530
    return host, port

def _database_url() -> str:
    return _env("DATABASE_URL")

# Tunables — kept conservative; we're not on the request hot path.
EMBEDDING_HTTP_TIMEOUT_S = 60.0
EMBEDDING_BATCH_SIZE = 32
MILVUS_COLLECTION_NAME = "mcp_tools"

# Periodic re-index cadence. Tools rarely change once MCP servers are stable,
# but new servers can be added at runtime + tool definitions can be edited.
# Default 5 min. Override via TOOL_INDEX_REFRESH_SECONDS env. Short-circuited
# by a content hash so a "no change" cycle is a few microseconds + zero
# embeddings calls.
def _refresh_interval_seconds() -> float:
    raw = _env("TOOL_INDEX_REFRESH_SECONDS", "300")
    try:
        return max(30.0, float(raw))  # floor 30s — Ollama embed budget
    except ValueError:
        return 300.0

# Module-level cache for change detection. Survives reindex iterations,
# resets on pod restart (forces a full re-embed on cold boot — desired).
_last_tools_hash: Optional[str] = None
_last_indexed_at: float = 0.0
_last_stats: Dict[str, Any] = {}

def _compute_tools_hash(flat_tools: List[Dict[str, Any]]) -> str:
    """SHA-1 of (server,name,description) sorted — small + change-sensitive."""
    payload = "\n".join(
        f"{t['server_name']}\x00{t['name']}\x00{t['description']}"
        for t in sorted(flat_tools, key=lambda x: (x["server_name"], x["name"]))
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()

def get_indexer_status() -> Dict[str, Any]:
    """Expose the latest run for /health/tool-indexer probes."""
    return {
        "last_indexed_at": _last_indexed_at,
        "last_tools_hash": _last_tools_hash,
        "last_stats": _last_stats,
        "refresh_interval_s": _refresh_interval_seconds(),
    }

# ---------------------------------------------------------------------------
# Embedding — delegated to api's /api/internal/embed (#1060). Provider-agnostic:
# api routes to whichever provider owns the embedding role (Bedrock Titan /
# AIF text-embedding-3 / Vertex gecko / Ollama nomic-embed-text). mcp-proxy
# has zero LLM-provider dependencies — it's a pure indexer + writer.
# ---------------------------------------------------------------------------
_embed_fail_count = 0
_embed_fail_logged = False

async def embed_many(texts: List[str]) -> List[Optional[List[float]]]:
    """Batched embed via api /api/internal/embed. Backoff on auth/conn failure
    so a misconfig doesn't hot-loop the logs. Returns aligned list (None for
    any text whose embedding the api couldn't produce)."""
    global _embed_fail_count, _embed_fail_logged
    secret = _internal_secret()
    if not secret:
        if not _embed_fail_logged:
            logger.warning("INTERNAL_SERVICE_SECRET unset — indexer disabled until provided")
            _embed_fail_logged = True
        return [None] * len(texts)

    results: List[Optional[List[float]]] = []
    url = f"{_api_base_url()}/api/internal/embed"
    headers = {"x-internal-secret": secret}
    async with httpx.AsyncClient(timeout=EMBEDDING_HTTP_TIMEOUT_S, headers=headers) as client:
        for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
            batch = texts[i : i + EMBEDDING_BATCH_SIZE]
            try:
                resp = await client.post(url, json={"texts": batch})
            except httpx.RequestError as e:
                _embed_fail_count += 1
                if _embed_fail_count <= 3:
                    logger.warning("api embed conn error: %s", e)
                results.extend([None] * len(batch))
                continue
            if resp.status_code != 200:
                _embed_fail_count += 1
                if _embed_fail_count <= 3:
                    logger.warning("api embed non-200: %s %s", resp.status_code, resp.text[:200])
                results.extend([None] * len(batch))
                continue
            try:
                payload = resp.json()
                embs = payload.get("embeddings") or []
            except Exception as e:
                logger.warning("api embed malformed json: %s", e)
                results.extend([None] * len(batch))
                continue
            for j in range(len(batch)):
                v = embs[j] if j < len(embs) and isinstance(embs[j], list) and embs[j] else None
                results.append(v)
            _embed_fail_count = 0  # success — reset
    return results

# ---------------------------------------------------------------------------
# pgvector sink — uses asyncpg for one-shot upserts. Schema must already
# exist (api's prisma migrations create the `mcp_tools` table).
# ---------------------------------------------------------------------------
async def upsert_pgvector(rows: List[Dict[str, Any]]) -> int:
    """Upsert N rows into mcp_tools. Returns rows written. 0 on connect fail."""
    if not rows:
        return 0
    dburl = _database_url()
    if not dburl:
        logger.warning("pgvector upsert skipped: DATABASE_URL not set")
        return 0
    try:
        import asyncpg  # type: ignore
    except ImportError:
        logger.warning("pgvector upsert skipped: asyncpg not installed")
        return 0

    # Strip ?sslmode= and other query params — asyncpg uses kwargs not URL params.
    # Translate sslmode=require → ssl=True for asyncpg.
    connect_kwargs: Dict[str, Any] = {}
    if "sslmode=require" in dburl or "sslmode=verify" in dburl:
        connect_kwargs["ssl"] = True
    base_url = dburl.split("?", 1)[0]

    try:
        conn = await asyncpg.connect(base_url, **connect_kwargs)
    except Exception as e:
        logger.warning("pgvector connect failed: %s", e)
        return 0

    written = 0
    try:
        for r in rows:
            try:
                # pgvector format: '[0.1,0.2,...]' string literal cast to halfvec.
                # Schema is owned by Prisma: id PK, server_id (not server_name),
                # description_embedding halfvec(768) (not embedding vector).
                # ON CONFLICT keyed on (server_id, name) — the actual unique
                # constraint — not (id), because each indexer cycle generates a
                # fresh UUID for r["id"] but the (server, tool-name) tuple is stable.
                vec_str = "[" + ",".join(f"{x:.6f}" for x in r["embedding"]) + "]"
                await conn.execute(
                    """
                    INSERT INTO mcp_tools (id, name, description, server_id, description_embedding, updated_at)
                    VALUES ($1, $2, $3, $4, $5::halfvec, NOW())
                    ON CONFLICT (server_id, name) DO UPDATE SET
                      description = EXCLUDED.description,
                      description_embedding = EXCLUDED.description_embedding,
                      updated_at = NOW()
                    """,
                    r["id"], r["name"], r["description"], r["server_name"], vec_str,
                )
                written += 1
            except Exception as e:
                logger.warning("pgvector row upsert failed for %s: %s", r.get("name"), e)
    finally:
        await conn.close()
    return written

# ---------------------------------------------------------------------------
# Milvus sink — pymilvus. Re-uses the same `mcp_tools` collection api expects.
# Schema is owned by whoever creates the collection first; we use upsert so
# repeated calls converge.
# ---------------------------------------------------------------------------
def _milvus_upsert(rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    try:
        from pymilvus import MilvusClient  # type: ignore
    except ImportError:
        logger.warning("milvus upsert skipped: pymilvus not installed")
        return 0

    host, port = _milvus_endpoint()
    uri = f"http://{host}:{port}"
    try:
        client = MilvusClient(uri=uri)
    except Exception as e:
        logger.warning("milvus connect failed: %s", e)
        return 0

    try:
        if not client.has_collection(MILVUS_COLLECTION_NAME):
            client.create_collection(
                collection_name=MILVUS_COLLECTION_NAME,
                dimension=_embedding_dim(),
                primary_field_name="id",
                id_type="string",
                max_length=512,
                metric_type="COSINE",
                auto_id=False,
            )
            logger.info("milvus: created collection %s", MILVUS_COLLECTION_NAME)
    except Exception as e:
        logger.warning("milvus collection-create failed (continuing): %s", e)

    records = [
        {
            "id": r["id"],
            "vector": r["embedding"],
            "name": r["name"],
            "description": r["description"],
            "server_name": r["server_name"],
        }
        for r in rows
    ]
    try:
        client.upsert(collection_name=MILVUS_COLLECTION_NAME, data=records)
    except Exception as e:
        logger.warning("milvus upsert failed: %s", e)
        return 0
    try:
        client.flush(collection_name=MILVUS_COLLECTION_NAME)
    except Exception as e:
        logger.warning("milvus flush failed (rows may not be queryable yet): %s", e)
    return len(records)

# ---------------------------------------------------------------------------
# Public entrypoint — lifespan calls this fire-and-forget after server binds.
# ---------------------------------------------------------------------------
def _tool_id(server_name: str, tool_name: str) -> str:
    """Deterministic primary key. Matches what api's ToolPgvectorSearchService
    expects when querying by `id`."""
    h = hashlib.sha1(f"{server_name}:{tool_name}".encode("utf-8")).hexdigest()
    return h[:32]

def _flatten_tools(mcp_tools_from_manager: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pivot the MCPManager catalog shape to {id, name, description, server_name}.
    The manager hands us the wire-shape used by /tools endpoint."""
    out: List[Dict[str, Any]] = []
    for t in mcp_tools_from_manager:
        fn = t.get("function") if isinstance(t.get("function"), dict) else None
        name = (fn or {}).get("name") or t.get("name")
        if not name:
            continue
        desc = (fn or {}).get("description") or t.get("description") or "No description"
        server = t.get("server") or t.get("serverName") or t.get("server_name") or "unknown"
        out.append({
            "id": _tool_id(server, name),
            "name": name,
            "description": desc,
            "server_name": server,
        })
    return out

async def index_all_tools(mcp_tools_from_manager: List[Dict[str, Any]], force: bool = False) -> Dict[str, Any]:
    """Embed + upsert ALL tools to pgvector + Milvus. Returns stats dict.
    Never raises. Caller is fire-and-forget.

    `force=False` (default): short-circuit when the tools-content hash matches
    the last successful run — costs a few microseconds, saves the 6-8s embed
    cycle when nothing changed. New MCP servers, edited descriptions, or
    deletions WILL change the hash and trigger a full re-index.

    `force=True`: skip the hash check — used by /internal/reindex-tools POST
    and by the first run after pod boot (forces a fresh write to verify the
    READ-path stores are populated)."""
    global _last_tools_hash, _last_indexed_at, _last_stats

    started = time.monotonic()
    tools = _flatten_tools(mcp_tools_from_manager)
    if not tools:
        logger.warning("[tool-indexer] no tools to index — manager returned empty catalog")
        return {"tools": 0, "embedded": 0, "pgvector_written": 0, "milvus_written": 0, "duration_s": 0.0, "skipped": False}

    current_hash = _compute_tools_hash(tools)
    if not force and current_hash == _last_tools_hash:
        logger.debug("[tool-indexer] hash unchanged (%s) — skip re-embed", current_hash[:8])
        skip_stats = {**_last_stats, "skipped": True, "tools": len(tools)}
        return skip_stats

    logger.info(
        "[tool-indexer] hash %s (was %s) — embedding %d tools via %s @ %s",
        current_hash[:8],
        (_last_tools_hash[:8] if _last_tools_hash else "none"),
        len(tools),
        _embedding_model(),
        _api_base_url(),
    )
    texts = [f"{t['name']}\n\n{t['description']}" for t in tools]
    embeddings = await embed_many(texts)

    rows: List[Dict[str, Any]] = []
    for t, vec in zip(tools, embeddings):
        if vec is None:
            continue
        rows.append({**t, "embedding": vec})

    if not rows:
        logger.warning(
            "[tool-indexer] embedding produced 0 usable vectors — Ollama unreachable or model missing. "
            "Tool search will degrade to empty. api remains Ready (this is non-fatal). Will retry next cycle."
        )
        return {"tools": len(tools), "embedded": 0, "pgvector_written": 0, "milvus_written": 0, "duration_s": time.monotonic() - started, "skipped": False}

    logger.info("[tool-indexer] writing %d rows to pgvector + Milvus", len(rows))
    pgv_written = await upsert_pgvector(rows)
    # Milvus client is sync; run in executor so we don't block the asyncio loop.
    loop = asyncio.get_event_loop()
    milvus_written = await loop.run_in_executor(None, _milvus_upsert, rows)
    duration = time.monotonic() - started

    stats = {
        "tools": len(tools),
        "embedded": len(rows),
        "pgvector_written": pgv_written,
        "milvus_written": milvus_written,
        "duration_s": round(duration, 2),
        "skipped": False,
    }

    # Only update the cache when BOTH sinks succeeded — otherwise the next
    # cycle will retry. A partial-write success doesn't get cached so we
    # converge on full success.
    if pgv_written > 0 or milvus_written > 0:
        _last_tools_hash = current_hash
        _last_indexed_at = time.time()
        _last_stats = stats

    logger.info("[tool-indexer] complete: %s", json.dumps(stats))
    return stats

def _normalize_manager_output(raw: Any) -> List[Dict[str, Any]]:
    """The manager's list_all_tools returns Dict[server_name, List[tool_dict]]
    (per mcp_manager.py:942). Older variants may return a flat list. Normalize
    both into the flat list shape expected downstream — each entry retains a
    `server` field so _flatten_tools can pick it up."""
    if not raw:
        return []
    # Dict-keyed-by-server (current shape).
    if isinstance(raw, dict):
        flat: List[Dict[str, Any]] = []
        for server_name, server_tools in raw.items():
            if not isinstance(server_tools, list):
                continue
            for t in server_tools:
                if not isinstance(t, dict):
                    continue
                # Stamp the server name onto each entry so _flatten_tools sees it.
                # Don't overwrite if the entry already has one.
                if "server" not in t and "serverName" not in t and "server_name" not in t:
                    t = {**t, "server": server_name}
                flat.append(t)
        return flat
    # Flat list shape (legacy / OpenAI-wrapped).
    if isinstance(raw, list):
        return raw
    logger.warning("[tool-indexer] unknown manager output shape: %s", type(raw).__name__)
    return []

async def _resolve_tools(mcp_manager: Any) -> List[Dict[str, Any]]:
    """Manager-tools fetch. Handles sync + async + dict-shape + list-shape."""
    if not mcp_manager:
        return []
    for method in ("list_all_tools", "aggregate_tools", "get_all_tools"):
        fn = getattr(mcp_manager, method, None)
        if not callable(fn):
            continue
        try:
            result = fn()
            if asyncio.iscoroutine(result):
                result = await result
            return _normalize_manager_output(result)
        except Exception as e:
            logger.warning("[tool-indexer] %s() raised: %s", method, e)
    return []

async def run_indexer_loop(mcp_manager: Any) -> None:
    """Long-running background task — keeps the mcp_tools index fresh.

    Lifecycle:
      • Wait ~30s after lifespan yield. The MCPManager spawns 10+ subprocess
        MCP servers that each do their own handshake; list_all_tools() returns
        empty until those handshakes complete. Polling earlier just burns
        cycles. Use TOOL_INDEX_INITIAL_DELAY_SECONDS to tune.
      • First non-empty iteration: force=True, ensures stores get populated on
        cold boot even when our in-memory hash cache is empty.
      • Subsequent iterations: force=False — hash short-circuit when unchanged,
        full re-embed when changed (new MCP server, edited description, etc).
      • Loop interval: TOOL_INDEX_REFRESH_SECONDS env, default 300s (5 min).
        Floor 30s.

    NEVER raises. Each iteration's failure logs WARN and the loop continues.
    """
    try:
        initial_delay = float(_env("TOOL_INDEX_INITIAL_DELAY_SECONDS", "30"))
    except ValueError:
        initial_delay = 30.0
    await asyncio.sleep(initial_delay)

    iteration = 0
    first_non_empty = True
    while True:
        iteration += 1
        try:
            tools = await _resolve_tools(mcp_manager)
            if not tools:
                logger.warning("[tool-indexer] iter %d: empty catalog (MCP servers still handshaking?) — retrying next cycle", iteration)
            else:
                # First successful pull after boot: force-refresh.
                force = first_non_empty
                first_non_empty = False
                await index_all_tools(tools, force=force)
        except asyncio.CancelledError:
            logger.info("[tool-indexer] loop cancelled — graceful shutdown")
            raise
        except Exception as e:
            logger.error("[tool-indexer] iter %d FATAL (continuing loop): %s", iteration, e, exc_info=True)

        try:
            await asyncio.sleep(_refresh_interval_seconds())
        except asyncio.CancelledError:
            raise

# Backwards-compat alias for any caller that still uses the old name.
run_post_listen = run_indexer_loop
