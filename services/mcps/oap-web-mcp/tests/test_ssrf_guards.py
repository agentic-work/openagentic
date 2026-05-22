# Proprietary and confidential. Unauthorized copying prohibited.

"""Tests for ssrf_guard.py (substrate fix S3 of V3 Enterprise Chatmode plan).

The web_fetch / web_search tools used to fetch arbitrary URLs with
``follow_redirects=True`` and no allow/deny list, which let the chatmode
fetch http://169.254.169.254/ (IMDS), http://10.x.x.x/ (RFC1918),
http://*.svc.cluster.local/ (in-cluster k8s), or get redirected through
any of those. ``deny_if_private`` is the pre-flight + per-redirect-hop
guard that closes those holes.

Test strategy: assert FetchError is raised with a structured ``reason``
field for every class of denied target, and that public targets pass.
The literal IMDS-host short-circuit needs no DNS; literal IPs are parsed
directly; only public hostnames trigger a real DNS round-trip.
"""

import os
import sys

import pytest

# Make the package root importable when running pytest from the oap-web-mcp dir
# (the package is flat — server.py and ssrf_guard.py both live at root).
HERE = os.path.dirname(os.path.abspath(__file__))
PKG_ROOT = os.path.abspath(os.path.join(HERE, ".."))
if PKG_ROOT not in sys.path:
    sys.path.insert(0, PKG_ROOT)

from ssrf_guard import deny_if_private, FetchError  # noqa: E402

class TestDenyIfPrivate:
    @pytest.mark.asyncio
    async def test_rejects_imds_169(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://169.254.169.254/latest/meta-data/")
        assert exc.value.reason == "imds"

    @pytest.mark.asyncio
    async def test_rejects_metadata_google_internal(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://metadata.google.internal/")
        assert exc.value.reason == "imds"

    @pytest.mark.asyncio
    async def test_rejects_metadata_azure_com(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://metadata.azure.com/")
        assert exc.value.reason == "imds"

    @pytest.mark.asyncio
    async def test_rejects_rfc1918_10(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://10.0.0.1/")
        assert exc.value.reason == "rfc1918"

    @pytest.mark.asyncio
    async def test_rejects_rfc1918_172(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://172.20.5.5/")
        assert exc.value.reason == "rfc1918"

    @pytest.mark.asyncio
    async def test_rejects_rfc1918_192(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://192.168.1.1/")
        assert exc.value.reason == "rfc1918"

    @pytest.mark.asyncio
    async def test_rejects_loopback_127(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://127.0.0.1/")
        assert exc.value.reason == "loopback"

    @pytest.mark.asyncio
    async def test_rejects_link_local_169(self):
        # 169.254.x.x but not the IMDS literal — still link-local, label as imds.
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://169.254.1.1/")
        assert exc.value.reason == "imds"

    @pytest.mark.asyncio
    async def test_rejects_svc_cluster_local(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://api.agentic-dev.svc.cluster.local/")
        assert exc.value.reason == "cluster_local"

    @pytest.mark.asyncio
    async def test_rejects_invalid_host(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http:///path-only")
        assert exc.value.reason == "invalid_host"

    @pytest.mark.asyncio
    async def test_rejects_ipv6_loopback(self):
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://[::1]/")
        assert exc.value.reason == "loopback"

    @pytest.mark.asyncio
    async def test_rejects_ipv6_ula(self):
        # fc00::/7 is ULA — is_private in ipaddress.
        with pytest.raises(FetchError) as exc:
            await deny_if_private("http://[fc00::1]/")
        assert exc.value.reason == "rfc1918"

    @pytest.mark.asyncio
    async def test_allows_public_ip_literal(self):
        # 8.8.8.8 (Google DNS) is public; literal IP path skips DNS round-trip.
        await deny_if_private("http://8.8.8.8/")

    @pytest.mark.asyncio
    async def test_allows_public_hostname_via_dns(self):
        # Public hostname — exercises the DNS round-trip path. If the test
        # environment has no DNS this will surface as FetchError(dns_failure)
        # which we want to know about.
        await deny_if_private("https://example.com/")

class TestFetchWithSsrfGuard:
    """Integration tests for the manual-redirect httpx wrapper.

    These exercise the redirect re-validation path that closes the
    rebinding-via-302 hole — the original bug was that
    ``httpx.AsyncClient(follow_redirects=True)`` silently followed a 302 →
    169.254.169.254. We use ``httpx.MockTransport`` to inject canned 30x
    responses and assert the guard fires per hop.
    """

    @pytest.mark.asyncio
    async def test_rejects_redirect_to_imds(self, monkeypatch):
        """Public start URL → 302 to IMDS → must raise FetchError(imds)."""
        import httpx
        from server import fetch_with_ssrf_guard

        def handler(request: httpx.Request) -> httpx.Response:
            # First (and only legitimate) hop: respond with a 302 → IMDS.
            if request.url.host == "example.com":
                return httpx.Response(
                    302,
                    headers={"location": "http://169.254.169.254/latest/meta-data/"},
                )
            # If guard ever lets us through to IMDS the test fails loud.
            return httpx.Response(200, text="LEAK: should never reach IMDS")

        transport = httpx.MockTransport(handler)

        # Patch httpx.AsyncClient so fetch_with_ssrf_guard's internal client
        # uses our MockTransport regardless of constructor args.
        real_client = httpx.AsyncClient

        def _patched_client(*args, **kwargs):
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        monkeypatch.setattr("server.httpx.AsyncClient", _patched_client)

        with pytest.raises(FetchError) as exc:
            await fetch_with_ssrf_guard("https://example.com/")
        assert exc.value.reason == "imds"

    @pytest.mark.asyncio
    async def test_rejects_redirect_to_rfc1918(self, monkeypatch):
        """Public start URL → 302 to 10.0.0.1 → must raise FetchError(rfc1918)."""
        import httpx
        from server import fetch_with_ssrf_guard

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "example.com":
                return httpx.Response(
                    302,
                    headers={"location": "http://10.0.0.1/internal-admin"},
                )
            return httpx.Response(200, text="LEAK")

        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def _patched_client(*args, **kwargs):
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        monkeypatch.setattr("server.httpx.AsyncClient", _patched_client)

        with pytest.raises(FetchError) as exc:
            await fetch_with_ssrf_guard("https://example.com/")
        assert exc.value.reason == "rfc1918"

    @pytest.mark.asyncio
    async def test_rejects_initial_imds_url(self, monkeypatch):
        """Pre-flight check should fire before any HTTP traffic happens."""
        from server import fetch_with_ssrf_guard

        with pytest.raises(FetchError) as exc:
            await fetch_with_ssrf_guard("http://169.254.169.254/latest/meta-data/")
        assert exc.value.reason == "imds"

    @pytest.mark.asyncio
    async def test_allows_public_no_redirect(self, monkeypatch):
        """Public URL with 200 response should pass through cleanly."""
        import httpx
        from server import fetch_with_ssrf_guard

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="hello world")

        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def _patched_client(*args, **kwargs):
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        monkeypatch.setattr("server.httpx.AsyncClient", _patched_client)

        response = await fetch_with_ssrf_guard("https://example.com/")
        assert response.status_code == 200
        assert response.text == "hello world"

    @pytest.mark.asyncio
    async def test_caps_redirect_chain(self, monkeypatch):
        """Infinite-redirect chain bounded at max_redirects → too_many_redirects."""
        import httpx
        from server import fetch_with_ssrf_guard

        # Each hop redirects to a different public host (no SSRF trip).
        chain = ["https://a.example.com/", "https://b.example.com/",
                 "https://c.example.com/", "https://d.example.com/",
                 "https://e.example.com/", "https://f.example.com/",
                 "https://g.example.com/", "https://h.example.com/"]

        def handler(request: httpx.Request) -> httpx.Response:
            # Find the next hop in the chain; if past the end, redirect to itself.
            current = str(request.url)
            for i, link in enumerate(chain):
                if current.startswith(link):
                    nxt = chain[i + 1] if i + 1 < len(chain) else chain[-1]
                    return httpx.Response(302, headers={"location": nxt})
            return httpx.Response(302, headers={"location": chain[-1]})

        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def _patched_client(*args, **kwargs):
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        monkeypatch.setattr("server.httpx.AsyncClient", _patched_client)

        with pytest.raises(FetchError) as exc:
            await fetch_with_ssrf_guard(chain[0], max_redirects=3)
        assert exc.value.reason == "too_many_redirects"
