

"""
OAT Executor Entry Point

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

    port = int(os.environ.get("OAT_EXECUTOR_PORT", "8090"))

    uvicorn.run(
        "openagentic_synth.server:app",
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
