"""Fetch the tag list from our own GitHub release.

This is the only outbound network request the extension ever makes, and it
happens solely when someone clicks Download in Settings. Nothing here runs on a
timer, at startup, or as a side effect of anything else.

THREAT MODEL
------------
ComfyUI has no authentication, so every route we add is reachable by anything
that can reach the port. A "download a file from the internet and write it to
disk" endpoint is the most abusable shape there is, so each capability is
removed rather than validated:

  SSRF — the caller cannot influence the URL. It is a module constant. There is
      no `url` parameter to smuggle `http://169.254.169.254/` or an internal
      host through, because the request body is ignored entirely.

  Redirect chasing — GitHub redirects release downloads to a CDN host, so
      redirects must be followed, but every hop is checked against
      `_ALLOWED_HOSTS` first. A tampered redirect to an attacker's host is
      refused mid-chain rather than followed.

  Arbitrary write — the destination is computed server-side from ComfyUI's user
      directory plus a constant filename. No caller input reaches the path, so
      there is nothing to traverse with. An existing symlink at that path is
      refused rather than followed, so the write cannot be redirected onto
      something else.

  Disk exhaustion — the response is streamed with a running total and aborted
      past `_MAX_BYTES`, so a hostile or corrupted response cannot fill the
      disk. `Content-Length` is checked first when present, but never trusted
      as the only guard: it is attacker-controlled.

  Repeat triggering — a single-flight lock means concurrent requests get a
      "already running" answer instead of N simultaneous downloads.

  Poisoned content — the payload is written to a temporary file and parsed
      before it replaces anything. A response that does not produce a usable
      index leaves the existing list untouched. The final move is atomic, so
      an interrupted download cannot leave a half-written file in place.

What is deliberately NOT claimed: this does not protect against a compromise of
our own GitHub release. It is a tag list, parsed as text into strings and never
executed, so the worst a bad file achieves is bad autocomplete suggestions.
"""
from __future__ import annotations

import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

_log = logging.getLogger(__name__)

#: The only URL this module will ever fetch. Fixed tag, asset replaced in place
#: by `.github/workflows/tag-list.yml`, so this never needs to change.
TAG_LIST_URL = (
    "https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline"
    "/releases/download/tag-list/wildcard-pipeline-tags.csv"
)

#: Hosts a redirect may land on. GitHub serves release assets by redirecting to
#: a CDN, so the chain has to be allowed to leave github.com — but only to here.
_ALLOWED_HOSTS = frozenset({
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
})

#: Generous against a real list (~6 MB) and far below anything that threatens a
#: disk. The point is that SOME ceiling exists, not that this exact one is right.
_MAX_BYTES = 64 * 1024 * 1024

_CHUNK = 64 * 1024
_TIMEOUT = 60

#: One download at a time, process-wide.
_lock = threading.Lock()


class DownloadError(Exception):
    """Anything that stopped the download. Message is shown to the user."""


@dataclass(frozen=True, slots=True)
class DownloadResult:
    path: Path
    bytes_written: int


class _StrictRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Allow redirects, but only onto hosts we named."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        host = (urllib.parse.urlsplit(newurl).hostname or "").lower()
        scheme = urllib.parse.urlsplit(newurl).scheme.lower()
        if scheme != "https" or host not in _ALLOWED_HOSTS:
            raise DownloadError(
                f"refused a redirect to an unexpected location: {host or newurl!r}",
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _opener() -> urllib.request.OpenerDirector:
    # No proxy handler and no cookie handler on purpose: this fetches one public
    # asset and should carry no ambient credentials or environment influence.
    return urllib.request.build_opener(_StrictRedirectHandler)


def download_tag_list(
    destination: Path,
    *,
    url: str = TAG_LIST_URL,
    opener_factory=_opener,
) -> DownloadResult:
    """Fetch the list and atomically replace `destination`.

    `url` is a parameter only so tests can point at a local server; nothing
    reachable from HTTP can set it.
    """
    if not _lock.acquire(blocking=False):
        raise DownloadError("a download is already running")
    try:
        return _download(destination, url, opener_factory)
    finally:
        _lock.release()


def _download(destination: Path, url: str, opener_factory) -> DownloadResult:  # noqa: ANN001
    parts = urllib.parse.urlsplit(url)
    if parts.scheme.lower() != "https" or (parts.hostname or "").lower() not in _ALLOWED_HOSTS:
        # Unreachable via HTTP — the route never passes a URL — but a future
        # caller inside the process could, so the check lives with the fetch.
        raise DownloadError("refusing to fetch from an unexpected location")

    if destination.is_symlink():
        raise DownloadError(
            f"{destination.name} is a symlink; refusing to write through it",
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    # Same directory, so the final os.replace is atomic rather than a
    # cross-filesystem copy that could be interrupted half-way.
    tmp = destination.with_suffix(destination.suffix + ".part")

    total = 0
    try:
        request = urllib.request.Request(
            url, headers={"User-Agent": "wildcard-pipeline-taglist/1.0"},
        )
        with opener_factory().open(request, timeout=_TIMEOUT) as response:
            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > _MAX_BYTES:
                raise DownloadError(
                    f"the file is larger than the {_MAX_BYTES // 1024 // 1024} MB limit",
                )
            with tmp.open("wb") as fh:
                while True:
                    chunk = response.read(_CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    # Checked per chunk, because Content-Length is whatever the
                    # server chose to say.
                    if total > _MAX_BYTES:
                        raise DownloadError(
                            f"the download exceeded the "
                            f"{_MAX_BYTES // 1024 // 1024} MB limit",
                        )
                    fh.write(chunk)
    except DownloadError:
        _cleanup(tmp)
        raise
    except urllib.error.HTTPError as err:
        _cleanup(tmp)
        raise DownloadError(f"the download failed ({err.code})") from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        _cleanup(tmp)
        raise DownloadError("the download failed — check the connection") from err

    if total == 0:
        _cleanup(tmp)
        raise DownloadError("the download was empty")

    # Validate BEFORE replacing anything. A working list must never be lost to a
    # response that turned out not to be one.
    from wp_api._tag_index import load_index

    if load_index(tmp) is None:
        _cleanup(tmp)
        raise DownloadError(
            "the downloaded file is not a readable tag list; "
            "the existing list was left in place",
        )

    os.replace(tmp, destination)
    _log.info("wildcard-pipeline: tag list updated (%d bytes)", total)
    return DownloadResult(path=destination, bytes_written=total)


def _cleanup(tmp: Path) -> None:
    try:
        tmp.unlink(missing_ok=True)
    except OSError:
        pass
