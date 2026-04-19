# Proprietary and confidential. Unauthorized copying prohibited.

"""
OpenAgentic GCP MCP Server
==================

A Model Context Protocol (MCP) server for Google Cloud Platform operations.
Uses service account authentication to control GCP resources.

Environment Variables:
    GCP_PROJECT_ID: Default GCP project ID
    GCP_CREDENTIALS_JSON: JSON string of service account credentials (preferred)
    GCP_CREDENTIALS_FILE: Path to service account JSON key file (alternative)
    GCP_REGION: Default region (e.g., us-central1)
    OpenAgentic_GCP_MCP_DISABLED: Set to "true" to disable this MCP
    LOG_LEVEL: Logging level (debug, info, warning, error)

Author: OpenAgentic Platform
"""

import os
import sys
import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-gcp-mcp')
except ImportError:
    log_level = os.getenv("LOG_LEVEL", "info").upper()
    logging.basicConfig(
        level=getattr(logging, log_level),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("oap-gcp-mcp")

# Check if disabled
if os.getenv("OpenAgentic_GCP_MCP_DISABLED", "false").lower() == "true":
    logger.warning("OpenAgentic GCP MCP is disabled via OpenAgentic_GCP_MCP_DISABLED environment variable")
    sys.exit(0)

from mcp.server.fastmcp import FastMCP
import httpx

# Google Cloud imports
try:
    from google.oauth2 import service_account
    from google.auth import default as google_default_auth
    from google.auth.transport.requests import Request
    import google.auth
    GCP_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Google Cloud SDK not available: {e}")
    GCP_AVAILABLE = False

# Initialize FastMCP server
mcp = FastMCP("OpenAgentic GCP MCP")

# Configuration
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")
GCP_CREDENTIALS_JSON = os.getenv("GCP_CREDENTIALS_JSON")
GCP_CREDENTIALS_FILE = os.getenv("GCP_CREDENTIALS_FILE")

# GCP API Base URLs
GCP_API_BASE = "https://compute.googleapis.com/compute/v1"
GCP_CRM_API_BASE = "https://cloudresourcemanager.googleapis.com/v1"
GCP_STORAGE_API_BASE = "https://storage.googleapis.com/storage/v1"
GCP_BILLING_API_BASE = "https://cloudbilling.googleapis.com/v1"
GCP_VERTEX_AI_API_BASE = "https://aiplatform.googleapis.com/v1"
GCP_MONITORING_API_BASE = "https://monitoring.googleapis.com/v3"

# Credentials cache
_credentials = None
_credentials_expiry = None

# OBO (On-Behalf-Of) context for user-delegated operations
_obo_access_token = None
_obo_user_email = None

def set_obo_context(access_token: str, user_email: str = None):
    """
    Set the OBO context to use a user's access token for GCP API calls.
    This enables operations to run as the authenticated user instead of the service account.

    Args:
        access_token: User's Google OAuth access token
        user_email: User's email (optional, for logging)
    """
    global _obo_access_token, _obo_user_email
    _obo_access_token = access_token
    _obo_user_email = user_email
    logger.info(f"OBO context set for user: {user_email or 'unknown'}")

def clear_obo_context():
    """Clear the OBO context, reverting to service account authentication."""
    global _obo_access_token, _obo_user_email
    _obo_access_token = None
    _obo_user_email = None
    logger.info("OBO context cleared")

def get_credentials():
    """
    Get GCP credentials from service account.

    Priority:
    1. GCP_CREDENTIALS_JSON environment variable (JSON string)
    2. GCP_CREDENTIALS_FILE environment variable (path to JSON file)
    3. Application Default Credentials (ADC)
    """
    global _credentials, _credentials_expiry

    if not GCP_AVAILABLE:
        raise RuntimeError("Google Cloud SDK is not installed")

    # Check if cached credentials are still valid
    if _credentials and _credentials_expiry:
        if datetime.utcnow() < _credentials_expiry:
            return _credentials

    scopes = [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/compute",
        "https://www.googleapis.com/auth/devstorage.full_control",
        "https://www.googleapis.com/auth/cloud-billing.readonly",
        "https://www.googleapis.com/auth/monitoring.read"
    ]

    try:
        # Option 1: JSON credentials from environment variable
        if GCP_CREDENTIALS_JSON:
            logger.info("Using credentials from GCP_CREDENTIALS_JSON environment variable")
            creds_info = json.loads(GCP_CREDENTIALS_JSON)
            _credentials = service_account.Credentials.from_service_account_info(
                creds_info,
                scopes=scopes
            )

        # Option 2: Credentials file path
        elif GCP_CREDENTIALS_FILE and os.path.exists(GCP_CREDENTIALS_FILE):
            logger.info(f"Using credentials from file: {GCP_CREDENTIALS_FILE}")
            _credentials = service_account.Credentials.from_service_account_file(
                GCP_CREDENTIALS_FILE,
                scopes=scopes
            )

        # Option 3: Application Default Credentials
        else:
            logger.info("Using Application Default Credentials (ADC)")
            _credentials, project = google_default_auth(scopes=scopes)
            if project:
                logger.info(f"ADC project: {project}")

        # Refresh if needed
        if _credentials.expired or not _credentials.valid:
            _credentials.refresh(Request())

        return _credentials

    except Exception as e:
        logger.error(f"Failed to get GCP credentials: {e}")
        raise

def get_access_token() -> str:
    """
    Get a valid access token for GCP API calls.

    If OBO context is set, returns the user's access token.
    Otherwise, returns the service account token.
    """
    global _obo_access_token

    # Use OBO token if available (user-delegated operations)
    if _obo_access_token:
        logger.debug(f"Using OBO access token for user: {_obo_user_email or 'unknown'}")
        return _obo_access_token

    # Fall back to service account credentials
    credentials = get_credentials()

    # Refresh if expired
    if credentials.expired:
        credentials.refresh(Request())

    return credentials.token

async def make_gcp_request(
    method: str,
    url: str,
    body: Optional[Dict] = None,
    timeout: float = 120.0
) -> Dict[str, Any]:
    """
    Make an authenticated request to GCP APIs.

    Args:
        method: HTTP method (GET, POST, PUT, PATCH, DELETE)
        url: Full URL for the API call
        body: Optional request body
        timeout: Request timeout in seconds

    Returns:
        Dict with success status, status_code, and data/error
    """
    try:
        token = get_access_token()

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        logger.info(f"GCP API Request: {method} {url}")

        async with httpx.AsyncClient(timeout=timeout) as client:
            if method.upper() == "GET":
                response = await client.get(url, headers=headers)
            elif method.upper() == "POST":
                response = await client.post(url, headers=headers, json=body)
            elif method.upper() == "PUT":
                response = await client.put(url, headers=headers, json=body)
            elif method.upper() == "PATCH":
                response = await client.patch(url, headers=headers, json=body)
            elif method.upper() == "DELETE":
                response = await client.delete(url, headers=headers)
            else:
                return {
                    "success": False,
                    "error": f"Unsupported HTTP method: {method}"
                }

        logger.info(f"GCP API Response: {response.status_code}")

        # Parse response
        try:
            data = response.json()
        except:
            data = {"raw": response.text}

        success = 200 <= response.status_code < 300

        return {
            "success": success,
            "status_code": response.status_code,
            "data": data if success else None,
            "error": data if not success else None
        }

    except Exception as e:
        logger.error(f"GCP API error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

# ============================================================================
# MCP TOOLS
# ============================================================================

@mcp.tool()
async def gcp_api_execute(
    service: str,
    method: str,
    path: str,
    project_id: Optional[str] = None,
    body: Optional[Dict] = None,
    meta: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Execute ANY Google Cloud Platform API operation.

    This is a universal tool that can perform any GCP operation via REST APIs.
    It supports Compute Engine, Cloud Storage, Cloud Resource Manager, and more.

    Supports OBO (On-Behalf-Of) authentication: When a user access token is provided
    via the meta.userAccessToken field, operations run as the authenticated user
    instead of the service account.

    Args:
        service: GCP service name. Options:
            - "compute": Compute Engine (VMs, disks, networks, etc.)
            - "storage": Cloud Storage (buckets, objects)
            - "crm": Cloud Resource Manager (projects, folders, orgs)
            - "iam": Identity and Access Management
            - "monitoring": Cloud Monitoring
            - "logging": Cloud Logging
        method: HTTP method (GET, POST, PUT, PATCH, DELETE)
        path: API path after the base URL. Examples:
            - Compute: "/projects/{project}/zones/{zone}/instances"
            - Storage: "/b/{bucket}/o" (list objects)
            - CRM: "/projects/{project}"
        project_id: GCP project ID (defaults to GCP_PROJECT_ID env var)
        body: Request body for POST/PUT/PATCH operations
        meta: Internal metadata from MCP proxy containing userAccessToken for OBO auth

    Returns:
        Dict with:
            - success: boolean indicating if the operation succeeded
            - status_code: HTTP status code
            - data: Response data (on success)
            - error: Error details (on failure)

    Examples:
        # List VM instances in a zone
        gcp_api_execute(
            service="compute",
            method="GET",
            path="/projects/my-project/zones/us-central1-a/instances"
        )

        # Create a storage bucket
        gcp_api_execute(
            service="storage",
            method="POST",
            path="/b",
            body={"name": "my-bucket", "location": "US"}
        )

        # Get project info
        gcp_api_execute(
            service="crm",
            method="GET",
            path="/projects/my-project"
        )
    """
    try:
        # Extract user token from meta if provided by MCP proxy
        # This enables OBO (On-Behalf-Of) authentication so operations run as the user
        if meta and isinstance(meta, dict):
            user_token = meta.get("userAccessToken")
            user_email = meta.get("userEmail")
            if user_token:
                logger.info(f"OBO: Using user token from meta for {user_email or 'unknown user'}")
                set_obo_context(user_token, user_email)
            else:
                logger.info("OBO: No userAccessToken in meta, using service account")
                clear_obo_context()
        else:
            logger.info("OBO: No meta provided, using service account")
            clear_obo_context()

        project = project_id or GCP_PROJECT_ID

        # Build the full URL based on service
        service_bases = {
            "compute": "https://compute.googleapis.com/compute/v1",
            "storage": "https://storage.googleapis.com/storage/v1",
            "crm": "https://cloudresourcemanager.googleapis.com/v1",
            "iam": "https://iam.googleapis.com/v1",
            "monitoring": "https://monitoring.googleapis.com/v3",
            "logging": "https://logging.googleapis.com/v2",
            "billing": "https://cloudbilling.googleapis.com/v1",
            "vertex": "https://aiplatform.googleapis.com/v1",
            "bigquery": "https://bigquery.googleapis.com/bigquery/v2"
        }

        base_url = service_bases.get(service.lower())
        if not base_url:
            return {
                "success": False,
                "error": f"Unknown service: {service}. Valid options: {list(service_bases.keys())}"
            }

        # Replace {project} placeholder in path
        resolved_path = path.replace("{project}", project)
        full_url = f"{base_url}{resolved_path}"

        logger.info(f"Executing GCP API: {method} {full_url}")

        return await make_gcp_request(method, full_url, body)

    except Exception as e:
        logger.error(f"GCP API execute error: {e}")
        return {
            "success": False,
            "error": str(e)
        }
    finally:
        # Always clear OBO context after each request
        clear_obo_context()

@mcp.tool()
async def gcp_list_instances(
    project_id: Optional[str] = None,
    zone: Optional[str] = None
) -> Dict[str, Any]:
    """
    List Compute Engine VM instances.

    Args:
        project_id: GCP project ID (defaults to configured project)
        zone: Specific zone to list (e.g., "us-central1-a"). If not provided,
              lists instances across all zones (aggregated list).

    Returns:
        Dict with list of instances and their details
    """
    project = project_id or GCP_PROJECT_ID

    if zone:
        path = f"/projects/{project}/zones/{zone}/instances"
    else:
        # Aggregated list across all zones
        path = f"/projects/{project}/aggregated/instances"

    return await gcp_api_execute(
        service="compute",
        method="GET",
        path=path,
        project_id=project
    )

@mcp.tool()
async def gcp_get_instance(
    instance_name: str,
    zone: str,
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get details of a specific Compute Engine VM instance.

    Args:
        instance_name: Name of the VM instance
        zone: Zone where the instance is located (e.g., "us-central1-a")
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with instance details including status, machine type, network, disks
    """
    project = project_id or GCP_PROJECT_ID
    path = f"/projects/{project}/zones/{zone}/instances/{instance_name}"

    return await gcp_api_execute(
        service="compute",
        method="GET",
        path=path,
        project_id=project
    )

@mcp.tool()
async def gcp_start_instance(
    instance_name: str,
    zone: str,
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Start a stopped Compute Engine VM instance.

    Args:
        instance_name: Name of the VM instance to start
        zone: Zone where the instance is located
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with operation status
    """
    project = project_id or GCP_PROJECT_ID
    path = f"/projects/{project}/zones/{zone}/instances/{instance_name}/start"

    return await gcp_api_execute(
        service="compute",
        method="POST",
        path=path,
        project_id=project
    )

@mcp.tool()
async def gcp_stop_instance(
    instance_name: str,
    zone: str,
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Stop a running Compute Engine VM instance.

    Args:
        instance_name: Name of the VM instance to stop
        zone: Zone where the instance is located
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with operation status
    """
    project = project_id or GCP_PROJECT_ID
    path = f"/projects/{project}/zones/{zone}/instances/{instance_name}/stop"

    return await gcp_api_execute(
        service="compute",
        method="POST",
        path=path,
        project_id=project
    )

@mcp.tool()
async def gcp_list_buckets(
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    List Cloud Storage buckets in a project.

    Args:
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with list of buckets and their details
    """
    project = project_id or GCP_PROJECT_ID

    url = f"https://storage.googleapis.com/storage/v1/b?project={project}"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def gcp_list_bucket_objects(
    bucket_name: str,
    prefix: Optional[str] = None,
    max_results: int = 100
) -> Dict[str, Any]:
    """
    List objects in a Cloud Storage bucket.

    Args:
        bucket_name: Name of the storage bucket
        prefix: Optional prefix to filter objects (like a folder path)
        max_results: Maximum number of results to return (default 100)

    Returns:
        Dict with list of objects and their metadata
    """
    url = f"https://storage.googleapis.com/storage/v1/b/{bucket_name}/o"
    params = [f"maxResults={max_results}"]
    if prefix:
        params.append(f"prefix={prefix}")

    if params:
        url += "?" + "&".join(params)

    return await make_gcp_request("GET", url)

@mcp.tool()
async def gcp_get_project(
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get details of a GCP project.

    Args:
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with project details including name, state, labels
    """
    project = project_id or GCP_PROJECT_ID

    return await gcp_api_execute(
        service="crm",
        method="GET",
        path=f"/projects/{project}",
        project_id=project
    )

@mcp.tool()
async def gcp_list_zones(
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    List available zones in a GCP project.

    Args:
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with list of zones and their status
    """
    project = project_id or GCP_PROJECT_ID

    return await gcp_api_execute(
        service="compute",
        method="GET",
        path=f"/projects/{project}/zones",
        project_id=project
    )

@mcp.tool()
async def gcp_list_regions(
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    List available regions in a GCP project.

    Args:
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with list of regions and their status
    """
    project = project_id or GCP_PROJECT_ID

    return await gcp_api_execute(
        service="compute",
        method="GET",
        path=f"/projects/{project}/regions",
        project_id=project
    )

@mcp.tool()
async def gcp_list_machine_types(
    zone: str,
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    List available machine types in a zone.

    Args:
        zone: Zone to list machine types for (e.g., "us-central1-a")
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with list of machine types and their specs
    """
    project = project_id or GCP_PROJECT_ID

    return await gcp_api_execute(
        service="compute",
        method="GET",
        path=f"/projects/{project}/zones/{zone}/machineTypes",
        project_id=project
    )

@mcp.tool()
async def gcp_list_disks(
    zone: Optional[str] = None,
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    List persistent disks in a project.

    Args:
        zone: Specific zone to list (if not provided, lists all zones)
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with list of disks and their details
    """
    project = project_id or GCP_PROJECT_ID

    if zone:
        path = f"/projects/{project}/zones/{zone}/disks"
    else:
        path = f"/projects/{project}/aggregated/disks"

    return await gcp_api_execute(
        service="compute",
        method="GET",
        path=path,
        project_id=project
    )

@mcp.tool()
async def gcp_list_networks(
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    List VPC networks in a project.

    Args:
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with list of networks and their configurations
    """
    project = project_id or GCP_PROJECT_ID

    return await gcp_api_execute(
        service="compute",
        method="GET",
        path=f"/projects/{project}/global/networks",
        project_id=project
    )

@mcp.tool()
async def gcp_list_firewalls(
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    List firewall rules in a project.

    Args:
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with list of firewall rules and their configurations
    """
    project = project_id or GCP_PROJECT_ID

    return await gcp_api_execute(
        service="compute",
        method="GET",
        path=f"/projects/{project}/global/firewalls",
        project_id=project
    )

# ============================================================================
# BILLING & COST MANAGEMENT TOOLS
# ============================================================================

@mcp.tool()
async def gcp_get_billing_info(
    project_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get billing information for a GCP project.

    Args:
        project_id: GCP project ID (defaults to configured project)

    Returns:
        Dict with billing account info including:
        - billingAccountName: The associated billing account
        - billingEnabled: Whether billing is enabled
        - projectId: The project ID
    """
    project = project_id or GCP_PROJECT_ID
    url = f"https://cloudbilling.googleapis.com/v1/projects/{project}/billingInfo"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def gcp_list_billing_accounts() -> Dict[str, Any]:
    """
    List all billing accounts accessible to the service account.

    Returns:
        Dict with list of billing accounts and their details including:
        - name: Billing account resource name
        - displayName: Human-readable name
        - open: Whether the account is open/active
        - masterBillingAccount: Parent account if any
    """
    url = "https://cloudbilling.googleapis.com/v1/billingAccounts"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def gcp_get_billing_account(
    billing_account_id: str
) -> Dict[str, Any]:
    """
    Get details of a specific billing account.

    Args:
        billing_account_id: The billing account ID (e.g., "012345-6789AB-CDEF01")

    Returns:
        Dict with billing account details
    """
    url = f"https://cloudbilling.googleapis.com/v1/billingAccounts/{billing_account_id}"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def gcp_list_billing_account_projects(
    billing_account_id: str
) -> Dict[str, Any]:
    """
    List all projects associated with a billing account.

    Args:
        billing_account_id: The billing account ID

    Returns:
        Dict with list of projects linked to this billing account
    """
    url = f"https://cloudbilling.googleapis.com/v1/billingAccounts/{billing_account_id}/projects"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def gcp_query_cost_usage(
    billing_account_id: str,
    start_date: str,
    end_date: str,
    project_id: Optional[str] = None,
    service_filter: Optional[str] = None
) -> Dict[str, Any]:
    """
    Query cost and usage data from BigQuery billing export.

    PREREQUISITE — REQUIRES PROJECT-LEVEL SETUP (one-time, by a billing admin):
    GCP cost queries do NOT work out of the box on a fresh project. The billing
    account must be configured to export usage data to BigQuery, and that
    BigQuery dataset must be queryable by the user's identity. To enable:

      1. Console: Billing → Billing Export → BigQuery export → enable for the
         billing account, target a dataset (e.g. `billing_export`)
      2. Wait ~24 hours for the first export rows to land
      3. Grant `BigQuery Data Viewer` on the dataset to whoever runs this query

    If billing export is NOT configured, this tool returns 404 / "table not
    found" — that means the prerequisite is missing, NOT that there's no spend.
    Tell the user to enable billing export and try again.

    Reference: https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup

    Args:
        billing_account_id: The billing account ID
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        project_id: Optional filter by project ID
        service_filter: Optional filter by service (e.g., "Vertex AI", "Compute Engine")

    Returns:
        Dict with aggregated cost data including:
        - total_cost: Total cost in the period
        - by_service: Breakdown by GCP service
        - by_sku: Breakdown by SKU
    """
    # Billing export tables follow the pattern:
    # project.dataset.gcp_billing_export_v1_BILLING_ACCOUNT_ID
    dataset_id = f"gcp_billing_export_v1_{billing_account_id.replace('-', '_')}"

    # Build WHERE clause
    where_clauses = [
        f"usage_start_time >= '{start_date}'",
        f"usage_start_time < '{end_date}'"
    ]

    if project_id:
        where_clauses.append(f"project.id = '{project_id}'")
    if service_filter:
        where_clauses.append(f"service.description LIKE '%{service_filter}%'")

    where_clause = " AND ".join(where_clauses)

    query = f"""
    SELECT
        service.description AS service_name,
        SUM(cost) AS total_cost,
        SUM(usage.amount) AS total_usage,
        usage.unit AS usage_unit,
        currency
    FROM `{dataset_id}`
    WHERE {where_clause}
    GROUP BY service.description, usage.unit, currency
    ORDER BY total_cost DESC
    """

    return {
        "success": True,
        "data": {
            "query": query,
            "note": "Execute this query in BigQuery or use the BigQuery API. "
                    "Billing export must be configured for your billing account.",
            "documentation": "https://cloud.google.com/billing/docs/how-to/export-data-bigquery"
        }
    }

# ============================================================================
# VERTEX AI TOOLS
# ============================================================================

@mcp.tool()
async def vertex_ai_list_models(
    project_id: Optional[str] = None,
    region: Optional[str] = None
) -> Dict[str, Any]:
    """
    List Vertex AI models in a project.

    Args:
        project_id: GCP project ID (defaults to configured project)
        region: Region (defaults to GCP_REGION env var)

    Returns:
        Dict with list of Vertex AI models
    """
    project = project_id or GCP_PROJECT_ID
    location = region or GCP_REGION
    url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/models"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def vertex_ai_list_endpoints(
    project_id: Optional[str] = None,
    region: Optional[str] = None
) -> Dict[str, Any]:
    """
    List Vertex AI endpoints in a project.

    Args:
        project_id: GCP project ID (defaults to configured project)
        region: Region (defaults to GCP_REGION env var)

    Returns:
        Dict with list of Vertex AI endpoints
    """
    project = project_id or GCP_PROJECT_ID
    location = region or GCP_REGION
    url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/endpoints"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def vertex_ai_get_endpoint(
    endpoint_id: str,
    project_id: Optional[str] = None,
    region: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get details of a Vertex AI endpoint.

    Args:
        endpoint_id: The endpoint ID
        project_id: GCP project ID (defaults to configured project)
        region: Region (defaults to GCP_REGION env var)

    Returns:
        Dict with endpoint details including deployed models
    """
    project = project_id or GCP_PROJECT_ID
    location = region or GCP_REGION
    url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/endpoints/{endpoint_id}"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def vertex_ai_list_training_pipelines(
    project_id: Optional[str] = None,
    region: Optional[str] = None
) -> Dict[str, Any]:
    """
    List Vertex AI training pipelines.

    Args:
        project_id: GCP project ID (defaults to configured project)
        region: Region (defaults to GCP_REGION env var)

    Returns:
        Dict with list of training pipelines and their status
    """
    project = project_id or GCP_PROJECT_ID
    location = region or GCP_REGION
    url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/trainingPipelines"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def vertex_ai_list_custom_jobs(
    project_id: Optional[str] = None,
    region: Optional[str] = None
) -> Dict[str, Any]:
    """
    List Vertex AI custom training jobs.

    Args:
        project_id: GCP project ID (defaults to configured project)
        region: Region (defaults to GCP_REGION env var)

    Returns:
        Dict with list of custom jobs and their status
    """
    project = project_id or GCP_PROJECT_ID
    location = region or GCP_REGION
    url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/customJobs"
    return await make_gcp_request("GET", url)

@mcp.tool()
async def vertex_ai_usage_metrics(
    project_id: Optional[str] = None,
    region: Optional[str] = None,
    hours_ago: int = 24
) -> Dict[str, Any]:
    """
    Get Vertex AI usage metrics from Cloud Monitoring.

    Args:
        project_id: GCP project ID (defaults to configured project)
        region: Region filter (optional)
        hours_ago: How many hours of data to fetch (default 24)

    Returns:
        Dict with Vertex AI usage metrics including:
        - prediction_count: Number of predictions made
        - prediction_latency: Average prediction latency
        - online_prediction_count: Online prediction requests
    """
    project = project_id or GCP_PROJECT_ID

    # Calculate time window
    from datetime import timedelta
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=hours_ago)

    # Cloud Monitoring API for Vertex AI metrics
    # Metric types: aiplatform.googleapis.com/prediction/online/prediction_count
    metrics = [
        "aiplatform.googleapis.com/prediction/online/prediction_count",
        "aiplatform.googleapis.com/prediction/online/prediction_latencies",
        "aiplatform.googleapis.com/endpoint/deployed_model_count"
    ]

    results = {}

    for metric in metrics:
        metric_name = metric.split("/")[-1]
        url = (
            f"https://monitoring.googleapis.com/v3/projects/{project}/timeSeries"
            f"?filter=metric.type=\"{metric}\""
            f"&interval.startTime={start_time.isoformat()}Z"
            f"&interval.endTime={end_time.isoformat()}Z"
        )

        response = await make_gcp_request("GET", url)
        if response.get("success"):
            results[metric_name] = response.get("data", {})
        else:
            results[metric_name] = {"error": response.get("error")}

    return {
        "success": True,
        "data": {
            "project": project,
            "time_range": {
                "start": start_time.isoformat(),
                "end": end_time.isoformat()
            },
            "metrics": results
        }
    }

@mcp.tool()
async def vertex_ai_generative_models(
    project_id: Optional[str] = None,
    region: Optional[str] = None
) -> Dict[str, Any]:
    """
    List available generative AI models (Gemini, PaLM, etc.) in Vertex AI.

    Args:
        project_id: GCP project ID (defaults to configured project)
        region: Region (defaults to GCP_REGION env var)

    Returns:
        Dict with list of available generative AI models
    """
    project = project_id or GCP_PROJECT_ID
    location = region or GCP_REGION

    # List publishers/models available
    url = f"https://{location}-aiplatform.googleapis.com/v1/publishers/google/models"

    response = await make_gcp_request("GET", url)

    # Also provide common model info
    common_models = {
        "gemini-1.5-pro": "Most capable Gemini model for complex tasks",
        "gemini-1.5-flash": "Fast Gemini model for high-volume tasks",
        "gemini-1.0-pro": "Previous generation Gemini model",
        "text-bison": "Text generation (legacy PaLM)",
        "chat-bison": "Chat/conversation (legacy PaLM)",
        "textembedding-gecko": "Text embeddings",
        "multimodalembedding": "Multimodal embeddings",
        "imagegeneration": "Image generation (Imagen)",
        "code-bison": "Code generation (legacy)"
    }

    return {
        "success": True,
        "data": {
            "api_response": response.get("data") if response.get("success") else response.get("error"),
            "common_models": common_models,
            "usage_example": {
                "endpoint": f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/gemini-1.5-pro:generateContent",
                "method": "POST"
            }
        }
    }

@mcp.tool()
async def gcp_monitoring_query(
    metric_type: str,
    project_id: Optional[str] = None,
    hours_ago: int = 24,
    aggregation_minutes: int = 5
) -> Dict[str, Any]:
    """
    Query Cloud Monitoring metrics.

    Args:
        metric_type: The metric type to query. Examples:
            - "compute.googleapis.com/instance/cpu/utilization"
            - "aiplatform.googleapis.com/prediction/online/prediction_count"
            - "logging.googleapis.com/log_entry_count"
        project_id: GCP project ID (defaults to configured project)
        hours_ago: How many hours of data to fetch (default 24)
        aggregation_minutes: Aggregation period in minutes (default 5)

    Returns:
        Dict with time series data for the metric
    """
    project = project_id or GCP_PROJECT_ID

    from datetime import timedelta
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=hours_ago)

    url = (
        f"https://monitoring.googleapis.com/v3/projects/{project}/timeSeries"
        f"?filter=metric.type=\"{metric_type}\""
        f"&interval.startTime={start_time.isoformat()}Z"
        f"&interval.endTime={end_time.isoformat()}Z"
        f"&aggregation.alignmentPeriod={aggregation_minutes * 60}s"
        f"&aggregation.perSeriesAligner=ALIGN_MEAN"
    )

    return await make_gcp_request("GET", url)

# =============================================================================
# TYPED CONVENIENCE TOOLS — 0.6.6 P7 GCP MCP parity
# Per-service typed wrappers for GKE, Cloud Run, Cloud Functions, BigQuery,
# Pub/Sub, Cloud SQL, Secret Manager, Artifact Registry, Cloud Logging,
# Vertex AI. Each composes the REST URL and delegates to make_gcp_request.
# =============================================================================

def _proj(project_id: Optional[str]) -> str:
    """Resolve the project ID, defaulting to the configured GCP_PROJECT_ID."""
    return project_id or GCP_PROJECT_ID

async def _get(url: str) -> Dict[str, Any]:
    """Shared body for GET wrappers — keeps per-tool bodies single-statement."""
    return await make_gcp_request("GET", url)

# ---------- GKE (Kubernetes Engine) ----------

@mcp.tool()
async def gcp_list_gke_clusters(
    location: str = "-",
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """List GKE clusters. location='-' means all locations."""
    return await _get(f"https://container.googleapis.com/v1/projects/{_proj(project_id)}/locations/{location}/clusters")

@mcp.tool()
async def gcp_describe_gke_cluster(
    cluster_name: str,
    location: str,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Describe one GKE cluster (version, nodes, endpoint, networking, logging)."""
    return await _get(f"https://container.googleapis.com/v1/projects/{_proj(project_id)}/locations/{location}/clusters/{cluster_name}")

# ---------- Cloud Run ----------

@mcp.tool()
async def gcp_list_cloud_run_services(
    location: str = "us-central1",
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """List Cloud Run services in a region."""
    return await _get(f"https://run.googleapis.com/v2/projects/{_proj(project_id)}/locations/{location}/services")

@mcp.tool()
async def gcp_describe_cloud_run_service(
    service_name: str,
    location: str = "us-central1",
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Describe one Cloud Run service."""
    return await _get(f"https://run.googleapis.com/v2/projects/{_proj(project_id)}/locations/{location}/services/{service_name}")

# ---------- Cloud Functions (v2) ----------

@mcp.tool()
async def gcp_list_cloud_functions(
    location: str = "us-central1",
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """List Cloud Functions (v2 / gen2) in a region."""
    return await _get(f"https://cloudfunctions.googleapis.com/v2/projects/{_proj(project_id)}/locations/{location}/functions")

# ---------- BigQuery ----------

@mcp.tool()
async def gcp_list_bq_datasets(project_id: Optional[str] = None) -> Dict[str, Any]:
    """List BigQuery datasets in the project."""
    return await _get(f"https://bigquery.googleapis.com/bigquery/v2/projects/{_proj(project_id)}/datasets")

@mcp.tool()
async def gcp_list_bq_tables(
    dataset_id: str,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """List BigQuery tables inside a dataset."""
    return await _get(f"https://bigquery.googleapis.com/bigquery/v2/projects/{_proj(project_id)}/datasets/{dataset_id}/tables")

# ---------- Pub/Sub ----------

@mcp.tool()
async def gcp_list_pubsub_topics(project_id: Optional[str] = None) -> Dict[str, Any]:
    """List Pub/Sub topics in the project."""
    return await _get(f"https://pubsub.googleapis.com/v1/projects/{_proj(project_id)}/topics")

@mcp.tool()
async def gcp_list_pubsub_subscriptions(project_id: Optional[str] = None) -> Dict[str, Any]:
    """List Pub/Sub subscriptions in the project."""
    return await _get(f"https://pubsub.googleapis.com/v1/projects/{_proj(project_id)}/subscriptions")

# ---------- Cloud SQL ----------

@mcp.tool()
async def gcp_list_cloud_sql_instances(project_id: Optional[str] = None) -> Dict[str, Any]:
    """List Cloud SQL instances (Postgres / MySQL / SQL Server)."""
    return await _get(f"https://sqladmin.googleapis.com/v1/projects/{_proj(project_id)}/instances")

@mcp.tool()
async def gcp_describe_cloud_sql_instance(
    instance_name: str,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Describe a Cloud SQL instance (tier, version, IPs, backup config)."""
    return await _get(f"https://sqladmin.googleapis.com/v1/projects/{_proj(project_id)}/instances/{instance_name}")

# ---------- Secret Manager ----------

@mcp.tool()
async def gcp_list_secrets(project_id: Optional[str] = None) -> Dict[str, Any]:
    """List Secret Manager secrets (names + labels, not values)."""
    return await _get(f"https://secretmanager.googleapis.com/v1/projects/{_proj(project_id)}/secrets")

# ---------- Artifact Registry ----------

@mcp.tool()
async def gcp_list_artifact_repositories(
    location: str = "us-central1",
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """List Artifact Registry repositories in a region."""
    return await _get(f"https://artifactregistry.googleapis.com/v1/projects/{_proj(project_id)}/locations/{location}/repositories")

# ---------- Vertex AI ----------

@mcp.tool()
async def gcp_list_vertex_endpoints(
    location: str = "us-central1",
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """List Vertex AI online prediction endpoints."""
    return await _get(f"https://{location}-aiplatform.googleapis.com/v1/projects/{_proj(project_id)}/locations/{location}/endpoints")

@mcp.tool()
async def gcp_list_vertex_models(
    location: str = "us-central1",
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """List Vertex AI custom models registered in the Model Registry."""
    return await _get(f"https://{location}-aiplatform.googleapis.com/v1/projects/{_proj(project_id)}/locations/{location}/models")

# ---------- IAM ----------

@mcp.tool()
async def gcp_list_service_accounts(project_id: Optional[str] = None) -> Dict[str, Any]:
    """List IAM service accounts in the project."""
    return await _get(f"https://iam.googleapis.com/v1/projects/{_proj(project_id)}/serviceAccounts")

@mcp.tool()
async def gcp_get_iam_policy(project_id: Optional[str] = None) -> Dict[str, Any]:
    """Get the IAM policy bound to the project (who has what role)."""
    url = f"https://cloudresourcemanager.googleapis.com/v1/projects/{_proj(project_id)}:getIamPolicy"
    return await make_gcp_request("POST", url, body={})

# ---------- Cloud Logging ----------

@mcp.tool()
async def gcp_list_log_entries(
    filter_expr: Optional[str] = None,
    project_id: Optional[str] = None,
    page_size: int = 50,
) -> Dict[str, Any]:
    """
    Search Cloud Logging entries. filter_expr is Google's log-filter
    syntax (e.g. 'severity>=ERROR AND resource.type="gce_instance"').
    Default page_size=50 to keep results sane.
    """
    project = project_id or GCP_PROJECT_ID
    body: Dict[str, Any] = {
        "resourceNames": [f"projects/{project}"],
        "pageSize": page_size,
        "orderBy": "timestamp desc",
    }
    if filter_expr:
        body["filter"] = filter_expr
    url = "https://logging.googleapis.com/v2/entries:list"
    return await make_gcp_request("POST", url, body=body)

@mcp.tool()
async def gcp_api_help() -> Dict[str, Any]:
    """
    Get help on using the GCP MCP tools.

    Returns comprehensive documentation on available tools and how to use them.
    """
    return {
        "success": True,
        "data": {
            "description": "OpenAgentic GCP MCP - Google Cloud Platform Management Tools",
            "project": GCP_PROJECT_ID,
            "region": GCP_REGION,
            "tools": {
                "gcp_api_execute": {
                    "description": "Universal tool for ANY GCP API operation",
                    "services": ["compute", "storage", "crm", "iam", "monitoring", "logging", "billing", "vertex", "bigquery"],
                    "example": {
                        "service": "compute",
                        "method": "GET",
                        "path": "/projects/{project}/zones/us-central1-a/instances"
                    }
                },
                "compute_engine": {
                    "gcp_list_instances": "List VM instances (all zones or specific zone)",
                    "gcp_get_instance": "Get details of a specific VM",
                    "gcp_start_instance": "Start a stopped VM",
                    "gcp_stop_instance": "Stop a running VM",
                    "gcp_list_zones": "List available zones",
                    "gcp_list_regions": "List available regions",
                    "gcp_list_machine_types": "List machine types in a zone",
                    "gcp_list_disks": "List persistent disks",
                    "gcp_list_networks": "List VPC networks",
                    "gcp_list_firewalls": "List firewall rules"
                },
                "cloud_storage": {
                    "gcp_list_buckets": "List Cloud Storage buckets",
                    "gcp_list_bucket_objects": "List objects in a bucket"
                },
                "project_management": {
                    "gcp_get_project": "Get project details"
                },
                "billing_and_costs": {
                    "gcp_get_billing_info": "Get billing info for a project",
                    "gcp_list_billing_accounts": "List all accessible billing accounts",
                    "gcp_get_billing_account": "Get details of a billing account",
                    "gcp_list_billing_account_projects": "List projects linked to a billing account",
                    "gcp_query_cost_usage": "Query cost/usage data from BigQuery billing export"
                },
                "vertex_ai": {
                    "vertex_ai_list_models": "List Vertex AI models",
                    "vertex_ai_list_endpoints": "List Vertex AI endpoints",
                    "vertex_ai_get_endpoint": "Get details of an endpoint",
                    "vertex_ai_list_training_pipelines": "List training pipelines",
                    "vertex_ai_list_custom_jobs": "List custom training jobs",
                    "vertex_ai_usage_metrics": "Get Vertex AI usage metrics from Cloud Monitoring",
                    "vertex_ai_generative_models": "List available generative AI models (Gemini, etc.)"
                },
                "monitoring": {
                    "gcp_monitoring_query": "Query any Cloud Monitoring metric"
                }
            },
            "common_paths": {
                "compute": {
                    "instances": "/projects/{project}/zones/{zone}/instances",
                    "disks": "/projects/{project}/zones/{zone}/disks",
                    "networks": "/projects/{project}/global/networks",
                    "firewalls": "/projects/{project}/global/firewalls"
                },
                "storage": {
                    "buckets": "/b?project={project}",
                    "objects": "/b/{bucket}/o"
                },
                "billing": {
                    "project_info": "/projects/{project}/billingInfo",
                    "accounts": "/billingAccounts"
                },
                "vertex": {
                    "models": "/projects/{project}/locations/{region}/models",
                    "endpoints": "/projects/{project}/locations/{region}/endpoints"
                }
            }
        }
    }

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    logger.info(f"Starting OpenAgentic GCP MCP Server")
    logger.info(f"Default Project: {GCP_PROJECT_ID}")
    logger.info(f"Default Region: {GCP_REGION}")
    logger.info(f"Credentials JSON: {'Set' if GCP_CREDENTIALS_JSON else 'Not set'}")
    logger.info(f"Credentials File: {GCP_CREDENTIALS_FILE or 'Not set'}")

    # Run the MCP server
    mcp.run()
