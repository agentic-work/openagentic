# Proprietary and confidential. Unauthorized copying prohibited.

"""
Synth Executor Entry Point

Starts the FastAPI server with full OTEL instrumentation.
"""

import os
import uvicorn
from .telemetry import setup_telemetry
from .logging_config import setup_logging

def main():
    # Initialize telemetry first
    setup_telemetry()
    setup_logging()

    # SYNTH_EXECUTOR_PORT is the current name; OAT_EXECUTOR_PORT kept as a
    # fallback read-only alias so existing Helm overrides keep working until
    # the next chart bump. Writers should set SYNTH_EXECUTOR_PORT only.
    port = int(
        os.environ.get("SYNTH_EXECUTOR_PORT")
        or os.environ.get("OAT_EXECUTOR_PORT")
        or "8090"
    )

    uvicorn.run(
        "synth_executor.server:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        access_log=True,
        # Single worker - scaling handled by K8s replicas
        workers=1,
        # Limit connections per worker
        limit_concurrency=10,
        # Timeout for requests
        timeout_keep_alive=5,
    )

if __name__ == "__main__":
    main()
