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
OpenAgentic GitHub MCP Server

A FastMCP server that provides GitHub operations with per-user OAuth token support.
This server wraps GitHub API calls and accepts user tokens via meta.githubToken
in tool call arguments.

Tools:
- list_repos: List repositories for the authenticated user
- get_repo: Get details about a specific repository
- list_issues: List issues in a repository
- create_issue: Create a new issue
- get_issue: Get details about a specific issue
- update_issue: Update an existing issue
- list_pull_requests: List pull requests in a repository
- get_pull_request: Get details about a specific pull request
- create_pull_request: Create a new pull request
- list_branches: List branches in a repository
- get_file_contents: Get contents of a file in a repository
- search_code: Search for code across repositories
- search_repos: Search for repositories
- get_user: Get authenticated user info
- list_workflows: List GitHub Actions workflows
- get_workflow_runs: Get workflow run history
"""

import os
import logging
import httpx
from typing import Optional, Any
from fastmcp import FastMCP

# Configure structured logging via shared observability module
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-github-mcp')
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oap-github-mcp")

# Initialize FastMCP
mcp = FastMCP("oap-github-mcp")

# GitHub API base URL (can be overridden for GitHub Enterprise)
GITHUB_API_URL = os.getenv("GITHUB_API_URL", "https://api.github.com")
GITHUB_HOST = os.getenv("GITHUB_HOST", "")

def get_api_base() -> str:
    """Get the GitHub API base URL."""
    if GITHUB_HOST:
        # GitHub Enterprise Server
        return f"https://{GITHUB_HOST}/api/v3"
    return GITHUB_API_URL

def get_github_headers(token: str) -> dict:
    """Get headers for GitHub API requests."""
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
    }

def extract_token(meta: Optional[dict]) -> str:
    """Extract GitHub token from meta object."""
    if not meta:
        raise ValueError("No authentication provided. Please connect your GitHub account in Settings.")

    token = meta.get("githubToken") or meta.get("userAccessToken")
    if not token:
        raise ValueError("GitHub token not found. Please connect your GitHub account in Settings.")

    return token

async def github_request(
    method: str,
    endpoint: str,
    token: str,
    params: Optional[dict] = None,
    json_data: Optional[dict] = None
) -> dict:
    """Make a request to the GitHub API."""
    url = f"{get_api_base()}{endpoint}"
    headers = get_github_headers(token)

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            json=json_data
        )

        if response.status_code == 401:
            raise ValueError("GitHub token is invalid or expired. Please reconnect your GitHub account.")
        elif response.status_code == 403:
            error_msg = response.json().get("message", "Access forbidden")
            raise ValueError(f"GitHub API access denied: {error_msg}")
        elif response.status_code == 404:
            raise ValueError("Resource not found on GitHub")
        elif response.status_code >= 400:
            error_msg = response.json().get("message", response.text)
            raise ValueError(f"GitHub API error ({response.status_code}): {error_msg}")

        return response.json() if response.content else {}


# =============================================================================
# USER TOOLS
# =============================================================================

@mcp.tool()
async def get_user(meta: Optional[dict] = None) -> dict:
    """
    Get information about the authenticated GitHub user.

    Returns the user's profile information including username, email, and avatar.
    """
    token = extract_token(meta)
    return await github_request("GET", "/user", token)


# =============================================================================
# REPOSITORY TOOLS
# =============================================================================

@mcp.tool()
async def list_repos(
    type: str = "all",
    sort: str = "updated",
    direction: str = "desc",
    per_page: int = 30,
    page: int = 1,
    meta: Optional[dict] = None
) -> list:
    """
    List GitHub repositories for the authenticated user.

    SCOPE: This tool ONLY queries GitHub. Use it ONLY when the user has
    explicitly asked about GitHub repositories, source code repositories,
    git history, pull requests, branches, commits, or issues.

    DO NOT USE FOR:
      - Azure resource inventory (use azure_resource_graph_query_tenant_wide)
      - AWS resource inventory (use aws_describe_* tools)
      - GCP resource inventory (use gcp_* tools)
      - "Language versions" of running infrastructure (use azure_resource_graph_query_tenant_wide
        with a KQL query against Microsoft.Web/sites for linuxFxVersion, against
        Microsoft.ContainerService/managedClusters for kubernetesVersion, etc)
      - Runtime versions of deployed services (these live in cloud provider APIs,
        not in GitHub)
      - Cost, billing, savings, security findings, monitoring data, or any
        non-source-code question

    If the user asks about Azure/AWS/GCP and the prompt doesn't mention "github",
    "repo", "repository", "pull request", "commit", "branch", "issue", or "code"
    explicitly, this tool is the wrong choice.

    Args:
        type: Type of repos - all, owner, public, private, member (default: all)
        sort: Sort by - created, updated, pushed, full_name (default: updated)
        direction: Sort direction - asc, desc (default: desc)
        per_page: Results per page, max 100 (default: 30)
        page: Page number (default: 1)
    """
    token = extract_token(meta)
    params = {
        "type": type,
        "sort": sort,
        "direction": direction,
        "per_page": min(per_page, 100),
        "page": page
    }
    return await github_request("GET", "/user/repos", token, params=params)


@mcp.tool()
async def get_repo(owner: str, repo: str, meta: Optional[dict] = None) -> dict:
    """
    Get details about a specific repository.

    Args:
        owner: Repository owner (username or organization)
        repo: Repository name
    """
    token = extract_token(meta)
    return await github_request("GET", f"/repos/{owner}/{repo}", token)


@mcp.tool()
async def search_repos(
    query: str,
    sort: str = "best-match",
    order: str = "desc",
    per_page: int = 30,
    page: int = 1,
    meta: Optional[dict] = None
) -> dict:
    """
    Search for repositories on GitHub.

    Args:
        query: Search query (supports GitHub search syntax)
        sort: Sort by - stars, forks, help-wanted-issues, updated, best-match
        order: Sort order - asc, desc
        per_page: Results per page (default: 30)
        page: Page number (default: 1)
    """
    token = extract_token(meta)
    params = {
        "q": query,
        "sort": sort if sort != "best-match" else None,
        "order": order,
        "per_page": min(per_page, 100),
        "page": page
    }
    params = {k: v for k, v in params.items() if v is not None}
    return await github_request("GET", "/search/repositories", token, params=params)


@mcp.tool()
async def list_branches(
    owner: str,
    repo: str,
    protected: Optional[bool] = None,
    per_page: int = 30,
    page: int = 1,
    meta: Optional[dict] = None
) -> list:
    """
    List branches in a repository.

    Args:
        owner: Repository owner
        repo: Repository name
        protected: Filter to only protected branches (optional)
        per_page: Results per page (default: 30)
        page: Page number (default: 1)
    """
    token = extract_token(meta)
    params = {
        "per_page": min(per_page, 100),
        "page": page
    }
    if protected is not None:
        params["protected"] = str(protected).lower()
    return await github_request("GET", f"/repos/{owner}/{repo}/branches", token, params=params)


@mcp.tool()
async def get_file_contents(
    owner: str,
    repo: str,
    path: str,
    ref: Optional[str] = None,
    meta: Optional[dict] = None
) -> dict:
    """
    Get contents of a file in a repository.

    Args:
        owner: Repository owner
        repo: Repository name
        path: Path to the file
        ref: Branch, tag, or commit SHA (default: default branch)
    """
    token = extract_token(meta)
    params = {}
    if ref:
        params["ref"] = ref
    return await github_request("GET", f"/repos/{owner}/{repo}/contents/{path}", token, params=params)


# =============================================================================
# ISSUE TOOLS
# =============================================================================

@mcp.tool()
async def list_issues(
    owner: str,
    repo: str,
    state: str = "open",
    sort: str = "created",
    direction: str = "desc",
    per_page: int = 30,
    page: int = 1,
    labels: Optional[str] = None,
    assignee: Optional[str] = None,
    meta: Optional[dict] = None
) -> list:
    """
    List issues in a repository.

    Args:
        owner: Repository owner
        repo: Repository name
        state: Issue state - open, closed, all (default: open)
        sort: Sort by - created, updated, comments (default: created)
        direction: Sort direction - asc, desc (default: desc)
        per_page: Results per page (default: 30)
        page: Page number (default: 1)
        labels: Comma-separated list of label names
        assignee: Filter by assignee username
    """
    token = extract_token(meta)
    params = {
        "state": state,
        "sort": sort,
        "direction": direction,
        "per_page": min(per_page, 100),
        "page": page
    }
    if labels:
        params["labels"] = labels
    if assignee:
        params["assignee"] = assignee
    return await github_request("GET", f"/repos/{owner}/{repo}/issues", token, params=params)


@mcp.tool()
async def get_issue(
    owner: str,
    repo: str,
    issue_number: int,
    meta: Optional[dict] = None
) -> dict:
    """
    Get details about a specific issue.

    Args:
        owner: Repository owner
        repo: Repository name
        issue_number: Issue number
    """
    token = extract_token(meta)
    return await github_request("GET", f"/repos/{owner}/{repo}/issues/{issue_number}", token)


@mcp.tool()
async def create_issue(
    owner: str,
    repo: str,
    title: str,
    body: Optional[str] = None,
    labels: Optional[list] = None,
    assignees: Optional[list] = None,
    milestone: Optional[int] = None,
    meta: Optional[dict] = None
) -> dict:
    """
    Create a new issue in a repository.

    Args:
        owner: Repository owner
        repo: Repository name
        title: Issue title
        body: Issue body/description (optional)
        labels: List of label names (optional)
        assignees: List of usernames to assign (optional)
        milestone: Milestone number (optional)
    """
    token = extract_token(meta)
    data = {"title": title}
    if body:
        data["body"] = body
    if labels:
        data["labels"] = labels
    if assignees:
        data["assignees"] = assignees
    if milestone:
        data["milestone"] = milestone
    return await github_request("POST", f"/repos/{owner}/{repo}/issues", token, json_data=data)


@mcp.tool()
async def update_issue(
    owner: str,
    repo: str,
    issue_number: int,
    title: Optional[str] = None,
    body: Optional[str] = None,
    state: Optional[str] = None,
    labels: Optional[list] = None,
    assignees: Optional[list] = None,
    meta: Optional[dict] = None
) -> dict:
    """
    Update an existing issue.

    Args:
        owner: Repository owner
        repo: Repository name
        issue_number: Issue number
        title: New title (optional)
        body: New body (optional)
        state: New state - open, closed (optional)
        labels: New labels list (optional)
        assignees: New assignees list (optional)
    """
    token = extract_token(meta)
    data = {}
    if title:
        data["title"] = title
    if body:
        data["body"] = body
    if state:
        data["state"] = state
    if labels is not None:
        data["labels"] = labels
    if assignees is not None:
        data["assignees"] = assignees
    return await github_request("PATCH", f"/repos/{owner}/{repo}/issues/{issue_number}", token, json_data=data)


# =============================================================================
# PULL REQUEST TOOLS
# =============================================================================

@mcp.tool()
async def list_pull_requests(
    owner: str,
    repo: str,
    state: str = "open",
    sort: str = "created",
    direction: str = "desc",
    per_page: int = 30,
    page: int = 1,
    base: Optional[str] = None,
    head: Optional[str] = None,
    meta: Optional[dict] = None
) -> list:
    """
    List pull requests in a repository.

    Args:
        owner: Repository owner
        repo: Repository name
        state: PR state - open, closed, all (default: open)
        sort: Sort by - created, updated, popularity, long-running (default: created)
        direction: Sort direction - asc, desc (default: desc)
        per_page: Results per page (default: 30)
        page: Page number (default: 1)
        base: Filter by base branch (optional)
        head: Filter by head branch (optional)
    """
    token = extract_token(meta)
    params = {
        "state": state,
        "sort": sort,
        "direction": direction,
        "per_page": min(per_page, 100),
        "page": page
    }
    if base:
        params["base"] = base
    if head:
        params["head"] = head
    return await github_request("GET", f"/repos/{owner}/{repo}/pulls", token, params=params)


@mcp.tool()
async def get_pull_request(
    owner: str,
    repo: str,
    pull_number: int,
    meta: Optional[dict] = None
) -> dict:
    """
    Get details about a specific pull request.

    Args:
        owner: Repository owner
        repo: Repository name
        pull_number: Pull request number
    """
    token = extract_token(meta)
    return await github_request("GET", f"/repos/{owner}/{repo}/pulls/{pull_number}", token)


@mcp.tool()
async def create_pull_request(
    owner: str,
    repo: str,
    title: str,
    head: str,
    base: str,
    body: Optional[str] = None,
    draft: bool = False,
    maintainer_can_modify: bool = True,
    meta: Optional[dict] = None
) -> dict:
    """
    Create a new pull request.

    Args:
        owner: Repository owner
        repo: Repository name
        title: PR title
        head: Branch containing changes (can be user:branch for cross-repo)
        base: Branch to merge into
        body: PR description (optional)
        draft: Create as draft PR (default: False)
        maintainer_can_modify: Allow maintainer edits (default: True)
    """
    token = extract_token(meta)
    data = {
        "title": title,
        "head": head,
        "base": base,
        "draft": draft,
        "maintainer_can_modify": maintainer_can_modify
    }
    if body:
        data["body"] = body
    return await github_request("POST", f"/repos/{owner}/{repo}/pulls", token, json_data=data)


# =============================================================================
# CODE SEARCH TOOLS
# =============================================================================

@mcp.tool()
async def search_code(
    query: str,
    sort: Optional[str] = None,
    order: str = "desc",
    per_page: int = 30,
    page: int = 1,
    meta: Optional[dict] = None
) -> dict:
    """
    Search for code across GitHub repositories.

    Args:
        query: Search query (supports GitHub search syntax like 'repo:owner/name')
        sort: Sort by - indexed (optional)
        order: Sort order - asc, desc (default: desc)
        per_page: Results per page (default: 30)
        page: Page number (default: 1)

    Note: Code search requires the query to include at least one qualifier like:
    - repo:owner/name
    - user:username
    - org:organization
    - language:python
    """
    token = extract_token(meta)
    params = {
        "q": query,
        "order": order,
        "per_page": min(per_page, 100),
        "page": page
    }
    if sort:
        params["sort"] = sort
    return await github_request("GET", "/search/code", token, params=params)


# =============================================================================
# GITHUB ACTIONS TOOLS
# =============================================================================

@mcp.tool()
async def list_workflows(
    owner: str,
    repo: str,
    per_page: int = 30,
    page: int = 1,
    meta: Optional[dict] = None
) -> dict:
    """
    List GitHub Actions workflows in a repository.

    Args:
        owner: Repository owner
        repo: Repository name
        per_page: Results per page (default: 30)
        page: Page number (default: 1)
    """
    token = extract_token(meta)
    params = {
        "per_page": min(per_page, 100),
        "page": page
    }
    return await github_request("GET", f"/repos/{owner}/{repo}/actions/workflows", token, params=params)


@mcp.tool()
async def get_workflow_runs(
    owner: str,
    repo: str,
    workflow_id: Optional[str] = None,
    status: Optional[str] = None,
    branch: Optional[str] = None,
    per_page: int = 30,
    page: int = 1,
    meta: Optional[dict] = None
) -> dict:
    """
    Get workflow runs for a repository.

    Args:
        owner: Repository owner
        repo: Repository name
        workflow_id: Filter by workflow ID or filename (optional)
        status: Filter by status - queued, in_progress, completed (optional)
        branch: Filter by branch name (optional)
        per_page: Results per page (default: 30)
        page: Page number (default: 1)
    """
    token = extract_token(meta)
    params = {
        "per_page": min(per_page, 100),
        "page": page
    }
    if status:
        params["status"] = status
    if branch:
        params["branch"] = branch

    if workflow_id:
        endpoint = f"/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
    else:
        endpoint = f"/repos/{owner}/{repo}/actions/runs"

    return await github_request("GET", endpoint, token, params=params)


@mcp.tool()
async def trigger_workflow(
    owner: str,
    repo: str,
    workflow_id: str,
    ref: str,
    inputs: Optional[dict] = None,
    meta: Optional[dict] = None
) -> dict:
    """
    Trigger a workflow dispatch event.

    Args:
        owner: Repository owner
        repo: Repository name
        workflow_id: Workflow ID or filename
        ref: Branch or tag to run the workflow on
        inputs: Input parameters for the workflow (optional)
    """
    token = extract_token(meta)
    data = {"ref": ref}
    if inputs:
        data["inputs"] = inputs

    await github_request(
        "POST",
        f"/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
        token,
        json_data=data
    )
    return {"success": True, "message": f"Workflow {workflow_id} triggered on {ref}"}


# =============================================================================
# COMMIT/TREE TOOLS
# =============================================================================

@mcp.tool()
async def list_commits(
    owner: str,
    repo: str,
    sha: Optional[str] = None,
    path: Optional[str] = None,
    author: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    per_page: int = 30,
    page: int = 1,
    meta: Optional[dict] = None
) -> list:
    """
    List commits in a repository.

    Args:
        owner: Repository owner
        repo: Repository name
        sha: Branch name or commit SHA to start from (optional)
        path: Only commits affecting this path (optional)
        author: GitHub username or email of author (optional)
        since: Only commits after this date ISO 8601 format (optional)
        until: Only commits before this date ISO 8601 format (optional)
        per_page: Results per page (default: 30)
        page: Page number (default: 1)
    """
    token = extract_token(meta)
    params = {
        "per_page": min(per_page, 100),
        "page": page
    }
    if sha:
        params["sha"] = sha
    if path:
        params["path"] = path
    if author:
        params["author"] = author
    if since:
        params["since"] = since
    if until:
        params["until"] = until

    return await github_request("GET", f"/repos/{owner}/{repo}/commits", token, params=params)


@mcp.tool()
async def get_commit(
    owner: str,
    repo: str,
    commit_sha: str,
    meta: Optional[dict] = None
) -> dict:
    """
    Get details about a specific commit.

    Args:
        owner: Repository owner
        repo: Repository name
        commit_sha: Commit SHA
    """
    token = extract_token(meta)
    return await github_request("GET", f"/repos/{owner}/{repo}/commits/{commit_sha}", token)


# Run the server
if __name__ == "__main__":
    mcp.run()
