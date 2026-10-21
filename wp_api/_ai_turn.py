"""POST /wp/api/ai/chat: one chat turn, its step loop, paused page and
web tools, and the closing lines."""
from __future__ import annotations

import asyncio
import json as _json
import re
from typing import Any

from aiohttp import web

from engine.ai import ask as ai_ask
from engine.ai import budget as ai_budget
from engine.ai import chat as ai_chat
from engine.ai import chatlog as ai_chatlog
from engine.ai import client_tools as ai_client_tools
from engine.ai import guide as ai_guide
from engine.ai import lint as ai_lint
from engine.ai import react as ai_react
from engine.ai import safety as ai_safety
from engine.ai import tools as ai_tools
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
    lines above the reply list), then `done` with the same JSON the plain
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
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    # `results`: the browser answering the calls a paused turn waits on
    # (page tools it ran, or the user's answer to a web search).
    answers = body.get("results")
    resume = isinstance(answers, list)
    text = body.get("message")
    retry = bool(body.get("retry")) and not resume
    # Edit last message: a retry that brings new text for that message.
    edited = retry and isinstance(text, str) and bool(text.strip())
    if retry and not edited:
        text = "(retry)"  # replaced by the turn's own message below
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
    page = body.get("page") if isinstance(body.get("page"), dict) else None
    chat_id = body.get("chat_id") if isinstance(body.get("chat_id"), str) else None
    vocab_kinds = await _vocab_kinds(body)

    with db_session(request) as conn:
        lib = ai_chat.Library(
            ModuleRepository(conn).list(), BundleRepository(conn).list(),
            CategoryRepository(conn).list(), TemplateRepository(conn).list(),
        )
        lib.index = _synced_index(conn, lib)
        chat: dict[str, Any] | None = None
        log: list[dict[str, Any]] = []
        if chat_id:
            try:
                chat = ChatRepository(conn).get(chat_id)
                log = ChatRepository(conn).messages(chat_id)
            except ChatNotFound:
                chat = None
    retried_from: int | None = None
    if retry:
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
        if not edited:
            text = str(log[retried_from].get("text") or "")
        images = list(log[retried_from].get("images") or [])
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
        chat = {**chat, "meta": m}
    paused = (chat or {}).get("meta", {}).get("pending") if chat else None
    reaction = ""
    if (chat is not None and not resume and not retry and not paused and not images
            and not body.get("events") and any(e.get("kind") == "step" for e in log)
            and not ai_chatlog.last_reply(log).rstrip().endswith("?")):
        reaction = ai_react.quick(text)
    if reaction:
        # Only thanks or praise: a reaction, no model call, and nothing the
        # model will read (`aside` entries aren't rendered).
        with db_session(request) as conn:
            ChatRepository(conn).append(chat["id"], [ai_chatlog.aside_entry(text, reaction)],
                                        meta=chat["meta"])
        return json_ok({"chat_id": chat["id"], "aside": True, "reaction": reaction,
                        "message": "", "proposals": [], "steps": [], "refs": {},
                        "pending": [], "model": str(chat["meta"].get("model") or "")})
    if resume:
        if not paused:
            return json_error("nothing in this chat is waiting for an answer", status=409)
        text = ai_chatlog.last_user_text(log)
    elif sum(1 for e in log if e.get("kind") == "user") >= ai_chat.MAX_TURNS:
        return json_error("this chat is long; start a new one to keep it focused", status=400)
    if lib.index is not None and _ai_embed.enabled(cfg):
        lib.embed_model = cfg["embed_model"]
        _ai_embed.fill_in_background(cfg, lib.index)
    prof = ai_budget.profile(cfg)
    rows = [*lib.modules.values(), *lib.bundles.values(), *lib.templates.values()]
    fp_now = ai_chatlog.fingerprint(rows, lib._kind)
    if chat is None:
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
        }
        if meta["lazy"]:
            # Their tools aren't declared up front: the first message's
            # tail says how to load them (`_sync_permissions`).
            meta.update(web=False, reader=False, danbooru=False)
        # As lean as the model's window needs (a 16k window can't hold all
        # 37 tool declarations plus the full instructions).
        snapshot = _open_chat(lib, cfg, meta, prof, page, fmt, await _window(cfg, meta))
    else:
        meta = dict(chat["meta"])
        snapshot = chat["snapshot"]
        fmt = meta.get("format") if meta.get("format") in ("native", "json") else "json"
        if cfg.get("tool_format") in ("native", "json") and cfg["tool_format"] != fmt \
                and not any(e.get("kind") == "step" for e in log):
            fmt = cfg["tool_format"]
    if page:
        lib.use_editor(page.get("editor"))
    lib.allow_delete = bool(cfg.get("allow_delete"))
    lib.vocab, lib.vocab_kinds = _ai_vocab.lookup, vocab_kinds
    had = list(meta.get("tools") or [])
    perms = " ".join(x for x in (_sync_permissions(meta, cfg), _sync_vocab(meta, vocab_kinds),
                                 _canvas_note(meta, body)) if x)
    added = [n for n in meta.get("tools") or [] if n not in had]
    if added and fmt == "json" and meta.get("prompt_tools"):
        # The JSON prompt keeps the tools the chat started with: say how
        # the new ones are called here instead.
        perms += "\n" + ai_chat.kinds_section(ai_tools.tools(added)).strip()
    if not resume and text and _ORGANIZE_ASK.search(text):
        perms = "\n".join(x for x in (perms, ai_chat.ORGANIZE_HINT) if x)
    if not resume and text:
        # The groups the message asks for by name come loaded: small models
        # rarely call more_tools and fake the missing tool with another.
        for group in ai_tools.groups_for(text):
            if group in ai_tools.MORE_GROUPS:
                got = _more_tools(meta, group)
                if got.startswith("These tools"):
                    perms = "\n".join(x for x in (perms, got) if x)
    meta, since = ai_chatlog.apply_events(meta, body.get("events"))
    route = str(page.get("route") or "") if page else ""
    if page and route != meta.get("page_route"):
        # Another page: anchors read on the last one don't point here.
        meta["page_route"] = route
        meta.pop("page_read", None)
    changes = ai_chatlog.library_changes(meta.get("fingerprint") or {}, fp_now)
    note = lib.page_note(page)
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
        got = {a["id"]: a for a in (answers or []) if isinstance(a, dict)
               and isinstance(a.get("id"), str)} if resume else {}
        items, first_steps, first_done = await _paused_results(cfg, meta, paused, got)
        tail = ""
        if resume:
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
    if not resume and log:
        meta = await _maybe_compact(cfg, log, meta, prof, num_ctx, window, fixed, emit)
    if not resume:
        meta.pop("asks", None)  # ask pauses are counted per user message
        meta.pop("pointed", None)  # so are the parts already highlighted
        meta.pop("page_reads", None)  # and the page parts already read
        hints = await _retrieval(lib, text, meta, prof, cfg) if text else ""
        pics = _ai_images.note(len(images)) if images else ""
        model = ai_guide.model_note(text) if text else ""
        sent = ai_safety.strip_invisible(
            "\n\n".join(x for x in (since, changes, perms, text, pics, note, hints, model)
                       if x))
        new.append(ai_chatlog.user_entry(text, sent, images))
        meta = ai_chatlog.move_images(log + new, meta)

    cache_key = chat["id"] if chat else ""
    pids = [int(p[1:]) for p in meta.get("proposals") or {} if p[1:].isdigit()]
    lib._next_pid = max(pids, default=0)
    lib.earlier_proposals = dict(meta.get("proposals") or {})
    # The library items the edit tools may change: ones the user named in
    # this chat, the page's item, and ones an earlier card already changes.
    named = set(meta.get("named") or [])
    if not resume and text:
        named |= lib.named_in(text)
        # The items the answer they are replying to showed as chips count
        # as named too ("Now add negatives to the stormy options" after
        # "You have [[Weather]] …"; chat eval round 4 refused every edit).
        named |= lib.shown_in(ai_chatlog.last_shown(log))
    answered_named = _named_by_answers(lib, paused if resume else None, answers)
    named |= answered_named
    if page and isinstance(page.get("id"), str):
        named.add(page["id"])
    for p_ in lib.earlier_proposals.values():
        op = p_.get("op") if isinstance(p_, dict) else None
        if isinstance(op, dict) and op.get("op") == "update" and isinstance(op.get("id"), str):
            named.add(op["id"])
    meta["named"] = sorted(named)
    lib.named = named
    # An item the answer reads in full may be changed when the user asked
    # for a change ("add negatives to the stormy options"), not a new item.
    lib.edit_read = (bool(text) and not resume and not ai_chat.creation_ask(text)) \
        or bool(answered_named)
    lib.decisions = list(meta.get("decisions") or [])  # what `ask` may not ask again
    # Links read_result may open: the same list the searches fill.
    lib.web_urls = meta.setdefault("web_urls", [])
    _adopt_earlier(lib, log, meta)
    proposals: list[dict[str, Any]] = []
    tool_use = {"calls": 0, "salvaged": 0}
    steps: list[dict[str, Any]] = first_steps
    pause: list[dict[str, Any]] = []
    message = ""
    interim = ""
    seen: set[str] = set()
    #: Change calls that failed, by their exact args: the same call again
    #: fails the same way (round 2: an identical create_wildcard twice).
    failed: dict[str, str] = {}
    errors: dict[str, int] = {}
    #: Refusals by tool and reason (ids and numbers left out).
    refused: dict[str, int] = {}
    forced = False
    checked = False
    nudged = False
    #: The step whose create calls were turned to plan_pack (`PACK_FIRST`).
    steered_at: int | None = None
    empty_nudged = False
    #: Ask the next step with the model's thinking off: set by the empty
    #: nudge, since a thinking model that came back empty once tends to
    #: think itself out of an answer again.
    think_off = False
    #: The answer a nudge set aside: shown if the nudged step comes back empty.
    set_aside = ""
    #: A cut answer waiting for the step that continues it, and how many
    #: continuations this answer had.
    carry = ""
    continued = 0
    out_of_time = False
    reads = 0
    ran = 0
    sent_steps = len(steps)
    read_budget = ai_chat.read_budget(prof["size"])
    last_answer = ai_chatlog.last_reply(log)
    usage: dict[str, Any] = {}

    def system_for() -> str:
        return _system_text(prof, meta, fmt, snapshot)

    loop = asyncio.get_running_loop()
    deadline = loop.time() + (TURN_SECONDS_LOCAL if cfg.get("local") else TURN_SECONDS)
    while step < ai_chat.MAX_STEPS:
        late = ran > 0 and loop.time() > deadline  # the first step always runs
        if late and (out_of_time or new[-1].get("kind") != "results"):
            message = message or interim or (
                "(Stopped early: this answer took too long. Ask me to continue.)")
            break
        if late:
            # Out of time with results in hand: one last step to answer.
            out_of_time = forced = True
            new[-1] = {**new[-1], "tail": str(new[-1].get("tail") or "") + (
                "\n\nTime is up: no more tool calls. Answer the user now from what you have.")}
        meta = ai_chatlog.fit(log + new, meta, prof["history_chars"])
        rendered = ai_chatlog.render(log + new, meta)
        if emit:
            await emit({"type": "step", "n": step + 1})
        try:
            st = await asyncio.wait_for(
                _chat_step({**cfg, "thinking": "off"} if think_off else cfg,
                           system=system_for(), log=rendered, fmt=fmt,
                           names=meta["tools"], prof=prof, num_ctx=num_ctx,
                           cache_key=cache_key, emit=emit, typed=bool(meta.get("typed")),
                           decls=_decls(cfg, meta, fmt), split=_splits(cfg, meta, fmt),
                           answer_only=forced),
                timeout=STEP_SECONDS)
        except asyncio.TimeoutError:
            if not steps and not any(x.get("kind") == "step" for x in new):
                return json_error("the model took too long to answer", status=504)
            message = "(Stopped early: this answer took too long. Ask me to continue.)"
            break
        except _ai_chat.ToolsUnsupported as e:
            if fmt == "native" and (e.fallback or not any(
                    x.get("kind") == "step" for x in log + new)):
                # The server has no tool calling, or can't read this
                # model's calls: the same step again in JSON steps, and the
                # chat stays in them (earlier native steps render as JSON
                # steps, `_ai_chat.json_answer`).
                fmt = "json"
                continue
            switched = meta.get("model") and meta.get("model") != cfg.get("model")
            hint = (" This chat started with another model; start a new chat to keep going "
                    "with this one.") if switched else ""
            if not steps:
                return json_error(e.message + hint, status=e.status)
            message = f"(Stopped early: {e.message.rstrip('.')}.{hint})"
            break
        except _ai_client.AIError as e:
            over = ai_budget.overflow(e.message)
            first = not steps and not any(x.get("kind") == "step" for x in log + new)
            if over is not None and chat is None and first \
                    and int(meta.get("lean") or 0) < len(ai_budget.LEVELS) - 1:
                # The server counted more than the estimate: start leaner.
                snapshot = _open_chat(lib, cfg, meta, base_prof, page, fmt, window,
                                      start=int(meta.get("lean") or 0) + 1)
                prof, fixed = _chat_profile(base_prof, cfg, meta, fmt, snapshot, window)
                continue
            if over is not None:
                e = _ai_client.AIError(_too_small(window, fixed, over), status=400)
            if not steps and not any(x.get("kind") == "step" for x in new):
                hint = (" The model may not see images; pick a vision model."
                        if images and re.search(r"image|vision|multimodal|mmproj",
                                                e.message, re.I) else "")
                return json_error(e.message + hint, status=e.status)
            message = f"(Stopped early: {e.message})"
            break
        think_off = False
        step += 1
        ran += 1
        usage = st["usage"]
        said = ai_safety.strip_invisible(st["message"])[:ai_chat.MAX_MESSAGE]
        calls = st["calls"][:ai_chat.MAX_CALLS_PER_STEP]
        plan_text = (st.get("answer") or {}).get("plan") if isinstance(
            st.get("answer"), dict) else ""
        if not said and not calls and isinstance(plan_text, str) \
                and len(plan_text.strip()) >= PLAN_AS_ANSWER:
            # Small models write the whole explanation in "plan" and leave
            # "message" empty: that showed as an empty answer.
            said = ai_safety.strip_invisible(plan_text.strip())[:ai_chat.MAX_MESSAGE]
        native_note = st.get("plan") if fmt == "native" else ""
        if not said and calls and isinstance(native_note, str) and native_note.strip():
            # Native text written next to calls ("I've proposed the two
            # wildcards…") streamed live: keep it on screen above its steps
            # instead of the next step wiping it.
            said = ai_safety.strip_invisible(native_note.strip())[:ai_chat.MAX_MESSAGE]
        dropped = len(st["calls"]) - len(calls)
        # How the model called its tools this answer, for the drawer's badge.
        tool_use["calls"] += len(calls)
        if st.get("salvaged"):
            tool_use["salvaged"] += len(calls)
        raw = (_ai_chat.responses_raw(st["raw"], {c["id"] for c in calls})
               if st.get("raw") else None)
        new.append(ai_chatlog.step_entry(ai_safety.strip_invisible(st["text"]), calls,
                                         answer=st["answer"], usage=usage,
                                         model=str(cfg.get("model") or ""), raw=raw))
        thought = st.get("thinking")
        if isinstance(thought, str) and thought.strip():
            # What it thought before acting, for the drawer's "Thinking"
            # (display only: steps are never sent to the model).
            steps.append({"tool": "think", "note": thought.strip(), "ok": True,
                          "think": True})
        if carry and not calls:
            said = ai_chat.join_continuation(carry, said)
            carry = ""
        # Cut off: the output limit, or a stream that ended early, or (no
        # signal at all) a reply that stops mid-sentence.
        cut = bool(said) and not calls and (
            bool(usage.get("cut")) or ai_chat.looks_cut(said))
        if cut and continued < MAX_CONTINUE and step < ai_chat.MAX_STEPS \
                and not out_of_time:
            # Ask for the rest; the two parts are joined into one answer.
            continued += 1
            carry = said
            new.append(ai_chatlog.note_entry(ai_chat.CONTINUE_NUDGE))
            continue
        # A message sent along with calls is usually "I'll search…": keep it
        # only as a fallback, so the answer is the step that stops calling.
        if said and not calls:
            message = said
            if cut:
                message += "\n\n*(Cut off: the model stopped before finishing.)*"
        elif said:
            interim = said
            # What it said before acting stays on screen above its steps
            # (it streamed live), instead of vanishing when the calls start.
            if not any(x.get("say") and x.get("note") == said for x in steps):
                steps.append({"tool": "say", "note": said, "ok": True, "say": True})
        if forced and calls:
            # Told to answer and called again anyway: stop on what it said.
            message = message or interim or _stuck_line(steps)
            break
        if any(c["tool"] == "run_test" for c in calls):
            checked = True
        items: list[dict[str, Any]] = []
        needs_reply = False
        repeats = 0
        waiting = ai_ask.deferred_page_calls(calls, change=ai_chat.CHANGE_TOOLS,
                                             pause=ai_chat.PAUSE_TOOLS,
                                             web=tuple(ai_tools.WEB))
        asked = [c for i, c in enumerate(calls) if i not in waiting]
        for at, call in enumerate(calls):
            tool = call["tool"]

            def result(out: str, call: dict[str, Any] = call,
                       items: list[dict[str, Any]] = items) -> None:
                # What the model reads back loses hidden characters too.
                items.append({"id": call["id"], "tool": call["tool"],
                              "text": ai_safety.strip_invisible(out)})

            spec = ai_tools.BY_NAME.get(tool)
            if spec is None:
                needs_reply = True
                result(f"{tool}: error: there is no tool named {tool[:40]}")
                steps.append({"tool": "unknown", "note": f"Unknown tool {tool[:40]}",
                              "ok": False})
                continue
            if tool != "more_tools" and tool not in (meta.get("tools") or []):
                # Only what this chat offers; more_tools unlocks the rest.
                needs_reply = True
                result(f"{tool}: error: {tool} isn't available here; call more_tools first")
                steps.append({"tool": tool, "note": f"{tool} isn't available here", "ok": False})
                continue
            if at in waiting:
                result(f"{tool}: {ai_ask.DEFERRED}")
                continue
            key = ""
            try:
                raw = call["args"] if isinstance(call.get("args"), dict) else call["args_text"]
                args, arg_notes = ai_tools.check_args(spec, ai_chat.parse_args(raw))
                if tool in ai_tools.ASK:
                    problem = ai_ask.step_problem(asked, asked.index(call),
                                                  change=ai_chat.CHANGE_TOOLS,
                                                  pause=ai_chat.PAUSE_TOOLS)
                    if problem:
                        raise ValueError(problem)
                    if int(meta.get("asks") or 0) >= ai_ask.MAX_ASKS:
                        needs_reply = True
                        result(ai_ask.TOO_MANY)
                        steps.append({"tool": tool, "note": "Decided without asking again",
                                      "ok": True})
                        continue
                    try:
                        cargs, label = ai_client_tools.prepare(lib, tool, args)
                    except ai_ask.Settled as done:
                        needs_reply = True
                        result(str(done))
                        steps.append({"tool": tool, "note": "Already answered", "ok": True})
                        continue
                    meta["asks"] = int(meta.get("asks") or 0) + 1
                    pause.append({"id": call["id"], "tool": tool, "args": cargs, "label": label})
                    steps.append({"tool": tool, "note": label, "ok": True})
                    continue
                if tool in ai_chat.PAUSE_TOOLS:
                    if tool == "highlight" and not meta.get("page_read") and not any(
                            c["tool"] == "read_page" for c in calls[:at]):
                        # Its anchors would be guesses, and the browser would
                        # only say "no part" after a pause.
                        raise ValueError(ai_client_tools.READ_PAGE_FIRST)
                    try:
                        cargs, label = ai_client_tools.prepare(lib, tool, args)
                    except ai_client_tools.Shown as shown:
                        needs_reply = True
                        again = tool + _json.dumps(args, sort_keys=True, ensure_ascii=False)
                        if again in seen:
                            # Small models "open" the card on screen again
                            # and again instead of answering.
                            repeats += 1
                        seen.add(again)
                        result(str(shown))
                        continue
                    if tool == "highlight":
                        anchors = sorted(p["anchor"] for p in cargs["points"])
                        pointed = list(meta.get("pointed") or [])
                        if anchors in pointed:
                            # Small models point at the same part again and
                            # again instead of answering. Only a highlight
                            # the browser showed counts (`_paused_results`).
                            needs_reply = True
                            result(ai_chat.POINTED_AGAIN)
                            steps.append({"tool": tool, "note": label, "ok": True})
                            continue
                    if tool == "read_page":
                        again = _json.dumps(cargs, sort_keys=True, ensure_ascii=False)
                        read_before = list(meta.get("page_reads") or [])
                        if again in read_before:
                            # Live probe 2026-10-21: Haiku read the same part
                            # five times, one pause each, then said nothing.
                            repeats += 1
                            needs_reply = True
                            result(ai_chat.READ_AGAIN)
                            continue
                        meta["page_reads"] = [*read_before, again][-20:]
                    if tool in ai_tools.WEB and _web_pre_allowed(cfg, meta):
                        # Allowed for this chat (or always): run it now.
                        result(await _web_call(cfg, meta, tool, cargs))
                        needs_reply = True
                        steps.append({"tool": tool, "note": label, "ok": True})
                        continue
                    # The browser runs it, or the user allows it: pause.
                    pause.append({"id": call["id"], "tool": tool, "args": cargs,
                                  "label": label})
                    steps.append({"tool": tool, "note": label, "ok": True})
                    continue
                if (tool.startswith("create_") and steered_at in (None, step)
                        and _PACK_ASK.search(text or "")
                        and "plan_pack" in (meta.get("tools") or [])
                        and not any(c["tool"] == "plan_pack" for c in calls)
                        and not any(p_["tool"] == "plan_pack" for p_ in proposals)):
                    # Every eval run: "plan a pack" made 2-3 loose items and
                    # never the Pack builder, which plans and checks a pack.
                    steered_at = step
                    raise ValueError(PACK_FIRST)
                key = tool + _json.dumps(args, sort_keys=True, ensure_ascii=False)
                if tool not in ai_chat.CHANGE_TOOLS and key in seen:
                    # Small models re-run the same search every step.
                    repeats += 1
                    needs_reply = True
                    result(f"{tool}: you already made this exact call; its results are above. "
                           "Don't repeat it.")
                    continue
                if key in failed:
                    repeats += 1
                    needs_reply = True
                    result(f"{tool}: you already made this exact call and it failed ("
                           f"{failed[key]}); sending it again fails again. Change what the "
                           "error names, or answer now")
                    continue
                seen.add(key)
                if errors.get(tool, 0) >= 3:
                    raise ValueError("this tool failed three times in this answer; stop "
                                     "calling it and tell the user what went wrong")
                if tool in ai_chat.CHANGE_TOOLS and len(proposals) >= ai_chat.MAX_PROPOSALS:
                    raise ValueError("too many changes in one answer; stop here")
                if tool == "more_tools":
                    out: Any = _more_tools(meta, args.get("group"))
                else:
                    if tool == "search":
                        lib.qvec = await _query_vector(lib, cfg, str(args.get("query") or ""))
                    out = lib.run(tool, args)
            except ValueError as e:
                errors[tool] = errors.get(tool, 0) + 1
                if key and tool in ai_chat.CHANGE_TOOLS:
                    failed[key] = ai_budget.clip(str(e), 300)
                why = tool + re.sub(r"\b[0-9a-f]{8}\b|\d+", "#", str(e))
                refused[why] = refused.get(why, 0) + 1
                needs_reply = True
                result(f"{tool}: error: {e}")
                steps.append({"tool": tool, "note": f"{tool}: {e}", "ok": False})
                continue
            except Exception as e:  # noqa: BLE001 - one broken call mustn't end the turn
                errors[tool] = errors.get(tool, 0) + 1
                needs_reply = True
                result(f"{tool}: error: that didn't work ({type(e).__name__}); try other "
                       "arguments or another way")
                steps.append({"tool": tool, "note": f"{tool} failed", "ok": False})
                continue
            extra = ("\n(" + "; ".join(arg_notes) + ")") if arg_notes else ""
            if isinstance(out, str):
                needs_reply = True
                result(f"{tool} {_json.dumps(args, ensure_ascii=False, sort_keys=True)[:200]}:\n"
                       + ai_budget.clip(out, prof["result_chars"]) + extra)
                if tool == "react":
                    continue  # shown on the user's message, not as a step
                step_ = {"tool": tool, "note": ai_chat.args_note(tool, args, lib), "ok": True}
                card = getattr(lib, "last_card", None) if tool == "run_test" else None
                if card:
                    # The run as a card the user can open in the Test Runner.
                    step_["card"] = card
                    lib.last_card = None
                steps.append(step_)
            else:
                # Hidden characters can't ride into the library on a card.
                out = ai_safety.clean(out)
                twin = any(p_["pid"] == out.get("replaces") for p_ in proposals)
                if twin:
                    # A repeat of a card from this answer: the user gets one.
                    old_pid, new_pid = out["replaces"], out["pid"]
                    proposals[:] = [p_ for p_ in proposals if p_["pid"] != old_pid]
                    for p_ in proposals:
                        if p_.get("after") == old_pid:
                            p_["after"] = new_pid
                        if p_.get("needs"):
                            p_["needs"] = [new_pid if n == old_pid else n for n in p_["needs"]]
                proposals.append(out)
                meta.setdefault("proposals", {})[out["pid"]] = {
                    "title": out["title"], "status": None}
                if out.get("replaces"):
                    gone = meta["proposals"].get(out["replaces"])
                    if gone is not None:
                        meta["proposals"][out["replaces"]] = {**gone, "status": "replaced"}
                result(ai_chat.proposal_note(tool, out) + extra)
                if twin:
                    out.pop("replaces")  # the user never saw the card it replaces
                steps.append({"tool": tool, "note": out["title"], "ok": True})
        if emit:
            for s_ in steps[sent_steps:]:
                await emit({"type": "tool", "step": s_})
            sent_steps = len(steps)
        if calls and not said and _splits(cfg, meta, fmt):
            # A split step's act ask can't write: after its cards, one more
            # step lets it say what it proposed (or carry on).
            needs_reply = True
        if pause:
            # Wait for the browser: what ran here waits with the calls.
            meta["pending"] = {"calls": pause, "items": items, "step": step,
                               "order": [c["id"] for c in calls]}
            message = said or interim
            break
        if not needs_reply:
            if not calls and not said and not proposals:
                # An empty answer: thinking models can spend the whole output
                # allowance before writing anything.
                cut = bool(usage.get("cut"))
                if lib.reaction and not set_aside:
                    break  # it reacted and had nothing to add: that's the answer
                if set_aside:
                    # Nudged, and then nothing: the earlier answer stands.
                    message = set_aside
                    break
                if cut or empty_nudged or step >= ai_chat.MAX_STEPS:
                    message = message or interim or (
                        "(The model used up its output limit before answering; thinking "
                        "models do this. Try again, raise the output limit, or turn its "
                        "thinking off.)" if cut else _done_line(steps, first_done))
                    break
                empty_nudged = think_off = True
                new.append(ai_chatlog.note_entry(ai_chat.EMPTY_NUDGE))
                continue
            if (not calls and not proposals and not nudged and not cut
                    and step < ai_chat.MAX_STEPS and ai_chat.unfinished(said)):
                nudged = True
                set_aside, message = said, ""
                new.append(ai_chatlog.note_entry(ai_chat.UNFINISHED_NUDGE))
                continue
            promised = ai_chat.promised_call(said)
            if (not calls and not proposals and not nudged and promised
                    and step < ai_chat.MAX_STEPS):
                nudged = True
                set_aside, message = said, ""
                new.append(ai_chatlog.note_entry(ai_chat.promise_nudge(promised)))
                continue
            # Said it made, tested or opened something with no call behind
            # it, or answered an organize ask with a list: ask once for the
            # call (9B: 3 of 3 organize and plan-a-pack turns, "the Test
            # Runner is now open" with no run).
            if (not calls and not proposals and not nudged and step < ai_chat.MAX_STEPS
                    and (ai_chat.claims_change(said) or _card_as_text(said)
                         or _ORGANIZE_ASK.search(text or ""))):
                nudged = True
                set_aside, message = said, ""
                new.append(ai_chatlog.note_entry(
                    ai_chat.ORGANIZE_NUDGE if _ORGANIZE_ASK.search(text or "")
                    and not ai_chat.claims_change(said) else ai_chat.CLAIM_NUDGE))
                continue
            # Proposed part of the ask and put the rest off to a later turn
            # ("Apply it, then I'll propose the derivation"): ask once for
            # the rest, in this answer.
            if (proposals and not calls and not nudged and step < ai_chat.MAX_STEPS
                    and ai_chat.defers_rest(said)):
                nudged = True
                set_aside, message = said, ""
                new.append(ai_chatlog.note_entry(ai_chat.DEFER_NUDGE))
                continue
            # Asked leave instead of proposing, or met "yes" with more talk:
            # tell it once to act. Small models loop on "Should I proceed?".
            if (not calls and not proposals and not nudged
                    and step < ai_chat.MAX_STEPS
                    and ai_chat.stalls(said, text, last_answer)):
                nudged = True
                # The stalled question isn't the answer, unless nothing better
                # comes.
                set_aside, message = said, ""
                new.append(ai_chatlog.note_entry(ai_chat.GO_NUDGE))
                continue
            # Changes were proposed but never tried: ask for one check
            # before the answer stands, so "done" means it ran.
            if (not checked and step < ai_chat.MAX_STEPS
                    and any(p["tool"] in ai_chat.CHECKABLE_TOOLS for p in proposals)):
                checked = True
                tail = "\n\n" + ai_chat.CHECK_NUDGE
                if items:
                    new.append(ai_chatlog.results_entry(items, tail))
                else:
                    new.append(ai_chatlog.note_entry(ai_chat.CHECK_NUDGE))
                continue
            if items:
                new.append(ai_chatlog.results_entry(items, ""))
            break
        if step >= ai_chat.MAX_STEPS:
            new.append(ai_chatlog.results_entry(items, ""))
            message = (message or interim
                       or "I ran out of steps before finishing; ask me to continue.")
            break
        # Only repeats, read enough, or one step left: no more tools, answer now.
        reads += sum(1 for c in calls if c["tool"] in ai_tools.READ)
        # The same refusal twice: small models loop on it instead of
        # answering, so the next step must answer (with what went wrong).
        forced = (bool(calls and repeats == len(calls)) or step == ai_chat.MAX_STEPS - 1
                  or reads >= read_budget or out_of_time
                  or max(refused.values(), default=0) >= MAX_REFUSED)
        more = (f"\n\nOnly your first {len(calls)} calls ran; {dropped} more were left out."
                + ("" if forced else " Make them in your next step.")) if dropped else ""
        new.append(ai_chatlog.results_entry(
            items, more + _results_tail(text, last=forced, native=fmt == "native",
                                        split=_splits(cfg, meta, fmt))))

    if pause:
        pass  # the turn goes on when the browser answers
    else:
        if not message and not (lib.reaction and not proposals and not interim):
            message = interim if interim and proposals else (
                "Here's what I'd change." if proposals else interim or set_aside
                or _done_line(steps, first_done))
        # Every call gets a result and the turn ends on an answer.
        last = new[-1]
        if last.get("kind") == "step" and last.get("calls"):
            new.append(ai_chatlog.results_entry(
                [{"id": c["id"], "tool": c["tool"], "text": f"{c['tool']}: not run"}
                 for c in last["calls"]], ""))
        if new[-1].get("kind") != "step":
            new.append(_final_step(fmt, message))
        if proposals and _TEST_ASK.search(text or "") and not any(
                s_.get("tool") == "run_test" and s_.get("ok") for s_ in steps):
            # Asked to test and never did (chat eval: the 9B wrote that it
            # can't): run it here, card and all. The note goes after the
            # answer, so the log stays append-only for the cache.
            got = _auto_test(lib, proposals)
            if got is not None:
                args_, report = got
                names_ = [str(lib.names.get(i) or i) for i in args_["stack"]]
                step_: dict[str, Any] = {
                    "tool": "run_test", "ok": True, "auto": True,
                    "note": f"Ran {', '.join(names_[:4])} with the proposed changes"}
                card = getattr(lib, "last_card", None)
                if card:
                    step_["card"] = card
                    lib.last_card = None
                steps.append(step_)
                if emit:
                    await emit({"type": "tool", "step": step_})
                new.append(ai_chatlog.note_entry(
                    AUTO_TEST_NOTE + f"run_test {_json.dumps(args_, sort_keys=True)}:\n"
                    + ai_budget.clip(report, prof["result_chars"])))
                message = message.rstrip() + "\n\n" + AUTO_TESTED
    if not pause and _TESTED.search(message or "") and not any(
            s_.get("tool") == "run_test" and s_.get("ok") for s_ in steps):
        # Chat eval round 1: "I ran a test on your Lighting wildcard" after
        # its only run_test failed.
        message = message.rstrip() + "\n\n" + NOTHING_TESTED
    if not pause and not proposals and (_CLAIMS.search(message or "")
                                        or _card_as_text(message)
                                        or _ORGANIZE_ASK.search(text or "")):
        # The 9B said "I've created … as a fixed values module" with no card,
        # and wrote "here's the card to apply: …" or an add_rules call as text.
        message = message.rstrip() + "\n\n" + NOTHING_PROPOSED
    elif not pause and proposals and (missing := _missing_kinds(message, proposals)):
        # All-tools eval: "I've proposed a combine" beside a wildcard card.
        what = " or ".join(k.replace("_", " ") for k in missing)
        message = (message.rstrip() + f"\n\n*(No {what} card came with this answer, so no "
                   f"{what} was made. Ask me to propose it.)*")
    # Chips for the items it names; no bare ids for the user.
    message = lib.link_items(message)
    meta["format"] = fmt
    meta["fingerprint"] = fp_now
    meta["model"] = cfg.get("model")
    out: dict[str, Any] = {
        "message": message, "proposals": proposals, "steps": steps,
        "model": cfg["model"], "format": fmt, "usage": usage, "tool_use": tool_use,
        # Card warnings name items too ("$coat is already set by [[id#Coat]]").
        "refs": lib.message_refs("\n".join([message, *(w for p_ in proposals
                                                          for w in p_.get("warnings") or [])])),
        # Calls for the browser to run (or the user to allow) before the
        # turn goes on; it posts their results back as `results`.
        "pending": [{k: c[k] for k in ("id", "tool", "args", "label")} for c in pause],
    }
    if lib.reaction:
        out["reaction"] = lib.reaction  # on the user's message
    # What the user saw, for reopening the chat later (the model never
    # reads it).
    new.append(ai_chatlog.shown_entry({k: out[k] for k in (
        "message", "proposals", "steps", "refs", "model", "pending", "format", "tool_use",
        "reaction") if k in out}))
    out["context"] = _context(cfg, meta, log + new, fixed, usage, window)
    with db_session(request) as conn:
        repo = ChatRepository(conn)
        if chat is None:
            chat = repo.create(title=ai_chatlog.title_for(text) if text else "Image",
                               snapshot=snapshot, meta=meta)
        elif retried_from is not None:
            repo.truncate(chat["id"], retried_from, meta=meta)
        repo.append(chat["id"], new, meta=meta)
    return json_ok({"chat_id": chat["id"], **out})


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
#: The kind of item such an answer says it made ("I've proposed a combine").
_CLAIM_KIND = re.compile(r"\bI(?:'ve| have)?\s+(?:just\s+)?(?:created|made|added|built|set up|"
                         r"proposed)\b[^.\n]{0,80}?\b(fixed[ -]values?|combine|template|bundle|"
                         r"constraint|derivation|wildcard)s?\b", re.I)


def _missing_kinds(message: str, proposals: list[dict[str, Any]]) -> list[str]:
    """Kinds the answer says it made that no card of this answer is."""
    have = set()
    for p in proposals:
        op = p.get("op") or {}
        have.add(str(op.get("type") or (op.get("body") or {}).get("type") or op.get("kind")))
    said = [re.sub(r"fixed[ -]values?", "fixed_values", m.group(1).lower())
            for m in _CLAIM_KIND.finditer(message or "")]
    return [k for k in dict.fromkeys(said) if k not in have]


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
        op = p.get("op") if isinstance(p.get("op"), dict) else {}
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


#: The same refusal this many times in one answer, and the model must answer.
MAX_REFUSED = 2


#: A JSON-mode "plan" this long, with no message and no calls, is the answer.
PLAN_AS_ANSWER = 80


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
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The results entry for a paused step, in the step's call order: the
    server results made before the pause plus each paused call's answer."""
    by_id = {it["id"]: it for it in paused.get("items") or [] if isinstance(it, dict)}
    steps: list[dict[str, Any]] = []
    done: list[str] = []
    for c in paused.get("calls") or []:
        answer = got.get(c["id"], {"cancelled": True})
        if c["tool"] in ai_tools.WEB and answer.get("approve") in ("once", "chat"):
            if answer["approve"] == "chat":
                meta["web_ok"] = True
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


def _web_pre_allowed(cfg: dict[str, Any], meta: dict[str, Any]) -> bool:
    """Web calls run without a card: allowed for this chat, or the user
    chose "Don't ask before web calls" in Settings."""
    return bool(meta.get("web_ok") or cfg.get("web_always_allow"))
