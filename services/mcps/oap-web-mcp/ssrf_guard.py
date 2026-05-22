# Proprietary and confidential. Unauthorized copying prohibited.

"""SSRF guard for oap-web-mcp (substrate fix S3 of V3 Enterprise Chatmode plan).

Pre-flight DNS resolves the target hostname; rejects RFC1918, link-local,
loopback, reserved/multicast IPv4 + IPv6, IMDS literal hostnames, and
``*.svc.cluster.local`` suffix. Used by web_fetch and friends BEFORE httpx,
and re-checked on every redirect hop to prevent rebinding-to-IMDS-via-302.

Why a custom guard rather than an httpx transport hook:
- httpx's ``follow_redirects=True`` does NOT re-validate against any guard;
  a 302 → 169.254.169.254 is silently followed.
- The fetch tools must therefore disable httpx redirect handling and walk
  the redirect chain manually, calling ``deny_if_private`` on every hop.

Reasons returned (stable strings; logged + included in user-facing error):
- ``imds``: 169.254.169.254, metadata.google.internal, metadata.azure.com,
  or any 169.254.x.x link-local IP / IPv6 fe80::/10.
- ``rfc1918``: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, IPv6 ULA fc00::/7.
- ``loopback``: 127.0.0.0/8, ::1.
- ``cluster_local``: hostname ends in ``.svc.cluster.local``.
- ``reserved``: reserved or multicast IPv4/IPv6.
- ``invalid_host``: URL had no parseable host.
- ``dns_failure``: hostname resolution failed.
- ``too_many_redirects``: redirect chain exceeded ``max_redirects``
  (raised by the caller, not this module — included here for vocabulary
  completeness).
"""

import asyncio
import ipaddress
from typing import Iterable
from urllib.parse import urlparse

class FetchError(Exception):
    """Structured SSRF / fetch denial.

    ``reason`` is a short stable identifier (see module docstring) so callers
    can branch on the failure mode without parsing strings. ``target`` is the
    specific host or IP that triggered the rejection.
    """

    def __init__(self, reason: str, target: str):
        super().__init__(f"fetch blocked: {reason} (target={target})")
        self.reason = reason
        self.target = target

# Literal IMDS hostnames — short-circuit before DNS to avoid leaking the
# probe to a resolver and to handle environments where these hostnames
# resolve to public IPs (cloud providers special-case these in metadata
# networks, but we do not want to depend on that).
IMDS_HOSTS = frozenset({
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.azure.com",
})

async def deny_if_private(url: str) -> None:
    """Raise :class:`FetchError` if the URL targets a private/IMDS/cluster-local host.

    Resolves the hostname via :func:`asyncio.AbstractEventLoop.getaddrinfo` and
    checks every returned address. Hostname-as-IP is detected and checked
    directly (no DNS round-trip).

    The function returns ``None`` on success — callers should treat any
    raised :class:`FetchError` as a hard denial.
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not host:
        raise FetchError("invalid_host", url)
    if host in IMDS_HOSTS:
        raise FetchError("imds", host)
    if host.endswith(".svc.cluster.local"):
        raise FetchError("cluster_local", host)

    # Try parsing as a literal IP first (no DNS round-trip needed).
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None

    if ip is not None:
        _check_ip(ip, host)
        return

    # DNS-resolve and check every returned address.
    try:
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(host, None)
    except Exception as e:
        raise FetchError("dns_failure", host) from e

    for info in infos:
        ip_str = info[4][0]
        # Strip IPv6 zone-id if present (e.g., "fe80::1%eth0").
        if "%" in ip_str:
            ip_str = ip_str.split("%", 1)[0]
        try:
            resolved = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        _check_ip(resolved, ip_str)

def _check_ip(ip: ipaddress._BaseAddress, target: str) -> None:
    """Raise :class:`FetchError` on private / IMDS / loopback / reserved IPs.

    ORDER MATTERS:
    - ``is_link_local`` is checked FIRST because 169.254.0.0/16 is also
      ``is_private``; we want IMDS-class addresses labeled ``imds``, not
      ``rfc1918``.
    - ``is_loopback`` (127.0.0.0/8, ::1) is also covered by ``is_private``
      in the IPv4 case, so we check it BEFORE ``is_private`` to label it
      ``loopback`` rather than ``rfc1918``.
    - ``is_private`` then catches the actual RFC1918 / IPv6 ULA cases.
    - ``is_reserved`` / ``is_multicast`` last.
    """
    if ip.is_link_local:
        raise FetchError("imds", target)
    if ip.is_loopback:
        raise FetchError("loopback", target)
    if ip.is_private:
        raise FetchError("rfc1918", target)
    if ip.is_reserved or ip.is_multicast:
        raise FetchError("reserved", target)

__all__: Iterable[str] = ("FetchError", "IMDS_HOSTS", "deny_if_private")
