"""
Tests for the cost-management tools — Q1-blocker-1 regression suite.

Bug captured 2026-05-12 in reports/verify-cadence/Q1-tri-cloud-cost-spike/
0.7.1-e489c729/api-log-extract.txt:

  Model called `azure_cost_by_service` and `azure_cost_query` without a
  `subscription_id`. The tool let `sub_id` resolve to "" (DEFAULT_SUBSCRIPTION_ID
  env unset in openagentic), then built scope=`/subscriptions/` and passed it
  to the Azure SDK. The SDK collapsed `/subscriptions//providers/...` and
  Azure returned:

    (InvalidSubscriptionId) The provided subscription identifier
    'providers' is malformed or invalid.

Fix: when `subscription_id` is not provided AND no default is configured,
auto-resolve via SubscriptionClient using the caller's OBO token, then fan the
cost query across each visible subscription and aggregate. NEVER pass an empty
sub_id into the Azure SDK URL builder.
"""

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

def _run(coro):
    return asyncio.run(coro)

def _import_server():
    import importlib
    import server
    importlib.reload(server)
    return server

# ── Helpers ────────────────────────────────────────────────────────────────

class _FakeSub:
    def __init__(self, sub_id, name="sub"):
        self.subscription_id = sub_id
        self.display_name = name

class _FakeColumn:
    def __init__(self, name):
        self.name = name

def _fake_cost_result(rows=None, columns=("Cost", "CostUSD")):
    res = MagicMock()
    res.columns = [_FakeColumn(c) for c in columns]
    res.rows = rows or []
    return res

# ── azure_cost_query ───────────────────────────────────────────────────────

def test_cost_query_null_subscription_id_does_not_call_azure_with_empty_scope():
    """
    RED: today, `subscription_id=None` + empty DEFAULT_SUBSCRIPTION_ID
    causes scope=`/subscriptions/`, which collapses to a malformed URL and
    Azure responds with InvalidSubscriptionId 'providers'.

    After fix: tool MUST either auto-resolve or fail-fast — never call
    `client.query.usage` with a scope that contains a trailing slash.
    """
    server = _import_server()

    cost_client = MagicMock()
    cost_client.query.usage.return_value = _fake_cost_result()

    sub_client = MagicMock()
    sub_client.subscriptions.list.return_value = [
        _FakeSub("11111111-1111-1111-1111-111111111111", "Sub A"),
    ]

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {"upn": "u"})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", ""), \
         patch.object(server, "CostManagementClient", return_value=cost_client), \
         patch.object(server, "SubscriptionClient", return_value=sub_client):
        result = _run(server.azure_cost_query(days=30, subscription_id=None))

    # The cost SDK must never be called with a scope that ends in "/" (empty sub).
    for call in cost_client.query.usage.call_args_list:
        scope = call.args[0] if call.args else call.kwargs.get("scope", "")
        assert scope.startswith("/subscriptions/"), scope
        assert scope != "/subscriptions/", "empty-sub scope = the 'providers' bug"
        assert "/subscriptions//" not in scope, "collapsed-path scope = the 'providers' bug"

    assert result["success"] is True, result

def test_cost_query_null_subscription_id_auto_resolves_and_fans_out():
    """After fix: with no sub_id + no default, tool calls SubscriptionClient and
    aggregates across every visible subscription."""
    server = _import_server()

    cost_client = MagicMock()
    cost_client.query.usage.return_value = _fake_cost_result(
        rows=[[100.0, 100.0, "2026-05-01"]],
        columns=("Cost", "CostUSD", "UsageDate"),
    )

    sub_client = MagicMock()
    sub_client.subscriptions.list.return_value = [
        _FakeSub("aaaa", "A"), _FakeSub("bbbb", "B"),
    ]

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {"upn": "u"})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", ""), \
         patch.object(server, "CostManagementClient", return_value=cost_client), \
         patch.object(server, "SubscriptionClient", return_value=sub_client):
        result = _run(server.azure_cost_query(days=30, subscription_id=None))

    assert result["success"] is True
    # One usage call per subscription, with the actual UUID baked into the scope.
    scopes = [c.args[0] for c in cost_client.query.usage.call_args_list]
    assert "/subscriptions/aaaa" in scopes
    assert "/subscriptions/bbbb" in scopes
    # Aggregated answer must mention each sub.
    assert result.get("subscription_count") == 2

def test_cost_query_explicit_subscription_id_unchanged():
    """Regression guard: passing an explicit sub_id must hit ONE subscription."""
    server = _import_server()

    cost_client = MagicMock()
    cost_client.query.usage.return_value = _fake_cost_result()

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {"upn": "u"})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", ""), \
         patch.object(server, "CostManagementClient", return_value=cost_client):
        result = _run(server.azure_cost_query(days=30, subscription_id="explicit-sub-uuid"))

    assert result["success"] is True
    assert cost_client.query.usage.call_count == 1
    scope = cost_client.query.usage.call_args.args[0]
    assert scope == "/subscriptions/explicit-sub-uuid"

def test_cost_query_auto_resolve_when_user_has_zero_subscriptions_fails_clean():
    """If user has no subs visible via OBO, fail-fast with a clear error —
    don't call the cost SDK at all."""
    server = _import_server()

    cost_client = MagicMock()
    sub_client = MagicMock()
    sub_client.subscriptions.list.return_value = []

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {"upn": "u"})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", ""), \
         patch.object(server, "CostManagementClient", return_value=cost_client), \
         patch.object(server, "SubscriptionClient", return_value=sub_client):
        result = _run(server.azure_cost_query(days=30, subscription_id=None))

    assert result["success"] is False
    assert "subscription" in result["error"].lower()
    cost_client.query.usage.assert_not_called()

# ── azure_cost_by_service ──────────────────────────────────────────────────

def test_cost_by_service_null_subscription_id_does_not_call_azure_with_empty_scope():
    """Same Q1 bug for the by-service tool. RED today."""
    server = _import_server()

    cost_client = MagicMock()
    cost_client.query.usage.return_value = _fake_cost_result(
        rows=[[42.0, "Storage"]], columns=("CostUSD", "ServiceName"))

    sub_client = MagicMock()
    sub_client.subscriptions.list.return_value = [_FakeSub("xxxx")]

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {"upn": "u"})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", ""), \
         patch.object(server, "CostManagementClient", return_value=cost_client), \
         patch.object(server, "SubscriptionClient", return_value=sub_client):
        result = _run(server.azure_cost_by_service(days=30, subscription_id=None))

    for call in cost_client.query.usage.call_args_list:
        scope = call.args[0] if call.args else call.kwargs.get("scope", "")
        assert scope != "/subscriptions/", "empty-sub scope reproduces Q1 bug"
        assert "/subscriptions//" not in scope

    assert result["success"] is True, result

def test_cost_by_service_aggregates_top_services_across_subs():
    """Auto-fan-out: aggregate top_n services across all visible subs."""
    server = _import_server()

    cost_client = MagicMock()
    # Each call returns the same shape; we'll see top services sum.
    cost_client.query.usage.return_value = _fake_cost_result(
        rows=[[10.0, "Storage"], [5.0, "Compute"]],
        columns=("CostUSD", "ServiceName"),
    )

    sub_client = MagicMock()
    sub_client.subscriptions.list.return_value = [
        _FakeSub("aaaa"), _FakeSub("bbbb"),
    ]

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {"upn": "u"})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", ""), \
         patch.object(server, "CostManagementClient", return_value=cost_client), \
         patch.object(server, "SubscriptionClient", return_value=sub_client):
        result = _run(server.azure_cost_by_service(days=30, top_n=5, subscription_id=None))

    assert result["success"] is True
    assert result.get("subscription_count") == 2
    services = {s["service"]: s["cost"] for s in result["top_services"]}
    assert services["Storage"] == 20.0  # 10 + 10
    assert services["Compute"] == 10.0  # 5 + 5
    assert result["total_cost"] == 30.0

# ── azure_cost_forecast (bonus — same family) ──────────────────────────────

def test_cost_forecast_null_subscription_id_does_not_call_azure_with_empty_scope():
    server = _import_server()

    cost_client = MagicMock()
    cost_client.forecast.usage.return_value = _fake_cost_result(rows=[[5.0]])

    sub_client = MagicMock()
    sub_client.subscriptions.list.return_value = [_FakeSub("aaaa")]

    with patch.object(server, "require_user_token", return_value=(MagicMock(), {"upn": "u"})), \
         patch.object(server, "DEFAULT_SUBSCRIPTION_ID", ""), \
         patch.object(server, "CostManagementClient", return_value=cost_client), \
         patch.object(server, "SubscriptionClient", return_value=sub_client):
        result = _run(server.azure_cost_forecast(forecast_days=14, subscription_id=None))

    for call in cost_client.forecast.usage.call_args_list:
        scope = call.args[0] if call.args else call.kwargs.get("scope", "")
        assert scope != "/subscriptions/", "empty-sub scope reproduces Q1 bug"
        assert "/subscriptions//" not in scope

    assert result["success"] is True, result
