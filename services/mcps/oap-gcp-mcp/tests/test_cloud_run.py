"""
TDD coverage for Cloud Run typed tools on oap-gcp-mcp.

Cloud Run v2 REST surface (https://run.googleapis.com/v2):
  /projects/{p}/locations/{loc}/services
  /projects/{p}/locations/{loc}/services/{svc}/revisions
  /projects/{p}/locations/{loc}/jobs
  /projects/{p}/locations/{loc}/jobs/{job}/executions
  /projects/{p}/locations/{loc}/operations

Each tool delegates to `gcp_api_execute(service, method, path, project_id, body, meta)`.
We mock that helper and assert each tool produces the right REST call so we
prove tool-level correctness without hitting the live GCP control plane.

Real-cloud integration tests (live SDK calls against the GCP project) live in
tests/test_cloud_run_live.py and run against REAL_GCP=1.
"""

import sys
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# Make `src/` importable under the package name `server` regardless of CWD.
SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))
# Don't probe Google ADC at import time during tests.
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", "")
os.environ.setdefault("GCP_PROJECT_ID", "test-proj")

import server  # noqa: E402

@pytest.fixture
def mock_exec():
    """Patch gcp_api_execute and return the AsyncMock so each test can assert on it."""
    mock = AsyncMock(return_value={"success": True, "data": {}})
    with patch.object(server, "gcp_api_execute", mock):
        yield mock

# ----------------------------------------------------------------------------
# Service registry — `service="run"` must be wired into gcp_api_execute's
# service_bases map (Cloud Run v2 base URL).
# ----------------------------------------------------------------------------

class TestServiceRegistry:
    def test_run_service_base_is_v2(self):
        """gcp_api_execute must map service='run' to the Cloud Run v2 base URL."""
        # Read the source so we don't have to import the function body shape.
        # The test fails until `"run": "https://run.googleapis.com/v2"` is added
        # to the service_bases map at server.py:358-368.
        src = (SRC / "server.py").read_text()
        assert '"run":' in src or "'run':" in src, (
            "service_bases map in gcp_api_execute must include 'run' key for Cloud Run"
        )
        assert "run.googleapis.com/v2" in src, (
            "Cloud Run v2 base URL must be https://run.googleapis.com/v2"
        )

# ----------------------------------------------------------------------------
# Cloud Run Services
# ----------------------------------------------------------------------------

class TestCloudRunServices:
    @pytest.mark.asyncio
    async def test_list_services_calls_v2_path(self, mock_exec):
        await server.gcp_list_cloud_run_services(location="us-central1", project_id="my-proj")
        mock_exec.assert_awaited_once()
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["service"] == "run"
        assert kwargs["method"] == "GET"
        assert kwargs["path"] == "/projects/my-proj/locations/us-central1/services"

    @pytest.mark.asyncio
    async def test_get_service_uses_named_path(self, mock_exec):
        await server.gcp_get_cloud_run_service(
            service_name="api", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == "/projects/my-proj/locations/us-central1/services/api"
        assert kwargs["method"] == "GET"

    @pytest.mark.asyncio
    async def test_delete_service_uses_DELETE(self, mock_exec):
        await server.gcp_delete_cloud_run_service(
            service_name="api", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["method"] == "DELETE"
        assert kwargs["path"] == "/projects/my-proj/locations/us-central1/services/api"

    @pytest.mark.asyncio
    async def test_get_service_iam_policy(self, mock_exec):
        await server.gcp_get_cloud_run_service_iam_policy(
            service_name="api", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["method"] == "GET"
        # GCP IAM uses `:getIamPolicy` suffix (verb-style)
        assert kwargs["path"].endswith(":getIamPolicy")

    @pytest.mark.asyncio
    async def test_default_project_falls_back_to_env(self, mock_exec):
        # When project_id is omitted, GCP_PROJECT_ID env should be used.
        await server.gcp_list_cloud_run_services(location="us-central1")
        kwargs = mock_exec.await_args.kwargs
        assert "/projects/test-proj/" in kwargs["path"]

# ----------------------------------------------------------------------------
# Cloud Run Revisions
# ----------------------------------------------------------------------------

class TestCloudRunRevisions:
    @pytest.mark.asyncio
    async def test_list_revisions(self, mock_exec):
        await server.gcp_list_cloud_run_revisions(
            service_name="api", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["method"] == "GET"
        assert kwargs["path"] == (
            "/projects/my-proj/locations/us-central1/services/api/revisions"
        )

    @pytest.mark.asyncio
    async def test_get_revision(self, mock_exec):
        await server.gcp_get_cloud_run_revision(
            service_name="api",
            revision_name="api-00003-abc",
            location="us-central1",
            project_id="my-proj",
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == (
            "/projects/my-proj/locations/us-central1/services/api/revisions/api-00003-abc"
        )

    @pytest.mark.asyncio
    async def test_delete_revision(self, mock_exec):
        await server.gcp_delete_cloud_run_revision(
            service_name="api",
            revision_name="api-00003-abc",
            location="us-central1",
            project_id="my-proj",
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["method"] == "DELETE"

# ----------------------------------------------------------------------------
# Cloud Run Jobs + Executions
# ----------------------------------------------------------------------------

class TestCloudRunJobs:
    @pytest.mark.asyncio
    async def test_list_jobs(self, mock_exec):
        await server.gcp_list_cloud_run_jobs(location="us-central1", project_id="my-proj")
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == "/projects/my-proj/locations/us-central1/jobs"

    @pytest.mark.asyncio
    async def test_get_job(self, mock_exec):
        await server.gcp_get_cloud_run_job(
            job_name="nightly-report", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == (
            "/projects/my-proj/locations/us-central1/jobs/nightly-report"
        )

    @pytest.mark.asyncio
    async def test_run_job_uses_POST_with_run_verb(self, mock_exec):
        await server.gcp_run_cloud_run_job(
            job_name="nightly-report", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["method"] == "POST"
        # Verb-style suffix — Cloud Run v2 jobs use `:run`
        assert kwargs["path"].endswith(":run")

    @pytest.mark.asyncio
    async def test_delete_job(self, mock_exec):
        await server.gcp_delete_cloud_run_job(
            job_name="nightly-report", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["method"] == "DELETE"

    @pytest.mark.asyncio
    async def test_list_executions(self, mock_exec):
        await server.gcp_list_cloud_run_executions(
            job_name="nightly-report", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == (
            "/projects/my-proj/locations/us-central1/jobs/nightly-report/executions"
        )

    @pytest.mark.asyncio
    async def test_get_execution(self, mock_exec):
        await server.gcp_get_cloud_run_execution(
            job_name="nightly-report",
            execution_name="nightly-report-abcde",
            location="us-central1",
            project_id="my-proj",
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == (
            "/projects/my-proj/locations/us-central1/jobs/nightly-report/executions/nightly-report-abcde"
        )

    @pytest.mark.asyncio
    async def test_cancel_execution_uses_cancel_verb(self, mock_exec):
        await server.gcp_cancel_cloud_run_execution(
            job_name="nightly-report",
            execution_name="nightly-report-abcde",
            location="us-central1",
            project_id="my-proj",
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["method"] == "POST"
        assert kwargs["path"].endswith(":cancel")

# ----------------------------------------------------------------------------
# Operations + locations
# ----------------------------------------------------------------------------

class TestCloudRunOperations:
    @pytest.mark.asyncio
    async def test_list_locations(self, mock_exec):
        await server.gcp_list_cloud_run_locations(project_id="my-proj")
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == "/projects/my-proj/locations"

    @pytest.mark.asyncio
    async def test_list_operations(self, mock_exec):
        await server.gcp_list_cloud_run_operations(
            location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == "/projects/my-proj/locations/us-central1/operations"

    @pytest.mark.asyncio
    async def test_get_operation(self, mock_exec):
        await server.gcp_get_cloud_run_operation(
            operation_name="op-abc-123", location="us-central1", project_id="my-proj"
        )
        kwargs = mock_exec.await_args.kwargs
        assert kwargs["path"] == (
            "/projects/my-proj/locations/us-central1/operations/op-abc-123"
        )

# ----------------------------------------------------------------------------
# Tool registration sanity — every Cloud Run tool MUST be picked up by FastMCP.
# ----------------------------------------------------------------------------

class TestToolRegistration:
    EXPECTED_TOOLS = [
        # services
        "gcp_list_cloud_run_services",
        "gcp_get_cloud_run_service",
        "gcp_delete_cloud_run_service",
        "gcp_get_cloud_run_service_iam_policy",
        # revisions
        "gcp_list_cloud_run_revisions",
        "gcp_get_cloud_run_revision",
        "gcp_delete_cloud_run_revision",
        # jobs
        "gcp_list_cloud_run_jobs",
        "gcp_get_cloud_run_job",
        "gcp_run_cloud_run_job",
        "gcp_delete_cloud_run_job",
        # executions
        "gcp_list_cloud_run_executions",
        "gcp_get_cloud_run_execution",
        "gcp_cancel_cloud_run_execution",
        # operations + locations
        "gcp_list_cloud_run_locations",
        "gcp_list_cloud_run_operations",
        "gcp_get_cloud_run_operation",
    ]

    def test_every_cloud_run_tool_is_a_callable_attr_on_module(self):
        for name in self.EXPECTED_TOOLS:
            fn = getattr(server, name, None)
            assert fn is not None, f"{name} not exported from server module"
            assert callable(fn), f"{name} is not callable"
