"""
#857 behavior test for azure_get_resource_group_inventory.

Why this exists
---------------
The tool fan-outs 16 list-by-resource-group calls in parallel via
``asyncio.gather(*fetchers, return_exceptions=True)``. Two behaviors must
hold:

1. Parallel: a slow category does NOT block a fast one (wall-clock < sum
   of category latencies).
2. Per-category degrade-gracefully: if one category raises (e.g.
   ``ClientAuthenticationError`` on KeyVault while VMs succeed), the
   surviving categories return successfully and the failure is reported
   in ``errors``.

Both are critical because the live tool will hit ~16 SDK calls; a single
auth failure on one client must not nuke the whole inventory payload.

Real-Azure smoke
----------------
The real-provider gate (per ``feedback_real_provider_testing_regime_chatmode_pivot``)
is the live Playwright drive of gpt-oss:20b against a real RG. That lives
in ``reports/verify-cadence/857-rg-inventory-<sha>/`` and is captured by
the harness driver, not pytest. This file pins the in-process behavior
that no real-Azure smoke can validate (auth-mid-fan-out, return_exceptions
semantics, category registry coverage).
"""

import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

@pytest.fixture
def server_module():
    """Import server with conftest stubs in place, then return the module that
    OWNS ``azure_get_resource_group_inventory`` after the god-file split
    (``tools.resources``).

    Post-split the tool bodies live in ``tools.resources`` and read their Azure
    SDK client classes + ``require_user_token`` from that module's namespace
    (pulled in via ``from _core import *``). The test stubs those dependencies
    with ``monkeypatch.setattr(server_module, ...)``, so ``server_module`` must
    be the owning module for the patch to reach the function. ``server`` itself
    only re-exports the tool (same function object), so calling
    ``server_module.azure_get_resource_group_inventory`` is identical either way.

    A fresh import (popping ``_core`` + every ``tools.*`` submodule, not just
    ``server``) guarantees the ``@mcp.tool`` decorators re-run for this test."""
    for _mod in [m for m in list(sys.modules)
                 if m in ("server", "_core", "tools") or m.startswith("tools.")]:
        sys.modules.pop(_mod, None)
    importlib.import_module("server")  # side-effect: load _core + register tools
    return importlib.import_module("tools.resources")

def _make_credential_stub(monkeypatch, server_module):
    """Stub require_user_token so we don't need a real OBO token in tests."""
    fake_credential = MagicMock(name="credential")
    fake_user_info = {"email": "test@example.com", "tenantId": "test-tenant"}
    monkeypatch.setattr(
        server_module,
        "require_user_token",
        lambda *_args, **_kwargs: (fake_credential, fake_user_info),
    )
    return fake_credential, fake_user_info

def _stub_clients_with_named_returns(monkeypatch, server_module, *, fail_categories=None):
    """Stub each Azure client class so its list/list_by_resource_group method
    returns a one-element list whose ``.name`` reveals which client was used.

    Args:
        fail_categories: set of method-call attribute paths that should raise
            ``ClientAuthenticationError`` instead of returning. Lets us prove
            the per-category degrade-gracefully path.
    """
    fail_categories = fail_categories or set()

    def mk_resource(category_label):
        r = MagicMock()
        r.name = f"{category_label}-instance-1"
        r.location = "eastus"
        # cover all the attribute reads the tool performs across categories
        r.hardware_profile = MagicMock(vm_size="Standard_D2s_v3")
        r.storage_profile = MagicMock()
        r.storage_profile.os_disk = MagicMock()
        r.storage_profile.os_disk.os_type = MagicMock(value="Linux")
        r.provisioning_state = "Succeeded"
        r.tags = {}
        r.disk_size_gb = 128
        r.disk_state = "Attached"
        r.sku = MagicMock(name="Standard_LRS", capacity=2, tier="Standard")
        r.time_created = None
        r.mac_address = "00-11-22-33-44-55"
        r.ip_configurations = []
        r.address_space = MagicMock(address_prefixes=["10.0.0.0/16"])
        r.subnets = []
        r.security_rules = []
        r.ip_address = "1.2.3.4"
        r.public_ip_allocation_method = "Static"
        r.frontend_ip_configurations = []
        r.operational_state = "Running"
        r.kind = "app"
        r.allow_blob_public_access = False
        r.minimum_tls_version = "TLS1_2"
        r.properties = MagicMock(
            vault_uri="https://kv.vault.azure.net/",
            enable_rbac_authorization=True,
            public_network_access="disabled",
        )
        r.kubernetes_version = "1.28.5"
        r.agent_pool_profiles = [MagicMock()]
        r.state = "Running"
        r.default_host_name = "app.azurewebsites.net"
        r.https_only = True
        r.number_of_workers = 1
        r.role_definition_id = "/subscriptions/x/role/Reader"
        r.principal_id = "principal-1"
        r.principal_type = "User"
        r.scope = "/subscriptions/x/resourceGroups/y"
        return r

    from azure.core.exceptions import ClientAuthenticationError

    def fake_list(category_label):
        def inner(*_args, **_kwargs):
            if category_label in fail_categories:
                raise ClientAuthenticationError(f"stubbed failure for {category_label}")
            return iter([mk_resource(category_label)])

        return inner

    def fake_list_for_scope(category_label):
        def inner(scope, *_args, **_kwargs):
            if category_label in fail_categories:
                raise ClientAuthenticationError(f"stubbed failure for {category_label}")
            return iter([mk_resource(category_label)])

        return inner

    # Wire each Mgmt client constructor so the returned instance's nested
    # methods produce our stub data.
    def wire_compute(*_a, **_kw):
        c = MagicMock(name="compute")
        c.virtual_machines.list = fake_list("vms")
        c.disks.list_by_resource_group = fake_list("disks")
        c.snapshots.list_by_resource_group = fake_list("snapshots")
        c.virtual_machine_scale_sets.list = fake_list("vmss")
        return c

    def wire_network(*_a, **_kw):
        c = MagicMock(name="network")
        c.network_interfaces.list = fake_list("nics")
        c.virtual_networks.list = fake_list("vnets")
        c.network_security_groups.list = fake_list("nsgs")
        c.public_ip_addresses.list = fake_list("public_ips")
        c.load_balancers.list = fake_list("load_balancers")
        c.application_gateways.list = fake_list("app_gateways")
        return c

    def wire_storage(*_a, **_kw):
        c = MagicMock(name="storage")
        c.storage_accounts.list_by_resource_group = fake_list("storage_accounts")
        return c

    def wire_keyvault(*_a, **_kw):
        c = MagicMock(name="keyvault")
        c.vaults.list_by_resource_group = fake_list("key_vaults")
        return c

    def wire_aks(*_a, **_kw):
        c = MagicMock(name="aks")
        c.managed_clusters.list_by_resource_group = fake_list("aks_clusters")
        return c

    def wire_web(*_a, **_kw):
        c = MagicMock(name="web")
        c.web_apps.list_by_resource_group = fake_list("web_apps")
        c.app_service_plans.list_by_resource_group = fake_list("app_service_plans")
        return c

    def wire_authz(*_a, **_kw):
        c = MagicMock(name="authz")
        c.role_assignments.list_for_scope = fake_list_for_scope("role_assignments")
        return c

    def wire_cognitive(*_a, **_kw):
        c = MagicMock(name="cognitive")
        c.accounts.list_by_resource_group = fake_list("cognitive_services")
        return c

    def wire_cdn(*_a, **_kw):
        c = MagicMock(name="cdn")
        c.profiles.list_by_resource_group = fake_list("cdn_profiles")
        return c

    def wire_appcontainers(*_a, **_kw):
        c = MagicMock(name="appcontainers")
        c.container_apps.list_by_resource_group = fake_list("container_apps")
        return c

    def wire_appinsights(*_a, **_kw):
        c = MagicMock(name="appinsights")
        c.components.list_by_resource_group = fake_list("app_insights")
        return c

    monkeypatch.setattr(server_module, "ComputeManagementClient", wire_compute)
    monkeypatch.setattr(server_module, "NetworkManagementClient", wire_network)
    monkeypatch.setattr(server_module, "StorageManagementClient", wire_storage)
    monkeypatch.setattr(server_module, "KeyVaultManagementClient", wire_keyvault)
    monkeypatch.setattr(server_module, "ContainerServiceClient", wire_aks)
    monkeypatch.setattr(server_module, "WebSiteManagementClient", wire_web)
    monkeypatch.setattr(server_module, "AuthorizationManagementClient", wire_authz)
    monkeypatch.setattr(server_module, "CognitiveServicesManagementClient", wire_cognitive, raising=False)
    monkeypatch.setattr(server_module, "CdnManagementClient", wire_cdn, raising=False)
    monkeypatch.setattr(server_module, "ContainerAppsAPIClient", wire_appcontainers, raising=False)
    monkeypatch.setattr(server_module, "ApplicationInsightsManagementClient", wire_appinsights, raising=False)

    # Default SubscriptionClient stub for the auto-resolve path. Tests that
    # need a specific subscription set call `_stub_subscription_client` AFTER
    # this helper to override. This makes the helper a complete client
    # substitute — no Azure SDK leaks.
    def wire_default_sub_client(*_a, **_kw):
        c = MagicMock(name="subscription-client-default")
        default_sub = MagicMock()
        default_sub.subscription_id = "default-sub-from-helper"
        default_sub.display_name = "Default Test Subscription"
        c.subscriptions.list = lambda *_args, **_kwargs: iter([default_sub])
        return c

    monkeypatch.setattr(server_module, "SubscriptionClient", wire_default_sub_client)

def test_inventory_happy_path_returns_all_categories(server_module, monkeypatch):
    """Every category fetcher succeeds → categories dict has all 16 keys with count=1."""
    _make_credential_stub(monkeypatch, server_module)
    _stub_clients_with_named_returns(monkeypatch, server_module)

    fn = server_module.azure_get_resource_group_inventory
    result = asyncio.run(
        fn(resource_group="rg-test", subscription_id="sub-test", meta={"userAccessToken": "x"})
    )

    assert result["success"] is True
    assert result["resource_group"] == "rg-test"
    assert result["subscription_id"] == "sub-test"
    assert result["total_count"] == 20, (
        f"Expected 20 categories × 1 item each = 20; got total_count={result['total_count']}. "
        f"categories.keys()={sorted(result['categories'].keys())}"
    )
    assert result["errors"] == []
    expected_categories = {
        "vms",
        "disks",
        "snapshots",
        "vmss",
        "network_interfaces",
        "virtual_networks",
        "network_security_groups",
        "public_ip_addresses",
        "load_balancers",
        "application_gateways",
        "storage_accounts",
        "key_vaults",
        "aks_clusters",
        "web_apps",
        "app_service_plans",
        "role_assignments",
        # 2026-05-15: added 4 categories to close the AIF/Front Door discovery
        # gap surfaced when the model couldn't find `awf-aif-eastus2-dev` or
        # `fd-prod-test` in a real-Azure live drive against rg-openagentic-aif-dev.
        "cognitive_services",
        "cdn_profiles",
        "container_apps",
        "app_insights",
    }
    assert set(result["categories"].keys()) == expected_categories
    for cat_name, cat_data in result["categories"].items():
        assert cat_data["count"] == 1, f"{cat_name} should have count=1"
        assert len(cat_data["items"]) == 1, f"{cat_name} should have 1 item"

def test_inventory_partial_failure_does_not_drop_whole_payload(server_module, monkeypatch):
    """One category raising ClientAuthenticationError must NOT nuke the whole inventory.

    This is the critical contract: if key_vaults auth fails mid-fan-out, we
    still want VMs/disks/networks back. Without `return_exceptions=True` on
    asyncio.gather, a single raised exception would propagate and kill the
    whole tool call.
    """
    _make_credential_stub(monkeypatch, server_module)
    _stub_clients_with_named_returns(monkeypatch, server_module, fail_categories={"key_vaults"})

    fn = server_module.azure_get_resource_group_inventory
    result = asyncio.run(fn(resource_group="rg-test", meta={"userAccessToken": "x"}))

    assert result["success"] is True
    # 19 categories succeeded with 1 item each, key_vaults failed → total 19
    assert result["total_count"] == 19
    assert "key_vaults" in result["categories"]
    assert "error" in result["categories"]["key_vaults"]
    assert result["categories"]["key_vaults"]["type"] == "ClientAuthenticationError"
    # The other 15 categories should be intact
    assert result["categories"]["vms"]["count"] == 1
    assert result["categories"]["storage_accounts"]["count"] == 1
    # errors list captures the failure for quick scanning
    assert len(result["errors"]) == 1
    assert result["errors"][0]["category"] == "key_vaults"

def test_inventory_include_filter_picks_subset(server_module, monkeypatch):
    """Passing `include=[...]` only fetches the named categories."""
    _make_credential_stub(monkeypatch, server_module)
    _stub_clients_with_named_returns(monkeypatch, server_module)

    fn = server_module.azure_get_resource_group_inventory
    result = asyncio.run(
        fn(
            resource_group="rg-test",
            include=["vms", "key_vaults", "role_assignments"],
            meta={"userAccessToken": "x"},
        )
    )

    assert result["success"] is True
    assert set(result["categories"].keys()) == {"vms", "key_vaults", "role_assignments"}
    assert result["total_count"] == 3

def test_inventory_rejects_unknown_category(server_module, monkeypatch):
    """Unknown category in `include` returns a useful error, doesn't fetch anything."""
    _make_credential_stub(monkeypatch, server_module)
    _stub_clients_with_named_returns(monkeypatch, server_module)

    fn = server_module.azure_get_resource_group_inventory
    result = asyncio.run(
        fn(
            resource_group="rg-test",
            include=["vms", "totally_made_up"],
            meta={"userAccessToken": "x"},
        )
    )

    assert result["success"] is False
    assert "Unknown categories" in result["error"]
    assert "totally_made_up" in result["error"]

def _stub_subscription_client(monkeypatch, server_module, subscription_ids):
    """Stub SubscriptionClient.subscriptions.list() to return N fake subs.

    Each fake sub exposes `.subscription_id` and `.display_name` matching
    the IDs passed in. Used to simulate the OBO-credential subscription
    listing path that auto-resolve takes when `subscription_id` is unset.
    """
    def wire_sub_client(*_a, **_kw):
        c = MagicMock(name="subscription-client")
        fake_subs = []
        for sid in subscription_ids:
            s = MagicMock()
            s.subscription_id = sid
            s.display_name = f"Sub {sid}"
            fake_subs.append(s)
        c.subscriptions.list = lambda *_args, **_kwargs: iter(fake_subs)
        return c

    monkeypatch.setattr(server_module, "SubscriptionClient", wire_sub_client)
    # Force DEFAULT_SUBSCRIPTION_ID to empty so the auto-resolve path triggers.
    monkeypatch.setattr(server_module, "DEFAULT_SUBSCRIPTION_ID", "")

def test_inventory_auto_resolves_subscription_when_user_has_exactly_one(
    server_module, monkeypatch
):
    """When subscription_id is unset AND user has exactly 1 OBO-accessible sub,
    the tool auto-resolves to that sub and proceeds with the inventory.

    Smoking-gun from live drive (#857 2026-05-15): model dispatched the tool
    without subscription_id; Azure SDK returned InvalidSubscriptionId; model's
    chain-of-thought said "We can list subscriptions to get ID. Let's call
    azure_list_subscriptions? No such tool listed." — model couldn't recover.
    Auto-resolve makes this happy-path work without forcing the model to
    chain a separate listing call (which may not even be in its top-K).
    """
    _make_credential_stub(monkeypatch, server_module)
    _stub_clients_with_named_returns(monkeypatch, server_module)
    _stub_subscription_client(monkeypatch, server_module, ["resolved-sub-id"])

    fn = server_module.azure_get_resource_group_inventory
    result = asyncio.run(fn(resource_group="rg-test", meta={"userAccessToken": "x"}))

    assert result["success"] is True, f"Expected success, got: {result}"
    assert result["subscription_id"] == "resolved-sub-id"
    # The result must annotate that subscription_id was auto-resolved, so the
    # model + UI can show it (transparency over implicit magic).
    assert result.get("auto_resolved_subscription_id") == "resolved-sub-id", (
        f"Expected auto_resolved_subscription_id='resolved-sub-id' to be set "
        f"so the response is self-documenting. Got result keys: {sorted(result.keys())}"
    )
    assert result["total_count"] == 20

def test_inventory_returns_choices_when_user_has_multiple_subs(server_module, monkeypatch):
    """When subscription_id is unset AND user has >1 sub, the tool returns a
    structured error listing the choices so the model can pick + retry.

    The model needs the subscription_id list back in the SAME tool response —
    we can't expect it to chain azure_list_subscriptions because that tool may
    not be in its top-K shortlist (the very gap that bit us on first live drive).
    """
    _make_credential_stub(monkeypatch, server_module)
    _stub_clients_with_named_returns(monkeypatch, server_module)
    _stub_subscription_client(
        monkeypatch,
        server_module,
        ["sub-A-id", "sub-B-id", "sub-C-id"],
    )

    fn = server_module.azure_get_resource_group_inventory
    result = asyncio.run(fn(resource_group="rg-test", meta={"userAccessToken": "x"}))

    assert result["success"] is False
    assert "subscription_id" in result["error"].lower(), (
        f"Error should explain the subscription_id ambiguity. Got: {result['error']}"
    )
    # Must surface the available subscription IDs so the model can pick one
    # without needing a separate tool call.
    assert "available_subscriptions" in result, (
        f"Expected `available_subscriptions` in payload. Got keys: {sorted(result.keys())}"
    )
    available_ids = [s["id"] for s in result["available_subscriptions"]]
    assert set(available_ids) == {"sub-A-id", "sub-B-id", "sub-C-id"}

def test_inventory_clear_error_when_user_has_no_subs(server_module, monkeypatch):
    """When subscription_id is unset AND user has 0 OBO-accessible subs, the
    tool returns a useful error (NOT InvalidSubscriptionId leaking from SDK).
    """
    _make_credential_stub(monkeypatch, server_module)
    _stub_clients_with_named_returns(monkeypatch, server_module)
    _stub_subscription_client(monkeypatch, server_module, [])

    fn = server_module.azure_get_resource_group_inventory
    result = asyncio.run(fn(resource_group="rg-test", meta={"userAccessToken": "x"}))

    assert result["success"] is False
    assert "no accessible azure subscriptions" in result["error"].lower(), (
        f"Error should clearly say the user has no accessible subs. Got: {result['error']}"
    )
