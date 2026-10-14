"""The chat's two web reads beyond search, both opt-in and allowed per call
(or always, when the user chose that in Settings › AI assistant):

- **read_result**: the text of one page from a search the user already
  allowed in this chat. Built in, it is a plain GET kept to its visible
  text (``engine.ai.web_read.page_text``): public addresses only (no
  localhost, LAN or link-local, checked on every hop and at connect time),
  at most 3 redirects, HTML or plain text only, 2 MB read. With Crawl4AI
  or Firecrawl the user's own (or Firecrawl's hosted) server fetches and
  renders it instead; its key is bound to its host.
- **danbooru**: a read-only lookup of one tag on danbooru.donmai.us: tag
  info, alias, implications, wiki text and related tags. JSON endpoints
  only, never posts or images, a descriptive User-Agent and at least one
  second between requests (Danbooru's terms forbid overburdening the
  site; its help asks API users to stay well under 10 requests a second).

Both return text labelled as untrusted data for the model.
See `/pr-drafts/ai-knowledge-packs.md` §7.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
import time
import urllib.parse
from typing import Any

import aiohttp
from aiohttp.abc import AbstractResolver

try:
    from aiohttp.abc import ResolveResult
except ImportError:  # aiohttp before 3.9 typed it as a plain dict
    ResolveResult = dict  # type: ignore[misc,assignment]

from engine.ai import web_read
from wp_api import _ai_client as client

_TIMEOUT = aiohttp.ClientTimeout(total=25, sock_connect=8)
MAX_BYTES = 2 * 1024 * 1024
MAX_HOPS = 3
_TEXT_TYPES = ("text/html", "application/xhtml+xml", "text/plain")
_UA = ("ComfyUI-Wildcard-Pipeline (AI assistant page reader; "
       "+https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline)")

DANBOORU = "https://danbooru.donmai.us"
_DANBOORU_UA = ("ComfyUI-Wildcard-Pipeline/AI tag lookup "
                "(+https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline)")
#: Seconds between two Danbooru requests from this ComfyUI.
DANBOORU_GAP = 1.0
_danbooru_lock = asyncio.Lock()
_danbooru_last = 0.0


class WebError(client.AIError):
    """A read that couldn't be done; the message is for the user and model."""


# ── Public addresses only (built-in reader) ──────────────────────────────

def _public_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def _check_url(url: str) -> urllib.parse.SplitResult:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise WebError("only http and https pages can be read")
    if parts.username or parts.password:
        raise WebError("that link carries a login; it isn't read")
    host = parts.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith((".localhost", ".local", ".lan", ".internal",
                                            ".home.arpa")) or "." not in host.strip("[]"):
        raise WebError("that page is on a local network; the reader only opens public pages")
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return parts
    if not _public_ip(host.strip("[]")):
        raise WebError("that page is on a local network; the reader only opens public pages")
    return parts


class _PublicResolver(AbstractResolver):
    """Resolves like the default resolver and refuses private answers, so a
    name can't point the reader at the user's network (also after a DNS
    change between the check and the connect)."""

    def __init__(self) -> None:
        self._inner = aiohttp.ThreadedResolver()

    async def resolve(self, host: str, port: int = 0,
                      family: socket.AddressFamily = socket.AF_INET) -> list[ResolveResult]:
        found = await self._inner.resolve(host, port, family)
        ok = [r for r in found if _public_ip(str(r["host"]))]
        if not ok:
            raise OSError(f"{host} is not a public address")
        return ok

    async def close(self) -> None:
        await self._inner.close()


def _reader_session() -> aiohttp.ClientSession:
    # No proxy from the environment here: the resolver check must see the
    # real address.
    return aiohttp.ClientSession(timeout=_TIMEOUT, trust_env=False,
                                 connector=aiohttp.TCPConnector(resolver=_PublicResolver()))


async def _read_body(resp: aiohttp.ClientResponse) -> bytes:
    chunks: list[bytes] = []
    total = 0
    async for chunk in resp.content.iter_chunked(64 * 1024):
        total += len(chunk)
        if total > MAX_BYTES:
            break
        chunks.append(chunk)
    return b"".join(chunks)[:MAX_BYTES]


async def _builtin(url: str) -> tuple[str, str]:
    here = url
    async with _reader_session() as s:
        for _ in range(MAX_HOPS + 1):
            _check_url(here)
            async with s.get(here, allow_redirects=False,
                             headers={"User-Agent": _UA,
                                      "Accept": "text/html,text/plain;q=0.9"}) as resp:
                if 300 <= resp.status < 400 and resp.headers.get("Location"):
                    here = urllib.parse.urljoin(here, resp.headers["Location"])
                    continue
                if resp.status in (401, 403):
                    raise WebError(f"the site refused the read ({resp.status}); it may need a "
                                   "login or a browser check")
                if resp.status >= 400:
                    raise WebError(f"the site answered {resp.status}")
                ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if ctype and ctype not in _TEXT_TYPES:
                    raise WebError(f"that link is {ctype}, not a web page")
                raw = await _read_body(resp)
                text = raw.decode(resp.charset or "utf-8", errors="replace")
                if ctype == "text/plain":
                    return "", text
                return web_read.page_text(text)
        raise WebError("that page redirected too many times")


async def _post_json(url: str, body: dict[str, Any], key: str) -> Any:
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    async with client._session(url, _TIMEOUT) as s:
        async with s.post(url, json=body, headers=headers, allow_redirects=False) as resp:
            if 300 <= resp.status < 400:
                raise WebError("the page reader redirected; check its address")
            data = await client._read_json(resp)
            if resp.status in (401, 403):
                raise WebError("the page reader refused the key")
            if resp.status == 402 or resp.status == 429:
                raise WebError("the page reader is rate-limiting or out of credit")
            if resp.status >= 400:
                raise WebError(f"the page reader answered {resp.status}")
            return data


async def _crawl4ai(reader: dict[str, Any], url: str) -> tuple[str, str]:
    data = await _post_json(reader["base_url"].rstrip("/") + "/md",
                            {"url": url, "f": "fit"}, reader.get("api_key", ""))
    md = data.get("markdown") if isinstance(data, dict) else None
    if isinstance(md, dict):
        md = md.get("fit_markdown") or md.get("raw_markdown")
    if not isinstance(md, str):
        raise WebError("Crawl4AI gave no page text")
    return "", md


async def _firecrawl(reader: dict[str, Any], url: str) -> tuple[str, str]:
    data = await _post_json(reader["base_url"].rstrip("/") + "/v1/scrape",
                            {"url": url, "formats": ["markdown"], "onlyMainContent": True},
                            reader.get("api_key", ""))
    page = data.get("data") if isinstance(data, dict) else None
    md = page.get("markdown") if isinstance(page, dict) else None
    if not isinstance(md, str):
        raise WebError("Firecrawl gave no page text")
    meta = page.get("metadata") if isinstance(page.get("metadata"), dict) else {}
    title = meta.get("title") if isinstance(meta.get("title"), str) else ""
    return title, md


def reader_ready(cfg: dict[str, Any]) -> bool:
    reader = cfg.get("reader") or {}
    engine = reader.get("engine")
    if engine == "builtin":
        return True
    if engine == "crawl4ai":
        return bool(reader.get("base_url"))
    if engine == "firecrawl":
        # The hosted API needs a key; a self-hosted one may not.
        return bool(reader.get("base_url")) and (
            bool(reader.get("api_key")) or "api.firecrawl.dev" not in reader["base_url"])
    return False


async def read_page(cfg: dict[str, Any], url: str) -> str:
    """The model's text for one page. Never raises: errors become text."""
    reader = cfg.get("reader") or {}
    try:
        if reader.get("engine") == "crawl4ai":
            title, text = await _crawl4ai(reader, url)
        elif reader.get("engine") == "firecrawl":
            title, text = await _firecrawl(reader, url)
        elif reader.get("engine") == "builtin":
            title, text = await _builtin(url)
        else:
            raise WebError("reading pages is off (Settings › AI assistant › Web search)")
    except client.AIError as e:
        return f"read_result: couldn't read {url}: {e.message}. Use the search snippet."
    except asyncio.TimeoutError:
        return f"read_result: {url} took too long. Use the search snippet."
    except (aiohttp.ClientError, OSError) as e:
        return f"read_result: couldn't reach {url} ({type(e).__name__}). Use the search snippet."
    return web_read.page_result(url, title, text)


# ── Danbooru ─────────────────────────────────────────────────────────────

async def _danbooru_get(s: aiohttp.ClientSession, path: str,
                        params: dict[str, Any] | None = None) -> Any:
    global _danbooru_last
    async with _danbooru_lock:
        wait = _danbooru_last + DANBOORU_GAP - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with s.get(DANBOORU + path, params=params, allow_redirects=False,
                             headers={"User-Agent": _DANBOORU_UA,
                                      "Accept": "application/json"}) as resp:
                if resp.status == 404:
                    return None
                if resp.status == 429:
                    raise WebError("Danbooru is rate-limiting; try again in a minute")
                if resp.status in (401, 403):
                    raise WebError("Danbooru refused the request (it may be blocking this "
                                   "network)")
                if resp.status >= 400 or 300 <= resp.status < 400:
                    raise WebError(f"Danbooru answered {resp.status}")
                return await client._read_json(resp)
        finally:
            _danbooru_last = time.monotonic()


async def danbooru(tag: str) -> str:
    """One tag looked up on Danbooru (5 requests at most, a second apart).
    Never raises: errors become text."""
    name = web_read.tag_name(tag)
    if not name:
        return "danbooru: say which tag to look up"
    try:
        async with client._session(DANBOORU, _TIMEOUT) as s:
            info = await _danbooru_get(s, "/tags.json",
                                       {"search[name]": name, "limit": 1})
            alias_to = None
            if not info:
                alias = await _danbooru_get(s, "/tag_aliases.json", {
                    "search[antecedent_name]": name, "search[status]": "active", "limit": 1})
                if isinstance(alias, list) and alias and isinstance(alias[0], dict):
                    alias_to = alias[0].get("consequent_name") or None
                    if alias_to:
                        info = await _danbooru_get(s, "/tags.json",
                                                   {"search[name]": alias_to, "limit": 1})
            target = alias_to or name
            if not info:
                return web_read.danbooru_result(name, info=None, alias_to=None, wiki=None,
                                                related=None, implies=None, implied_by=None)
            wiki = await _danbooru_get(s, f"/wiki_pages/{urllib.parse.quote(target, safe='')}"
                                       ".json")
            related = await _danbooru_get(s, "/related_tag.json",
                                          {"query": target, "limit": web_read.MAX_RELATED})
            implies = await _danbooru_get(s, "/tag_implications.json", {
                "search[antecedent_name]": target, "search[status]": "active",
                "limit": web_read.MAX_IMPLIED})
    except client.AIError as e:
        return f"danbooru: couldn't look up {name}: {e.message}"
    except asyncio.TimeoutError:
        return "danbooru: Danbooru took too long; try again later"
    except (aiohttp.ClientError, OSError) as e:
        return f"danbooru: couldn't reach Danbooru ({type(e).__name__})"
    return web_read.danbooru_result(name, info=info, alias_to=alias_to, wiki=wiki,
                                    related=related, implies=implies, implied_by=None)
