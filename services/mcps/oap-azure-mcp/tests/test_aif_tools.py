"""
Tests for the 7 new AIF tools added in #72.

What's covered for each tool:
  - success path with mocked Azure SDK clients
  - error path when require_user_token raises ValueError (no token in meta)
  - missing-default-subscription path (returns success=False)

For the Agent tools (aif_list_agents / aif_create_agent / aif_delete_agent),
we additionally cover the missing-SDK degrade path because azure-ai-projects
is currently optional in this image.

These were back-filled — TDD violation noted; the implementation landed
before the tests. Future AIF tools must follow Red-Green-Refactor.
"""

import asyncio
import sys
from pathlib import Path
from typing import Any, Dict
from unittest.mock import MagicMock, patch

import pytest

# Make src/ importable. The package isn't pip-installed in tests.
SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

def _run(coro):
    """Drive an async coroutine to completion in a sync test."""
    return asyncio.run(coro)

# ─── Fixtures: lightweight mocks ────────────────────────────────────────────

class _FakeProperties:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

class _FakeAccount:
    def __init__(self, name="awf-test", location="eastus", kind="AIServices",
                 sku_name="S0", endpoint="https://awf-test.cognitiveservices.azure.com",
                 provisioning_state="Succeeded", tags=None):
        self.name = name
        self.location = location
        self.kind = kind
        self.sku = MagicMock(name="sku", capacity=None)
        self.sku.name = sku_name
        self.tags = tags or {}
        self.properties = _FakeProperties(
            endpoint=endpoint,
            provisioning_state=provisioning_state,
        )

class _FakeDeployment:
    def __init__(self, name, model_name, model_version, sku_name, capacity,
                 provisioning_state="Succeeded"):
        self.name = name
        self.sku = MagicMock(name="sku", capacity=capacity)
        self.sku.name = sku_name
        self.properties = _FakeProperties(
            model=_FakeProperties(name=model_name, version=model_version),
            provisioning_state=provisioning_state,
            rate_limits=[],
        )

class _FakePolicy:
    def __init__(self, name, mode="Default", base_policy_name="Microsoft.Default"):
        self.name = name
        self.type = "Microsoft.CognitiveServices/accounts/raiPolicies"
        self.properties = _FakeProperties(mode=mode, base_policy_name=base_policy_name)

def _import_server():
    """Return the module that OWNS the AIF tools after the god-file split
    (``tools.ai``).

    Done inside each test (rather than at module top) so per-test patches of
    azure SDK clients are honored when the tools instantiate them via the local
    imports inside their function bodies. The AIF bodies read
    ``require_user_token`` and ``DEFAULT_SUBSCRIPTION_ID`` from ``tools.ai``
    (pulled in via ``from _core import *``); the tests stub those with
    ``patch.object(server, ...)``, so the returned object must be the owning
    module. ``server`` re-exports the same tool objects, so
    ``server.aif_project_status(...)`` is identical either way."""
    import importlib
    import server  # noqa: F401 — load _core + register every tool as a side effect
    importlib.reload(server)
    return importlib.import_module("tools.ai")

# ─── aif_project_status ────────────────────────────────────────────────────

def test_aif_project_status_success_returns_account_and_deployment_summary():
    server = _import_server()
    fake_client = MagicMock()
    fake_client.accounts.get.return_value = _FakeAccount()
    fake_client.deployments.list.return_value = [
        _FakeDeployment("gpt-5.3-codex", "gpt-5.3-codex", "2026-02-24", "GlobalStandard", 42),
    ]
    fake_client.rai_policies.list.return_value = [_FakePolicy("Microsoft.Default")]
    fake_client.usages.list.return_value = []

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {"upn": "tester@example.com"})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub-uuid"), \
         patch("azure.mgmt.cognitiveservices.CognitiveServicesManagementClient", return_value=fake_client):
        result = _run(server.aif_project_status(resource_group="rg", account_name="awf-test"))

    assert result["success"] is True
    assert result["account"]["name"] == "awf-test"
    assert result["account"]["location"] == "eastus"
    assert result["deployment_count"] == 1
    assert result["deployments"][0]["model"] == "gpt-5.3-codex"
    assert result["guardrail_count"] == 1
    assert result["executed_as"]["upn"] == "tester@example.com"

def test_aif_project_status_no_subscription_returns_error():
    server = _import_server()
    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", ""):
        result = _run(server.aif_project_status(resource_group="rg", account_name="acct"))
    assert result["success"] is False
    assert "No subscription_id" in result["error"]

def test_aif_project_status_no_user_token_returns_error():
    server = _import_server()
    with patch.object(server, "require_user_token", side_effect=ValueError("No user token in meta")):
        result = _run(server.aif_project_status(resource_group="rg", account_name="acct"))
    assert result["success"] is False
    assert "No user token" in result["error"]

def test_aif_project_status_handles_missing_rai_policies_attr():
    """Tolerates older azure-mgmt-cognitiveservices SDKs that don't expose rai_policies."""
    server = _import_server()
    fake_client = MagicMock(spec=["accounts", "deployments", "usages"])
    fake_client.accounts.get.return_value = _FakeAccount()
    fake_client.deployments.list.return_value = []
    fake_client.usages.list.return_value = []
    # No rai_policies attribute on this spec'd mock.
    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("azure.mgmt.cognitiveservices.CognitiveServicesManagementClient", return_value=fake_client):
        result = _run(server.aif_project_status(resource_group="rg", account_name="acct"))
    assert result["success"] is True
    assert result["guardrail_count"] == 0

# ─── aif_list_guardrails ───────────────────────────────────────────────────

def test_aif_list_guardrails_success_returns_policy_list():
    server = _import_server()
    fake_client = MagicMock()
    fake_client.rai_policies.list.return_value = [
        _FakePolicy("default", mode="Default"),
        _FakePolicy("strict", mode="Asynchronous_filter"),
    ]
    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("azure.mgmt.cognitiveservices.CognitiveServicesManagementClient", return_value=fake_client):
        result = _run(server.aif_list_guardrails(resource_group="rg", account_name="acct"))
    assert result["success"] is True
    assert result["count"] == 2
    assert result["policies"][1]["name"] == "strict"
    assert result["policies"][1]["mode"] == "Asynchronous_filter"

def test_aif_list_guardrails_when_sdk_missing_rai_policies_attr_returns_error():
    server = _import_server()
    fake_client = MagicMock(spec=["accounts", "deployments"])
    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("azure.mgmt.cognitiveservices.CognitiveServicesManagementClient", return_value=fake_client):
        result = _run(server.aif_list_guardrails(resource_group="rg", account_name="acct"))
    assert result["success"] is False
    assert "RAI policy management not available" in result["error"]

# ─── aif_create_guardrail ──────────────────────────────────────────────────

def test_aif_create_guardrail_success_returns_created():
    server = _import_server()
    fake_client = MagicMock()
    fake_client.rai_policies.create_or_update.return_value = MagicMock(name="my-policy")
    fake_client.rai_policies.create_or_update.return_value.name = "my-policy"
    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("azure.mgmt.cognitiveservices.CognitiveServicesManagementClient", return_value=fake_client):
        result = _run(server.aif_create_guardrail(
            resource_group="rg", account_name="acct", policy_name="my-policy"))
    assert result["success"] is True
    assert result["status"] == "created_or_updated"
    assert result["name"] == "my-policy"
    fake_client.rai_policies.create_or_update.assert_called_once()

def test_aif_create_guardrail_passes_base_policy_and_mode():
    server = _import_server()
    fake_client = MagicMock()
    fake_client.rai_policies.create_or_update.return_value = MagicMock(name="strict")
    fake_client.rai_policies.create_or_update.return_value.name = "strict"
    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("azure.mgmt.cognitiveservices.CognitiveServicesManagementClient", return_value=fake_client):
        _run(server.aif_create_guardrail(
            resource_group="rg", account_name="acct",
            policy_name="strict",
            base_policy_name="Microsoft.Default",
            mode="Asynchronous_filter"))
    body_arg = fake_client.rai_policies.create_or_update.call_args[0][3]
    assert body_arg["properties"]["basePolicyName"] == "Microsoft.Default"
    assert body_arg["properties"]["mode"] == "Asynchronous_filter"

# ─── aif_delete_guardrail ──────────────────────────────────────────────────

def test_aif_delete_guardrail_success():
    server = _import_server()
    fake_client = MagicMock()
    fake_client.rai_policies.delete.return_value = None
    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("azure.mgmt.cognitiveservices.CognitiveServicesManagementClient", return_value=fake_client):
        result = _run(server.aif_delete_guardrail(
            resource_group="rg", account_name="acct", policy_name="my-policy"))
    assert result["success"] is True
    assert result["status"] == "deleted"
    assert result["policy"] == "my-policy"

# ─── aif_list_agents (Agent service / A2S) ─────────────────────────────────

def test_aif_list_agents_when_azure_ai_projects_missing_returns_clear_error():
    """Most images don't ship azure-ai-projects yet — verify graceful degrade."""
    server = _import_server()
    # Stub the azure.ai.projects ImportError path.
    import builtins
    real_import = builtins.__import__

    def stubbed_import(name, *args, **kwargs):
        if name == "azure.ai.projects" or (args and "azure.ai.projects" in args):
            raise ImportError("azure-ai-projects not installed")
        return real_import(name, *args, **kwargs)

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("builtins.__import__", side_effect=stubbed_import):
        result = _run(server.aif_list_agents(resource_group="rg", account_name="acct"))
    assert result["success"] is False
    assert "azure-ai-projects SDK not installed" in result["error"]

def test_aif_create_agent_when_azure_ai_projects_missing_returns_clear_error():
    server = _import_server()
    import builtins
    real_import = builtins.__import__

    def stubbed_import(name, *args, **kwargs):
        if name == "azure.ai.projects":
            raise ImportError("azure-ai-projects not installed")
        return real_import(name, *args, **kwargs)

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("builtins.__import__", side_effect=stubbed_import):
        result = _run(server.aif_create_agent(
            resource_group="rg", account_name="acct",
            agent_name="researcher", model="gpt-5.3-codex",
            instructions="be terse"))
    assert result["success"] is False
    assert "azure-ai-projects SDK not installed" in result["error"]

def test_aif_delete_agent_when_azure_ai_projects_missing_returns_clear_error():
    server = _import_server()
    import builtins
    real_import = builtins.__import__

    def stubbed_import(name, *args, **kwargs):
        if name == "azure.ai.projects":
            raise ImportError("azure-ai-projects not installed")
        return real_import(name, *args, **kwargs)

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", "sub"), \
         patch("builtins.__import__", side_effect=stubbed_import):
        result = _run(server.aif_delete_agent(
            resource_group="rg", account_name="acct", agent_id="agent-123"))
    assert result["success"] is False
    assert "not installed" in result["error"]
