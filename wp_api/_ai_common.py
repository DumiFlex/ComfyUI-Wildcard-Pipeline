"""Helpers every /wp/api/ai/* route module shares: body limits and parsing,
the enabled check, one model ask, and the library lookups the drafting
routes and the pack builder both use."""
from __future__ import annotations

import json as _json
from typing import Any

from aiohttp import web

from engine.ai import config as ai_config
from engine.ai import followup as ai_followup
from engine.ai import refs as ai_refs
from engine.ai import research as ai_research
from engine.ai import wildcard as ai_wildcard
from engine.db.repositories import (
    ModuleRepository,
)
from wp_api import (
    _ai_chat,
    _ai_client,
    _ai_images,
    _ai_search,
)
from wp_api._helpers import db_session, json_error

_MAX_BODY_BYTES = 512 * 1024


#: Requests that may carry reference images (a few shrunk JPEGs).
_MAX_IMAGE_BODY_BYTES = 6 * 1024 * 1024


#: Pack routes carry the plan and every built item (up to 60 payloads).
_MAX_PACK_BODY_BYTES = 8 * 1024 * 1024


async def _body(request: web.Request, *,
                limit: int = _MAX_BODY_BYTES) -> dict[str, Any] | web.Response:
    if request.content_length is not None and request.content_length > limit:
        return json_error("request too large", status=413)
    try:
        raw = await request.read()
    except web.HTTPRequestEntityTooLarge:
        return json_error("request too large", status=413)
    if len(raw) > limit:
        return json_error("request too large", status=413)
    if not raw:
        return {}
    try:
        body = _json.loads(raw)
    except ValueError:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be an object", status=400)
    return body


def _enabled_cfg() -> dict[str, Any] | web.Response:
    cfg = ai_config.load_effective()
    if not cfg["enabled"]:
        return json_error(
            "the AI assistant is off. Turn it on in Settings › AI assistant.", status=403,
        )
    return cfg


def _turns(body: dict[str, Any]) -> list[dict[str, Any]] | web.Response:
    try:
        return ai_followup.parse_history(body.get("history"))
    except ai_followup.HistoryError as e:
        return json_error(str(e), status=400)


async def _ask(
    cfg: dict[str, Any], *, first: str, turns: list[dict[str, Any]], instruction: str,
    image_note: bool = True, extra: str = "", **kwargs: Any,
) -> Any:
    """`complete_json` with the conversation so far, when there is one.
    Reference images (`images=`) go with the newest message, which says so;
    `extra` (web results) is added to it too."""
    history, user = ai_followup.conversation(first, turns, instruction)
    if extra:
        user = f"{user}\n\n{extra}"
    if image_note and kwargs.get("images"):
        user = f"{user}\n\n{_ai_images.note(len(kwargs['images']))}"
    return await _ai_client.complete_json(cfg, user=user, history=history, **kwargs)


class _Web:
    """Web search on a Draft with AI request (`engine/ai/research.py`):
    whether to offer the model a `research` list, and the results or skip
    note the user's answer to the last search card adds."""

    def __init__(self, cfg: dict[str, Any], body: dict[str, Any]) -> None:
        self.on = _ai_search.enabled(cfg)
        self.searched = _str_list(body.get("searched"), limit=12)
        self.note = (ai_research.note(body.get("web"), body.get("skipped") is True)
                     if self.on else "")

    def schema(self, schema: dict[str, Any]) -> dict[str, Any]:
        return ai_research.with_research(schema) if self.on else schema

    def system(self, system: str) -> str:
        return f"{system}\n\n{ai_research.PROMPT}" if self.on else system

    def take(self, answer: Any) -> tuple[Any, list[str]]:
        return ai_research.take(answer, self.searched) if self.on else (answer, [])


def _wildcards(request: web.Request) -> list[dict[str, Any]]:
    """The library's wildcards, for name refs (`@{Colors:warm}`)."""
    with db_session(request) as conn:
        return [m for m in ModuleRepository(conn).list() if m.get("type") == "wildcard"]


def _ref_index(rows: list[dict[str, Any]], editor_id: Any = None,
               editor_payload: Any = None, name: Any = None) -> ai_refs.RefIndex:
    """Library wildcards, with the open editor's version of its own."""
    idx = ai_refs.RefIndex(rows)
    if isinstance(editor_id, str) and isinstance(editor_payload, dict):
        saved = idx.rows.get(editor_id) or {}
        idx.add({"id": editor_id, "type": "wildcard",
                 "name": name if isinstance(name, str) and name else saved.get("name", ""),
                 "payload": editor_payload})
    return idx


def _str_list(value: Any, *, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [v for v in value if isinstance(v, str)][:limit]


def _instruction(body: dict[str, Any], missing: str) -> str | web.Response:
    instruction = body.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        return json_error(missing, status=400)
    if len(instruction) > ai_wildcard.MAX_INSTRUCTION_LEN:
        return json_error("that request is too long", status=400)
    return instruction


async def _web_result(cfg: dict[str, Any], query: str,
                      urls: list[str] | None = None) -> str:
    try:
        return "web_search: " + await _ai_search.search(cfg, query, urls)
    except _ai_client.AIError as e:
        return f"web_search: error: {e.message}"


async def _request_images(cfg: dict[str, Any], body: dict[str, Any],
                          ) -> list[dict[str, Any]] | web.Response:
    """Reference images sent with a pack plan or Draft with AI request,
    checked; refused when the model can't see them."""
    try:
        images = _ai_images.clean(body.get("images"))
    except _ai_images.ImageError as e:
        return json_error(str(e), status=400)
    if images and await _ai_chat.vision_support(cfg) is False:
        return json_error(f"{cfg.get('model')} can't see images. Pick a vision model "
                          "(Gemma 3, Qwen2.5-VL, Llama 3.2 Vision, …) or remove them.",
                          status=400)
    return images
