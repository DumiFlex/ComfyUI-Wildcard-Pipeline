"""POST /wp/api/ai/chat: one chat turn, its step loop, paused page and
web tools, and the closing lines."""
from __future__ import annotations

import asyncio
import json as _json
import re
import time
from dataclasses import dataclass, field
from typing import Any

from aiohttp import web

from engine.ai import ask as ai_ask
from engine.ai import budget as ai_budget
from engine.ai import cards as ai_cards
from engine.ai import chat as ai_chat
from engine.ai import chat_manage as ai_manage
from engine.ai import chatlog as ai_chatlog
from engine.ai import claims as ai_claims
from engine.ai import client_tools as ai_client_tools
from engine.ai import config as ai_config
from engine.ai import examples as ai_examples
from engine.ai import guide as ai_guide
from engine.ai import lang as ai_lang
from engine.ai import lint as ai_lint
from engine.ai import narrow as ai_narrow
from engine.ai import plan_items as ai_plan
from engine.ai import react as ai_react
from engine.ai import recipes as ai_recipes
from engine.ai import request_check as ai_request_check
from engine.ai import safety as ai_safety
from engine.ai import tools as ai_tools
from engine.ai import trace as ai_trace
from engine.ai.step_fields import strip_step_fields
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ChatNotFound,
    ChatRepository,
    ModuleRepository,
    TemplateRepository,
)
from wp_api import (
    _ai_chat,
    _ai_client,
    _ai_embed,
    _ai_images,
    _ai_lang,
    _ai_search,
    _ai_vocab,
    _ai_web,
)
from wp_api._ai_common import (
    _body,
    _enabled_cfg,
    _web_result,
)
from wp_api._ai_context import (
    _canvas_note,
    _chat_profile,
    _chat_step,
    _context,
    _decls,
    _final_step,
    _maybe_compact,
    _more_tools,
    _open_chat,
    _query_vector,
    _results_tail,
    _retrieval,
    _splits,
    _sync_permissions,
    _sync_vocab,
    _synced_index,
    _system_text,
    _too_small,
    _vocab_kinds,
    _window,
)
from wp_api._helpers import db_session, json_error, json_ok

#: Time one chat answer may take, checked before each step: a step that
#: started finishes (each model call has its own timeout), and once the time
#: is up the model gets one last step to answer from what it has. Local
#: models get longer: a 27B reading a long prompt takes minutes per step.
TURN_SECONDS = 600


TURN_SECONDS_LOCAL = 1200


#: Times one answer may be continued after it was cut off.
MAX_CONTINUE = 2


#: The most one model step may take, a little over the client's own limit.
STEP_SECONDS = 330


async def post_chat(request: web.Request) -> web.StreamResponse:
    """The chat turn (see `_chat_turn`). With `"stream": true` the answer
    comes as NDJSON events while it is worked out: `step` (a model step
    starts), `status` (what's happening, e.g. a summary), `thinking`,
    `text` (the answer so far, replacing the last), `tool` (a step the
    lines above the reply list), `reaction` (an emoji on the user's message,
    as soon as it is decided), then `done` with the same JSON the plain
    request returns, or `error`."""
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    if not body.get("stream"):
        return await _one_turn(request, body, None)
    resp = web.StreamResponse(headers={
        "Content-Type": "application/x-ndjson", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"})
    await resp.prepare(request)

    async def emit(event: dict[str, Any]) -> None:
        await resp.write((_json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"))

    out = await _one_turn(request, body, emit)
    try:
        data = _json.loads(out.text or "{}")
    except ValueError:
        data = {}
    if out.status >= 400:
        await emit({"type": "error", "status": out.status,
                    "message": str(data.get("error") or "something went wrong")})
    else:
        await emit({"type": "done", "result": data})
    await resp.write_eof()
    return resp


# Chats with a turn running. A second request for the same chat (another
# tab, a resume racing a new message) would build on the same log and both
# would append, so it is refused instead.
_BUSY: set[str] = set()


async def _one_turn(request: web.Request, body: dict[str, Any], emit: Any) -> web.Response:
    chat_id = body.get("chat_id")
    if not isinstance(chat_id, str) or not chat_id:
        return await _chat_turn(request, body, emit)
    if chat_id in _BUSY:
        return json_error("this chat is still answering; wait for it or press Stop",
                          status=409)
    _BUSY.add(chat_id)
    try:
        return await _chat_turn(request, body, emit)
    finally:
        _BUSY.discard(chat_id)


@dataclass
class _Ask:
    """What the browser sent for this turn, checked (`_read_ask`)."""

    #: The user's message; on a retry, the retried turn's own message once
    #: `_rewind` has run; on a resume, the paused turn's message.
    text: Any
    images: list[dict[str, Any]]
    #: `results`: the browser answering the calls a paused turn waits on
    #: (page tools it ran, or the user's answer to a web search).
    answers: Any
    resume: bool
    retry: bool
    #: Edit last message: a retry that brings new text for that message.
    edited: bool
    page: dict[str, Any] | None
    chat_id: str | None


@dataclass
class _Turn:
    """One answer being worked out: what the step loop (`_step`), the calls
    in each step (`_run_call`) and the closing lines (`_close`) share."""

    request: web.Request
    body: dict[str, Any]
    emit: Any
    cfg: dict[str, Any]
    ask: _Ask
    lib: Any
    chat: dict[str, Any] | None
    log: list[dict[str, Any]]
    meta: dict[str, Any]
    snapshot: Any
    fmt: str
    base_prof: dict[str, Any]
    prof: dict[str, Any]
    fixed: int
    window: Any
    num_ctx: int
    retried_from: int | None
    #: The entries this answer adds to the chat log.
    new: list[dict[str, Any]]
    fp_now: Any
    #: How many items a multi-item ask names (0: not one, or not planned).
    plan_n: int
    #: The step's tool shortlist for small models (None: every tool).
    short: Any
    #: The message as `ai_tools.message_kind` reads it: "question" and
    #: "chat" steps are offered no change tools.
    asks_kind: str
    #: What earlier paused calls did, for the empty-answer line.
    first_done: list[str]
    step: int
    deadline: float
    #: When this request started working (`time.monotonic`), for the
    #: answer's "took" time.
    started: float = field(default_factory=time.monotonic)
    proposals: list[dict[str, Any]] = field(default_factory=list)
    tool_use: dict[str, int] = field(default_factory=lambda: {"calls": 0, "salvaged": 0})
    steps: list[dict[str, Any]] = field(default_factory=list)
    pause: list[dict[str, Any]] = field(default_factory=list)
    message: str = ""
    interim: str = ""
    seen: set[str] = field(default_factory=set)
    #: Change calls that failed, by their exact args: the same call again
    #: fails the same way (round 2: an identical create_wildcard twice).
    failed: dict[str, str] = field(default_factory=dict)
    errors: dict[str, int] = field(default_factory=dict)
    #: Refusals by tool and reason (ids and numbers left out).
    refused: dict[str, int] = field(default_factory=dict)
    forced: bool = False
    #: A step of only repeated calls was let through once (`_repeat_pass`).
    repeat_passed: bool = False
    checked: bool = False
    #: The cards were checked against the request (`request_check`), once.
    gap_checked: bool = False
    gaps: list[str] = field(default_factory=list)
    nudged: bool = False
    #: The step whose create calls were turned to plan_pack (`PACK_FIRST`).
    steered_at: int | None = None
    empty_nudged: bool = False
    #: The steps this answer may take: `MAX_STEPS`, more while a plan of
    #: items runs (`queue`).
    cap: int = 0
    #: The step limit: one past `cap` once, for the words-only nudge after
    #: an empty answer at the limit.
    limit: int = 0
    #: A multi-item ask's items, made one per step once planned.
    queue: ai_plan.ItemQueue | None = None
    #: The first step was asked to plan (only once).
    plan_asked: bool = False
    #: A more_tools call opened every tool the chat has for this answer.
    widened: bool = False
    #: Tools called in this answer: a shortlist keeps offering them.
    called: set[str] = field(default_factory=set)
    #: The model was told its plan is finished.
    queue_told: bool = False
    #: Change calls proposed in this request, by their exact args: the card's pid.
    proposed: dict[str, str] = field(default_factory=dict)
    #: Repeats per tool (exact calls answered by `_repeated`, cards that
    #: replaced their own earlier version) and the tools taken out of the
    #: grammar for the rest of the answer for looping (`_loop_check`).
    loops: dict[str, int] = field(default_factory=dict)
    closed: set[str] = field(default_factory=set)
    #: The next step's tools after the request check's nudge, once
    #: (`request_check.fix_tools`).
    gap_offer: list[str] | None = None
    #: Ask the next step with the model's thinking off: set by the empty
    #: nudge, since a thinking model that came back empty once tends to
    #: think itself out of an answer again.
    think_off: bool = False
    #: The answer a nudge set aside: shown if the nudged step comes back empty.
    set_aside: str = ""
    #: A cut answer waiting for the step that continues it, and how many
    #: continuations this answer had.
    carry: str = ""
    continued: int = 0
    out_of_time: bool = False
    reads: int = 0
    ran: int = 0
    sent_steps: int = 0
    read_budget: int = 0
    last_answer: str = ""
    usage: dict[str, Any] = field(default_factory=dict)
    #: The tail blocks the user's message carried (`ai_trace.TAIL_KINDS`).
    tail_kinds: list[str] = field(default_factory=list)
    #: The tools the current step's grammar offers (None: all of the chat's).
    offered: list[str] | None = None
    #: One record per model step (`ai_trace.step_record`).
    trace: list[dict[str, Any]] = field(default_factory=list)
    #: The message read into a request frame when it isn't in English
    #: (`engine/ai/lang.py`): what the code checks read instead of its words.
    frame: dict[str, Any] | None = None

    @property
    def text(self) -> Any:
        return self.ask.text

    @property
    def check(self) -> str:
        """The text the English checks read: the frame's restatement, else
        the message."""
        return ai_lang.check_text(self.frame, self.text if isinstance(self.text, str) else "")

    @property
    def split(self) -> bool:
        return _splits(self.cfg, self.meta, self.fmt)

    def no_step_yet(self, *, in_log: bool = False) -> bool:
        """Nothing worked out yet in this answer (or, `in_log`, the chat)."""
        entries = self.log + self.new if in_log else self.new
        return not self.steps and not any(x.get("kind") == "step" for x in entries)


#: What `_step` tells the loop: go on with the next step, or stop.
_NEXT = "next"
_STOP = "stop"


async def _chat_turn(request: web.Request, body: dict[str, Any], emit: Any) -> web.Response:
    """Body: {message, chat_id?, page?: {route, id?, doc?, note?, editor?},
    events?: [{pid, status}], retry?: true}.

    `retry` runs the last message again; with a non-empty `message` it runs
    that text instead (the user edited their last message).

    The server keeps the chat (`ai_chats`), so the browser sends only the new
    message; without a `chat_id` (or with one that's gone) a new chat starts.
    `events` say what the user did with earlier proposal cards (applied,
    undone, dismissed, …). `editor` is the open editor's item as it stands,
    unsaved changes included; the chat reads and changes that version.

    Runs up to `chat.MAX_STEPS` model steps. Read tools run here and their
    results go back to the model; change tools become proposals the manager
    shows as cards. Nothing is written to the library. The turn is stored
    only once it finishes, so a failed turn leaves the chat as it was.

    The phases: `_read_ask` (the request), `_rewind` (retry / edit),
    `_quick_reaction`, `_start_chat` or the stored chat, `_prepare` (the
    user's entry, paused results, the items the edit tools may change),
    then `_step` until the answer stands, and `_close` (closing lines, the
    stored chat).
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    ask = await _read_ask(body, cfg)
    if isinstance(ask, web.Response):
        return ask
    vocab_kinds = await _vocab_kinds(body)

    with db_session(request) as conn:
        lib = ai_chat.Library(
            ModuleRepository(conn).list(), BundleRepository(conn).list(),
            CategoryRepository(conn).list(), TemplateRepository(conn).list(),
        )
        lib.index = _synced_index(conn, lib)
        chat: dict[str, Any] | None = None
        log: list[dict[str, Any]] = []
        if ask.chat_id:
            try:
                chat = ChatRepository(conn).get(ask.chat_id)
                log = ChatRepository(conn).messages(ask.chat_id)
            except ChatNotFound:
                chat = None
    retried_from: int | None = None
    if ask.retry:
        rewound = _rewind(ask, chat, log)
        if isinstance(rewound, web.Response):
            return rewound
        chat, log, retried_from = rewound
    paused = (chat or {}).get("meta", {}).get("pending") if chat else None
    quick = _quick_reaction(request, body, ask, chat, log, paused)
    if quick is not None:
        return quick
    if ask.resume:
        if not paused:
            return json_error("nothing in this chat is waiting for an answer", status=409)
        ask.text = ai_chatlog.last_user_text(log)
    elif sum(1 for e in log if e.get("kind") == "user") >= ai_chat.MAX_TURNS:
        return json_error("this chat is long; start a new one to keep it focused", status=400)
    if lib.index is not None and _ai_embed.enabled(cfg):
        lib.embed_model = cfg["embed_model"]
        _ai_embed.fill_in_background(cfg, lib.index)
    prof = ai_budget.profile(cfg)
    rows = [*lib.modules.values(), *lib.bundles.values(), *lib.templates.values()]
    fp_now = ai_chatlog.fingerprint(rows, lib._kind)
    if chat is None:
        fmt, meta, snapshot = await _start_chat(lib, cfg, prof, ask.page, vocab_kinds)
    else:
        meta = dict(chat["meta"])
        snapshot = chat["snapshot"]
        fmt = str(meta.get("format")) if meta.get("format") in ("native", "json") else "json"
        if cfg.get("tool_format") in ("native", "json") and cfg["tool_format"] != fmt \
                and not any(e.get("kind") == "step" for e in log):
            fmt = cfg["tool_format"]
    if ask.page:
        lib.use_editor(ask.page.get("editor"))
    lib.allow_delete = bool(cfg.get("allow_delete"))
    lib.vocab, lib.vocab_kinds = _ai_vocab.lookup, vocab_kinds
    t = await _prepare(request, body, emit, cfg, ask, lib, chat, log, meta, snapshot, fmt,
                       prof, fp_now, retried_from, paused, vocab_kinds)
    if not ask.resume and ask.text:
        # "perfect, now add boots": its reaction shows as the message is
        # sent, not once the answer is done (Dumi, 2026-10-22).
        lib.opening_reaction = ai_react.opening(ask.text)
        if lib.opening_reaction and emit:
            await emit({"type": "reaction", "emoji": lib.opening_reaction})
    while t.step < t.limit:
        got = await _step(t)
        if isinstance(got, web.Response):
            return got
        if got == _STOP:
            break
    return await _close(t)


async def _read_ask(body: dict[str, Any], cfg: dict[str, Any]) -> _Ask | web.Response:
    """The turn's request, checked: the message, images and what kind of
    turn it is (new message, retry, edit or resume)."""
    answers = body.get("results")
    resume = isinstance(answers, list)
    text = body.get("message")
    retry = bool(body.get("retry")) and not resume
    edited = retry and isinstance(text, str) and bool(text.strip())
    if retry and not edited:
        text = "(retry)"  # replaced by the turn's own message (`_rewind`)
    images: list[dict[str, Any]] = []
    if not resume and not retry:
        try:
            images = _ai_images.clean(body.get("images"))
        except _ai_images.ImageError as e:
            return json_error(str(e), status=400)
        if images and await _ai_chat.vision_support(cfg) is False:
            return json_error(f"{cfg.get('model')} can't see images. Pick a vision model "
                              "(Gemma 3, Qwen2.5-VL, Llama 3.2 Vision, …) to send one.",
                              status=400)
    if not resume:
        if not isinstance(text, str):
            return json_error("say something first", status=400)
        text = ai_safety.strip_invisible(text).strip()
        if not text and not images:
            return json_error("say something first", status=400)
        if len(text) > ai_chat.MAX_TURN_CHARS:
            text = text[:ai_chat.MAX_TURN_CHARS] + " …"
    page = _got if isinstance(_got := body.get("page"), dict) else None
    chat_id = _got if isinstance(_got := body.get("chat_id"), str) else None
    return _Ask(text=text, images=images, answers=answers, resume=resume, retry=retry,
                edited=edited, page=page, chat_id=chat_id)


def _rewind(
    ask: _Ask, chat: dict[str, Any] | None, log: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]], int] | web.Response:
    """Retry or edit: the chat as it was before its last turn, with that
    turn's cards, fixes and answered asks dropped. Sets the ask's text and
    images to the retried turn's (an edit keeps its new text)."""
    if chat is None:
        return json_error("that chat is gone", status=404)
    retried_from = ai_chatlog.last_turn_start(log)
    if retried_from is None:
        return json_error("nothing to try again", status=409)
    turn_pids = {p.get("pid") for e in log[retried_from:] if e.get("kind") == "shown"
                 for p in (e.get("view") or {}).get("proposals") or []}
    shown_status = (chat["meta"].get("shown_status") or {})
    model_status = (chat["meta"].get("proposals") or {})
    if any((shown_status.get(pid) or {}).get("status") in ("applied", "editor")
           or (model_status.get(pid) or {}).get("status") in ("applied", "editor")
           for pid in turn_pids):
        return json_error("undo the changes you applied from that answer first",
                          status=409)
    if not ask.edited:
        ask.text = str(log[retried_from].get("text") or "")
    ask.images = list(log[retried_from].get("images") or [])
    log_cut = log[retried_from:]
    log = log[:retried_from]
    m = dict(chat["meta"])
    m.pop("pending", None)
    m["proposals"] = {k: v for k, v in (m.get("proposals") or {}).items()
                      if k not in turn_pids}
    m["shown_status"] = {k: v for k, v in shown_status.items() if k not in turn_pids}
    # Pids and call ids get reused by the new turn: drop what the old one
    # left behind (card fixes, answered asks), and keep masking out of it.
    turn_calls = {c.get("id") for e in log_cut for c in e.get("calls") or []
                  if isinstance(c, dict)}
    m["fixes"] = {k: v for k, v in (m.get("fixes") or {}).items() if k not in turn_pids}
    m["asked"] = {k: v for k, v in (m.get("asked") or {}).items() if k not in turn_calls}
    m["decisions"] = [d for d in m.get("decisions") or []
                      if not (isinstance(d, dict) and d.get("call") in turn_calls)]
    for key in ("masked_before", "dropped_before"):
        if int(m.get(key) or 0) > retried_from:
            m[key] = retried_from
    return {**chat, "meta": m}, log, retried_from


def _quick_reaction(
    request: web.Request, body: dict[str, Any], ask: _Ask, chat: dict[str, Any] | None,
    log: list[dict[str, Any]], paused: Any,
) -> web.Response | None:
    """A message that is only thanks or praise: a reaction, no model call,
    and nothing the model will read (`aside` entries aren't rendered)."""
    if (chat is None or ask.resume or ask.retry or paused or ask.images
            or body.get("events") or not any(e.get("kind") == "step" for e in log)
            or ai_chatlog.last_reply(log).rstrip().endswith("?")):
        return None
    reaction = ai_react.quick(ask.text)
    if not reaction:
        return None
    with db_session(request) as conn:
        ChatRepository(conn).append(chat["id"], [ai_chatlog.aside_entry(ask.text, reaction)],
                                    meta=chat["meta"])
    return json_ok({"chat_id": chat["id"], "aside": True, "reaction": reaction,
                    "message": "", "proposals": [], "steps": [], "refs": {},
                    "pending": [], "model": str(chat["meta"].get("model") or "")})


async def _start_chat(
    lib: Any, cfg: dict[str, Any], prof: dict[str, Any], page: dict[str, Any] | None,
    vocab_kinds: Any,
) -> tuple[str, dict[str, Any], Any]:
    """A new chat's tool format, meta and snapshot."""
    fmt = await _ai_chat.pick_format(cfg)
    web_on = _ai_search.enabled(cfg)
    reader_on = web_on and _ai_web.reader_ready(cfg)
    danbooru_on = bool(cfg.get("danbooru_lookup"))
    meta: dict[str, Any] = {
        "format": fmt, "proposals": {}, "fingerprint": {},
        "tools": ai_tools.toolset(page.get("route") if page else None,
                                  scoped=prof["slim"] or bool(prof.get("scoped")),
                                  wide=not prof["slim"], web=web_on,
                                  delete=bool(cfg.get("allow_delete")),
                                  vocab=bool(vocab_kinds), reader=reader_on,
                                  danbooru=danbooru_on),
        "vocab": sorted(vocab_kinds),
        "web": web_on, "reader": reader_on, "danbooru": danbooru_on,
        "delete": bool(cfg.get("allow_delete")),
        # JSON-mode args as objects the server checks (fixed per chat so
        # the instructions stay the same).
        "typed": _ai_chat.checks_schema(cfg),
        # Told in the first message's tail when on (_sync_permissions).
        "auto": False,
        # Small and medium models: each step asked in two parts
        # (`_ai_chat.split_step`), and the rare tool groups loaded only
        # when asked (`more_tools`), appended to the end of the list.
        "split": bool(prof.get("split")),
        "lazy": bool(prof["slim"] or prof.get("scoped")),
        # Lean prompt (Settings › AI assistant › Advanced): small models in
        # typed JSON steps get one line per tool, and each tool's docs with
        # the step that first offers it (`_tool_docs`).
        "tool_index": bool(cfg.get("lean_prompt")) and prof.get("size") == "small"
        and fmt == "json" and _ai_chat.checks_schema(cfg) and bool(prof.get("split")),
    }
    if meta["lazy"]:
        # Their tools aren't declared up front: the first message's
        # tail says how to load them (`_sync_permissions`).
        meta.update(web=False, reader=False, danbooru=False)
    # As lean as the model's window needs (a 16k window can't hold all
    # 37 tool declarations plus the full instructions).
    snapshot = _open_chat(lib, cfg, meta, prof, page, fmt, await _window(cfg, meta))
    return fmt, meta, snapshot


def _permission_notes(meta: dict[str, Any], cfg: dict[str, Any], body: dict[str, Any],
                      vocab_kinds: Any, fmt: str, ask: _Ask, check: str) -> str:
    """What changed in the chat's tools and permissions since the last
    message, and the tool groups this message asks for by name (loaded)."""
    had = list(meta.get("tools") or [])
    perms = " ".join(x for x in (_sync_permissions(meta, cfg), _sync_vocab(meta, vocab_kinds),
                                 _canvas_note(meta, body)) if x)
    added = [n for n in meta.get("tools") or [] if n not in had]
    if added and fmt == "json" and meta.get("prompt_tools"):
        # The JSON prompt keeps the tools the chat started with: say how
        # the new ones are called here instead.
        perms += "\n" + ai_chat.kinds_section(ai_tools.tools(added)).strip()
    if not ask.resume and ask.text and _ORGANIZE_ASK.search(check):
        perms = "\n".join(x for x in (perms, ai_chat.ORGANIZE_HINT) if x)
    if not ask.resume and ask.text:
        # The groups the message asks for by name come loaded: small models
        # rarely call more_tools and fake the missing tool with another.
        for group in ai_tools.groups_for(check):
            if group in ai_tools.MORE_GROUPS:
                got = _more_tools(meta, group)
                if got.startswith("These tools"):
                    perms = "\n".join(x for x in (perms, got) if x)
    return perms


async def _prepare(
    request: web.Request, body: dict[str, Any], emit: Any, cfg: dict[str, Any], ask: _Ask,
    lib: Any, chat: dict[str, Any] | None, log: list[dict[str, Any]], meta: dict[str, Any],
    snapshot: Any, fmt: str, prof: dict[str, Any], fp_now: Any, retried_from: int | None,
    paused: Any, vocab_kinds: Any,
) -> _Turn:
    """Everything before the first step: the notes that ride with the
    message, the paused calls' results, the user's entry, the context
    profile, and which items the edit tools may change."""
    text = ask.text
    # A message that isn't in English: read into a request frame first, so
    # the checks below read an English restatement (`engine/ai/lang.py`).
    frame = await _ai_lang.frame(cfg, text, emit)
    check = ai_lang.check_text(frame, text if isinstance(text, str) else "")
    lib.request_frame = frame
    perms = _permission_notes(meta, cfg, body, vocab_kinds, fmt, ask, check)
    meta, since = ai_chatlog.apply_events(meta, body.get("events"))
    route = str(ask.page.get("route") or "") if ask.page else ""
    if ask.page and route != meta.get("page_route"):
        # Another page: anchors read on the last one don't point here.
        meta["page_route"] = route
        meta.pop("page_read", None)
    changes = ai_chatlog.library_changes(meta.get("fingerprint") or {}, fp_now)
    note = lib.page_note(ask.page)
    if note and note == meta.get("page_note"):
        note = ""  # still on the same page: it is in the history already
    elif note:
        meta["page_note"] = note
    new: list[dict[str, Any]] = []
    first_steps: list[dict[str, Any]] = []
    first_done: list[str] = []
    step = 0
    if paused:
        # Every paused call gets its result before anything else: the
        # browser's answers, or "not run" when the user moved on.
        meta = dict(meta)
        meta.pop("pending", None)
        got = {a["id"]: a for a in (ask.answers or []) if isinstance(a, dict)
               and isinstance(a.get("id"), str)} if ask.resume else {}
        items, first_steps, first_done = await _paused_results(cfg, meta, paused, got)
        tail = ""
        if ask.resume:
            step = int(paused.get("step") or 0)
            tail = "".join("\n\n" + x for x in (since, changes, perms, note) if x)
            tail += _results_tail(
                text, last=step >= ai_chat.MAX_STEPS - 1, native=fmt == "native",
                split=_splits(cfg, meta, fmt))
        new.append(ai_chatlog.results_entry(items, tail))
    num_ctx = int(cfg.get("context_max") or ai_budget.CONTEXT_DEFAULT)
    window = await _window(cfg, meta)
    base_prof = prof
    prof, fixed = _chat_profile(base_prof, cfg, meta, fmt, snapshot, window)
    if not ask.resume and log:
        meta = await _maybe_compact(cfg, log, meta, prof, num_ctx, window, fixed, emit)
    # Small and medium local models (split JSON steps with typed args): each
    # step's grammar offers a shortlist of the chat's tools, and an ask for
    # several items is planned once and made one item per step
    # (`engine/ai/plan_items.py`). The prompt keeps every tool either way.
    guided = (not ask.resume and bool(text) and fmt == "json" and bool(meta.get("typed"))
              and _ai_chat.checks_schema(cfg) and _splits(cfg, meta, fmt))
    # A question or chat gets no change tools (harness note H3); a chat that
    # already proposed cards counts a follow-up as more work.
    working = bool(meta.get("proposals"))
    asks_kind = (ai_lang.message_kind(frame, working) or ai_tools.message_kind(check, working)) \
        if guided else "task"
    short = ai_tools.shortlist(meta["tools"], check, route, working=working,
                               kind=asks_kind) if guided else None
    plan_n = ai_plan.multi_ask(check) if guided and not _PACK_ASK.search(check) else 0
    tail_kinds: list[str] = []
    if plan_n and not any(n in ai_plan.PLANNABLE for n in meta["tools"]):
        plan_n = 0
    if not ask.resume:
        meta.pop("asks", None)  # ask pauses are counted per user message
        meta.pop("pointed", None)  # so are the parts already highlighted
        meta.pop("page_reads", None)  # and the page parts already read
        # The user's words and the restatement both: item names may be in
        # either language.
        found = text if check == text else f"{text}\n{check}"
        hints = await _retrieval(lib, found, meta, prof, cfg) if text else ""
        pics = _ai_images.note(len(ask.images)) if ask.images else ""
        model = ai_guide.model_note(check) if text else ""
        plan_hint = ai_plan.HINT if plan_n else ""
        # Small and medium models: the closest calls that worked before
        # (`engine/ai/examples.py`).
        shown_examples = ai_examples.note(ai_examples.pick(check, meta["tools"])) \
            if text and _splits(cfg, meta, fmt) else ""
        steps_hint = ai_recipes.recipe(check) if text and not plan_n \
            and _splits(cfg, meta, fmt) else ""
        # Small and medium models: a few lines on each feature this ask
        # touches (`engine/ai/cards.py`), once while the model can see them.
        cards = _feature_cards(lib, text, route, meta, len(log), check) \
            if text and _splits(cfg, meta, fmt) else []
        ai_cards.mark(meta, cards, len(log) + len(new))
        card_note = ai_cards.note(cards)
        if cards:
            offers = ai_cards.offers(cards)
            if asks_kind != "task":
                offers = [n for n in offers if ai_tools.looks(n)]
            short, unlocked = _card_tools(meta, short, offers)
            card_note += unlocked
            if plan_n:
                # "…then make each setting get only outfits that suit it"
                # asks for a constraint without the word: room in the plan
                # for each item kind a card brings that the count missed.
                plan_n = min(ai_plan.MAX_ITEMS, plan_n + _unnamed_kinds(check, cards))
        tail_kinds = ai_trace.tail_kinds({
            "since": since, "changes": changes, "perms": perms, "images": pics, "page": note,
            "library": hints, "model": model, "examples": shown_examples,
            "cards": card_note, "recipe": steps_hint, "plan": plan_hint})
        sent = ai_safety.strip_invisible(
            "\n\n".join(x for x in (since, changes, perms, text, pics, note, hints, model,
                                    shown_examples, card_note, steps_hint, plan_hint) if x))
        new.append(ai_chatlog.user_entry(text, sent, ask.images))
        meta = ai_chatlog.move_images(log + new, meta)
    _scope_edits(lib, meta, ask, log, paused, check)
    # Links read_result may open: the same list the searches fill.
    lib.web_urls = meta.setdefault("web_urls", [])
    _adopt_earlier(lib, log, meta)
    loop = asyncio.get_running_loop()
    t = _Turn(
        request=request, body=body, emit=emit, cfg=cfg, ask=ask, lib=lib, chat=chat,
        log=log, meta=meta, snapshot=snapshot, fmt=fmt, base_prof=base_prof, prof=prof,
        fixed=fixed, window=window, num_ctx=num_ctx, retried_from=retried_from, new=new,
        fp_now=fp_now, plan_n=plan_n, short=short, asks_kind=asks_kind,
        first_done=first_done, step=step,
        deadline=loop.time() + (TURN_SECONDS_LOCAL if cfg.get("local") else TURN_SECONDS),
        steps=first_steps, cap=ai_chat.MAX_STEPS, limit=ai_chat.MAX_STEPS, tail_kinds=tail_kinds,
        sent_steps=len(first_steps), read_budget=ai_chat.read_budget(prof["size"]),
        last_answer=ai_chatlog.last_reply(log), frame=frame,
    )
    if ask.resume and step >= ai_chat.MAX_STEPS - 1:
        t.forced = True  # its results tail already says to answer now
    return t


def _feature_cards(lib: Any, text: str, route: str, meta: dict[str, Any],
                   log_len: int, check: str = "") -> list[ai_cards.Card]:
    """The feature cards one message needs, from its words (``check``: the
    English restatement of one in another language), the kinds of the
    items it @-picks and the page it was sent from."""
    kinds = {lib.kind_of(i) for i in ai_cards.picked_ids(text)} - {""}
    return ai_cards.pick(check or text, kinds=kinds, route=route,
                         shown=ai_cards.sent(meta, log_len))


_KIND_WORDS = {"create_constraint": r"constraints?", "create_derivation": r"derivations?|rules?",
               "create_bundle": r"bundles?|stacks?", "create_template": r"templates?",
               "create_combine": r"combines?", "create_fixed_values": r"fixed[ -]?values?"}


def _unnamed_kinds(text: str, cards: list[ai_cards.Card]) -> int:
    """Item kinds the cards' create tools make that the message never names."""
    return sum(1 for tool in ai_cards.offers(cards) if tool in _KIND_WORDS
               and not re.search(rf"\b(?:{_KIND_WORDS[tool]})\b", text, re.I))


def _card_tools(meta: dict[str, Any], short: list[str] | None,
                offers: list[str]) -> tuple[list[str] | None, str]:
    """The step shortlist plus the tools the message's cards name; a named
    tool the chat doesn't have yet comes with its group, as `more_tools`
    would bring it (its docs go in the message tail)."""
    unlocked = ""
    for group in dict.fromkeys(
            g for n in offers if n not in (meta.get("tools") or []) and n in ai_tools.BY_NAME
            for g in ai_tools.BY_NAME[n].groups[:1] if g in ai_tools.MORE_GROUPS):
        got = _more_tools(meta, group)
        if got.startswith("These tools"):
            unlocked += "\n\n" + got
    if short is not None:
        short = [*short, *(n for n in offers if n in meta["tools"] and n not in short)]
    return short, unlocked


def _tool_card(t: _Turn, tool: str) -> str:
    """A change tool's feature card, the first time it is used or fails
    while the model can't see it yet, for the end of that call's result."""
    if not t.split or tool not in ai_chat.CHANGE_TOOLS:
        return ""
    at = len(t.log) + len(t.new)
    card = ai_cards.for_tool(tool, ai_cards.sent(t.meta, at))
    if card is None:
        return ""
    ai_cards.mark(t.meta, [card], at, in_result=True)
    return f"\n(Note: {card.title}: {card.text})"


def _scope_edits(lib: Any, meta: dict[str, Any], ask: _Ask, log: list[dict[str, Any]],
                 paused: Any, check: str = "") -> None:
    """The library items the edit tools may change: ones the user named in
    this chat, the page's item, and ones an earlier card already changes
    or created;
    plus the card numbering and what `ask` may not ask again. ``check``:
    the English restatement of a message in another language."""
    text = ask.text
    check = check or (text if isinstance(text, str) else "")
    pids = [int(p[1:]) for p in meta.get("proposals") or {} if p[1:].isdigit()]
    lib._next_pid = max(pids, default=0)
    lib.earlier_proposals = dict(meta.get("proposals") or {})
    named = set(meta.get("named") or [])
    if not ask.resume and text:
        named |= lib.named_in(text) | (lib.named_in(check) if check != text else set())
        # The items the answer they are replying to showed as chips count
        # as named too ("Now add negatives to the stormy options" after
        # "You have [[Weather]] …"; chat eval round 4 refused every edit).
        named |= lib.shown_in(ai_chatlog.last_shown(log))
    answered_named = _named_by_answers(lib, paused if ask.resume else None, ask.answers)
    named |= answered_named
    if ask.page and isinstance(ask.page.get("id"), str):
        named.add(ask.page["id"])
    for p_ in lib.earlier_proposals.values():
        op = p_.get("op") if isinstance(p_, dict) else None
        if isinstance(op, dict) and op.get("op") == "update" and isinstance(op.get("id"), str):
            named.add(op["id"])
        # The item a card of this chat changes or made (applied at the
        # card's id): the 9B was refused renaming the Hair it had just
        # created (smoke s-rename-var, 2026-10-23).
        if isinstance(p_, dict) and isinstance(p_.get("item"), str):
            named.add(p_["item"])
    meta["named"] = sorted(named)
    lib.named = named
    if not ask.resume and text:
        meta["ref_asks"] = sorted(ai_chat.ref_asks(check))
        meta["asked_words"] = sorted({w.lower() for said in dict.fromkeys((text, check))
                                      for m in _VAR_WORD.findall(said) for w in m if w})
        # A rating lowered to safe needs the user's say-so (ratings.keep_nsfw),
        # read in English too when the message isn't.
        meta["user_text"] = "\n".join(dict.fromkeys((text[:2000], check[:2000])))
        meta["delete_scope"] = ai_manage.delete_scope(meta["user_text"])
        meta["read_only"] = ai_chat.explain_ask(text)
    lib.read_only = bool(meta.get("read_only"))
    lib.delete_scope = dict(meta.get("delete_scope") or {})
    lib.ref_asks = set(meta.get("ref_asks") or [])
    lib.user_text = str(meta.get("user_text") or "")
    lib.asked_words = set(meta.get("asked_words") or [])
    # An item the answer reads in full may be changed when the user asked
    # for a change ("add negatives to the stormy options"), not a new item.
    lib.edit_read = (bool(text) and not ask.resume and not ai_chat.creation_ask(check)) \
        or bool(answered_named)
    lib.decisions = list(meta.get("decisions") or [])  # what `ask` may not ask again


#: A variable the user's message names: "$hair", "hair_color", or a word
#: after "to" / "named" / "called" ("rename it to hue"), not any word ("a
#: color wildcard" doesn't ask for $color).
_VAR_WORD = re.compile(r"\$([A-Za-z_]\w{0,40})|(?<![\w$])([A-Za-z]\w*_\w+)"
                       r"|\b(?:to|named|called)\s+([A-Za-z_]\w{0,40})", re.I)


def _offer(t: _Turn) -> tuple[list[Any] | None, bool]:
    """The tools this step's grammar offers, and whether it must call one:
    the plan tool first, then the plan's next item, else the shortlist."""
    if t.plan_n and not t.plan_asked and not t.forced:
        t.plan_asked = True
        return [ai_plan.plan_tool(t.meta["tools"], t.plan_n)], True
    if t.queue is not None and t.queue.active and not t.forced:
        return ai_tools.tools([n for n in t.queue.allowed() if n in t.meta["tools"]]), True
    if t.gap_offer:
        fix = [n for n in t.gap_offer if n in t.meta["tools"] and n not in t.closed]
        t.gap_offer = None
        if fix:
            return ai_tools.tools(fix), False
    if t.short and not t.widened:
        # Plus what usually follows this answer's calls (`ai_narrow.NEXT`),
        # a test once it made a card, the docs once a call failed (H5).
        follow = ai_narrow.next_tools(t.called, {t.lib.kind_of(i) for i in t.lib.touched})
        if t.proposals:
            follow |= set(ai_tools.AFTER_CHANGE)
        if t.errors:
            follow |= set(ai_tools.DOCS_TOOLS)
        if t.asks_kind != "task":
            follow = {n for n in follow if ai_tools.looks(n)}
        return ai_tools.tools([n for n in t.meta["tools"] if n not in t.closed
                               and (n in t.short or n in t.called or n in follow)]), False
    if t.closed:
        return ai_tools.tools([n for n in t.meta["tools"] if n not in t.closed]), False
    return None, False


#: Repeats of one tool in an answer before it leaves the grammar.
MAX_LOOPS = 2


def _loop_check(t: _Turn, tool: str) -> str:
    """Count a repeat of `tool`; at MAX_LOOPS it leaves the grammar for the
    rest of the answer (harness research H2: Mingbird's anti-loop; the 9B
    re-proposed the same Setting card four times in smoke s-only). Not in a
    plan run, where the same tool on the next item is the point. Returns
    the line that tells the model."""
    t.loops[tool] = t.loops.get(tool, 0) + 1
    if t.loops[tool] < MAX_LOOPS or tool in t.closed or tool == "more_tools" \
            or (t.queue is not None and t.queue.active):
        return ""
    t.closed.add(tool)
    return (f"\n({tool} is closed for the rest of this answer: you repeated it. Answer "
            "with what you have, or do the next part of the request with another tool.)")


def _check_call(proposals: list[dict[str, Any]]) -> str:
    """The run_test call for CHECK_NUDGE, spelled out: told only to test,
    the 9B answered "I cannot run a test automatically, no such stack
    exists" (smoke s-negatives, empty library, 2026-10-23)."""
    stack: list[str] = []
    for p_ in proposals:
        op = p_.get("op") if isinstance(p_.get("op"), dict) else {}
        body = op.get("body") if isinstance(op.get("body"), dict) else {}
        ref = op.get("id") if op.get("op") == "update" else body.get("name")
        if p_.get("tool") in ai_chat.CHECKABLE_TOOLS and isinstance(ref, str) \
                and ref and ref not in stack:
            stack.append(ref)
    if not stack:
        return ""
    call = ai_chatlog.dumps({"proposed": True, "stack": stack[:4]})
    return f" A card is enough for a stack of its own: run_test {call}"


def _repeat_pass(t: _Turn, calls: list[dict[str, Any]], items: list[dict[str, Any]]) -> bool:
    """A small model's change ask (a shortlisted, guided chat) with no card
    yet whose step only repeated a look-up
    gets one more step, with the repeated tools closed, instead of being
    made to answer: the 9B looked up $hair_color twice, then claimed a
    rename it never proposed (smoke s-rename-var, 2026-10-24)."""
    if t.repeat_passed or t.proposals or t.short is None or t.asks_kind != "task" or t.plan_n \
            or t.step >= t.cap - 1 or any(c["tool"] in ai_chat.CHANGE_TOOLS for c in calls):
        return False
    t.repeat_passed = True
    closed = sorted({c["tool"] for c in calls} - {"more_tools"})
    t.closed.update(closed)
    if items and closed:
        items[-1]["text"] = (items[-1].get("text") or "") + (
            f"\n({', '.join(closed)} {'is' if len(closed) == 1 else 'are'} closed for the rest "
            "of this answer. Make the change the user asked for now.)")
    return True


#: Where each kind of log entry keeps the text the model reads last.
_TAIL_FIELD = {"user": "sent", "results": "tail", "note": "text"}


def _tool_docs(t: _Turn, offer: list[Any] | None) -> None:
    """Lean prompt (`meta["tool_index"]`): the full docs of each offered
    tool the model can't read yet, at the end of the newest entry (which no
    request carried yet, so the log stays append-only). Remembered as
    `tool:<name>` keys beside the feature cards, so a masked or cut entry
    sends them again."""
    if not t.meta.get("tool_index") or offer is None or t.forced:
        return
    at = len(t.log) + len(t.new) - 1
    seen = ai_cards.sent(t.meta, at + 1)
    fresh = [x for x in offer if x.name in ai_tools.BY_NAME and f"tool:{x.name}" not in seen]
    if not fresh:
        return
    docs = "Tools for this step:\n" + ai_chat.kinds_section(fresh).strip()
    last = t.new[-1] if t.new else {}
    field = _TAIL_FIELD.get(str(last.get("kind")))
    if field is None:
        t.new.append(ai_chatlog.note_entry(docs))
        at += 1
    else:
        last[field] = (last.get(field) or "") + "\n\n" + docs
    t.meta["cards"] = {**(t.meta.get("cards") or {}),
                       **{f"tool:{x.name}": [at, False] for x in fresh}}


def _narrowed(t: _Turn, offer: list[Any] | None) -> list[Any] | None:
    """A typed JSON step's offer with its fields limited to what exists and
    may be changed (`engine/ai/narrow.py`); grammar only, so free."""
    key = (str(t.cfg.get("base_url") or ""), str(t.cfg.get("model") or ""))
    if not (t.fmt == "json" and t.split and t.meta.get("typed")
            and _ai_chat.checks_schema(t.cfg)) or key in _ai_chat.NO_ENUMS:
        return offer
    return ai_narrow.narrow(offer if offer is not None else ai_tools.tools(t.meta["tools"]),
                            t.lib)


async def _model_step(t: _Turn) -> dict[str, Any] | str | web.Response:
    """Ask the model for one step. Returns the step, `_NEXT` to ask again
    (another tool format, a leaner start), `_STOP` with `t.message` set, or
    an error response when nothing was worked out yet."""
    offer, must_call = _offer(t)
    _tool_docs(t, offer)
    meta = t.meta = ai_chatlog.fit(t.log + t.new, t.meta, t.prof["history_chars"])
    rendered = ai_chatlog.render(t.log + t.new, meta)
    if t.emit:
        await t.emit({"type": "step", "n": t.step + 1})
    t.offered = [x.name for x in offer] if offer is not None else None
    plain = offer
    offer = _narrowed(t, offer)
    cfg = t.cfg
    started = asyncio.get_running_loop().time()
    try:
        return await asyncio.wait_for(
            _chat_step({**cfg, "thinking": "off"} if t.think_off else cfg,
                       system=_system_text(t.prof, meta, t.fmt, t.snapshot), log=rendered,
                       fmt=t.fmt, names=meta["tools"], prof=t.prof, num_ctx=t.num_ctx,
                       cache_key=t.chat["id"] if t.chat else "", emit=t.emit,
                       typed=bool(meta.get("typed")), decls=_decls(cfg, meta, t.fmt),
                       split=t.split, answer_only=t.forced, offer=offer,
                       must_call=must_call, plain=plain if plain is not offer else None),
            timeout=STEP_SECONDS)
    except asyncio.TimeoutError:
        t.trace.append(ai_trace.timed_out_record(
            t.step + 1, t.offered, asyncio.get_running_loop().time() - started))
        if t.no_step_yet():
            return json_error("the model took too long to answer", status=504)
        t.message = "(Stopped early: this answer took too long. Ask me to continue.)"
        return _STOP
    except _ai_chat.ToolsUnsupported as e:
        if t.fmt == "native" and (e.fallback or not any(
                x.get("kind") == "step" for x in t.log + t.new)):
            # The server has no tool calling, or can't read this
            # model's calls: the same step again in JSON steps, and the
            # chat stays in them (earlier native steps render as JSON
            # steps, `_ai_chat.json_answer`).
            t.fmt = "json"
            return _NEXT
        switched = meta.get("model") and meta.get("model") != cfg.get("model")
        hint = (" This chat started with another model; start a new chat to keep going "
                "with this one.") if switched else ""
        if not t.steps:
            return json_error(e.message + hint, status=e.status)
        t.message = f"(Stopped early: {e.message.rstrip('.')}.{hint})"
        return _STOP
    except _ai_client.AIError as e:
        over = ai_budget.overflow(e.message)
        if over is not None and t.chat is None and t.no_step_yet(in_log=True) \
                and int(meta.get("lean") or 0) < len(ai_budget.LEVELS) - 1:
            # The server counted more than the estimate: start leaner.
            t.snapshot = _open_chat(t.lib, cfg, meta, t.base_prof, t.ask.page, t.fmt,
                                    t.window, start=int(meta.get("lean") or 0) + 1)
            t.prof, t.fixed = _chat_profile(t.base_prof, cfg, meta, t.fmt, t.snapshot,
                                            t.window)
            return _NEXT
        if over is not None:
            e = _ai_client.AIError(_too_small(t.window, t.fixed, over), status=400)
        if t.no_step_yet():
            hint = (" The model may not see images; pick a vision model."
                    if t.ask.images and re.search(r"image|vision|multimodal|mmproj",
                                                  e.message, re.I) else "")
            return json_error(e.message + hint, status=e.status)
        t.message = f"(Stopped early: {e.message})"
        return _STOP


def _said(t: _Turn, st: dict[str, Any], calls: list[dict[str, Any]]) -> str:
    """The step's words: its message, or the plan / native text a small
    model wrote them into instead."""
    # A JSON step's other fields written into its message ("calls: []").
    said = strip_step_fields(ai_safety.strip_invisible(st["message"]))[:ai_chat.MAX_MESSAGE]
    plan_text = (st.get("answer") or {}).get("plan") if isinstance(
        st.get("answer"), dict) else ""
    if not said and not calls and isinstance(plan_text, str) \
            and len(plan_text.strip()) >= PLAN_AS_ANSWER:
        # Small models write the whole explanation in "plan" and leave
        # "message" empty: that showed as an empty answer.
        said = strip_step_fields(ai_safety.strip_invisible(plan_text.strip()))[
            :ai_chat.MAX_MESSAGE]
    native_note = st.get("plan") if t.fmt == "native" else ""
    if not said and calls and isinstance(native_note, str) and native_note.strip():
        # Native text written next to calls ("I've proposed the two
        # wildcards…") streamed live: keep it on screen above its steps
        # instead of the next step wiping it.
        said = ai_safety.strip_invisible(native_note.strip())[:ai_chat.MAX_MESSAGE]
    return said


async def _step(t: _Turn) -> str | web.Response:
    """One model step and its calls; `_NEXT` or `_STOP` for the loop."""
    # The first step always runs.
    late = t.ran > 0 and asyncio.get_running_loop().time() > t.deadline
    if late and (t.out_of_time or t.new[-1].get("kind") != "results"):
        t.message = t.message or t.interim or (
            "(Stopped early: this answer took too long. Ask me to continue.)")
        return _STOP
    if late:
        # Out of time with results in hand: one last step to answer.
        t.out_of_time = t.forced = True
        t.new[-1] = {**t.new[-1], "tail": str(t.new[-1].get("tail") or "") + (
            "\n\nTime is up: no more tool calls. Answer the user now from what you have.")}
    started = asyncio.get_running_loop().time()
    st = await _model_step(t)
    if not isinstance(st, dict):
        return st
    t.think_off = False
    t.step += 1
    t.ran += 1
    t.usage = usage = st["usage"]
    calls = st["calls"][:ai_chat.MAX_CALLS_PER_STEP]
    t.trace.append(ai_trace.step_record(t.step, t.offered, calls, usage,
                                        asyncio.get_running_loop().time() - started))
    said = _said(t, st, calls)
    dropped = len(st["calls"]) - len(calls)
    # How the model called its tools this answer, for the drawer's badge.
    t.tool_use["calls"] += len(calls)
    if st.get("salvaged"):
        t.tool_use["salvaged"] += len(calls)
    raw = (_ai_chat.responses_raw(st["raw"], {c["id"] for c in calls})
           if st.get("raw") else None)
    t.new.append(ai_chatlog.step_entry(ai_safety.strip_invisible(st["text"]), calls,
                                       answer=st["answer"], usage=usage,
                                       model=str(t.cfg.get("model") or ""), raw=raw))
    thought = st.get("thinking")
    if isinstance(thought, str) and thought.strip():
        # What it thought before acting, for the drawer's "Thinking"
        # (display only: steps are never sent to the model).
        t.steps.append({"tool": "think", "note": thought.strip(), "ok": True,
                        "think": True})
    if t.carry and not calls:
        said = ai_chat.join_continuation(t.carry, said)
        t.carry = ""
    # Cut off: the output limit, or a stream that ended early, or (no
    # signal at all) a reply that stops mid-sentence.
    cut = bool(said) and not calls and (
        bool(usage.get("cut")) or ai_chat.looks_cut(said))
    if cut and t.continued < MAX_CONTINUE and t.step < t.cap \
            and not t.out_of_time:
        # Ask for the rest; the two parts are joined into one answer.
        t.continued += 1
        t.carry = said
        t.new.append(ai_chatlog.note_entry(ai_chat.CONTINUE_NUDGE))
        return _NEXT
    # A message sent along with calls is usually "I'll search…": keep it
    # only as a fallback, so the answer is the step that stops calling.
    if said and not calls:
        t.message = said
        if cut:
            t.message += "\n\n*(Cut off: the model stopped before finishing.)*"
    elif said:
        t.interim = said
        # What it said before acting stays on screen above its steps
        # (it streamed live), instead of vanishing when the calls start.
        if not any(x.get("say") and x.get("note") == said for x in t.steps):
            t.steps.append({"tool": "say", "note": said, "ok": True, "say": True})
    if t.forced and calls:
        # Told to answer and called again anyway: stop on what it said.
        t.message = t.message or t.interim or _stuck_line(t.steps)
        return _STOP
    if any(c["tool"] == "run_test" for c in calls):
        t.checked = True
    run = _Calls(calls=calls, waiting=ai_ask.deferred_page_calls(
        calls, change=ai_chat.CHANGE_TOOLS, pause=ai_chat.PAUSE_TOOLS,
        web=tuple(ai_tools.WEB)))
    run.asked = [c for i, c in enumerate(calls) if i not in run.waiting]
    made_before = len(t.proposals)
    for at, call in enumerate(calls):
        await _run_call(t, run, at, call)
    if run.repeats:
        t.trace[-1]["repeats"] = run.repeats
    if t.queue is not None and t.queue.active and not run.planned_now:
        t.queue.after_step(len(t.proposals) > made_before)
    if t.emit:
        for s_ in t.steps[t.sent_steps:]:
            await t.emit({"type": "tool", "step": s_})
        t.sent_steps = len(t.steps)
    if calls and not said and t.split:
        # A split step's act ask can't write: after its cards, one more
        # step lets it say what it proposed (or carry on).
        run.needs_reply = True
    if t.pause:
        # Wait for the browser: what ran here waits with the calls.
        t.meta["pending"] = {"calls": t.pause, "items": run.items, "step": t.step,
                             "order": [c["id"] for c in calls]}
        t.message = said or t.interim
        return _STOP
    if not run.needs_reply:
        return _settle(t, said, calls, cut, usage, run.items)
    return _next_tail(t, calls, run, dropped)


@dataclass
class _Calls:
    """One step's calls while they run (`_run_call`)."""

    calls: list[dict[str, Any]]
    #: Page calls held back until the step's other calls ran.
    waiting: Any
    #: The calls that count for the ask checks (the step minus `waiting`).
    asked: list[dict[str, Any]] = field(default_factory=list)
    #: The results the model reads back, in call order.
    items: list[dict[str, Any]] = field(default_factory=list)
    needs_reply: bool = False
    repeats: int = 0
    planned_now: bool = False

    def result(self, call: dict[str, Any], out: str) -> None:
        # What the model reads back loses hidden characters too.
        self.items.append({"id": call["id"], "tool": call["tool"],
                           "text": ai_safety.strip_invisible(out)})

    def add_to_last(self, text: str) -> None:
        """Append `text` to the result just given (a note on the call)."""
        if text and self.items:
            self.items[-1]["text"] += ai_safety.strip_invisible(text)


async def _run_call(t: _Turn, run: _Calls, at: int, call: dict[str, Any]) -> None:
    """Run one call of the step: a plan, a refusal, a pause for the
    browser or the user, a read tool's result, or a proposal card."""
    tool = call["tool"]
    t.called.add(tool)
    if tool == "more_tools":
        t.widened = True
    if tool == ai_plan.TOOL:
        _plan_call(t, run, call)
        return
    spec = ai_tools.BY_NAME.get(tool)
    if spec is None:
        run.needs_reply = True
        run.result(call, f"{tool}: error: there is no tool named {tool[:40]}")
        t.steps.append({"tool": "unknown", "note": f"Unknown tool {tool[:40]}",
                        "ok": False})
        return
    if tool != "more_tools" and tool not in (t.meta.get("tools") or []):
        # Only what this chat offers; more_tools unlocks the rest.
        run.needs_reply = True
        group = next((g for g in spec.groups if g in ai_tools.MORE_GROUPS), "")
        # The group's contents too: bench N4 never opened "lists" for the tags.
        how = (f'call more_tools with {{"group": "{group}"}} '
               f"({ai_tools.MORE_GROUPS[group]}) first, then {tool}"
               if group else "call more_tools first")
        run.result(call, f"{tool}: error: {tool} isn't available here; {how}")
        t.steps.append({"tool": tool, "note": f"{tool} isn't available here", "ok": False})
        return
    if at in run.waiting:
        run.result(call, f"{tool}: {ai_ask.DEFERRED}")
        return
    key = ""
    try:
        raw = call["args"] if isinstance(call.get("args"), dict) else call["args_text"]
        args, arg_notes = ai_tools.check_args(spec, ai_chat.parse_args(raw))
        if tool in ai_tools.ASK:
            _ask_call(t, run, call, args)
            return
        if tool in ai_chat.PAUSE_TOOLS:
            await _pause_call(t, run, at, call, args)
            return
        if (tool.startswith("create_") and t.steered_at in (None, t.step)
                and _PACK_ASK.search(t.check)
                and "plan_pack" in (t.meta.get("tools") or [])
                and not any(c["tool"] == "plan_pack" for c in run.calls)
                and not any(p_["tool"] == "plan_pack" for p_ in t.proposals)):
            # Every eval run: "plan a pack" made 2-3 loose items and
            # never the Pack builder, which plans and checks a pack.
            t.steered_at = t.step
            raise ValueError(PACK_FIRST)
        key = tool + _json.dumps(args, sort_keys=True, ensure_ascii=False)
        if _repeated(t, run, call, key):
            run.add_to_last(_loop_check(t, call["tool"]))
            return
        t.seen.add(key)
        if t.errors.get(tool, 0) >= 3 and not (t.queue is not None and t.queue.active):
            raise ValueError("this tool failed three times in this answer; stop "
                             "calling it and tell the user what went wrong")
        if tool in ai_chat.CHANGE_TOOLS and len(t.proposals) >= ai_chat.MAX_PROPOSALS:
            raise ValueError("too many changes in one answer; stop here")
        if tool == "more_tools":
            out: Any = _more_tools(t.meta, args.get("group"))
        else:
            if tool == "search":
                t.lib.qvec = await _query_vector(t.lib, t.cfg, str(args.get("query") or ""))
            out = t.lib.run(tool, args)
    except ValueError as e:
        t.errors[tool] = t.errors.get(tool, 0) + 1
        if key and tool in ai_chat.CHANGE_TOOLS:
            t.failed[key] = ai_budget.clip(str(e), 300)
        why = tool + re.sub(r"\b[0-9a-f]{8}\b|\d+", "#", str(e))
        t.refused[why] = t.refused.get(why, 0) + 1
        run.needs_reply = True
        run.result(call, f"{tool}: error: {e}" + _tool_card(t, tool))
        t.steps.append({"tool": tool, "note": f"{tool}: {e}", "ok": False})
        return
    except Exception as e:  # noqa: BLE001 - one broken call mustn't end the turn
        t.errors[tool] = t.errors.get(tool, 0) + 1
        run.needs_reply = True
        run.result(call, f"{tool}: error: that didn't work ({type(e).__name__}); try other "
                   "arguments or another way")
        t.steps.append({"tool": tool, "note": f"{tool} failed", "ok": False})
        return
    extra = ("\n(" + "; ".join(arg_notes) + ")") if arg_notes else ""
    if isinstance(out, str):
        run.needs_reply = True
        if tool in ai_chat.CHANGE_TOOLS and "this is exactly card" in out:
            # Re-sent with only its category changed (s7): the same card.
            lacks = _still_lacks(t)
            extra += ("\n" + lacks) if lacks else ""
        run.result(call, f"{tool} {_json.dumps(args, ensure_ascii=False, sort_keys=True)[:200]}:\n"
                   + ai_budget.clip(out, t.prof["result_chars"]) + extra)
        if tool == "react":
            if t.emit and t.lib.reaction:
                # On the user's message now, not when the answer is done.
                await t.emit({"type": "reaction", "emoji": t.lib.reaction})
            return  # shown on the user's message, not as a step
        step_ = {"tool": tool, "note": ai_chat.args_note(tool, args, t.lib), "ok": True}
        card = getattr(t.lib, "last_card", None) if tool == "run_test" else None
        if card:
            # The run as a card the user can open in the Test Runner.
            step_["card"] = card
            t.lib.last_card = None
        t.steps.append(step_)
    else:
        _add_card(t, run, call, args, key, out, extra)


def _plan_call(t: _Turn, run: _Calls, call: dict[str, Any]) -> None:
    """The plan of a multi-item ask: code keeps it and asks for one item
    per step from here."""
    run.needs_reply = True
    got_plan = ai_plan.ItemQueue.from_args(
        call["args"] if isinstance(call.get("args"), dict)
        else _plan_args(call.get("args_text")), t.meta["tools"]) \
        if t.plan_n and t.queue is None else None
    if got_plan is None:
        run.result(call, f"{ai_plan.TOOL}: no items to make in it; carry on without a plan")
        return
    t.queue, run.planned_now = got_plan, True
    t.cap = min(max(t.cap, t.step + t.queue.steps_left() + 2), ai_plan.MAX_STEPS)
    t.limit = max(t.limit, t.cap)
    run.result(call, t.queue.started())
    t.steps.append({"tool": ai_plan.TOOL, "ok": True, "note": "Planned "
                    + ", ".join(it["name"] for it in t.queue.items)})


def _ask_call(t: _Turn, run: _Calls, call: dict[str, Any], args: dict[str, Any]) -> None:
    """A question for the user: pauses the turn (at most `MAX_ASKS` per
    message, never one already answered)."""
    tool = call["tool"]
    problem = ai_ask.step_problem(run.asked, run.asked.index(call),
                                  change=ai_chat.CHANGE_TOOLS, pause=ai_chat.PAUSE_TOOLS)
    if problem:
        raise ValueError(problem)
    if int(t.meta.get("asks") or 0) >= ai_ask.MAX_ASKS:
        run.needs_reply = True
        run.result(call, ai_ask.TOO_MANY)
        t.steps.append({"tool": tool, "note": "Decided without asking again", "ok": True})
        return
    try:
        cargs, label = ai_client_tools.prepare(t.lib, tool, args)
    except ai_ask.Settled as done:
        run.needs_reply = True
        run.result(call, str(done))
        t.steps.append({"tool": tool, "note": "Already answered", "ok": True})
        return
    t.meta["asks"] = int(t.meta.get("asks") or 0) + 1
    t.pause.append({"id": call["id"], "tool": tool, "args": cargs, "label": label})
    t.steps.append({"tool": tool, "note": label, "ok": True})


async def _pause_call(t: _Turn, run: _Calls, at: int, call: dict[str, Any],
                      args: dict[str, Any]) -> None:
    """A page tool the browser runs or a web tool the user allows: pauses
    the turn, unless it repeats or the web call is already allowed."""
    tool = call["tool"]
    if tool == "highlight" and not t.meta.get("page_read") and not any(
            c["tool"] == "read_page" for c in run.calls[:at]):
        # Its anchors would be guesses, and the browser would
        # only say "no part" after a pause.
        raise ValueError(ai_client_tools.READ_PAGE_FIRST)
    try:
        cargs, label = ai_client_tools.prepare(
            t.lib, tool, args, t.check)
    except ai_client_tools.Shown as shown:
        run.needs_reply = True
        again = tool + _json.dumps(args, sort_keys=True, ensure_ascii=False)
        if again in t.seen:
            # Small models "open" the card on screen again
            # and again instead of answering.
            run.repeats += 1
        t.seen.add(again)
        # Its own card can't be opened until the answer ends, so the
        # tool leaves the grammar now (9B smoke 1a63959: open, open on
        # its own card before every request-check fix).
        t.closed.add(tool)
        run.result(call, str(shown) + f" ({tool} is closed for the rest of this answer.)")
        return
    if tool == "highlight":
        anchors = sorted(p["anchor"] for p in cargs["points"])
        pointed = list(t.meta.get("pointed") or [])
        if anchors in pointed:
            # Small models point at the same part again and
            # again instead of answering. Only a highlight
            # the browser showed counts (`_paused_results`).
            run.needs_reply = True
            run.result(call, ai_chat.POINTED_AGAIN)
            t.steps.append({"tool": tool, "note": label, "ok": True})
            return
    if tool == "read_page":
        again = _json.dumps(cargs, sort_keys=True, ensure_ascii=False)
        read_before = list(t.meta.get("page_reads") or [])
        if again in read_before:
            # Live probe 2026-10-21: Haiku read the same part
            # five times, one pause each, then said nothing.
            run.repeats += 1
            run.needs_reply = True
            run.result(call, ai_chat.READ_AGAIN)
            return
        t.meta["page_reads"] = [*read_before, again][-20:]
    if tool in ai_tools.WEB and _web_pre_allowed(t.cfg, t.meta):
        # Allowed for this chat (or always): run it now.
        run.result(call, await _web_call(t.cfg, t.meta, tool, cargs))
        run.needs_reply = True
        t.steps.append({"tool": tool, "note": label, "ok": True})
        return
    # The browser runs it, or the user allows it: pause.
    t.pause.append({"id": call["id"], "tool": tool, "args": cargs, "label": label})
    t.steps.append({"tool": tool, "note": label, "ok": True})


def _repeated(t: _Turn, run: _Calls, call: dict[str, Any], key: str) -> bool:
    """The exact call again: a read already answered, a card already made
    or a change that failed. Answered here (True) instead of run."""
    tool = call["tool"]
    if tool not in ai_chat.CHANGE_TOOLS and key in t.seen:
        # Small models re-run the same search every step.
        run.repeats += 1
        run.needs_reply = True
        run.result(call, f"{tool}: you already made this exact call; its results are above. "
                   "Don't repeat it: use them for the next call (the change, if the "
                   "request asks for one).")
        return True
    if tool in ai_chat.CHANGE_TOOLS and key in t.proposed:
        # Sonnet probe 2026-10-21: the same three creates sent
        # three times over a warning, then out of steps with two
        # of five wildcards never made.
        run.needs_reply = True
        again = ai_chat.PROPOSED_AGAIN.format(tool=tool, pid=t.proposed[key])
        # 9B smoke s-tag-filter: the note's fix was the same card, byte
        # for byte, three runs out of three.
        lacks = _still_lacks(t)
        if lacks:
            again = f"{tool}: card {t.proposed[key]} is this exact call. {lacks}"
        run.result(call, again)
        return True
    if key in t.failed:
        run.repeats += 1
        run.needs_reply = True
        run.result(call, f"{tool}: you already made this exact call and it failed ("
                   f"{t.failed[key]}); sending it again fails again. Change what the "
                   "error names, or answer now")
        return True
    return False


def _add_card(t: _Turn, run: _Calls, call: dict[str, Any], args: dict[str, Any], key: str,
              out: dict[str, Any], extra: str) -> None:
    """A change tool's proposal card: replaces its twin from this answer,
    remembered as an example and in the chat's proposals."""
    tool = call["tool"]
    # Hidden characters can't ride into the library on a card.
    out = ai_safety.clean(out)
    proposals = t.proposals
    twin = any(p_["pid"] == out.get("replaces") for p_ in proposals)
    had = ai_request_check.gaps(t.check, proposals, _wants(t)) if twin and not t.plan_n else []
    if twin:
        # A repeat of a card from this answer: the user gets one.
        old_pid, new_pid = out["replaces"], out["pid"]
        proposals[:] = [p_ for p_ in proposals if p_["pid"] != old_pid]
        for p_ in proposals:
            if p_.get("after") == old_pid:
                p_["after"] = new_pid
            if p_.get("needs"):
                p_["needs"] = [new_pid if n == old_pid else n for n in p_["needs"]]
    for gone_pid in out.get("absorbs") or []:
        # A card from this answer this one does the work of (a new
        # category it creates as it files the item): the user gets one.
        proposals[:] = [p_ for p_ in proposals if p_["pid"] != gone_pid]
        for p_ in proposals:
            if p_.get("after") == gone_pid:
                p_["after"] = out["pid"]
            if p_.get("needs"):
                p_["needs"] = [out["pid"] if n == gone_pid else n for n in p_["needs"]]
        gone = t.meta.get("proposals", {}).get(gone_pid)
        if gone is not None:
            t.meta["proposals"][gone_pid] = {**gone, "status": "replaced"}
    proposals.append(out)
    if key:
        t.proposed[key] = out["pid"]
    if t.text and t.text != "(retry)":
        # Kept as an example if the user applies the card.
        kept = dict(t.meta.get("examples") or {})
        kept[out["pid"]] = {"ask": ai_budget.clip(t.text, 300), "tool": tool,
                            "args": ai_examples.compact(args)}
        t.meta["examples"] = dict(list(kept.items())[-30:])
    entry: dict[str, Any] = {"title": out["title"], "status": None}
    op = out.get("op") if isinstance(out.get("op"), dict) else {}
    item = op.get("id") if op.get("op") == "update" else (op.get("body") or {}).get("id")
    if isinstance(item, str):
        entry["item"] = item  # the item it changes or makes (`_scope_edits`)
    t.meta.setdefault("proposals", {})[out["pid"]] = entry
    if out.get("replaces"):
        gone = t.meta["proposals"].get(out["replaces"])
        if gone is not None:
            t.meta["proposals"][out["replaces"]] = {**gone, "status": "replaced"}
    if twin and not t.plan_n:
        # 9B smoke s-tag-filter: a fixed card rewritten back to plain
        # colours to get rid of a duplicate warning.
        now = [] if t.out_of_time else ai_request_check.gaps(t.check, proposals, _wants(t))
        lost = [n for n in now if n not in had]
        if lost:
            what = " and ".join(ai_request_check.short_name(n) for n in lost)
            extra += (f"\nThis card drops {what}, which the request asks for and the card "
                      "it replaces had: send it again with that kept.")
        elif now:
            # Re-sent with only its tags or order changed (s7).
            extra += "\n" + _still_lacks(t)
    run.result(call, ai_chat.proposal_note(tool, out) + extra + _tool_card(t, tool)
               + (_loop_check(t, tool) if twin else ""))
    if twin:
        out.pop("replaces")  # the user never saw the card it replaces
    out.pop("absorbs", None)
    t.steps.append({"tool": tool, "note": out["title"], "ok": True})


def _nudge(t: _Turn, said: str, note: str) -> str:
    """Set this answer aside and ask once more with `note`."""
    t.nudged = True
    t.set_aside, t.message = said, ""
    t.new.append(ai_chatlog.note_entry(note))
    return _NEXT


def _settle(t: _Turn, said: str, calls: list[dict[str, Any]], cut: bool,
            usage: dict[str, Any], items: list[dict[str, Any]]) -> str:
    """A step that needs no reply: the answer stands, unless it is empty or
    one of the known slips that gets one nudge (unfinished, a promised or
    claimed call, a deferred rest, made-up names, a stall, nothing tested)."""
    proposals = t.proposals
    if not calls and not said and not proposals:
        # An empty answer: thinking models can spend the whole output
        # allowance before writing anything.
        cut = bool(usage.get("cut"))
        if t.lib.reaction and not t.set_aside:
            return _STOP  # it reacted and had nothing to add: that's the answer
        if t.set_aside:
            # Nudged, and then nothing: the earlier answer stands.
            t.message = t.set_aside
            return _STOP
        if cut or t.empty_nudged:
            t.message = t.message or t.interim or (
                "(The model used up its output limit before answering; thinking "
                "models do this. Try again, raise the output limit, or turn its "
                "thinking off.)" if cut else _done_line(t.steps, t.first_done))
            return _STOP
        t.empty_nudged = t.think_off = True
        page_failed = any(not x.get("ok") and str(x.get("note") or "").startswith(
            "Couldn't: ") for x in t.steps)
        if page_failed or t.step >= t.cap:
            # Sonnet and Haiku probes 2026-10-21: a highlight that
            # failed, then an empty answer with no step left. One
            # more step, in words only.
            t.limit = max(t.limit, t.step + 1)
            t.forced = True
            t.new.append(ai_chatlog.note_entry(
                ai_chat.PAGE_FAILED_NUDGE if page_failed else ai_chat.EMPTY_WORDS_NUDGE))
            return _NEXT
        t.new.append(ai_chatlog.note_entry(ai_chat.EMPTY_NUDGE))
        return _NEXT
    can_nudge = not calls and not t.nudged and t.step < t.cap
    if can_nudge and not proposals and not cut and ai_chat.unfinished(said):
        return _nudge(t, said, ai_chat.UNFINISHED_NUDGE)
    promised = ai_chat.promised_call(said)
    if can_nudge and not proposals and promised:
        return _nudge(t, said, ai_chat.promise_nudge(promised))
    # Said it made, tested or opened something with no call behind
    # it, or answered an organize ask with a list: ask once for the
    # call (9B: 3 of 3 organize and plan-a-pack turns, "the Test
    # Runner is now open" with no run).
    organize = bool(_ORGANIZE_ASK.search(t.check))
    if can_nudge and not proposals and (ai_chat.claims_change(said) or _card_as_text(said)
                                        or organize):
        if not organize or ai_chat.claims_change(said):
            # The 9B met the claim nudge with the same claim again (smoke
            # s-negatives, empty library): the next step offers only the
            # change tools it had, and the test tools.
            t.gap_offer = [n for n in t.meta["tools"] if (
                n in ai_chat.CHANGE_TOOLS and (not t.short or n in t.short)
            ) or n in ("run_test", "show_test")]
        return _nudge(t, said, ai_chat.ORGANIZE_NUDGE if organize
                      and not ai_chat.claims_change(said) else ai_chat.CLAIM_NUDGE)
    # Proposed part of the ask and put the rest off to a later turn
    # ("Apply it, then I'll propose the derivation"): ask once for
    # the rest, in this answer.
    if can_nudge and proposals and ai_chat.defers_rest(said):
        return _nudge(t, said, ai_chat.DEFER_NUDGE)
    # Named keys or $variables that the docs, the library and the
    # chat never mention: ask once to check or drop them.
    unknown = ai_chat.unknown_names(
        said, ai_chatlog.dumps([e for e in t.log + t.new if e.get("kind") not in (
            "step", "shown", "note")]), getattr(t.lib, "catalog", {})) if can_nudge else []
    if unknown:
        return _nudge(t, said, ai_chat.facts_nudge(unknown))
    # Asked leave instead of proposing, or met "yes" with more talk:
    # tell it once to act. Small models loop on "Should I proceed?".
    # The stalled question isn't the answer, unless nothing better comes.
    if can_nudge and not proposals and ai_chat.stalls(said, t.check, t.last_answer):
        return _nudge(t, said, ai_chat.GO_NUDGE)
    # The request asks for a feature no card has (a constraint, an
    # "only" rule, a fallback, negatives): ask once, before the test, so
    # the test covers it. Not in a plan run, whose items are the ask.
    # A repeated refusal forces the answer, and the last step leaves none
    # for the fix, but the missing feature still gets its one note (9B
    # smoke, s-tag-filter: plain colours with no tag ref, answered on the
    # last step). Out of time does not.
    missing = (ai_request_check.gaps(t.check, proposals, _wants(t))
               if not calls and not t.gap_checked and not t.plan_n
               and not t.out_of_time else [])
    if missing:
        note = _gap_note(t, missing)
        t.new.append(ai_chatlog.results_entry(items, "\n\n" + note) if items
                     else ai_chatlog.note_entry(note))
        return _NEXT
    # Changes were proposed but never tried: ask for one check
    # before the answer stands, so "done" means it ran.
    if (not t.checked and t.step < t.cap
            and any(p["tool"] in ai_chat.CHECKABLE_TOOLS for p in proposals)):
        t.checked = True
        nudge = ai_chat.CHECK_NUDGE + _check_call(proposals)
        if items:
            t.new.append(ai_chatlog.results_entry(items, "\n\n" + nudge))
        else:
            t.new.append(ai_chatlog.note_entry(nudge))
        return _NEXT
    if items:
        t.new.append(ai_chatlog.results_entry(items, ""))
    return _STOP


def _next_tail(t: _Turn, calls: list[dict[str, Any]], run: _Calls, dropped: int) -> str:
    """The step's results go back with what comes next: the plan's next
    item, a progress note, or (out of steps, reads or patience) answer now."""
    items = run.items
    if t.step >= t.cap:
        t.new.append(ai_chatlog.results_entry(items, ""))
        t.message = (t.message or t.interim
                     or "I ran out of steps before finishing; ask me to continue.")
        return _STOP
    if t.queue is not None and (t.queue.active or run.planned_now):
        # A plan runs: code says which item is next, and repeats, reads
        # and refusals count against that item, not the answer.
        t.forced = t.out_of_time or t.step == t.cap - 1
        t.new.append(ai_chatlog.results_entry(items, t.queue.note() if not t.forced else (
            _results_tail(t.text, last=True, native=False, split=True))))
        return _NEXT
    if t.queue is not None and not t.queue_told:
        t.queue_told = True  # the plan just finished: say so once
        t.forced = t.out_of_time or t.step == t.cap - 1
        t.new.append(ai_chatlog.results_entry(items, t.queue.note()))
        return _NEXT
    # Only repeats, read enough, or one step left: no more tools, answer now.
    t.reads += sum(1 for c in calls if c["tool"] in ai_tools.READ)
    # The same refusal twice: small models loop on it instead of
    # answering, so the next step must answer (with what went wrong).
    t.forced = ((bool(calls and run.repeats == len(calls)) and not _repeat_pass(t, calls, items))
                or t.step == t.cap - 1
                or t.reads >= t.read_budget or t.out_of_time
                or max(t.refused.values(), default=0) >= MAX_REFUSED)
    more = (f"\n\nOnly your first {len(calls)} calls ran; {dropped} more were left out."
            + ("" if t.forced else " Make them in your next step.")) if dropped else ""
    note = _early_gap(t, calls)
    if t.split and t.step > 1 and not note:
        # What this answer did so far, written by code: a small model
        # re-reads and re-proposes what scrolled up (research note
        # "Small model tool use", T7). Not beside the request check's
        # note, whose fix is often that same card changed.
        more += _progress_note(t.steps, t.proposals)
    if note:
        t.new.append(ai_chatlog.results_entry(items, more + "\n\n" + note))
        return _NEXT
    t.new.append(ai_chatlog.results_entry(
        items, more + _results_tail(t.text, last=t.forced, native=t.fmt == "native",
                                    split=t.split)))
    return _NEXT


def _early_gap(t: _Turn, calls: list[dict[str, Any]]) -> str:
    """The request check's note as soon as a step after the cards changes
    nothing: the 9B spent 2-4 steps on more_tools and opening its own card
    before answering, and only then got the note (smoke d25d274)."""
    if (t.gap_checked or not t.proposals or t.plan_n or t.out_of_time
            or any(c["tool"] in ai_chat.CHANGE_TOOLS for c in calls)):
        return ""
    missing = ai_request_check.gaps(t.check, t.proposals, _wants(t))
    return _gap_note(t, missing) if missing else ""


def _still_lacks(t: _Turn) -> str:
    """What the cards still lack of the request, for a card sent again;
    it counts as the request check's note when none came yet."""
    missing = ([] if t.plan_n or t.out_of_time
               else ai_request_check.gaps(t.check, t.proposals, _wants(t)))
    if not missing:
        return ""
    if not t.gap_checked:
        _gap_note(t, missing)
    what = " and ".join(ai_request_check.short_name(n) for n in missing)
    return (f"It still lacks {what}, which the request asks for: add it, in this card or "
            "the card that should have it.")


def _wants(t: _Turn) -> list[str] | None:
    """What the request frame says the ask wants (None: read the words)."""
    return ai_lang.wants(t.frame)


def _gap_note(t: _Turn, missing: list[str]) -> str:
    """Mark the request check as done and give it room: the fix step and
    the answer after it, even past the step cap (once per answer)."""
    t.gap_checked = True
    t.gaps = missing
    t.gap_offer = ai_request_check.fix_tools(missing, t.proposals)
    t.forced = False
    t.cap = max(t.cap, t.step + 2)
    t.limit = max(t.limit, t.cap)
    return ai_request_check.nudge(missing, t.text or "")


def _end_answer(t: _Turn) -> None:
    """A fallback message when the steps left none, every call answered,
    and the log ending on the answer."""
    if t.pause:
        return  # the turn goes on when the browser answers
    proposals = t.proposals
    if not t.message and not (t.lib.reaction and not proposals and not t.interim):
        t.message = t.interim if t.interim and proposals else (
            "Here's what I'd change." if proposals else t.interim or t.set_aside
            or _done_line(t.steps, t.first_done))
    # Every call gets a result and the turn ends on an answer.
    last = t.new[-1]
    if last.get("kind") == "step" and last.get("calls"):
        t.new.append(ai_chatlog.results_entry(
            [{"id": c["id"], "tool": c["tool"], "text": f"{c['tool']}: not run"}
             for c in last["calls"]], ""))
    if t.new[-1].get("kind") != "step":
        t.new.append(_final_step(t.fmt, t.message))


def _claim_notes(t: _Turn) -> None:
    """Notes on what the answer claims that its steps don't back (a test,
    a card, a kind of item), the cloud offer, and chips for the items it
    names."""
    proposals, steps, text, message = t.proposals, t.steps, t.text, t.message
    if not t.pause and _TESTED.search(message or "") and not any(
            s_.get("tool") == "run_test" and s_.get("ok") for s_ in steps):
        # Chat eval round 1: "I ran a test on your Lighting wildcard" after
        # its only run_test failed.
        message = message.rstrip() + "\n\n" + NOTHING_TESTED
    if not t.pause and not proposals and (_CLAIMS.search(message or "")
                                          or _card_as_text(message)
                                          or _ORGANIZE_ASK.search(text or "")):
        # The 9B said "I've created … as a fixed values module" with no card,
        # and wrote "here's the card to apply: …" or an add_rules call as text.
        message = message.rstrip() + "\n\n" + NOTHING_PROPOSED
    elif not t.pause and proposals and (missing := _missing_kinds(message, proposals)):
        # All-tools eval: "I've proposed a combine" beside a wildcard card.
        what = " or ".join(k.replace("_", " ") for k in missing)
        message = (message.rstrip() + f"\n\n*(No {what} card came with this answer, so no "
                   f"{what} was made. Ask me to propose it.)*")
    if not t.pause and proposals and (said := ai_request_check.claimed(
            ai_request_check.gaps(text or "", proposals), message)):
        what = " or ".join(ai_request_check.short_name(n) for n in said)
        message = (message.rstrip() + f"\n\n*(You asked for {what}, but no card in this "
                   "answer has it yet, so it isn't made. Ask me to add it.)*")
    if not t.pause and proposals:
        message = _card_claims(message, proposals)
    if not t.pause and not t.lib.allow_delete and t.lib.delete_scope.get("delete") \
            and not _DELETE_SETTING.search(message or ""):
        # Bench W22: deleting off and the item missing, the 9B offered
        # another item and never said where deleting is switched on.
        message = message.rstrip() + "\n\n" + DELETE_IS_OFF
    if not t.pause and t.cfg.get("local") and not t.meta.get("cloud_offered") and _struggled(
            message, t.errors, t.queue, bool(proposals)):
        # A local model struggled: say once per chat that a cloud model the
        # user already set up would likely manage (research note "Small
        # model tool use", T12). Never switched for them.
        cloud = ai_config.cloud_ready()
        if cloud:
            t.meta["cloud_offered"] = True
            message = message.rstrip() + "\n\n" + CLOUD_OFFER.format(name=cloud[0])
    # Tool names said in plain words, then chips for the items it names; no
    # bare ids for the user.
    message = ai_claims.plain_tool_names(message, tuple(ai_tools.BY_NAME))
    t.message = t.lib.link_items(message)


def _card_claims(message: str, proposals: list[dict[str, Any]]) -> str:
    """Notes on what the answer says its cards do that they don't: a weight
    or factor no card sets, a move no bundle card makes, a change said to
    be done before Apply (`engine/ai/claims.py`)."""
    notes: list[str] = []
    if nums := ai_claims.unbacked_numbers(message, proposals):
        said = ", ".join(nums[:4])
        what = "a weight or factor" if len(nums) == 1 else "weights or factors"
        notes.append(f"*(The answer names {what} ({said}) that no card sets: what the "
                     "cards show is what applies.)*")
    if ai_claims.unbacked_move(message, proposals):
        notes.append("*(The bundle card moves nothing: the order stays as it was. Ask me to "
                     "move it.)*")
    if ai_claims.says_done(message):
        notes.append(ai_claims.NOT_APPLIED)
    return message.rstrip() + "".join("\n\n" + n for n in notes) if notes else message


def _trace(t: _Turn) -> dict[str, Any]:
    """What this request offered the model and what it did (`engine/ai/trace.py`)."""
    notes = [str(e.get("text") or "") for e in t.new if e.get("kind") == "note"]
    return ai_trace.turn_record(
        steps=t.trace, tail=t.tail_kinds, short=t.short, notes=notes, refused=t.refused,
        errors=t.errors, widened=t.widened, plan_n=t.plan_n, model=t.cfg.get("model"),
        profile=t.prof.get("size"), asks=t.asks_kind, gaps=t.gaps, closed=t.closed)


async def _close(t: _Turn) -> web.Response:
    """The answer's closing lines, then the chat stored with this turn and
    the reply the drawer shows."""
    _end_answer(t)
    await _test_if_asked(t)
    _claim_notes(t)
    meta, message, proposals = t.meta, t.message, t.proposals
    meta["format"] = t.fmt
    meta["fingerprint"] = t.fp_now
    meta["model"] = t.cfg.get("model")
    # How long the answer took: this request, plus the earlier requests of a
    # turn that paused on a page tool, a search or a question.
    took = int((time.monotonic() - t.started) * 1000)
    meta["turn_ms"] = took + (int(meta.get("turn_ms") or 0) if t.ask.resume else 0)
    out: dict[str, Any] = {
        "message": message, "proposals": proposals, "steps": t.steps,
        "model": t.cfg["model"], "format": t.fmt, "usage": t.usage, "tool_use": t.tool_use,
        "elapsed_ms": meta["turn_ms"],
        # Card warnings name items too ("$coat is already set by [[id#Coat]]").
        "refs": t.lib.message_refs("\n".join([message, *(w for p_ in proposals
                                                            for w in p_.get("warnings") or [])])),
        # Calls for the browser to run (or the user to allow) before the
        # turn goes on; it posts their results back as `results`.
        "pending": [{k: c[k] for k in ("id", "tool", "args", "label")} for c in t.pause],
    }
    if t.lib.reaction or t.lib.opening_reaction:
        # On the user's message.
        out["reaction"] = t.lib.reaction or t.lib.opening_reaction
    # What the user saw, for reopening the chat later (the model never
    # reads it).
    t.new.append(ai_chatlog.shown_entry({k: out[k] for k in (
        "message", "proposals", "steps", "refs", "model", "pending", "format", "tool_use",
        "elapsed_ms", "reaction") if k in out}, trace=_trace(t)))
    out["context"] = _context(t.cfg, meta, t.log + t.new, t.fixed, t.usage, t.window)
    chat = t.chat
    with db_session(t.request) as conn:
        repo = ChatRepository(conn)
        if chat is None:
            chat = repo.create(title=ai_chatlog.title_for(t.text) if t.text else "Image",
                               snapshot=t.snapshot, meta=meta)
        elif t.retried_from is not None:
            repo.truncate(chat["id"], t.retried_from, meta=meta)
        repo.append(chat["id"], t.new, meta=meta)
    return json_ok({"chat_id": chat["id"], **out})


async def _test_if_asked(t: _Turn) -> None:
    """Asked to test and never did (chat eval: the 9B wrote that it can't):
    run it here, card and all. The note goes after the answer, so the log
    stays append-only for the cache."""
    if t.pause or not t.proposals or not _TEST_ASK.search(t.check) or any(
            s_.get("tool") == "run_test" and s_.get("ok") for s_ in t.steps):
        return
    got = _auto_test(t.lib, t.proposals)
    if got is None:
        return
    args_, report = got
    names_ = [str(t.lib.names.get(i) or i) for i in args_["stack"]]
    step_: dict[str, Any] = {
        "tool": "run_test", "ok": True, "auto": True,
        "note": f"Ran {', '.join(names_[:4])} with the proposed changes"}
    card = getattr(t.lib, "last_card", None)
    if card:
        step_["card"] = card
        t.lib.last_card = None
    t.steps.append(step_)
    if t.emit:
        await t.emit({"type": "tool", "step": step_})
    t.new.append(ai_chatlog.note_entry(
        AUTO_TEST_NOTE + f"run_test {_json.dumps(args_, sort_keys=True)}:\n"
        + ai_budget.clip(report, t.prof["result_chars"])))
    t.message = t.message.rstrip() + "\n\n" + AUTO_TESTED


def _adopt_earlier(lib: Any, log: list[dict[str, Any]], meta: dict[str, Any]) -> None:
    """New modules from earlier answers' cards the user hasn't applied (nor
    dismissed): the model can read and revise them (`Library.adopt_earlier`)."""
    model_status = meta.get("proposals") or {}
    shown_status = meta.get("shown_status") or {}
    for e in log:
        if e.get("kind") != "shown":
            continue
        for p in (e.get("view") or {}).get("proposals") or []:
            pid = p.get("pid") if isinstance(p, dict) else None
            if not pid or (model_status.get(pid) or {}).get("status") or (
                    shown_status.get(pid) or {}).get("status"):
                continue
            keys = (meta.get("fixes") or {}).get(pid)
            lib.adopt_earlier(ai_lint.with_fixes(p, list(keys)) if keys else p)


#: An answer saying it made a change ("I've created …").
_CLAIMS = re.compile(r"\b(?:I(?:'ve| have)?|I've now)\s+(?:just\s+)?(?:created|made|added|built|"
                     r"set up|saved|updated|applied|proposed)\b", re.I)
def _missing_kinds(message: str, proposals: list[dict[str, Any]]) -> list[str]:
    """Kinds the answer says it made that no card of this answer is."""
    return ai_claims.missing_kinds(message, proposals)


#: A message asking the chat to sort the library: an answer with no card
#: (re-test on d6ac847: eight categories listed as text) changed nothing.
_ORGANIZE_ASK = re.compile(r"\b(?:organi[sz]e|tidy(?: up)?|clean(?: ?up)?|sort|file|group)\b"
                           r"[^.?!\n]{0,60}\b(?:librar(?:y|ies)|items?|wildcards?|modules?|"
                           r"categor(?:y|ies)|everything|these|them|it)\b", re.I)
#: An answer that speaks of a card it shows, or spells a change call out.
_CARD_WORDS = re.compile(r"\bhere(?:'s| is| are)\s+the\s+cards?\b|\bapply\s+(?:the|this|these|"
                         r"that|those)\s+cards?\b|\bcards?\s+(?:below|above)\b|"
                         r"\b(?:the|this)\s+cards?\s+(?:to\s+apply|shows?|is\s+ready)\b", re.I)


def _card_as_text(message: str) -> bool:
    """Whether an answer with no card talks as if one came with it (all-tools
    eval: "here's the card to apply: Face Description · $face_desc", "Apply
    the cards if they look right", an add_rules call written into the text)."""
    text = message or ""
    if _CARD_WORDS.search(text):
        return True
    names = "|".join(sorted(ai_chat.CHANGE_TOOLS))
    return bool(re.search(rf"[\"'](?:{names})[\"']|\b(?:{names})\s*[({{]", text))


#: A message asking for a whole pack.
_PACK_ASK = re.compile(r"\b(?:plan|make|build|create|design|set up|start)\b[^.?!\n]{0,40}"
                       r"\bpacks?\b", re.I)
PACK_FIRST = ("the user asked for a whole pack: call plan_pack with its description (what "
              "it makes, its parts and its rules) so the Pack builder plans, checks and "
              "builds it. Only if they asked for just these few items, call this again")


#: The user asking for a test of what the answer proposes ("test it
#: first", "try it", "dry run", "check it", "run a test").
_TEST_ASK = re.compile(
    r"(?:^|\b(?:and|then|please|also|can you|could you|now)\s+)test(?:s|ed|ing)?\b"
    r"|\btest(?:s|ed|ing)?\s+(?:it|them|that|this|the|first|now|again|before|after|out)\b"
    r"|\btest(?:s|ed|ing)?\s*[.!?]*$"
    r"|\b(?:dry[- ]runs?|(?:try|run|check)\s+(?:it|them|that|this|one|first|out)"
    r"|run\s+(?:a\s+)?tests?)\b", re.I)
#: Told to the model, after its answer, when the server ran the test it
#: didn't (the user reads the card; the model reads this next turn).
AUTO_TEST_NOTE = ("(The user asked for a test and your answer proposed changes without "
                  "running one, so run_test ran on the proposed changes for them. Its "
                  "report, for your next answer:)\n\n")
#: Added to the answer the user sees when that happened.
AUTO_TESTED = ("*(You asked for a test: the proposed changes ran on the engine; the test card "
               "shows what they do.)*")


def _auto_test(lib: Any, proposals: list[dict[str, Any]]) -> tuple[dict[str, Any], str] | None:
    """`run_test` on the items this answer's cards change, the way the
    model's own ``{"stack": […], "proposed": true}`` call runs it. Chat eval
    (9B): asked to test first, it proposed the change and wrote that it
    can't run tests. Returns ``(args, report)``, or None when nothing
    testable was proposed or the run fails (then the answer stands as it
    was: a check that can't run is no answer's fault)."""
    ids: list[str] = []
    for p in proposals:
        op = _got if isinstance(_got := p.get("op"), dict) else {}
        if p.get("tool") not in ai_chat.CHECKABLE_TOOLS:
            continue
        iid = op.get("id") if op.get("op") == "update" else (op.get("body") or {}).get("id")
        if isinstance(iid, str) and iid not in ids:
            ids.append(iid)
    if not ids:
        return None
    args: dict[str, Any] = {"stack": ids, "proposed": True}
    try:
        report = lib.run("run_test", args)
    except Exception:  # noqa: BLE001 - the answer stands without the check
        return None
    return (args, report) if isinstance(report, str) else None


#: Added to such an answer when no card came with it.
_TESTED = re.compile(r"\b(?:I(?:'ve| have)?\s+(?:just\s+)?(?:ran|run|tested)\b|"
                     r"\b(?:the\s+)?test\s+(?:ran|run|shows|showed|passed)\b|"
                     r"\bthe\s+test\s+runner\s+is\s+(?:now\s+)?open\b|"
                     r"\bopened\s+the\s+test\s+runner\b)", re.I)
NOTHING_TESTED = ("*(No test ran in this answer, so what it says about test results is not "
                  "checked. Ask me to run the test.)*")
NOTHING_PROPOSED = ("*(Nothing was proposed in this answer, so nothing changed. Ask me to "
                    "propose it and a card will show.)*")


#: An answer that already says where deleting is switched on.
_DELETE_SETTING = re.compile(r"\bPermissions\b|\bSettings\b[^.\n]{0,40}\bAI\b", re.I)
DELETE_IS_OFF = ("*(Deleting is turned off, so I can't delete anything. You can let the "
                 "assistant delete in Settings › AI assistant › Permissions.)*")


#: The same refusal this many times in one answer, and the model must answer.
MAX_REFUSED = 2


#: A JSON-mode "plan" this long, with no message and no calls, is the answer.
PLAN_AS_ANSWER = 80


#: Said once per chat after a local model struggled (`_struggled`).
CLOUD_OFFER = ("*(This was hard for the local model. You have {name} set up: switching to it in "
               "Settings › AI assistant for asks like this one usually gets them done. Nothing "
               "goes there unless you switch.)*")


def _struggled(message: str, errors: dict[str, int],
               queue: ai_plan.ItemQueue | None, proposed: bool = False) -> bool:
    """Whether this answer shows a model out of its depth: out of steps,
    stuck, stopped early, no answer after only reading, three failed calls,
    or plan items left unmade."""
    stuck = re.search(r"ran out of steps|Stopped early|didn't work on your page|"
                      r"couldn't finish this|model gave no answer|I kept ", message or "")
    silent = not proposed and (message or "").startswith("Done: ")
    return (bool(stuck) or silent or sum(errors.values()) >= 3
            or bool(queue and queue.skipped))


def _progress_note(steps: list[dict[str, Any]], proposals: list[dict[str, Any]]) -> str:
    """One line of what this answer did: its cards, what it read, what
    failed."""
    cards = [str(p.get("title") or "") for p in proposals if p.get("title")]
    looked = [str(s_.get("note") or "") for s_ in steps
              if s_.get("ok") and s_.get("tool") in ai_tools.READ and s_.get("note")]
    failed = [str(s_.get("tool")) for s_ in steps if not s_.get("ok") and s_.get("tool")]
    parts = []
    if cards:
        parts.append("proposed " + "; ".join(cards[-8:]) + " (don't propose these again)")
    if looked:
        parts.append("looked at " + "; ".join(x[:60] for x in looked[-6:]))
    if failed:
        parts.append("failed " + ", ".join(dict.fromkeys(failed[-6:])))
    return ("\n\nSo far in this answer you " + ". You ".join(parts) + ".") if parts else ""


def _plan_args(text: Any) -> Any:
    """A plan call's args written as text (a server that refused typed args)."""
    try:
        return ai_chat.parse_args(text) if isinstance(text, str) else None
    except ValueError:
        return None


def _stuck_line(steps: list[dict[str, Any]]) -> str:
    """The answer when the model was told to answer and called tools
    again: what got in the way (the refusals say why), never a bare "I
    kept looking"."""
    why = list(dict.fromkeys(str(x.get("note")) for x in steps
                             if not x.get("ok") and x.get("note")))[-3:]
    if not why:
        return ("I kept looking without getting to an answer. Try asking more specifically, "
                "or name the item.")
    return ("I couldn't finish this. What got in the way:\n"
            + "\n".join(f"- {w}" for w in why)
            + "\n\nTell me which way to go, or ask for one part at a time.")


def _done_line(steps: list[dict[str, Any]], paused_done: list[str] | None = None) -> str:
    """The answer when the model said nothing after acting: what it did,
    never a bare "Done."."""
    undone = {str(x.get("note"))[len("Couldn't: "):] for x in steps
              if not x.get("ok") and str(x.get("note") or "").startswith("Couldn't: ")}
    did = [*(paused_done or []),
           *(str(x.get("note")) for x in steps
             if x.get("ok") and x.get("note") and not x.get("say") and not x.get("think")
             and x.get("note") not in undone)]
    pointed = [n[len("Pointed at "):] for n in did if n.startswith("Pointed at ")]
    if pointed:
        # "Where is X?" answered by pointing: say so in words.
        return f"It's highlighted on the page: {pointed[-1]}."
    if did:
        return "Done: " + "; ".join(did[-3:]) + "."
    if undone:
        # The step lines above already say which page call failed.
        return ("(That didn't work on your page, and the model gave no answer. Try "
                "again, or ask another way.)")
    return "(The model gave an empty answer. Try again, or ask another way.)"


def _named_by_answers(lib: Any, paused: dict[str, Any] | None, answers: Any) -> set[str]:
    """Library items the user's answer to an ``ask`` names: the picked
    choice, their own words or the question they answered ("Trim
    [[764294a5#Hair color]] to 8" picked). Answering by button sends no
    text, so these never reached ``named`` and the edit the user just chose
    was refused as "they haven't named it" (Haiku hair eval, 2026-10-21)."""
    if not paused or not isinstance(answers, list):
        return set()
    got = {a["id"]: a for a in answers if isinstance(a, dict) and isinstance(a.get("id"), str)}
    out: set[str] = set()
    for c in paused.get("calls") or []:
        if c.get("tool") not in ai_tools.ASK or c.get("id") not in got:
            continue
        for a in ai_ask.answers(c.get("args") or {}, got[c["id"]]):
            if a.get("by") != "user":
                continue
            said = f"{a.get('question', '')} {a.get('answer', '')}"
            out |= lib.shown_in(said) | lib.named_in(str(a.get("answer") or ""))
    return out


async def _paused_results(
    cfg: dict[str, Any], meta: dict[str, Any], paused: dict[str, Any],
    got: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """The results entry for a paused step, in the step's call order: the
    server results made before the pause plus each paused call's answer;
    the step lines for calls that didn't run; and the labels of the ones
    that did (for the empty-answer line)."""
    by_id = {it["id"]: it for it in paused.get("items") or [] if isinstance(it, dict)}
    steps: list[dict[str, Any]] = []
    done: list[str] = []
    for c in paused.get("calls") or []:
        answer = got.get(c["id"], {"cancelled": True})
        if c["tool"] in ai_tools.WEB and answer.get("approve") in ("once", "chat"):
            if answer["approve"] == "chat":
                meta["web_ok"] = time.time()
            # Its step line was shown when the turn paused: not again.
            text = await _web_call(cfg, meta, c["tool"], c["args"])
        elif c["tool"] in ai_tools.ASK:
            # Answered with the buttons, or with the user's next message.
            asked = dict(meta.get("asked") or {})
            if answer.get("cancelled"):
                text = ai_ask.OWN_WORDS
                asked[c["id"]] = {"own": True}
            else:
                got_ = ai_ask.answers(c["args"], answer)
                text = ai_ask.result_text(c["args"], got_)
                meta["decisions"] = ai_ask.settle(meta.get("decisions"), got_, c["id"])
                asked[c["id"]] = ai_ask.shown(got_)
            meta["asked"] = asked
        else:
            text = ai_client_tools.result_text(c["tool"], answer)
            if answer.get("denied"):
                steps.append({"tool": c["tool"], "note": "You declined: "
                              + (c.get("label") or c["tool"]), "ok": False})
            elif ai_client_tools.failed(text):
                # Its step showed as done when it was sent; say it wasn't,
                # to the user and, plainly, to the model.
                steps.append({"tool": c["tool"], "note": "Couldn't: "
                              + (c.get("label") or c["tool"]), "ok": False})
                text += "\n" + ai_client_tools.FAILED_NOTE
            elif c["tool"] == "highlight":
                meta["pointed"] = [*(meta.get("pointed") or []),
                                   sorted(p["anchor"] for p in c["args"].get("points") or [])]
            elif c["tool"] == "read_page" and not answer.get("cancelled"):
                meta["page_read"] = True  # its anchors can be highlighted now
            if c["tool"] == "open" and not answer.get("denied"):
                text += ai_client_tools.open_note(c["args"])
                meta.pop("page_read", None)  # a new page: read it again
                meta.pop("page_reads", None)
            if not (answer.get("denied") or answer.get("cancelled")
                    or ai_client_tools.failed(text)):
                # Its step line was shown when the turn paused, so not
                # again; an empty final answer still says what was done
                # (browser check 2026-10-19: a highlight that worked ended
                # on "The model gave an empty answer").
                done.append(str(c.get("label") or c["tool"]))
        by_id[c["id"]] = {"id": c["id"], "tool": c["tool"], "text": text}
    order = [i for i in paused.get("order") or [] if i in by_id]
    order += [i for i in by_id if i not in order]
    return [by_id[i] for i in order], steps, done


#: Most result links a chat remembers for read_result.
MAX_WEB_URLS = 60


async def _web_call(cfg: dict[str, Any], meta: dict[str, Any], tool: str,
                    args: dict[str, Any]) -> str:
    """Run one allowed web tool on the server."""
    if tool == "read_result":
        return await _ai_web.read_page(cfg, str(args["url"]))
    if tool == "danbooru":
        return await _ai_web.danbooru(str(args["tag"]))
    urls = meta.setdefault("web_urls", [])
    out = await _web_result(cfg, str(args["query"]), urls)
    del urls[:-MAX_WEB_URLS]
    return out


#: How long "Allow for this chat" lasts: a chat reopened the next day asks again.
WEB_OK_SECONDS = 8 * 3600


def _web_pre_allowed(cfg: dict[str, Any], meta: dict[str, Any]) -> bool:
    """Web calls run without a card: allowed for this chat in the last
    `WEB_OK_SECONDS` (an older chat's `True` has expired), or the user chose
    "Don't ask before web calls" in Settings."""
    at = meta.get("web_ok")
    recent = isinstance(at, (int, float)) and not isinstance(at, bool) \
        and 0 <= time.time() - at < WEB_OK_SECONDS
    return bool(recent or cfg.get("web_always_allow"))
