"""Request checks for the `/wp/api/ai/*` routes, on top of ComfyUI's own.

ComfyUI has no login, and its origin middleware is not enough for routes
that hold an API key and can spend credits:

- it compares Origin with Host only when Host is a loopback address, so a
  DNS-rebinding page (a public name that resolves to 127.0.0.1) passes;
- it lets `Origin: null` through (sandboxed iframes, `data:` pages);
- `--enable-cors-header` replaces it with one that allows any site.

So every AI route checks, whatever ComfyUI's flags are:

1. `Sec-Fetch-Site: cross-site` is refused.
2. An `Origin` must be the same host and port as `Host`; `null` is refused.
3. `Host` must look local (an IP address, localhost, a name with no dot, or
   a LAN suffix like `.local`) or be listed in ``WP_AI_ALLOWED_HOSTS``
   (comma-separated, for a reverse-proxy domain). This is what stops DNS
   rebinding, the same fix Ollama made for CVE-2024-28224.
4. A request with a body must say `Content-Type: application/json`, so a
   cross-site page can't send one without a CORS preflight.

See `/pr-drafts/ai-security.md`.
"""
from __future__ import annotations

import functools
import ipaddress
import os
import urllib.parse
from collections.abc import Awaitable, Callable

from aiohttp import web

from wp_api._helpers import json_error

#: Names that only resolve on a LAN or this machine, so a rebinding
#: attacker can't own them.
_LOCAL_SUFFIXES = (".localhost", ".local", ".lan", ".home", ".home.arpa", ".internal",
                   ".localdomain")


def _split_host(value: str) -> tuple[str, int | None]:
    """`host[:port]` (IPv6 in brackets) → (host, port or None)."""
    parts = urllib.parse.urlsplit("//" + value.strip())
    try:
        port = parts.port
    except ValueError:
        port = -1
    return (parts.hostname or "").lower(), port


def _allowed_hosts() -> set[str]:
    raw = os.environ.get("WP_AI_ALLOWED_HOSTS", "")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def host_allowed(host_header: str) -> bool:
    host, port = _split_host(host_header)
    if not host or port == -1:
        return False
    extra = _allowed_hosts()
    if "*" in extra or host in extra or host_header.strip().lower() in extra:
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    if host == "localhost" or "." not in host:
        return True
    return host.endswith(_LOCAL_SUFFIXES)


def _same_origin(origin: str, host_header: str) -> bool:
    parts = urllib.parse.urlsplit(origin)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        o_port = parts.port
    except ValueError:
        return False
    host, port = _split_host(host_header)
    if parts.hostname.lower() != host:
        return False
    # Behind a TLS proxy the Host has no port while the scheme differs from
    # ours, so compare explicit ports only.
    if port is None:
        return o_port is None
    default = 443 if parts.scheme == "https" else 80
    return (o_port or default) == port


def refusal(request: web.Request) -> web.Response | None:
    """The response that refuses this request, or None when it may go on."""
    if request.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
        return json_error("refused: the request came from another website", status=403)
    host = request.headers.get("Host", "")
    if not host_allowed(host):
        return json_error(
            f"refused: {_split_host(host)[0] or 'this address'} isn't a local address. If you "
            "reach ComfyUI through a domain name, add it to the WP_AI_ALLOWED_HOSTS "
            "environment variable and restart ComfyUI.", status=403,
        )
    origin = request.headers.get("Origin")
    if origin is not None and not _same_origin(origin, host):
        return json_error("refused: the request came from another page's origin", status=403)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.body_exists:
        ctype = request.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if ctype != "application/json":
            return json_error("refused: send JSON (Content-Type: application/json)", status=415)
    return None


def guarded(
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> Callable[[web.Request], Awaitable[web.StreamResponse]]:
    @functools.wraps(handler)
    async def wrapped(request: web.Request) -> web.StreamResponse:
        refused = refusal(request)
        if refused is not None:
            return refused
        return await handler(request)

    return wrapped
