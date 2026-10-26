"""The AI debug log's record, scrubbing and Markdown copy."""
from __future__ import annotations

import json

import pytest

from engine.ai import debug_log


@pytest.fixture(autouse=True)
def _empty():
    debug_log.clear()
    yield
    debug_log.clear()


def test_scrub_hides_images_vectors_and_keys():
    b64 = "A" * 4000
    body = {
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "what is this"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "image", "source": {"type": "base64", "data": b64}},
        ], "images": [b64]}],
        "data": [{"embedding": [0.1] * 300}],
        "api_key": "sk-secret",
    }
    out = json.dumps(debug_log.scrub(body))
    assert b64 not in out and "sk-secret" not in out
    assert "[image image/jpeg, 3 KB]" in out and "[image, 3 KB]" in out
    assert "[vector, 300 numbers]" in out
    assert "what is this" in out


def test_long_prompt_text_is_not_taken_for_an_image():
    text = "word " * 2000
    assert debug_log.scrub({"content": text})["content"] == text
    assert debug_log.scrub({"data": "abc,def " * 600})["data"].startswith("abc")


def test_record_lists_and_caps():
    debug_log.begin("a1", "/wp/api/ai/wildcard/draft", meta={"label": "Draft", "asked": "more"})
    usage = {"prompt_tokens": 10, "completion_tokens": 3,
             "prompt_tokens_details": {"cached_tokens": 4}}
    debug_log.add_call("a1", {"path": "/chat/completions", "request": {"messages": []},
                              "response": {"usage": usage},
                              "seconds": 1.0})
    debug_log.finish("a1", status=200)
    [row] = debug_log.listing()
    assert row["calls"] == 1 and row["tokens"] == {"prompt": 10, "cached": 4, "output": 3}
    assert debug_log.get("a1")["calls"][0]["n"] == 1
    for i in range(debug_log.KEEP + 5):
        debug_log.begin(f"x{i}", "/r")
    assert len(debug_log.listing()) == debug_log.KEEP and debug_log.get("a1") is None


def test_a_call_past_the_size_cap_is_counted_not_kept(monkeypatch):
    monkeypatch.setattr(debug_log, "MAX_ACTION_CHARS", 500)
    debug_log.begin("b", "/r")
    debug_log.add_call("b", {"path": "/messages", "request": {"system": "x" * 1000}})
    rec = debug_log.get("b")
    assert rec["calls"] == [] and rec["dropped"] == 1
    assert "not recorded" in debug_log.markdown(rec)


def test_finish_writes_a_file_and_prunes(tmp_path, monkeypatch):
    monkeypatch.setattr(debug_log, "KEEP_FILES", 2)
    for i in range(3):
        debug_log.begin(f"f{i}", "/r")
        debug_log.add_call(f"f{i}", {"path": "/api/chat", "request": {}, "response": {}})
        debug_log.finish(f"f{i}", status=200, folder=tmp_path)
    files = sorted(p.name for p in tmp_path.glob("*.json"))
    assert len(files) == 2 and files[-1].endswith("-f2.json")
    assert json.loads((tmp_path / files[-1]).read_text())["id"] == "f2"


@pytest.mark.parametrize("response, text, thinking, calls", [
    ({"choices": [{"message": {"content": "hi", "reasoning_content": "hmm",
                               "tool_calls": [{"function": {"name": "find"}}]},
                   "finish_reason": "tool_calls"}]}, "hi", "hmm", "find"),
    ({"content": [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "hi"},
                  {"type": "tool_use", "name": "find", "input": {}}],
      "stop_reason": "tool_use", "usage": {"input_tokens": 5, "output_tokens": 2}},
     "hi", "hmm", "find"),
    ({"message": {"content": "hi", "thinking": "hmm",
                  "tool_calls": [{"function": {"name": "find"}}]},
      "done_reason": "stop"}, "hi", "hmm", "find"),
    ({"output": [{"type": "reasoning", "summary": [{"text": "hmm"}]},
                 {"type": "message", "content": [{"type": "output_text", "text": "hi"}]},
                 {"type": "function_call", "name": "find", "arguments": "{}"}],
      "status": "completed"}, "hi", "hmm", "find"),
])
def test_markdown_shows_prompt_and_reply_for_every_provider(response, text, thinking, calls):
    debug_log.begin("m", "/wp/api/ai/chat", meta={"label": "Chat message", "asked": "q?",
                                                  "provider": "lmstudio", "model": "qwen"})
    debug_log.add_call("m", {"path": "/x", "seconds": 2.0, "request": {
        "model": "qwen", "temperature": 0.2, "system": "SYSTEM TEXT",
        "messages": [{"role": "user", "content": "USER TEXT"}],
        "tools": [{"type": "function", "function": {"name": "find"}}]}, "response": response})
    debug_log.finish("m", status=200)
    md = debug_log.markdown(debug_log.get("m"))
    for want in ("# AI debug: Chat message", "Asked: q?", "SYSTEM TEXT", "USER TEXT",
                 "Tools offered (1)**: find", '"temperature": 0.2', text, thinking, calls):
        assert want in md, want


def test_markdown_shows_an_error_and_its_body():
    debug_log.begin("e", "/r")
    debug_log.add_call("e", {"path": "/messages", "request": {"messages": []},
                             "error": "the server answered 400: bad", "status": 400,
                             "response": {"error": {"message": "bad"}}})
    md = debug_log.markdown(debug_log.get("e"))
    assert "**Error** (status 400): the server answered 400: bad" in md and '"bad"' in md


def test_fences_survive_backticks_in_text():
    assert debug_log._fence("a ``` b").startswith("````\n")


def test_a_request_that_never_reached_the_model_is_dropped():
    debug_log.clear()
    debug_log.begin("quiet", "/wp/api/ai/pack/check", meta={})
    debug_log.finish("quiet", status=200)
    debug_log.begin("refused", "/wp/api/ai/chat", meta={})
    debug_log.finish("refused", status=400, error="no model set")
    assert [r["id"] for r in debug_log.listing()] == ["refused"]


def test_the_copy_folds_an_answer_schema_away_from_the_settings():
    debug_log.clear()
    debug_log.begin("s", "/wp/api/ai/chat", meta={})
    schema = {"type": "json_schema", "json_schema": {"name": "chat_step", "schema": {}}}
    debug_log.add_call("s", {"path": "/chat/completions", "seconds": 1.0,
                             "request": {"model": "m", "temperature": 0.2,
                                         "response_format": schema, "messages": []},
                             "response": {"choices": [{"message": {"content": "ok"}}]}})
    debug_log.finish("s", status=200)
    md = debug_log.markdown(debug_log.get("s"))
    settings, folded = md.split("<details><summary>Answer schema</summary>")
    assert '"temperature": 0.2' in settings and "chat_step" not in settings
    assert "chat_step" in folded
