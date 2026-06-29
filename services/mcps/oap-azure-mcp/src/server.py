"""
OpenAgentic Azure MCP Server — thin entry point.

The implementation lives in:
  - ``_core``      — the ``mcp`` FastMCP instance, service-principal auth
                     (``require_user_token``/``get_service_principal_credential``),
                     config (``DEFAULT_SUBSCRIPTION_ID``/``AZURE_*``), the Azure SDK
                     client-class imports, ``error_response``/``_in_thread`` helpers,
                     ``AZURE_SERVER_INSTRUCTIONS`` and the http_transport guard.
  - ``tools.*``    — one module per Azure domain; each ``from _core import *`` and
                     registers its ``@mcp.tool`` handlers as an import side-effect.

Importing THIS module constructs ``mcp`` (via ``_core``) and side-effect-imports
every tools module so the FULL tool registry (~96 tools) is populated. Every
shared helper + Azure client class (via ``from _core import *``) and every tool
(via ``from tools.* import *``) is re-exported at module scope so
``getattr(server, "<tool>")`` keeps resolving against this module.
"""

import os
import sys

# Make the package root importable so the absolute imports below resolve both
# under `python -m src.server` (Docker; cwd is the parent of `src`) and under
# `import server` with `src` on sys.path (the test harness).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Core: FastMCP instance, auth, config, Azure SDK client classes, helpers,
# instructions, http_transport guard. Re-exported so `server.mcp`,
# `server.require_user_token`, `server.DEFAULT_SUBSCRIPTION_ID`, the SDK client
# classes, `server.run_with_http_support`, etc. resolve against this module.
from _core import *  # noqa: F401,F403

# Side-effect-import + re-export every tool group. Each `import *` triggers the
# module's `@mcp.tool` registrations AND binds every tool function onto this
# module's namespace (each tools module declares __all__).
from tools.help import *  # noqa: F401,F403
from tools.resources import *  # noqa: F401,F403
from tools.compute import *  # noqa: F401,F403
from tools.aks import *  # noqa: F401,F403
from tools.networking import *  # noqa: F401,F403
from tools.storage import *  # noqa: F401,F403
from tools.keyvault import *  # noqa: F401,F403
from tools.cost import *  # noqa: F401,F403
from tools.identity import *  # noqa: F401,F403
from tools.monitoring import *  # noqa: F401,F403
from tools.governance import *  # noqa: F401,F403
from tools.webapps import *  # noqa: F401,F403
from tools.ai import *  # noqa: F401,F403


def main():
    """Main entry point for the OpenAgentic Azure MCP Server."""
    logger.info("=" * 70)
    logger.info("OpenAgentic Azure MCP Server - Full Azure SDK (az cli Parity)")
    logger.info("=" * 70)
    logger.info("")
    logger.info("AUTHENTICATION:")
    logger.info("  - Azure AD service principal (ClientSecretCredential)")
    logger.info("  - From AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET")
    logger.info("  - NO OBO / user-token passthrough")
    logger.info(f"  - Service principal configured: {'Yes' if (AZURE_TENANT_ID and AZURE_CLIENT_ID and AZURE_CLIENT_SECRET) else 'No (set the AZURE_* env vars)'}")
    logger.info("")
    logger.info(f"Default Subscription: {DEFAULT_SUBSCRIPTION_ID[:8] if DEFAULT_SUBSCRIPTION_ID else 'Not set'}...")
    logger.info("")
    logger.info("Available Tool Categories:")
    logger.info("  - Subscriptions & Resources")
    logger.info("  - Compute (VMs)")
    logger.info("  - AKS (Kubernetes)")
    logger.info("  - Networking (VNets, NSGs, App Gateway, Load Balancer)")
    logger.info("  - Storage")
    logger.info("  - Key Vault")
    logger.info("  - Cost Management")
    logger.info("  - Microsoft Graph (Users, Groups, Apps)")
    logger.info("  - Monitoring")
    logger.info("  - AI Foundry (Deployment Management)")
    logger.info("=" * 70)

    # Use HTTP transport if available and in HTTP mode, otherwise use stdio
    if HTTP_TRANSPORT_AVAILABLE:
        run_with_http_support(
            mcp_server=mcp,
            name="oap-azure-mcp",
            version="2.0.0",
            default_port=8081
        )
    else:
        mcp.run()

if __name__ == "__main__":
    main()
