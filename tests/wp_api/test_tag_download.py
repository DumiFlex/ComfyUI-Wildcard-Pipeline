"""Security properties of the tag-list download.

This is the only outbound request the extension makes, and it writes a file to
disk. ComfyUI has no authentication, so the endpoint is reachable by anything
that can reach the port — which makes "download a file and save it" the most
abusable shape available.

Each test below pins one capability we removed. A comment claiming the
capability is absent is worth nothing; these are what make it true.
"""
from __future__ import annotations

import threading
import urllib.error
from pathlib import Path

import pytest

from wp_api import _tag_download
from wp_api._tag_download import (
    TAG_LIST_URL,
    DownloadError,
    download_tag_list,
)

VALID_CSV = b'1girl,0,8244968,"1girls"\nhighres,5,7948772,"hires"\n'


class _FakeResponse:
    def __init__(self, body: bytes, headers: dict[str, str] | None = None):
        self._body = body
        self._pos = 0
        self.headers = headers or {}

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            chunk, self._pos = self._body[self._pos:], len(self._body)
            return chunk
        chunk = self._body[self._pos:self._pos + size]
        self._pos += len(chunk)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _opener_serving(body: bytes, headers: dict[str, str] | None = None):
    class _Opener:
        def open(self, request, timeout=None):  # noqa: ANN001, ARG002
            return _FakeResponse(body, headers)
    return lambda: _Opener()


class TestTheUrlCannotBeSteered:
    def test_the_endpoint_url_is_a_constant_on_our_own_release(self):
        assert TAG_LIST_URL.startswith(
            "https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/releases/download/",
        )

    @pytest.mark.parametrize("hostile", [
        "http://169.254.169.254/latest/meta-data/",   # cloud metadata
        "https://evil.example.com/payload.csv",       # arbitrary external host
        "http://127.0.0.1:8188/wp/api/modules",       # loopback / internal
        "file:///etc/passwd",                         # non-HTTP scheme
        "https://github.com.evil.example.com/x.csv",  # suffix-confusion host
    ])
    def test_a_url_outside_the_allowlist_is_refused(self, tmp_path, hostile):
        """Not reachable over HTTP — the route ignores the body entirely — but
        an in-process caller could pass one, so the fetch checks for itself."""
        with pytest.raises(DownloadError, match="unexpected location"):
            download_tag_list(
                tmp_path / "tags.csv", url=hostile,
                opener_factory=_opener_serving(VALID_CSV),
            )

    def test_the_github_cdn_host_is_allowed(self):
        """GitHub serves release assets by redirecting, so the chain must be
        able to leave github.com — to these hosts and nowhere else."""
        assert "objects.githubusercontent.com" in _tag_download._ALLOWED_HOSTS
        assert "evil.example.com" not in _tag_download._ALLOWED_HOSTS


class TestRedirectsAreChecked:
    @pytest.mark.parametrize("target", [
        "https://evil.example.com/payload.csv",
        "http://objects.githubusercontent.com/x.csv",  # downgraded to plain HTTP
    ])
    def test_a_redirect_off_the_allowlist_is_refused(self, target):
        handler = _tag_download._StrictRedirectHandler()
        with pytest.raises(DownloadError, match="redirect"):
            handler.redirect_request(
                None, None, 302, "Found", {}, target,
            )


class TestSizeIsBounded:
    def test_a_declared_content_length_over_the_cap_is_refused(self, tmp_path):
        with pytest.raises(DownloadError, match="limit"):
            download_tag_list(
                tmp_path / "tags.csv",
                opener_factory=_opener_serving(
                    VALID_CSV, {"Content-Length": str(_tag_download._MAX_BYTES + 1)},
                ),
            )

    def test_a_body_over_the_cap_is_refused_even_when_length_lies(self, tmp_path, monkeypatch):
        """Content-Length is whatever the server chose to say, so the running
        total is the guard that actually holds."""
        monkeypatch.setattr(_tag_download, "_MAX_BYTES", 1024)
        oversized = b"a,0,1,\n" * 500  # ~3.5 KB against a 1 KB cap
        with pytest.raises(DownloadError, match="exceeded"):
            download_tag_list(
                tmp_path / "tags.csv",
                # Understates the real size on purpose.
                opener_factory=_opener_serving(oversized, {"Content-Length": "10"}),
            )

    def test_nothing_is_left_behind_when_a_download_is_refused(self, tmp_path):
        monkeypatch_target = tmp_path / "tags.csv"
        with pytest.raises(DownloadError):
            download_tag_list(
                monkeypatch_target,
                opener_factory=_opener_serving(
                    VALID_CSV, {"Content-Length": str(_tag_download._MAX_BYTES + 1)},
                ),
            )
        assert list(tmp_path.iterdir()) == [], "a .part file survived"


class TestTheExistingListIsProtected:
    def test_an_unparseable_response_leaves_the_old_list_alone(self, tmp_path):
        dest = tmp_path / "tags.csv"
        dest.write_text("existing,0,100,\n", encoding="utf-8")
        with pytest.raises(DownloadError, match="not a readable tag list"):
            download_tag_list(
                dest, opener_factory=_opener_serving(b"<html>404 not found</html>"),
            )
        assert dest.read_text(encoding="utf-8") == "existing,0,100,\n"

    def test_an_empty_response_leaves_the_old_list_alone(self, tmp_path):
        dest = tmp_path / "tags.csv"
        dest.write_text("existing,0,100,\n", encoding="utf-8")
        with pytest.raises(DownloadError, match="empty"):
            download_tag_list(dest, opener_factory=_opener_serving(b""))
        assert dest.read_text(encoding="utf-8") == "existing,0,100,\n"

    def test_a_symlink_at_the_destination_is_refused(self, tmp_path):
        """Otherwise the write follows the link and lands somewhere else."""
        real = tmp_path / "elsewhere.txt"
        real.write_text("do not touch", encoding="utf-8")
        dest = tmp_path / "tags.csv"
        try:
            dest.symlink_to(real)
        except (OSError, NotImplementedError):
            pytest.skip("symlinks unavailable on this platform/account")
        with pytest.raises(DownloadError, match="symlink"):
            download_tag_list(dest, opener_factory=_opener_serving(VALID_CSV))
        assert real.read_text(encoding="utf-8") == "do not touch"


class TestConcurrency:
    def test_a_second_download_is_refused_while_one_is_running(self, tmp_path):
        """Repeat triggering must not mean N simultaneous multi-MB fetches."""
        started = threading.Event()
        release = threading.Event()

        class _SlowOpener:
            def open(self, request, timeout=None):  # noqa: ANN001, ARG002
                started.set()
                release.wait(5)
                return _FakeResponse(VALID_CSV)

        errors: list[Exception] = []

        def _first():
            try:
                download_tag_list(
                    tmp_path / "tags.csv", opener_factory=lambda: _SlowOpener(),
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        worker = threading.Thread(target=_first)
        worker.start()
        try:
            assert started.wait(5), "the first download never started"
            with pytest.raises(DownloadError, match="already running"):
                download_tag_list(
                    tmp_path / "other.csv",
                    opener_factory=_opener_serving(VALID_CSV),
                )
        finally:
            release.set()
            worker.join(5)
        assert errors == []


class TestTheHappyPath:
    def test_a_valid_list_is_written_and_reported(self, tmp_path):
        dest = tmp_path / "tags.csv"
        result = download_tag_list(dest, opener_factory=_opener_serving(VALID_CSV))
        assert result.path == dest
        assert result.bytes_written == len(VALID_CSV)
        assert dest.read_bytes() == VALID_CSV

    def test_it_replaces_an_existing_list(self, tmp_path):
        dest = tmp_path / "tags.csv"
        dest.write_text("old,0,1,\n", encoding="utf-8")
        download_tag_list(dest, opener_factory=_opener_serving(VALID_CSV))
        assert dest.read_bytes() == VALID_CSV

    def test_the_parent_directory_is_created(self, tmp_path):
        dest = tmp_path / "nested" / "dir" / "tags.csv"
        download_tag_list(dest, opener_factory=_opener_serving(VALID_CSV))
        assert dest.exists()

    def test_a_transport_failure_is_reported_without_a_stack_trace(self, tmp_path):
        class _Broken:
            def open(self, request, timeout=None):  # noqa: ANN001, ARG002
                raise urllib.error.URLError("no route to host")

        with pytest.raises(DownloadError, match="check the connection"):
            download_tag_list(tmp_path / "tags.csv", opener_factory=lambda: _Broken())


def test_no_part_files_are_left_anywhere_after_the_suite(tmp_path: Path):
    """A .part left behind would be picked up by nothing but would confuse
    anyone looking in their user directory."""
    dest = tmp_path / "tags.csv"
    download_tag_list(dest, opener_factory=_opener_serving(VALID_CSV))
    assert [p.name for p in tmp_path.iterdir()] == ["tags.csv"]
