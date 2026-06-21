

"""
OpenAgentic AWS MCP Server - Forked from awslabs/mcp aws-api-mcp-server

Authentication: standard boto3 / environment credential chain.

This MCP authenticates with AWS using the standard credential resolution
order — environment variables (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
optional AWS_SESSION_TOKEN), a shared credentials file, or an attached IAM
role (EC2 instance profile / ECS task role / EKS IRSA). This is the
self-hosted OSS pattern: the operator supplies a service account / IAM
identity via the environment and every tool runs with those permissions.

There is NO On-Behalf-Of (OBO) / Azure-AD token exchange and no per-user
credential brokering — all tools share the one configured AWS identity.

The official server provides:
- call_aws: Execute AWS CLI commands with validation
- suggest_aws_commands: Suggest CLI commands from natural language
"""

import os
import sys
import logging
import json
from typing import Any, Dict, Optional
from pathlib import Path

import boto3
from fastmcp import FastMCP, Context
from pydantic import Field, BaseModel
from typing import Annotated

# =============================================================================
# CONFIGURATION
# =============================================================================

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-aws-mcp')
except ImportError:
    log_dir = Path.home() / '.aws' / 'oap-aws-mcp'
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / 'oap-aws-mcp-server.log'
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stderr),
            logging.FileHandler(log_file)
        ]
    )
    logger = logging.getLogger("oap-aws-mcp")

# AWS Configuration (no hardcoded defaults - all from environment)
AWS_REGION = os.environ.get("AWS_REGION", "")

# Static service credentials (optional). When unset, boto3 / the AWS CLI fall
# back to the rest of the standard credential chain (shared credentials file,
# EC2 instance profile, ECS task role, EKS IRSA, etc.).
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "")

# Working directory for file operations
WORKING_DIRECTORY = os.environ.get("AWS_API_MCP_WORKING_DIR", os.getcwd())

# =============================================================================
# CREDENTIALS MODEL (Compatible with official aws-api-mcp-server)
# =============================================================================

class Credentials(BaseModel):
    """AWS Credentials model - compatible with official aws-api-mcp-server."""
    access_key_id: str
    secret_access_key: str
    session_token: Optional[str] = None

# =============================================================================
# AUTHENTICATION - standard boto3 / environment credential chain
# =============================================================================

def get_environment_credentials() -> Optional[Credentials]:
    """Return static service credentials from the environment, if configured.

    When AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are set we pass them
    explicitly. Otherwise this returns None and the caller falls through to
    boto3 / the AWS CLI default credential chain (shared credentials file,
    EC2 instance profile, ECS task role, EKS IRSA, etc.).
    """
    if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
        logger.info("Using static AWS service credentials from environment")
        return Credentials(
            access_key_id=AWS_ACCESS_KEY_ID,
            secret_access_key=AWS_SECRET_ACCESS_KEY,
            session_token=None
        )
    return None

def get_aws_session(credentials: Optional[Credentials] = None) -> boto3.Session:
    """Get AWS session from credentials or default chain."""
    region = AWS_REGION or "us-east-1"

    if credentials:
        return boto3.Session(
            aws_access_key_id=credentials.access_key_id,
            aws_secret_access_key=credentials.secret_access_key,
            aws_session_token=credentials.session_token,
            region_name=region
        )

    # Use default credential chain (instance profile, etc.)
    logger.info("Using default AWS credential chain")
    return boto3.Session(region_name=region)

# =============================================================================
# FASTMCP SERVER
# =============================================================================

# Server instructions to help LLMs know when/how to use AWS tools
AWS_SERVER_INSTRUCTIONS = """
## OpenAgentic AWS MCP - Tool Selection Guide

### AVAILABLE TOOLS

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `call_aws` | Execute any AWS CLI command | General AWS operations with full CLI flexibility |
| `aws_identity` | Get current AWS identity | "Who am I?", "What AWS account am I using?" |
| `aws_list_accounts` | List accessible AWS accounts | "Which AWS accounts can I access?" |
| `aws_list_ec2` | List EC2 instances | "Show my EC2 instances", "List VMs" |
| `aws_list_s3` | List S3 buckets | "Show my S3 buckets", "List storage" |
| `aws_cost_summary` | Get total AWS costs | "How much have I spent?", "AWS bill" |
| `aws_cost_by_service` | Cost breakdown by service | "Which services cost the most?" |
| `suggest_aws_commands` | Get CLI command suggestions | When unsure about exact syntax |

### COMMON QUERIES AND TOOL MAPPING

| User Query | Best Tool | Example Call |
|------------|-----------|--------------|
| "Who am I in AWS?" | `aws_identity` | `aws_identity()` |
| "What's my AWS identity?" | `aws_identity` | `aws_identity()` |
| "List my EC2 instances" | `aws_list_ec2` | `aws_list_ec2()` |
| "Show my S3 buckets" | `aws_list_s3` | `aws_list_s3()` |
| "How much has AWS cost me?" | `aws_cost_summary` | `aws_cost_summary(days=30)` |
| "AWS spending by service" | `aws_cost_by_service` | `aws_cost_by_service(days=30)` |
| "Create an S3 bucket" | `call_aws` | `call_aws(cli_command="aws s3api create-bucket --bucket my-bucket")` |
| "Describe my VPCs" | `call_aws` | `call_aws(cli_command="aws ec2 describe-vpcs")` |

### AUTHENTICATION

This MCP authenticates with the standard AWS credential chain configured on
the server (environment variables / shared credentials file / attached IAM
role). Every operation runs with that single configured AWS identity — there
is no per-user credential brokering. Use `aws_identity()` to see which
identity is active.

### CRITICAL RULES

1. **Start with convenience tools** - Use `aws_identity`, `aws_list_ec2`, `aws_list_s3`, `aws_cost_summary` for common operations
2. **Use `call_aws` for complex operations** - When convenience tools don't cover the use case
3. **Don't guess credentials** - The MCP authenticates automatically via the server's configured AWS credentials
4. **Check identity first** - If unsure about access, use `aws_identity()` to see which identity is active

### DO NOT

- Try to configure AWS credentials manually
- Run destructive commands without user confirmation (DELETE, TERMINATE, etc.)
"""

mcp = FastMCP("OpenAgentic-AWS-MCP", instructions=AWS_SERVER_INSTRUCTIONS)

# =============================================================================
# TOOLS - Compatible with official aws-api-mcp-server interface
# =============================================================================

@mcp.tool()
async def call_aws(
    cli_command: Annotated[str, Field(description='The complete AWS CLI command to execute. MUST start with "aws"')],
    ctx: Context,
    max_results: Annotated[Optional[int], Field(description='Optional limit for number of results')] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Execute AWS CLI commands with validation and proper error handling.

    This tool is compatible with the official aws-api-mcp-server interface.
    It authenticates with the standard AWS credential chain configured on the
    server (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars, shared
    credentials file, or an attached IAM role).

    Args:
        cli_command: The complete AWS CLI command (must start with "aws")
        ctx: FastMCP context
        max_results: Optional limit for pagination
        meta: Internal metadata from MCP proxy (unused for auth)

    Returns:
        Command execution result with 'success' and 'data' or 'error'

    Examples:
        call_aws(cli_command="aws ec2 describe-instances")
        call_aws(cli_command="aws s3 ls")
        call_aws(cli_command="aws sts get-caller-identity")
        call_aws(cli_command="aws lambda list-functions --region us-west-2")
    """
    try:
        # Resolve static env credentials if present; otherwise pass None and let
        # boto3 / the AWS CLI use the default credential chain (instance/task
        # role, IRSA, shared credentials file, etc.).
        credentials = get_environment_credentials()

        # Parse and execute the command
        result = await execute_cli_command(cli_command, credentials, max_results)

        return result

    except Exception as e:
        logger.error(f"call_aws failed: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool()
async def suggest_aws_commands(
    query: Annotated[str, Field(description='A natural language description of what you want to do in AWS', max_length=2000)],
    ctx: Context,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Suggest AWS CLI commands based on a natural language query.

    This is a FALLBACK tool - the LLM should first attempt to construct commands
    directly based on its knowledge. Use this when unsure about exact syntax or
    for discovering new/recent AWS CLI features.

    Args:
        query: Natural language description (e.g., "list all EC2 instances in us-west-2")
        ctx: FastMCP context
        meta: Internal metadata from MCP proxy (for consistency with other tools)

    Returns:
        List of suggested commands with explanations
    """
    if not query.strip():
        return {"success": False, "error": "Empty query provided"}

    # Common AWS operations with suggestions
    suggestions = get_command_suggestions(query)

    return {
        "success": True,
        "suggestions": suggestions,
        "tip": "Use call_aws to execute any of these commands"
    }

@mcp.tool()
async def aws_list_accounts(
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List AWS accounts visible to the configured identity.

    For an AWS Organizations management/delegated account this returns every
    member account (via `organizations list-accounts`). Otherwise it falls
    back to the single account the configured credentials belong to (via
    `sts get-caller-identity`).

    Args:
        meta: Internal metadata from MCP proxy (unused for auth)

    Returns:
        List of accessible accounts
    """
    # First try AWS Organizations (works when the configured identity is in an
    # org management / delegated-admin account with organizations:ListAccounts).
    org_result = await _execute_aws_command(
        cli_command="aws organizations list-accounts",
        meta=meta,
    )
    if org_result.get("success") and isinstance(org_result.get("data"), dict):
        org_accounts = org_result["data"].get("Accounts", [])
        if org_accounts:
            accounts = [
                {
                    "accountId": a.get("Id", ""),
                    "accountName": a.get("Name", "Unknown"),
                    "emailAddress": a.get("Email", ""),
                    "status": a.get("Status", ""),
                }
                for a in org_accounts
            ]
            return {"success": True, "accounts": accounts}

    # Fallback: just the account the configured credentials belong to.
    identity = await _execute_aws_command(
        cli_command="aws sts get-caller-identity",
        meta=meta,
    )
    if identity.get("success") and isinstance(identity.get("data"), dict):
        data = identity["data"]
        return {
            "success": True,
            "accounts": [{
                "accountId": data.get("Account", ""),
                "accountName": "(current account)",
                "emailAddress": "",
                "arn": data.get("Arn", ""),
                "note": "Showing the single account the configured AWS identity belongs to. "
                        "Full multi-account listing requires AWS Organizations access.",
            }],
        }

    # Surface whichever error is more informative.
    return identity if not identity.get("success") else org_result

# =============================================================================
# INTERNAL AWS EXECUTION FUNCTION
# This is the actual implementation, shared by both the tool and convenience wrappers
# =============================================================================

async def _execute_aws_command(
    cli_command: str,
    meta: Optional[Dict[str, Any]] = None,
    max_results: Optional[int] = None
) -> Dict[str, Any]:
    """
    Internal function to execute AWS CLI commands.
    Called by both the call_aws tool and convenience tools.

    Authenticates with the server's configured AWS credentials (env vars or
    the default boto3 / AWS CLI credential chain).
    """
    try:
        # Resolve static env credentials if present; otherwise pass None and let
        # boto3 / the AWS CLI use the default credential chain.
        credentials = get_environment_credentials()

        # Execute the command
        result = await execute_cli_command(cli_command, credentials, max_results)

        return result

    except Exception as e:
        logger.error(f"_execute_aws_command failed: {e}")
        return {"success": False, "error": str(e)}

# =============================================================================
# CONVENIENCE TOOLS - Simple wrappers for common operations
# These make it easier for LLMs to pick the right tool without complex arguments
# =============================================================================

@mcp.tool()
async def aws_identity(
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get your current AWS identity (who am I?).

    This is a simple wrapper around 'aws sts get-caller-identity' that shows
    your AWS identity including account, user ARN, and user ID.

    Args:
        meta: Internal metadata from MCP proxy (unused for auth)

    Returns:
        Your AWS identity information (Account, ARN, UserId)

    Example:
        aws_identity()  # Returns your current AWS identity
    """
    return await _execute_aws_command(
        cli_command="aws sts get-caller-identity",
        meta=meta
    )

@mcp.tool()
async def aws_cost_summary(
    days: Annotated[int, Field(description='Number of days to analyze (default: 30)', default=30)] = 30,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get a summary of your AWS costs for a specified number of days.

    This provides total AWS spending for the time period, useful for quick cost checks.

    AUTH IS AUTOMATIC: this tool uses the server's configured AWS credentials.
    NEVER ask the user for AWS credentials, role ARNs, or access keys —
    just call the tool, authentication is handled server-side.

    Args:
        days: Number of days to analyze (default 30)
        meta: Internal metadata from MCP proxy (unused for auth)

    Returns:
        Total cost for the period with currency

    Example:
        aws_cost_summary()  # Get last 30 days costs
        aws_cost_summary(days=7)  # Get last 7 days costs
    """
    from datetime import datetime, timedelta

    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

    command = f"aws ce get-cost-and-usage --time-period Start={start_date},End={end_date} --granularity MONTHLY --metrics BlendedCost"

    result = await _execute_aws_command(
        cli_command=command,
        meta=meta
    )

    # Parse and simplify the result
    if result.get("success") and result.get("data"):
        try:
            data = result["data"]
            results_by_time = data.get("ResultsByTime", [])
            total = 0.0
            currency = "USD"

            for period in results_by_time:
                metrics = period.get("Total", {}).get("BlendedCost", {})
                amount = float(metrics.get("Amount", 0))
                total += amount
                currency = metrics.get("Unit", "USD")

            return {
                "success": True,
                "total_cost": round(total, 2),
                "currency": currency,
                "period": f"Last {days} days ({start_date} to {end_date})",
                "raw_data": data
            }
        except Exception as e:
            logger.warning(f"Failed to parse cost data: {e}")
            return result  # Return raw result if parsing fails

    return result

@mcp.tool()
async def aws_cost_by_service(
    days: Annotated[int, Field(description='Number of days to analyze (default: 30)', default=30)] = 30,
    group_by: Annotated[str, Field(description='Group dimension: SERVICE, REGION, LINKED_ACCOUNT, USAGE_TYPE, INSTANCE_TYPE (default: SERVICE)', default='SERVICE')] = 'SERVICE',
    granularity: Annotated[str, Field(description='Time granularity: DAILY, MONTHLY (default: MONTHLY)', default='MONTHLY')] = 'MONTHLY',
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get a breakdown of your AWS costs grouped by a dimension.

    Common use cases:
    - Cost by service (default): which AWS services cost the most
    - Cost by region: spending per AWS region
    - Cost by account: spending per linked account (multi-account)

    Args:
        days: Number of days to analyze (default 30)
        group_by: Dimension to group by — SERVICE, REGION, LINKED_ACCOUNT, USAGE_TYPE, INSTANCE_TYPE
        granularity: Time granularity — DAILY or MONTHLY
        meta: Internal metadata from MCP proxy (unused for auth)

    Returns:
        Cost breakdown grouped by the specified dimension, sorted by cost descending

    Example:
        aws_cost_by_service()  # Last 30 days by service
        aws_cost_by_service(days=7, group_by="REGION")  # Last 7 days by region
        aws_cost_by_service(group_by="LINKED_ACCOUNT")  # By account
    """
    from datetime import datetime, timedelta

    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

    # Validate group_by dimension
    valid_dimensions = {'SERVICE', 'REGION', 'LINKED_ACCOUNT', 'USAGE_TYPE', 'INSTANCE_TYPE', 'AZ', 'PLATFORM', 'TENANCY'}
    dim = group_by.upper() if group_by else 'SERVICE'
    if dim not in valid_dimensions:
        dim = 'SERVICE'

    command = f"aws ce get-cost-and-usage --time-period Start={start_date},End={end_date} --granularity {granularity} --metrics BlendedCost --group-by Type=DIMENSION,Key={dim}"

    result = await _execute_aws_command(
        cli_command=command,
        meta=meta
    )

    # Parse and simplify the result
    if result.get("success") and result.get("data"):
        try:
            data = result["data"]
            results_by_time = data.get("ResultsByTime", [])
            service_costs = {}
            currency = "USD"

            for period in results_by_time:
                for group in period.get("Groups", []):
                    service = group.get("Keys", ["Unknown"])[0]
                    metrics = group.get("Metrics", {}).get("BlendedCost", {})
                    amount = float(metrics.get("Amount", 0))
                    currency = metrics.get("Unit", "USD")

                    if service in service_costs:
                        service_costs[service] += amount
                    else:
                        service_costs[service] = amount

            # Sort by cost descending
            sorted_services = sorted(
                [(s, round(c, 2)) for s, c in service_costs.items() if c > 0.01],
                key=lambda x: x[1],
                reverse=True
            )

            total = sum(c for _, c in sorted_services)

            return {
                "success": True,
                "total_cost": round(total, 2),
                "currency": currency,
                "period": f"Last {days} days ({start_date} to {end_date})",
                "services": [{"service": s, "cost": c} for s, c in sorted_services],
                "top_5": [{"service": s, "cost": c} for s, c in sorted_services[:5]]
            }
        except Exception as e:
            logger.warning(f"Failed to parse cost data: {e}")
            return result  # Return raw result if parsing fails

    return result

@mcp.tool()
async def aws_list_ec2(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all EC2 instances in your AWS account.

    Shows instance IDs, types, states, and names.

    Args:
        region: AWS region (e.g. us-east-1). Uses default if not specified.
        meta: Internal metadata from MCP proxy (unused for auth)

    Returns:
        List of EC2 instances with their details

    Example:
        aws_list_ec2()  # List all EC2 instances
        aws_list_ec2(region="us-west-2")  # List EC2 in specific region
    """
    cmd = "aws ec2 describe-instances"
    if region:
        cmd += f" --region {region}"
    return await _execute_aws_command(
        cli_command=cmd,
        meta=meta
    )

@mcp.tool()
async def aws_list_s3(
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all S3 buckets in your AWS account.

    Shows bucket names and creation dates.

    Args:
        meta: Internal metadata from MCP proxy (unused for auth)

    Returns:
        List of S3 buckets

    Example:
        aws_list_s3()  # List all S3 buckets
    """
    return await _execute_aws_command(
        cli_command="aws s3api list-buckets",
        meta=meta
    )

# =============================================================================
# TYPED CONVENIENCE TOOLS — 0.6.6 P6 AWS MCP parity
# Small, focused wrappers around CLI commands so the LLM can pick specific
# tools by name instead of hand-rolling CLI strings. Each delegates to
# _aws_cli() (below) which handles the region suffix.
# =============================================================================

def _with_region(cmd: str, region: Optional[str]) -> str:
    """Suffix an AWS CLI command with `--region <r>` when region is set."""
    return f"{cmd} --region {region}" if region else cmd

async def _aws_cli(
    base_cmd: str,
    *,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Shared tool body: region-suffix + CLI invocation."""
    return await _execute_aws_command(
        cli_command=_with_region(base_cmd, region),
        meta=meta,
    )

# ---------- EC2 ----------

@mcp.tool()
async def aws_describe_ec2_instance(
    instance_id: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Describe one EC2 instance in detail (state, type, IPs, tags, security groups)."""
    return await _aws_cli(
        f"aws ec2 describe-instances --instance-ids {instance_id}",
        region=region, meta=meta,
    )

@mcp.tool()
async def aws_list_security_groups(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all EC2 security groups in the account (or region if specified)."""
    return await _aws_cli("aws ec2 describe-security-groups", region=region, meta=meta)

@mcp.tool()
async def aws_list_volumes(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all EBS volumes (state, size, attachment)."""
    return await _aws_cli("aws ec2 describe-volumes", region=region, meta=meta)

@mcp.tool()
async def aws_list_vpcs(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all VPCs (CIDR blocks, state, default flag)."""
    return await _aws_cli("aws ec2 describe-vpcs", region=region, meta=meta)

@mcp.tool()
async def aws_list_subnets(
    vpc_id: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List VPC subnets. Optionally filter by vpc-id."""
    base = "aws ec2 describe-subnets"
    if vpc_id:
        base += f' --filters Name=vpc-id,Values={vpc_id}'
    return await _aws_cli(base, region=region, meta=meta)

# ---------- IAM ----------

@mcp.tool()
async def aws_list_iam_users(meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """List IAM users in the account."""
    return await _aws_cli("aws iam list-users", meta=meta)

@mcp.tool()
async def aws_list_iam_roles(meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """List IAM roles in the account."""
    return await _aws_cli("aws iam list-roles", meta=meta)

@mcp.tool()
async def aws_list_iam_policies(
    scope: str = "All",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List IAM managed policies. scope: All | AWS | Local (customer-managed)."""
    return await _aws_cli(f"aws iam list-policies --scope {scope}", meta=meta)

@mcp.tool()
async def aws_list_iam_groups(
    path_prefix: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List IAM groups in the account. Optional `path_prefix` filters by path (e.g. '/division-a/')."""
    base = "aws iam list-groups"
    if path_prefix:
        base += f" --path-prefix {path_prefix}"
    return await _aws_cli(base, meta=meta)

@mcp.tool()
async def aws_get_iam_user(
    user_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get details for one IAM user (path, ARN, create date, last-used, tags)."""
    return await _aws_cli(f"aws iam get-user --user-name {user_name}", meta=meta)

@mcp.tool()
async def aws_get_iam_role(
    role_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get details for one IAM role (assume-role policy, max session, tags)."""
    return await _aws_cli(f"aws iam get-role --role-name {role_name}", meta=meta)

@mcp.tool()
async def aws_get_iam_group(
    group_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get an IAM group + the list of users in it."""
    return await _aws_cli(f"aws iam get-group --group-name {group_name}", meta=meta)

@mcp.tool()
async def aws_list_iam_user_groups(
    user_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List the IAM groups that an IAM user belongs to."""
    return await _aws_cli(
        f"aws iam list-groups-for-user --user-name {user_name}",
        meta=meta,
    )

@mcp.tool()
async def aws_list_iam_attached_user_policies(
    user_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List managed policies attached directly to an IAM user."""
    return await _aws_cli(
        f"aws iam list-attached-user-policies --user-name {user_name}",
        meta=meta,
    )

@mcp.tool()
async def aws_list_iam_attached_role_policies(
    role_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List managed policies attached to an IAM role."""
    return await _aws_cli(
        f"aws iam list-attached-role-policies --role-name {role_name}",
        meta=meta,
    )

@mcp.tool()
async def aws_list_iam_attached_group_policies(
    group_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List managed policies attached to an IAM group."""
    return await _aws_cli(
        f"aws iam list-attached-group-policies --group-name {group_name}",
        meta=meta,
    )

@mcp.tool()
async def aws_list_iam_user_policies(
    user_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List inline policies embedded directly on an IAM user."""
    return await _aws_cli(
        f"aws iam list-user-policies --user-name {user_name}",
        meta=meta,
    )

@mcp.tool()
async def aws_list_iam_role_policies(
    role_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List inline policies embedded directly on an IAM role."""
    return await _aws_cli(
        f"aws iam list-role-policies --role-name {role_name}",
        meta=meta,
    )

@mcp.tool()
async def aws_list_iam_group_policies(
    group_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List inline policies embedded directly on an IAM group."""
    return await _aws_cli(
        f"aws iam list-group-policies --group-name {group_name}",
        meta=meta,
    )

@mcp.tool()
async def aws_get_iam_policy(
    policy_arn: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get an IAM managed policy by ARN (default version, attachment count, tags)."""
    return await _aws_cli(
        f"aws iam get-policy --policy-arn {policy_arn}",
        meta=meta,
    )

@mcp.tool()
async def aws_get_iam_account_summary(
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Account-wide IAM summary: user/group/role/policy counts, MFA, password policy state."""
    return await _aws_cli("aws iam get-account-summary", meta=meta)

@mcp.tool()
async def aws_get_iam_account_password_policy(
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get the IAM account password policy (min length, complexity, rotation)."""
    return await _aws_cli("aws iam get-account-password-policy", meta=meta)

@mcp.tool()
async def aws_list_iam_access_keys(
    user_name: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List access-key IDs (NOT secrets) for an IAM user. Includes status + create date."""
    return await _aws_cli(
        f"aws iam list-access-keys --user-name {user_name}",
        meta=meta,
    )

@mcp.tool()
async def aws_list_iam_mfa_devices(
    user_name: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List MFA devices. Pass user_name to scope to one user; omit for all virtual MFAs."""
    if user_name:
        return await _aws_cli(
            f"aws iam list-mfa-devices --user-name {user_name}",
            meta=meta,
        )
    return await _aws_cli("aws iam list-virtual-mfa-devices", meta=meta)

@mcp.tool()
async def aws_list_iam_instance_profiles(
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List IAM instance profiles (used to attach roles to EC2)."""
    return await _aws_cli("aws iam list-instance-profiles", meta=meta)

# ---------- RDS ----------

@mcp.tool()
async def aws_list_rds_instances(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all RDS DB instances."""
    return await _aws_cli("aws rds describe-db-instances", region=region, meta=meta)

@mcp.tool()
async def aws_describe_rds_instance(
    instance_identifier: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Describe one RDS DB instance by identifier."""
    return await _aws_cli(
        f"aws rds describe-db-instances --db-instance-identifier {instance_identifier}",
        region=region, meta=meta,
    )

# ---------- Lambda ----------

@mcp.tool()
async def aws_list_lambdas(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all Lambda functions."""
    return await _aws_cli("aws lambda list-functions", region=region, meta=meta)

@mcp.tool()
async def aws_describe_lambda(
    function_name: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one Lambda function's configuration (handler, memory, timeout, env vars)."""
    return await _aws_cli(
        f"aws lambda get-function --function-name {function_name}",
        region=region, meta=meta,
    )

# ---------- CloudWatch ----------

@mcp.tool()
async def aws_list_cw_alarms(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List CloudWatch alarms (state, metric, threshold)."""
    return await _aws_cli("aws cloudwatch describe-alarms", region=region, meta=meta)

@mcp.tool()
async def aws_list_cw_metrics(
    namespace: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List CloudWatch metrics; optionally filter by namespace (e.g. AWS/EC2, AWS/Lambda)."""
    base = "aws cloudwatch list-metrics"
    if namespace:
        base += f" --namespace {namespace}"
    return await _aws_cli(base, region=region, meta=meta)

# ---------- Bedrock (UC-A16 anchor) ----------

@mcp.tool()
async def aws_bedrock_list_foundation_models(
    by_provider: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    List Bedrock foundation models. Filter by provider
    (anthropic, amazon, meta, mistral, cohere, ai21). region defaults to
    us-east-1 (primary Bedrock control plane).

    Typed replacement for the previous `call_aws("aws bedrock
    list-foundation-models")` round-trip that was prone to truncation/
    backfill (UC-A16). tool-execution.helper emits _truncated:true on
    results > 100KB so the LLM won't fabricate missing rows.
    """
    base = "aws bedrock list-foundation-models"
    if by_provider:
        base += f" --by-provider {by_provider}"
    return await _aws_cli(base, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_get_foundation_model(
    model_identifier: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one Bedrock foundation model's metadata (modalities, lifecycle, customizations)."""
    return await _aws_cli(
        f"aws bedrock get-foundation-model --model-identifier {model_identifier}",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_list_inference_profiles(
    type_equals: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    List Bedrock inference profiles. Optional `type_equals`:
    SYSTEM_DEFINED (cross-region routing) | APPLICATION (custom).
    """
    base = "aws bedrock list-inference-profiles"
    if type_equals:
        base += f" --type-equals {type_equals}"
    return await _aws_cli(base, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_get_inference_profile(
    inference_profile_identifier: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get details of one Bedrock inference profile (member regions, ARN, status)."""
    return await _aws_cli(
        f"aws bedrock get-inference-profile --inference-profile-identifier {inference_profile_identifier}",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_list_custom_models(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List Bedrock custom (fine-tuned) models in the account."""
    return await _aws_cli(
        "aws bedrock list-custom-models",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_get_custom_model(
    model_identifier: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get details of one Bedrock custom model (training job, base model, status)."""
    return await _aws_cli(
        f"aws bedrock get-custom-model --model-identifier {model_identifier}",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_list_imported_models(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List Bedrock imported models (BYOM) in the account."""
    return await _aws_cli(
        "aws bedrock list-imported-models",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_list_provisioned_model_throughputs(
    status_equals: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    List Bedrock provisioned-throughput allocations. Optional `status_equals`:
    Creating | InService | Updating | Failed.
    """
    base = "aws bedrock list-provisioned-model-throughputs"
    if status_equals:
        base += f" --status-equals {status_equals}"
    return await _aws_cli(base, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_list_guardrails(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List Bedrock guardrails (content filters, denied topics, sensitive-info redaction)."""
    return await _aws_cli(
        "aws bedrock list-guardrails",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_get_guardrail(
    guardrail_identifier: str,
    guardrail_version: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one Bedrock guardrail's full configuration (filter strengths, blocked phrases)."""
    base = f"aws bedrock get-guardrail --guardrail-identifier {guardrail_identifier}"
    if guardrail_version:
        base += f" --guardrail-version {guardrail_version}"
    return await _aws_cli(base, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_list_model_invocation_jobs(
    status_equals: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    List Bedrock batch model-invocation jobs. Optional `status_equals`:
    Submitted | InProgress | Completed | Failed | Stopping | Stopped | PartiallyCompleted | Expired | Validating | Scheduled.
    """
    base = "aws bedrock list-model-invocation-jobs"
    if status_equals:
        base += f" --status-equals {status_equals}"
    return await _aws_cli(base, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_get_model_invocation_logging_configuration(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get the account-wide Bedrock model-invocation logging config (S3 / CloudWatch sinks)."""
    return await _aws_cli(
        "aws bedrock get-model-invocation-logging-configuration",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_list_model_customization_jobs(
    status_equals: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    List Bedrock model-customization (fine-tune) jobs. Optional `status_equals`:
    InProgress | Completed | Failed | Stopping | Stopped.
    """
    base = "aws bedrock list-model-customization-jobs"
    if status_equals:
        base += f" --status-equals {status_equals}"
    return await _aws_cli(base, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_agent_list_agents(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List Bedrock Agents (managed agentic workflows) in the account."""
    return await _aws_cli(
        "aws bedrock-agent list-agents",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_agent_get_agent(
    agent_id: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one Bedrock Agent's full config (foundation model, instruction, action groups)."""
    return await _aws_cli(
        f"aws bedrock-agent get-agent --agent-id {agent_id}",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_agent_list_knowledge_bases(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List Bedrock Agent knowledge bases (vector stores backing RAG retrieval)."""
    return await _aws_cli(
        "aws bedrock-agent list-knowledge-bases",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_agent_get_knowledge_base(
    knowledge_base_id: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one Bedrock Agent knowledge base's config (embeddings model, vector store)."""
    return await _aws_cli(
        f"aws bedrock-agent get-knowledge-base --knowledge-base-id {knowledge_base_id}",
        region=region or 'us-east-1',
        meta=meta,
    )

@mcp.tool()
async def aws_bedrock_agent_list_data_sources(
    knowledge_base_id: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List data sources in a Bedrock Agent knowledge base (S3 prefixes, websites, etc.)."""
    return await _aws_cli(
        f"aws bedrock-agent list-data-sources --knowledge-base-id {knowledge_base_id}",
        region=region or 'us-east-1',
        meta=meta,
    )

# ---------- Bedrock data-plane + agent CRUD (#675) ----------
# Added 2026-05-07 — full ML-platform control. Existing block above covers
# read-only bedrock-control-plane discovery. These add the missing
# write/invoke surface:
#   - aws_bedrock_invoke_model         : sync model invoke (bedrock-runtime)
#   - aws_bedrock_create_knowledge_base: create KB (bedrock-agent)
#   - aws_bedrock_create_agent         : create agent (bedrock-agent)
#   - aws_bedrock_invoke_agent         : invoke agent (bedrock-agent-runtime)
# All shell out via _aws_cli with shlex-quoted JSON bodies and the
# `--cli-binary-format raw-in-base64-out` flag so JSON `--body`/`--input-text`
# payloads round-trip without base64 wrapping.

@mcp.tool()
async def aws_bedrock_invoke_model(
    model_id: str,
    body: str,
    accept: Optional[str] = "application/json",
    content_type: Optional[str] = "application/json",
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Synchronously invoke a Bedrock foundation model with a JSON body.

    Use when the user asks "call Bedrock model X with this prompt", "run
    inference on <model> with body Y", "test that Claude on Bedrock returns
    something". Backed by `aws bedrock-runtime invoke-model` (data-plane)
    against
    https://bedrock-runtime.{region}.amazonaws.com/model/{model_id}/invoke.

    The `body` is a provider-shaped JSON string. For Anthropic Claude models,
    use the Bedrock-Anthropic schema: {"anthropic_version":"bedrock-2023-05-31",
    "max_tokens":1024,"messages":[{"role":"user","content":"hi"}]}. For
    Amazon Titan / Llama / Mistral, see the per-provider request schema docs.

    Returns the raw model response in the `data` field (provider-shaped JSON).
    Output is captured to a temp file via the CLI and dumped back; large
    responses (>100KB) carry `_truncated:true` per the standard envelope.

    Args:
        model_id: Bedrock model id or inference-profile id
        body: Provider-shaped JSON request body (string)
        accept: Response Accept header (default application/json)
        content_type: Request Content-Type (default application/json)
        region: AWS region (defaults to us-east-1)
        meta: Internal metadata from MCP proxy (unused for auth)
    """
    import shlex
    cmd = (
        "aws bedrock-runtime invoke-model "
        f"--model-id {shlex.quote(model_id)} "
        f"--body {shlex.quote(body)} "
        f"--cli-binary-format raw-in-base64-out "
        f"--accept {shlex.quote(accept or 'application/json')} "
        f"--content-type {shlex.quote(content_type or 'application/json')} "
        "/dev/stdout"
    )
    return await _aws_cli(cmd, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_create_knowledge_base(
    name: str,
    role_arn: str,
    embedding_model_arn: str,
    vector_store_type: str,
    vector_store_config: str,
    description: Optional[str] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Create a Bedrock Agent knowledge base (vector store wrapper for RAG).

    Use when the user asks "create a Bedrock KB", "set up a knowledge base
    backed by OpenSearch / Pinecone / RDS", "wire up RAG for our Bedrock
    Agent". Backed by `aws bedrock-agent create-knowledge-base`.

    `vector_store_type` selects the storage configuration shape — common
    values: OPENSEARCH_SERVERLESS, PINECONE, RDS, MONGO_DB_ATLAS. The
    `vector_store_config` is the matching JSON sub-document for that type
    (e.g. for OPENSEARCH_SERVERLESS:
    `{"collectionArn":"...","vectorIndexName":"...",
      "fieldMapping":{"vectorField":"...","textField":"...","metadataField":"..."}}`).

    Returns {success, data:{knowledgeBase:{knowledgeBaseId, status, name,
    knowledgeBaseArn,...}}}.

    Args:
        name: KB name (must be unique in the account)
        role_arn: Service role ARN that the KB assumes for vector-store + S3 access
        embedding_model_arn: Embedding model ARN (e.g.
            arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0)
        vector_store_type: OPENSEARCH_SERVERLESS / PINECONE / RDS / MONGO_DB_ATLAS
        vector_store_config: JSON config sub-document for the chosen type (string)
        description: Optional KB description
        region: AWS region (defaults to us-east-1)
        meta: Internal metadata from MCP proxy (unused for auth)
    """
    import shlex
    storage_config_json = json.dumps({
        "type": vector_store_type,
        f"{vector_store_type.lower().replace('_', '')}Configuration": json.loads(vector_store_config),
    })
    kb_config_json = json.dumps({
        "type": "VECTOR",
        "vectorKnowledgeBaseConfiguration": {
            "embeddingModelArn": embedding_model_arn,
        },
    })
    cmd = (
        "aws bedrock-agent create-knowledge-base "
        f"--name {shlex.quote(name)} "
        f"--role-arn {shlex.quote(role_arn)} "
        f"--knowledge-base-configuration {shlex.quote(kb_config_json)} "
        f"--storage-configuration {shlex.quote(storage_config_json)}"
    )
    if description:
        cmd += f" --description {shlex.quote(description)}"
    return await _aws_cli(cmd, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_create_agent(
    agent_name: str,
    agent_resource_role_arn: str,
    foundation_model: str,
    instruction: str,
    description: Optional[str] = None,
    idle_session_ttl_in_seconds: Optional[int] = None,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Create a Bedrock Agent (managed agentic workflow).

    Use when the user asks "create a Bedrock Agent named X", "stand up a
    bedrock agent on Claude with instruction Y", "make a new agent for our
    customer support workflow". Backed by `aws bedrock-agent create-agent`.

    The new agent is created in DRAFT and must be subsequently associated
    with action groups / knowledge bases via separate calls and then
    `prepare-agent` before it can be invoked.

    Returns {success, data:{agent:{agentId, agentArn, agentName,
    agentStatus,...}}}.

    Args:
        agent_name: Display name (unique in the account)
        agent_resource_role_arn: Service role ARN the agent assumes at runtime
        foundation_model: Foundation model id (e.g. anthropic.claude-3-5-sonnet-20240620-v1:0)
        instruction: System prompt / persona instruction (10+ chars)
        description: Optional agent description
        idle_session_ttl_in_seconds: Session expiry (60-3600, default 600)
        region: AWS region (defaults to us-east-1)
        meta: Internal metadata from MCP proxy (unused for auth)
    """
    import shlex
    cmd = (
        "aws bedrock-agent create-agent "
        f"--agent-name {shlex.quote(agent_name)} "
        f"--agent-resource-role-arn {shlex.quote(agent_resource_role_arn)} "
        f"--foundation-model {shlex.quote(foundation_model)} "
        f"--instruction {shlex.quote(instruction)}"
    )
    if description:
        cmd += f" --description {shlex.quote(description)}"
    if idle_session_ttl_in_seconds:
        cmd += f" --idle-session-ttl-in-seconds {idle_session_ttl_in_seconds}"
    return await _aws_cli(cmd, region=region or 'us-east-1', meta=meta)

@mcp.tool()
async def aws_bedrock_invoke_agent(
    agent_id: str,
    agent_alias_id: str,
    session_id: str,
    input_text: str,
    enable_trace: bool = False,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Invoke a Bedrock Agent and stream its completion to a buffer.

    Use when the user asks "run Bedrock Agent X on prompt Y", "invoke
    agent-alias Z with this question", "test our customer-support agent
    with the input <text>". Backed by `aws bedrock-agent-runtime
    invoke-agent` against
    https://bedrock-agent-runtime.{region}.amazonaws.com/agents/{agent_id}/agentAliases/{agent_alias_id}/sessions/{session_id}/text.

    The CLI captures the streamed event payload into a temp file and dumps
    it to stdout — the response is the concatenated assistant chunks
    (text or trace events) wrapped in the standard envelope.

    Args:
        agent_id: Agent id (from aws_bedrock_agent_list_agents)
        agent_alias_id: Alias id; use 'TSTALIASID' for the DRAFT agent
        session_id: Caller-chosen session id (any string; reuse to keep
            multi-turn context with the agent runtime)
        input_text: User message to send to the agent
        enable_trace: Include trace events in the streamed response
        region: AWS region (defaults to us-east-1)
        meta: Internal metadata from MCP proxy (unused for auth)
    """
    import shlex
    cmd = (
        "aws bedrock-agent-runtime invoke-agent "
        f"--agent-id {shlex.quote(agent_id)} "
        f"--agent-alias-id {shlex.quote(agent_alias_id)} "
        f"--session-id {shlex.quote(session_id)} "
        f"--input-text {shlex.quote(input_text)}"
    )
    if enable_trace:
        cmd += " --enable-trace"
    cmd += " /dev/stdout"
    return await _aws_cli(cmd, region=region or 'us-east-1', meta=meta)

# ---------- DynamoDB ----------

@mcp.tool()
async def aws_list_dynamodb_tables(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List DynamoDB tables."""
    return await _aws_cli("aws dynamodb list-tables", region=region, meta=meta)

@mcp.tool()
async def aws_describe_dynamodb_table(
    table_name: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Describe a DynamoDB table (schema, GSIs, throughput, stream settings)."""
    return await _aws_cli(
        f"aws dynamodb describe-table --table-name {table_name}",
        region=region, meta=meta,
    )

# ---------- EKS ----------

@mcp.tool()
async def aws_list_eks_clusters(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List EKS Kubernetes clusters in a region."""
    return await _aws_cli("aws eks list-clusters", region=region, meta=meta)

@mcp.tool()
async def aws_describe_eks_cluster(
    cluster_name: str,
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Describe one EKS cluster (version, endpoint, logging, OIDC)."""
    return await _aws_cli(
        f"aws eks describe-cluster --name {cluster_name}",
        region=region, meta=meta,
    )

# ---------- SNS / SQS / SecretsManager / KMS ----------

@mcp.tool()
async def aws_list_sns_topics(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List SNS topics."""
    return await _aws_cli("aws sns list-topics", region=region, meta=meta)

@mcp.tool()
async def aws_list_sqs_queues(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List SQS queues (URLs) in a region."""
    return await _aws_cli("aws sqs list-queues", region=region, meta=meta)

@mcp.tool()
async def aws_list_secrets(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List Secrets Manager secrets (names + ARNs, no values)."""
    return await _aws_cli("aws secretsmanager list-secrets", region=region, meta=meta)

@mcp.tool()
async def aws_list_kms_keys(
    region: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List KMS customer master keys."""
    return await _aws_cli("aws kms list-keys", region=region, meta=meta)

# =============================================================================
# CLI COMMAND EXECUTION - Uses real AWS CLI for full compatibility
# =============================================================================

async def execute_cli_command(
    cli_command: str,
    credentials: Optional[Credentials],
    max_results: Optional[int] = None
) -> Dict[str, Any]:
    """
    Execute an AWS CLI command by shelling out to the real AWS CLI.

    This provides full compatibility with all AWS CLI features including:
    - wait commands
    - s3 cp, s3 sync, s3 mv, s3 rm
    - JMESPath queries (--query)
    - All CLI-specific features

    Credentials are passed via environment variables to the subprocess.
    """
    import subprocess
    import shlex
    import json

    try:
        # Validate command starts with 'aws'
        command = cli_command.strip()
        if not command.startswith("aws "):
            return {
                "success": False,
                "error": "Command must start with 'aws'",
                "hint": "Example: aws ec2 describe-instances"
            }

        # Build environment with credentials
        env = os.environ.copy()
        env["AWS_DEFAULT_OUTPUT"] = "json"  # Force JSON output for parsing

        if credentials:
            env["AWS_ACCESS_KEY_ID"] = credentials.access_key_id
            env["AWS_SECRET_ACCESS_KEY"] = credentials.secret_access_key
            if credentials.session_token:
                env["AWS_SESSION_TOKEN"] = credentials.session_token

        # Set region if not in command
        if "--region" not in command and AWS_REGION:
            command = f"{command} --region {AWS_REGION}"
        elif "--region" not in command:
            command = f"{command} --region us-east-1"

        # Add max-results if provided and applicable
        # NOTE: Not all AWS services support --max-items. Skip for services with different pagination.
        SKIP_MAX_ITEMS_SERVICES = [
            "bedrock",           # Uses --max-results in some, none in others
            "bedrock-runtime",   # No pagination on most ops
            "sso",               # Uses different pagination
            "sso-admin",         # Uses different pagination
            "iam",               # Uses --max-items but with specific format
        ]

        if max_results and "--max-results" not in command and "--max-items" not in command:
            # Only add for commands that support pagination AND aren't in skip list
            service_name = command.split()[1] if len(command.split()) > 1 else ""
            if any(op in command for op in ["describe-", "list-", "get-"]):
                if service_name not in SKIP_MAX_ITEMS_SERVICES:
                    command = f"{command} --max-items {max_results}"
                else:
                    logger.debug(f"Skipping --max-items for {service_name} (not supported)")

        logger.info(f"Executing AWS CLI: {command[:100]}...")

        # Execute the command
        result = subprocess.run(
            shlex.split(command),
            capture_output=True,
            text=True,
            env=env,
            timeout=300  # 5 minute timeout
        )

        # Check for errors
        if result.returncode != 0:
            error_msg = result.stderr.strip() if result.stderr else f"Command failed with exit code {result.returncode}"
            logger.error(f"AWS CLI error: {error_msg}")
            return {
                "success": False,
                "error": error_msg
            }

        # Parse output
        stdout = result.stdout.strip()

        if not stdout:
            # Some commands like delete don't return output
            return {"success": True, "data": {"message": "Command completed successfully"}}

        # Try to parse as JSON
        try:
            data = json.loads(stdout)
            return {"success": True, "data": data}
        except json.JSONDecodeError:
            # Return raw output for non-JSON responses (like s3 ls)
            return {"success": True, "data": {"output": stdout}}

    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Command timed out after 5 minutes"
        }
    except FileNotFoundError:
        return {
            "success": False,
            "error": "AWS CLI not found. Please install the AWS CLI: https://aws.amazon.com/cli/"
        }
    except Exception as e:
        logger.error(f"Command execution failed: {e}")
        return {"success": False, "error": str(e)}

def get_command_suggestions(query: str) -> list:
    """Get command suggestions based on query."""
    query_lower = query.lower()

    suggestions_db = {
        "ec2": [
            {"command": "aws ec2 describe-instances", "description": "List all EC2 instances"},
            {"command": "aws ec2 describe-instances --instance-ids i-xxx", "description": "Describe specific instance"},
            {"command": "aws ec2 start-instances --instance-ids i-xxx", "description": "Start an instance"},
            {"command": "aws ec2 stop-instances --instance-ids i-xxx", "description": "Stop an instance"},
            {"command": "aws ec2 describe-security-groups", "description": "List security groups"},
        ],
        "s3": [
            {"command": "aws s3 ls", "description": "List all S3 buckets"},
            {"command": "aws s3 ls s3://bucket-name", "description": "List objects in bucket"},
            {"command": "aws s3api list-buckets", "description": "List buckets with details"},
            {"command": "aws s3api create-bucket --bucket name", "description": "Create a bucket"},
        ],
        "lambda": [
            {"command": "aws lambda list-functions", "description": "List Lambda functions"},
            {"command": "aws lambda invoke --function-name name output.json", "description": "Invoke a function"},
            {"command": "aws lambda get-function --function-name name", "description": "Get function details"},
        ],
        "iam": [
            {"command": "aws iam list-users", "description": "List IAM users"},
            {"command": "aws iam list-roles", "description": "List IAM roles"},
            {"command": "aws iam get-user", "description": "Get current user details"},
        ],
        "sts": [
            {"command": "aws sts get-caller-identity", "description": "Get current identity (who am I?)"},
        ],
        "rds": [
            {"command": "aws rds describe-db-instances", "description": "List RDS instances"},
            {"command": "aws rds describe-db-clusters", "description": "List RDS clusters"},
        ],
        "eks": [
            {"command": "aws eks list-clusters", "description": "List EKS clusters"},
            {"command": "aws eks describe-cluster --name cluster-name", "description": "Describe EKS cluster"},
        ],
        "dynamodb": [
            {"command": "aws dynamodb list-tables", "description": "List DynamoDB tables"},
        ],
        "cloudformation": [
            {"command": "aws cloudformation list-stacks", "description": "List CloudFormation stacks"},
        ],
    }

    results = []

    # Match by service name
    for service, commands in suggestions_db.items():
        if service in query_lower:
            results.extend(commands)

    # Match by keywords
    keywords = {
        "list": ["describe", "list"],
        "create": ["create", "put"],
        "delete": ["delete", "remove"],
        "start": ["start"],
        "stop": ["stop"],
        "instance": ["ec2"],
        "bucket": ["s3"],
        "function": ["lambda"],
        "user": ["iam"],
        "identity": ["sts"],
        "database": ["rds", "dynamodb"],
        "cluster": ["eks", "rds"],
    }

    for keyword, services in keywords.items():
        if keyword in query_lower:
            for service in services:
                if service in suggestions_db:
                    for cmd in suggestions_db[service]:
                        if cmd not in results:
                            results.append(cmd)

    # Default suggestions if no match
    if not results:
        results = [
            {"command": "aws sts get-caller-identity", "description": "Check your AWS identity"},
            {"command": "aws ec2 describe-instances", "description": "List EC2 instances"},
            {"command": "aws s3 ls", "description": "List S3 buckets"},
        ]

    return results[:5]  # Limit to 5 suggestions

# =============================================================================
# MAIN
# =============================================================================

# Add shared module to path for http_transport
# In Docker container: /app/server.py, shared is at /app/shared/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'shared'))
sys.path.insert(0, '/app/shared')

try:
    from http_transport import run_with_http_support
    HTTP_TRANSPORT_AVAILABLE = True
except ImportError:
    HTTP_TRANSPORT_AVAILABLE = False

def main():
    """Main entry point for the OpenAgentic AWS MCP server."""
    logger.info("=" * 60)
    logger.info("Starting OpenAgentic AWS MCP Server")
    logger.info("Forked from awslabs/mcp aws-api-mcp-server")
    logger.info("Auth: standard boto3 / environment credential chain")
    logger.info("=" * 60)
    logger.info(f"AWS Region: {AWS_REGION or '(not set, will use us-east-1)'}")
    logger.info(f"Static env credentials: {'Yes' if AWS_ACCESS_KEY_ID else 'No (using default credential chain)'}")
    logger.info(f"Working directory: {WORKING_DIRECTORY}")
    logger.info("=" * 60)

    # Use HTTP transport if available and in HTTP mode, otherwise use stdio
    if HTTP_TRANSPORT_AVAILABLE:
        run_with_http_support(
            mcp_server=mcp,
            name="oap-aws-mcp",
            version="1.0.0",
            default_port=8082
        )
    else:
        mcp.run()

if __name__ == "__main__":
    main()
