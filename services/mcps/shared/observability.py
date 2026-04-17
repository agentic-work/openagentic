# Proprietary and confidential. Unauthorized copying prohibited.

"""
Shared observability module for all OpenAgentic MCP services.
Provides structured JSON logging via structlog and optional Prometheus metrics.

Usage:
    from observability import configure_logging

    logger = configure_logging('oap-admin-mcp')
    logger.info("server started", port=8083, tools=12)
"""
import logging
import os
import sys

import structlog

def configure_logging(service_name: str, log_level: str = None):
    """Configure structlog for JSON structured logging.

    Args:
        service_name: Name of the MCP service (e.g., 'oap-admin-mcp')
        log_level: Override log level (default: LOG_LEVEL env var or INFO)
    """
    level = getattr(
        logging,
        (log_level or os.environ.get("LOG_LEVEL", "INFO")).upper(),
        logging.INFO,
    )

    # Configure stdlib logging to use structlog
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stderr,
        level=level,
        force=True,
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Reduce noise from libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    return structlog.get_logger(service=service_name)
