
"""
OpenAgentic Synth Server

FastAPI server that receives code execution requests and runs them
in isolated subprocesses with resource limits and full audit logging.
"""

import os
import time
import asyncio
import hashlib
import resource
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

# Prometheus metrics
from prometheus_client import (
    Counter,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

from .logging_config import get_logger
from .telemetry import (
    tracer,
    execution_counter,
    execution_duration,
    execution_errors,
    active_executions,
    memory_usage,
)
from .executor import SecureExecutor, ExecutionResult

logger = get_logger("openagentic-synth")

# =============================================================================
# Prometheus Metrics
# =============================================================================

prom_executions_total = Counter(
    "oat_executions_total",
    "Total number of OAT code executions",
    ["status"],
)

prom_execution_duration_seconds = Histogram(
    "oat_execution_duration_seconds",
    "Duration of OAT code executions in seconds",
    buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0),
)

# =============================================================================
# Request/Response Models
# =============================================================================

class ExecutionRequest(BaseModel):
    """Request to execute synthesized Python code."""

    execution_id: str = Field(..., description="Unique execution ID for tracking")
    code: str = Field(..., description="Python code to execute")
    intent: str = Field(..., description="Original user intent for audit")
    user_id: str = Field(..., description="User ID who initiated the request")
    user_email: Optional[str] = Field(None, description="User email for audit")

    # Execution context
    timeout_seconds: int = Field(default=30, ge=1, le=300, description="Max execution time")
    max_memory_mb: int = Field(default=256, ge=32, le=1024, description="Max memory in MB")

    # Credentials (injected as environment variables)
    credentials: Optional[Dict[str, str]] = Field(
        default=None,
        description="Cloud credentials to inject (keys become env vars)"
    )

    # Allowed capabilities determine what the code can do
    capabilities: List[str] = Field(
        default=["http", "json", "datetime"],
        description="Allowed capabilities"
    )

    # Input files (base64-encoded, decoded to /tmp before execution)
    files: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description="Files to make available: [{name, type, data (base64)}]"
    )

    # Callback URL for async results
    callback_url: Optional[str] = Field(
        None,
        description="URL to POST results when execution completes"
    )

class ExecutionResponse(BaseModel):
    """Response from code execution."""

    execution_id: str
    success: bool
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    result: Optional[Any] = None
    error: Optional[str] = None

    # Metrics
    execution_time_ms: int
    memory_used_bytes: Optional[int] = None

    # Audit info
    code_hash: str
    started_at: str
    completed_at: str

class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    active_executions: int
    max_concurrent: int
    uptime_seconds: float

# =============================================================================
# Application Setup
# =============================================================================

# Global state
startup_time = time.time()
executor: Optional[SecureExecutor] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global executor

    logger.info(
        "openagentic_synth_starting",
        version="1.0.0",
        max_execution_time=os.environ.get("OAT_MAX_EXECUTION_TIME", "30"),
        max_memory_mb=os.environ.get("OAT_MAX_MEMORY_MB", "256"),
    )

    # Initialize the secure executor
    executor = SecureExecutor(
        max_concurrent=int(os.environ.get("OAT_MAX_CONCURRENT", "5")),
        default_timeout=int(os.environ.get("OAT_MAX_EXECUTION_TIME", "30")),
        default_memory_mb=int(os.environ.get("OAT_MAX_MEMORY_MB", "256")),
    )

    yield

    # Cleanup
    logger.info("openagentic_synth_shutting_down")
    if executor:
        await executor.shutdown()

app = FastAPI(
    title="OpenAgentic Synth",
    description="Secure Python code execution for On-demand Agent Tooling",
    version="1.0.0",
    lifespan=lifespan,
)

# Instrument with OpenTelemetry
FastAPIInstrumentor.instrument_app(app)

# =============================================================================
# Endpoints
# =============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for K8s probes."""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        active_executions=executor.active_count if executor else 0,
        max_concurrent=executor.max_concurrent if executor else 0,
        uptime_seconds=time.time() - startup_time,
    )

@app.get("/ready")
async def readiness_check():
    """Readiness check - are we ready to accept executions?"""
    if not executor:
        raise HTTPException(status_code=503, detail="Executor not initialized")

    if executor.active_count >= executor.max_concurrent:
        raise HTTPException(status_code=503, detail="At capacity")

    return {"ready": True}

@app.post("/execute", response_model=ExecutionResponse)
async def execute_code(
    request: ExecutionRequest,
    background_tasks: BackgroundTasks,
):
    """
    Execute synthesized Python code securely.

    The code runs in an isolated subprocess with:
    - Memory limits
    - CPU time limits
    - No filesystem access (except /tmp)
    - No network access (unless http capability granted)
    - Credentials injected as environment variables
    """

    with tracer.start_as_current_span("oat.execute") as span:
        span.set_attribute("oat.execution_id", request.execution_id)
        span.set_attribute("oat.user_id", request.user_id)
        span.set_attribute("oat.capabilities", ",".join(request.capabilities))

        # Compute code hash for audit
        code_hash = hashlib.sha256(request.code.encode()).hexdigest()[:16]
        span.set_attribute("oat.code_hash", code_hash)

        started_at = datetime.now(timezone.utc)

        # Log the execution request (full audit)
        logger.info(
            "oat_execution_started",
            execution_id=request.execution_id,
            user_id=request.user_id,
            user_email=request.user_email,
            intent=request.intent[:200],  # Truncate for log
            code_hash=code_hash,
            code_length=len(request.code),
            timeout_seconds=request.timeout_seconds,
            max_memory_mb=request.max_memory_mb,
            capabilities=request.capabilities,
            has_credentials=request.credentials is not None,
        )

        # Update metrics
        execution_counter.add(1, {"capability": ",".join(request.capabilities)})
        active_executions.add(1)

        start_time = time.time()

        # Decode uploaded files to /tmp before execution
        file_env_vars: Dict[str, str] = {}
        if request.files:
            import base64 as b64mod
            for idx, file_info in enumerate(request.files):
                try:
                    fname = file_info.get("name", f"file_{idx}")
                    fdata = file_info.get("data", "")
                    if fdata:
                        decoded = b64mod.b64decode(fdata)
                        fpath = f"/tmp/{fname}"
                        with open(fpath, "wb") as f:
                            f.write(decoded)
                        file_env_vars[f"UPLOADED_FILE_{idx}"] = fpath
                        file_env_vars[f"UPLOADED_FILE_{idx}_NAME"] = fname
                        file_env_vars[f"UPLOADED_FILE_{idx}_TYPE"] = file_info.get("type", "")
                        logger.info(
                            "oat_file_decoded",
                            execution_id=request.execution_id,
                            file_name=fname,
                            file_size=len(decoded),
                            file_path=fpath,
                        )
                except Exception as e:
                    logger.error("oat_file_decode_error", error=str(e), file_index=idx)

        # Merge file env vars with credentials
        merged_creds = dict(request.credentials or {})
        merged_creds.update(file_env_vars)

        try:
            # Execute the code
            result: ExecutionResult = await executor.execute(
                code=request.code,
                execution_id=request.execution_id,
                timeout_seconds=request.timeout_seconds,
                max_memory_mb=request.max_memory_mb,
                credentials=merged_creds if merged_creds else None,
                capabilities=request.capabilities,
            )

            execution_time_ms = int((time.time() - start_time) * 1000)
            completed_at = datetime.now(timezone.utc)

            # Log execution result
            logger.info(
                "oat_execution_completed",
                execution_id=request.execution_id,
                user_id=request.user_id,
                success=result.success,
                execution_time_ms=execution_time_ms,
                memory_used_bytes=result.memory_used_bytes,
                exit_code=result.exit_code,
                stdout_length=len(result.stdout) if result.stdout else 0,
                stderr_length=len(result.stderr) if result.stderr else 0,
            )

            # Update OTEL metrics
            execution_duration.record(execution_time_ms)
            if result.memory_used_bytes:
                memory_usage.record(result.memory_used_bytes)
            if not result.success:
                execution_errors.add(1, {"error_type": result.error_type or "unknown"})

            # Update Prometheus metrics
            status_label = "success" if result.success else "error"
            prom_executions_total.labels(status=status_label).inc()
            prom_execution_duration_seconds.observe(execution_time_ms / 1000.0)

            span.set_attribute("oat.success", result.success)
            span.set_attribute("oat.execution_time_ms", execution_time_ms)

            response = ExecutionResponse(
                execution_id=request.execution_id,
                success=result.success,
                stdout=result.stdout,
                stderr=result.stderr,
                result=result.result,
                error=result.error,
                execution_time_ms=execution_time_ms,
                memory_used_bytes=result.memory_used_bytes,
                code_hash=code_hash,
                started_at=started_at.isoformat(),
                completed_at=completed_at.isoformat(),
            )

            # Send callback if configured
            if request.callback_url:
                background_tasks.add_task(
                    send_callback,
                    request.callback_url,
                    response.model_dump(),
                )

            return response

        except asyncio.TimeoutError:
            execution_time_ms = int((time.time() - start_time) * 1000)
            completed_at = datetime.now(timezone.utc)

            logger.warning(
                "oat_execution_timeout",
                execution_id=request.execution_id,
                user_id=request.user_id,
                timeout_seconds=request.timeout_seconds,
            )

            execution_errors.add(1, {"error_type": "timeout"})
            span.set_attribute("oat.error", "timeout")

            # Prometheus metrics for timeout
            prom_executions_total.labels(status="timeout").inc()
            prom_execution_duration_seconds.observe(execution_time_ms / 1000.0)

            return ExecutionResponse(
                execution_id=request.execution_id,
                success=False,
                error=f"Execution timed out after {request.timeout_seconds} seconds",
                execution_time_ms=execution_time_ms,
                code_hash=code_hash,
                started_at=started_at.isoformat(),
                completed_at=completed_at.isoformat(),
            )

        except Exception as e:
            execution_time_ms = int((time.time() - start_time) * 1000)
            completed_at = datetime.now(timezone.utc)

            logger.error(
                "oat_execution_error",
                execution_id=request.execution_id,
                user_id=request.user_id,
                error=str(e),
                error_type=type(e).__name__,
            )

            execution_errors.add(1, {"error_type": type(e).__name__})
            span.set_attribute("oat.error", str(e))

            # Prometheus metrics for exception
            prom_executions_total.labels(status="error").inc()
            prom_execution_duration_seconds.observe(execution_time_ms / 1000.0)

            return ExecutionResponse(
                execution_id=request.execution_id,
                success=False,
                error=str(e),
                execution_time_ms=execution_time_ms,
                code_hash=code_hash,
                started_at=started_at.isoformat(),
                completed_at=completed_at.isoformat(),
            )

        finally:
            active_executions.add(-1)

@app.get("/metrics")
async def get_metrics():
    """Prometheus metrics endpoint for scraping."""
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST,
    )

# =============================================================================
# Helpers
# =============================================================================

async def send_callback(url: str, data: dict):
    """Send execution result to callback URL."""
    import httpx

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                url,
                json=data,
                timeout=10.0,
                headers={"Content-Type": "application/json"},
            )
        logger.info("oat_callback_sent", url=url, execution_id=data.get("execution_id"))
    except Exception as e:
        logger.error("oat_callback_failed", url=url, error=str(e))
