"""Helm tools."""

import json
import asyncio
from typing import Any, Dict, Optional

from .._core import (
    mcp,
    logger,
    validate_namespace_write_access,
)

__all__ = [
    "helm_list",
    "helm_status",
    "helm_history",
    "helm_install",
    "helm_upgrade",
    "helm_uninstall",
    "helm_rollback",
    "helm_get_values",
]

# ============================================================================
# HELM TOOLS
# ============================================================================

@mcp.tool(description="List Helm releases in a namespace or all namespaces.")
async def helm_list(
    namespace: Optional[str] = None,
    all_namespaces: bool = False
) -> Dict[str, Any]:
    """List Helm releases"""
    try:
        import subprocess

        cmd = ["helm", "list", "--output", "json"]

        if all_namespaces:
            cmd.append("--all-namespaces")
        elif namespace:
            cmd.extend(["-n", namespace])

        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        releases = json.loads(result.stdout) if result.stdout else []

        return {
            "success": True,
            "namespace": namespace or ("all" if all_namespaces else "default"),
            "releases": releases,
            "count": len(releases)
        }
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to list Helm releases: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get status of a Helm release.")
async def helm_status(
    release_name: str,
    namespace: str = "default"
) -> Dict[str, Any]:
    """Get Helm release status"""
    try:
        import subprocess

        cmd = ["helm", "status", release_name, "-n", namespace, "--output", "json"]
        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        status = json.loads(result.stdout) if result.stdout else {}

        return {
            "success": True,
            "release": release_name,
            "namespace": namespace,
            "status": status
        }
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to get Helm status for {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get Helm release history showing all revisions.")
async def helm_history(
    release_name: str,
    namespace: str = "default"
) -> Dict[str, Any]:
    """Get Helm release history"""
    try:
        import subprocess

        cmd = ["helm", "history", release_name, "-n", namespace, "--output", "json"]
        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        history = json.loads(result.stdout) if result.stdout else []

        return {
            "success": True,
            "release": release_name,
            "namespace": namespace,
            "history": history,
            "count": len(history)
        }
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to get Helm history for {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Install a Helm chart. BLOCKED for protected namespace.")
async def helm_install(
    release_name: str,
    chart: str,
    namespace: str = "default",
    values: Optional[Dict[str, Any]] = None,
    create_namespace: bool = False,
    wait: bool = True,
    timeout: str = "5m"
) -> Dict[str, Any]:
    """Install a Helm chart"""
    try:
        validate_namespace_write_access(namespace, "install Helm chart in")

        import subprocess
        import tempfile
        import yaml as pyyaml

        cmd = ["helm", "install", release_name, chart, "-n", namespace, "--output", "json"]

        if create_namespace:
            cmd.append("--create-namespace")

        if wait:
            cmd.extend(["--wait", "--timeout", timeout])

        # Write values to temp file if provided
        values_file_name = None
        if values:
            def _write_values_tempfile() -> str:
                # Synchronous tempfile + YAML dump kept off the event loop.
                f = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False)
                try:
                    pyyaml.dump(values, f)
                    return f.name
                finally:
                    f.close()

            values_file_name = await asyncio.to_thread(_write_values_tempfile)
            cmd.extend(["-f", values_file_name])

        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=600
        )

        # Clean up temp file
        if values_file_name:
            import os
            await asyncio.to_thread(os.unlink, values_file_name)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        logger.info(f"Installed Helm chart {chart} as {release_name} in {namespace}")

        return {
            "success": True,
            "release": release_name,
            "chart": chart,
            "namespace": namespace,
            "message": f"Release '{release_name}' installed successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to install Helm chart {chart}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Upgrade a Helm release. BLOCKED for protected namespace.")
async def helm_upgrade(
    release_name: str,
    chart: str,
    namespace: str = "default",
    values: Optional[Dict[str, Any]] = None,
    reuse_values: bool = True,
    wait: bool = True,
    timeout: str = "5m"
) -> Dict[str, Any]:
    """Upgrade a Helm release"""
    try:
        validate_namespace_write_access(namespace, "upgrade Helm release in")

        import subprocess
        import tempfile
        import yaml as pyyaml

        cmd = ["helm", "upgrade", release_name, chart, "-n", namespace, "--output", "json"]

        if reuse_values:
            cmd.append("--reuse-values")

        if wait:
            cmd.extend(["--wait", "--timeout", timeout])

        values_file_name = None
        if values:
            def _write_values_tempfile() -> str:
                # Synchronous tempfile + YAML dump kept off the event loop.
                f = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False)
                try:
                    pyyaml.dump(values, f)
                    return f.name
                finally:
                    f.close()

            values_file_name = await asyncio.to_thread(_write_values_tempfile)
            cmd.extend(["-f", values_file_name])

        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=600
        )

        if values_file_name:
            import os
            await asyncio.to_thread(os.unlink, values_file_name)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        logger.info(f"Upgraded Helm release {release_name} in {namespace}")

        return {
            "success": True,
            "release": release_name,
            "chart": chart,
            "namespace": namespace,
            "message": f"Release '{release_name}' upgraded successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to upgrade Helm release {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Uninstall a Helm release. BLOCKED for protected namespace.")
async def helm_uninstall(
    release_name: str,
    namespace: str = "default",
    keep_history: bool = False
) -> Dict[str, Any]:
    """Uninstall a Helm release"""
    try:
        validate_namespace_write_access(namespace, "uninstall Helm release from")

        import subprocess

        cmd = ["helm", "uninstall", release_name, "-n", namespace]

        if keep_history:
            cmd.append("--keep-history")

        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=120
        )

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        logger.info(f"Uninstalled Helm release {release_name} from {namespace}")

        return {
            "success": True,
            "release": release_name,
            "namespace": namespace,
            "message": f"Release '{release_name}' uninstalled successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to uninstall Helm release {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Rollback a Helm release to a previous revision. BLOCKED for protected namespace.")
async def helm_rollback(
    release_name: str,
    revision: int,
    namespace: str = "default",
    wait: bool = True,
    timeout: str = "5m"
) -> Dict[str, Any]:
    """Rollback a Helm release"""
    try:
        validate_namespace_write_access(namespace, "rollback Helm release in")

        import subprocess

        cmd = ["helm", "rollback", release_name, str(revision), "-n", namespace]

        if wait:
            cmd.extend(["--wait", "--timeout", timeout])

        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=600
        )

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        logger.info(f"Rolled back Helm release {release_name} to revision {revision}")

        return {
            "success": True,
            "release": release_name,
            "revision": revision,
            "namespace": namespace,
            "message": f"Release '{release_name}' rolled back to revision {revision}"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to rollback Helm release {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get values for a Helm release.")
async def helm_get_values(
    release_name: str,
    namespace: str = "default",
    all_values: bool = False
) -> Dict[str, Any]:
    """Get Helm release values"""
    try:
        import subprocess

        cmd = ["helm", "get", "values", release_name, "-n", namespace, "--output", "json"]

        if all_values:
            cmd.append("--all")

        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        values = json.loads(result.stdout) if result.stdout else {}

        return {
            "success": True,
            "release": release_name,
            "namespace": namespace,
            "values": values
        }
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to get Helm values for {release_name}: {e}")
        return {"success": False, "error": str(e)}
