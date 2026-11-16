"""The tag list is parsed in a worker thread, once for every request waiting on
it, and the status check answers from the status file beside the list."""
from __future__ import annotations

import asyncio
import os
import time

import pytest

from wp_api import _tag_index
from wp_api import tags as _tags


@pytest.fixture
def tag_file(tmp_path, monkeypatch):
    csv = tmp_path / "tags.csv"
    csv.write_text("long_hair,0,900,\nred_hair,0,400,longhair_red\nsmile,0,3000,\n")
    monkeypatch.setattr(_tags, "tag_file_path", lambda: csv)
    _tags.reset_cache()
    yield csv
    _tags.reset_cache()


def _slow_loader(monkeypatch, delay: float) -> list[int]:
    calls: list[int] = []

    def slow(path):
        calls.append(1)
        time.sleep(delay)
        return _tag_index.load_index(path)

    monkeypatch.setattr(_tags, "load_index", slow)
    return calls


async def test_status_after_a_restart_reads_the_status_file(wp_client, tag_file, monkeypatch):
    first = await (await wp_client.get("/wp/api/tags/status")).json()
    assert first["available"] is True and first["tag_count"] == 4
    assert (tag_file.parent / (tag_file.name + _tags.STATUS_SUFFIX)).is_file()

    # A new process: nothing built. The status must not parse the file.
    _tags.reset_cache()

    def boom(path):
        raise AssertionError("status parsed the tag list")
    monkeypatch.setattr(_tags, "load_index", boom)
    again = await (await wp_client.get("/wp/api/tags/status")).json()
    assert again == first

    # A replaced list is parsed again (its status file no longer matches).
    calls = _slow_loader(monkeypatch, 0)
    tag_file.write_text("blonde_hair,0,10,\n")
    st = os.stat(tag_file)
    os.utime(tag_file, (st.st_atime + 5, st.st_mtime + 5))
    changed = await (await wp_client.get("/wp/api/tags/status")).json()
    assert changed["tag_count"] == 1 and calls == [1]


async def test_a_broken_list_is_remembered_as_unavailable(wp_client, tag_file, monkeypatch):
    tag_file.write_text("not a tag row\n")
    assert (await (await wp_client.get("/wp/api/tags/status")).json())["available"] is False
    _tags.reset_cache()
    calls = _slow_loader(monkeypatch, 0)
    body = await (await wp_client.get("/wp/api/tags/status")).json()
    assert body["available"] is False and body["tag_count"] == 0 and calls == []


async def test_requests_during_a_build_share_it(wp_client, tag_file, monkeypatch):
    calls = _slow_loader(monkeypatch, 0.3)
    responses = await asyncio.gather(
        *[wp_client.get("/wp/api/tags/suggest?q=lo") for _ in range(5)],
        wp_client.get("/wp/api/tags/status"),
    )
    assert all(r.status == 200 for r in responses)
    assert calls == [1]
    names = [t["name"] for t in (await responses[0].json())["tags"]]
    assert names == ["long_hair", "red_hair"]


async def test_a_build_does_not_block_the_event_loop(wp_client, tag_file, monkeypatch):
    _slow_loader(monkeypatch, 0.6)
    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.ensure_future(ticker())
    try:
        resp = await wp_client.get("/wp/api/tags/suggest?q=smi")
    finally:
        task.cancel()
    assert resp.status == 200
    # A blocked loop would tick ~0 times during the 0.6 s build.
    assert ticks >= 10


async def test_remove_deletes_the_status_file(wp_client, tag_file):
    await wp_client.get("/wp/api/tags/status")
    status_file = tag_file.parent / (tag_file.name + _tags.STATUS_SUFFIX)
    assert status_file.is_file()
    assert (await wp_client.delete("/wp/api/tags")).status == 200
    assert not status_file.exists()


def test_the_sync_getter_builds_once_across_threads(tag_file, monkeypatch):
    import threading

    calls = _slow_loader(monkeypatch, 0.2)
    got: list[object] = []
    threads = [threading.Thread(target=lambda: got.append(_tags._get_index())) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert calls == [1] and len({id(g) for g in got}) == 1
