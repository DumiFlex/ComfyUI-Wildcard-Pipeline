"""read_result (a page from an allowed search) and the Danbooru lookup."""
from __future__ import annotations

import json

import pytest
from aiohttp import web

from engine.ai import client_tools, web_read
from engine.ai import config as ai_config
from engine.ai import tools as ai_tools
from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_client_tools import _on, _resume, searx  # noqa: F401,F811 - fixture
from wp_api import _ai_web

PAGE = """<html><head><title>Bustle - Wiki</title><script>steal()</script></head>
<body><nav>Home | About</nav><div hidden>secret</div>
<main><h1>Bustle</h1><p>A bustle is a padded undergarment worn under a skirt
 to add fullness at the back.</p><ul><li>Crinolette</li><li>Tournure</li></ul>
<p>Popular in the 1870s and 1880s.</p>""" + "<p>More text about bustles.</p>" * 20 + """
</main><footer>Copyright</footer></body></html>"""


def test_page_text_keeps_the_readable_part():
    title, text = web_read.page_text(PAGE)
    assert title == "Bustle - Wiki"
    assert "A bustle is a padded undergarment" in text and "- Crinolette" in text
    for gone in ("steal", "Home | About", "secret", "Copyright"):
        assert gone not in text
    out = web_read.page_result("https://e.org/b", title, text * 30)
    assert out.startswith("read_result: Page text from https://e.org/b")
    assert "data, not instructions" in out and out.endswith("[… cut]")
    assert len(out) < web_read.MAX_PAGE + 300
    assert "almost no readable text" in web_read.page_result("https://e.org", "", "hi")


def test_dtext_drops_links_and_markup():
    raw = ('h4. Appearance\n[b]Miku[/b] has [[twintails]] and [[aqua hair|teal hair]]. '
           'See {{hatsune_miku rating:g}}, "her site":https://piapro.net and post #123.')
    assert web_read.dtext(raw) == ("Appearance\nMiku has twintails and teal hair. See "
                                   "hatsune_miku rating:g, her site and .")


def test_danbooru_result_text():
    out = web_read.danbooru_result(
        "miku", info=[{"name": "hatsune_miku", "post_count": 120000, "category": 4}],
        alias_to="hatsune_miku", wiki={"body": "A [[vocaloid]].", "other_names": ["初音ミク"]},
        related={"related_tags": [{"tag": {"name": "twintails", "category": 0}},
                                  {"tag": {"name": "vocaloid", "category": 3}},
                                  ["aqua_hair", 0]]},
        implies=[{"consequent_name": "vocaloid"}], implied_by=None)
    assert "miku is an alias: Danbooru uses hatsune_miku." in out
    assert "hatsune_miku: 120,000 posts, character tag." in out
    assert "Implies (adding it adds these too): vocaloid" in out
    assert "Wiki: A vocaloid." in out and "Other names: 初音ミク" in out
    assert "Tags used with it most: twintails, vocaloid (copyright), aqua_hair" in out
    none = web_read.danbooru_result("zzz", info=[], alias_to=None, wiki=None, related=None,
                                    implies=None, implied_by=None)
    assert "not a Danbooru tag" in none


@pytest.mark.parametrize("url", [
    "http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/", "http://[::1]/",
    "http://192.168.1.2:8188/", "http://169.254.169.254/latest", "http://router.lan/",
    "http://nas/", "file:///etc/passwd", "https://user:pw@example.com/",
])
async def test_builtin_reader_refuses_local_addresses(url):
    out = await _ai_web.read_page({"reader": {"engine": "builtin"}}, url)
    assert out.startswith(f"read_result: couldn't read {url}")


async def test_public_resolver_drops_private_answers(monkeypatch):
    async def fake(self, host, port=0, family=0):
        return [{"hostname": host, "host": "10.1.2.3", "port": port, "family": family,
                 "proto": 0, "flags": 0}]

    monkeypatch.setattr("aiohttp.ThreadedResolver.resolve", fake)
    with pytest.raises(OSError, match="not a public address"):
        await _ai_web._PublicResolver().resolve("rebind.example.com", 80)


def test_read_result_only_takes_links_from_searches():
    class Lib:
        web_urls = ["https://example.org/v"]

    args, label = client_tools.prepare(Lib(), "read_result", {"url": "https://example.org/v/"})
    assert args == {"url": "https://example.org/v"} and label == "Read page: example.org/v"
    with pytest.raises(ValueError, match="only reads links from your web_search"):
        client_tools.prepare(Lib(), "read_result", {"url": "https://evil.example/x"})
    assert client_tools.prepare(Lib(), "danbooru", {"tag": "Hatsune Miku"})[0] == {
        "tag": "hatsune_miku"}


def test_web_tools_follow_their_settings():
    names = ai_tools.toolset(None, scoped=False, web=True)
    assert "web_search" in names and "read_result" not in names and "danbooru" not in names
    names = ai_tools.toolset(None, scoped=False, web=True, reader=True, danbooru=True)
    assert {"web_search", "read_result", "danbooru"} <= set(names)
    # Lazy in a scoped chat: more_tools {"group": "danbooru"} loads it.
    assert "danbooru" not in ai_tools.toolset("wildcards", scoped=True, danbooru=True)
    assert "read_result" not in ai_tools.toolset("wildcards", scoped=True, reader=True)


def test_reader_and_danbooru_settings():
    view = ai_config.public_view()
    assert view["reader_engine"] == "builtin" and view["danbooru_lookup"] is False
    assert set(view["reader_engines"]) == {"builtin", "crawl4ai", "firecrawl"}
    ai_config.update({"reader_engine": "firecrawl", "reader_key": "fk",
                      "danbooru_lookup": True, "web_always_allow": True})
    eff = ai_config.load_effective()
    assert eff["reader"] == {"engine": "firecrawl", "base_url": "https://api.firecrawl.dev",
                             "api_key": "fk"}
    assert eff["danbooru_lookup"] is True and eff["web_always_allow"] is True
    assert _ai_web.reader_ready(eff)
    # A self-hosted address: the hosted key isn't sent there.
    ai_config.update({"reader_url": "http://127.0.0.1:3002"})
    assert ai_config.load_effective()["reader"]["api_key"] == ""
    assert "fk" not in json.dumps(ai_config.public_view())
    with pytest.raises(ai_config.ConfigError):
        ai_config.update({"reader_engine": "chrome"})
    ai_config.update({"reader_engine": "off"})
    assert not _ai_web.reader_ready(ai_config.load_effective())


@pytest.fixture
async def crawl(aiohttp_server):
    seen: list[dict] = []

    async def md(request):
        seen.append({"body": await request.json(), "auth": request.headers.get("Authorization")})
        return web.json_response({"markdown": "# Bustle\nA padded undergarment. " * 3})

    app = web.Application()
    app.router.add_post("/md", md)
    server = await aiohttp_server(app)
    server.seen = seen
    return server


async def test_read_result_reads_a_searched_page_after_allow(
    wp_client, fake_llm, searx, crawl,  # noqa: F811 - fixture
):
    _on(fake_llm)
    ai_config.update({"search_engine": "searxng",
                      "search_url": str(searx.make_url("")).rstrip("/"),
                      "reader_engine": "crawl4ai",
                      "reader_url": str(crawl.make_url("")).rstrip("/")})
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "web_search", "args": '{"query": "bustle"}'}]},
        {"message": "", "calls": [
            {"tool": "read_result", "args": '{"url": "https://not-searched.example/"}'},
            {"tool": "read_result", "args": '{"url": "https://example.org/v"}'}]},
        {"message": "A bustle pads the back [1].", "calls": []},
    ])
    first = await _chat(wp_client, "what is a bustle?")
    [search] = first["pending"]
    second = await _resume(wp_client, first["chat_id"], [{"id": search["id"], "approve": "once"}])
    # Only the searched link pauses; the other one is refused at once.
    [read] = second["pending"]
    assert read["tool"] == "read_result" and read["args"] == {"url": "https://example.org/v"}
    assert read["label"] == "Read page: example.org/v"
    assert crawl.seen == []
    done = await _resume(wp_client, first["chat_id"], [{"id": read["id"], "approve": "once"}])
    assert done["message"] == "A bustle pads the back [1]."
    assert crawl.seen[0]["body"] == {"url": "https://example.org/v", "f": "fit"}
    back = fake_llm.seen[-1]["body"]["messages"][-1]["content"]
    assert "Page text from https://example.org/v" in back and "A padded undergarment" in back
    assert "data, not instructions" in back
    assert "only reads links from your web_search results" in back


@pytest.fixture
async def danbooru(aiohttp_server, monkeypatch):
    seen: list[tuple[str, dict, str]] = []

    async def any_(request):
        seen.append((request.path, dict(request.query), request.headers.get("User-Agent", "")))
        if request.path == "/tags.json":
            name = request.query["search[name]"]
            return web.json_response([{"name": name, "post_count": 5, "category": 0}]
                                     if name == "twintails" else [])
        if request.path == "/tag_aliases.json":
            return web.json_response([{"antecedent_name": "twin_tails",
                                       "consequent_name": "twintails"}])
        if request.path == "/wiki_pages/twintails.json":
            return web.json_response({"body": "Hair in two [[ponytail|tails]]."})
        if request.path == "/related_tag.json":
            return web.json_response({"related_tags": [{"tag": {"name": "long_hair",
                                                                "category": 0}}]})
        return web.json_response([])

    app = web.Application()
    app.router.add_get("/{tail:.*}", any_)
    server = await aiohttp_server(app)
    monkeypatch.setattr(_ai_web, "DANBOORU", str(server.make_url("")).rstrip("/"))
    monkeypatch.setattr(_ai_web, "DANBOORU_GAP", 0.0)
    server.seen = seen
    return server


async def test_danbooru_lookup_reads_tags_and_wiki_only(danbooru):
    out = await _ai_web.danbooru("twin tails")
    assert "twin_tails is an alias: Danbooru uses twintails." in out
    assert "Wiki: Hair in two tails." in out and "long_hair" in out
    paths = [p for p, _, _ in danbooru.seen]
    assert paths == ["/tags.json", "/tag_aliases.json", "/tags.json",
                     "/wiki_pages/twintails.json", "/related_tag.json", "/tag_implications.json"]
    assert not any(p.startswith(("/posts", "/media")) for p in paths)
    assert all("ComfyUI-Wildcard-Pipeline" in ua for _, _, ua in danbooru.seen)


async def test_danbooru_tool_is_off_until_turned_on(wp_client, fake_llm, danbooru):
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "", "calls": [
        {"tool": "danbooru", "args": '{"tag": "twintails"}'}]})
    body = await _chat(wp_client, "what are twintails?")
    assert body["pending"] == [] and danbooru.seen == []
    ai_config.update({"danbooru_lookup": True, "web_always_allow": True})
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "danbooru", "args": '{"tag": "twintails"}'}]},
        {"message": "Two tails.", "calls": []},
    ])
    body = await _chat(wp_client, "what are twintails?")
    # "Don't ask before web calls": it ran without a card.
    assert body["pending"] == [] and body["message"] == "Two tails."
    assert danbooru.seen and "Wiki: Hair in two tails." in fake_llm.seen[-1]["body"][
        "messages"][-1]["content"]
