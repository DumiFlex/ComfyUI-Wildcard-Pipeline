"""The workflows in `example_workflows/` run on an EMPTY library.

ComfyUI lists them under Browse Templates. Every list they use is embedded on
their WP Context nodes, so this test runs each one's WP nodes through the
engine with a fresh database and fails on a payload a handler rejects, a
warning (an unknown `@{}` reference, a missing variable…) or an empty prompt.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import pytest

from engine.modules import dispatcher
from engine.modules.snapshot import payload_hash
from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.context_loop import WPContextLoop
from wp_nodes.context_node import WPContext
from wp_nodes.injector_node import WPContextInjector
from wp_nodes.prompt_cleaner import WPPromptCleaner
from wp_nodes.toggles_node import WPToggles
from wp_nodes.var_to_bool import WPVarToBool
from wp_nodes.var_to_float import WPVarToFloat
from wp_nodes.var_to_int import WPVarToInt

EXAMPLES = sorted((Path(__file__).parent.parent / "example_workflows").glob("*.json"))
BYPASS, MUTE = 4, 2
VAR_NODES = {"WP_VarToInt": WPVarToInt, "WP_VarToFloat": WPVarToFloat, "WP_VarToBool": WPVarToBool}
# Every WP node, frontend-only ones included, shows up in at least one example.
ALL_WP_NODES = {
    "WP_Context", "WP_ContextLoop", "WP_ContextInjector", "WP_Toggles", "WP_ModelInfo",
    "WP_PromptAssembler", "WP_PromptCleaner", "WP_Debug", "WP_SeedList", "WP_ImageFilter",
    "WP_LabelGrid", "WP_VarToInt", "WP_VarToFloat", "WP_VarToBool", "WP_VarToChoice",
    "WP_Note", "WP_Bookmark", "WP_NodeGroup", "WP_ModeRelay",
}


@pytest.fixture(autouse=True)
def _empty_library(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_DB_PATH", os.fspath(tmp_path / "wp.db"))


def _json_value(values: list[Any], key: str) -> str:
    """The widget value that is a JSON object holding `key`."""
    for v in values:
        if isinstance(v, str) and v.startswith("{"):
            try:
                if key in json.loads(v):
                    return v
            except ValueError:
                continue
    raise AssertionError(f"no JSON widget value with {key!r}")


class Graph:
    """Runs the WP nodes of a saved (UI-format) workflow, frame by frame."""

    def __init__(self, wf: dict[str, Any], toggles_on: bool = False, unmute: bool = False):
        self.toggles_on = toggles_on
        # Muted groups are the modes a Pick one toggle switched off; with
        # `unmute` they run too, so every mode gets checked.
        self.unmute = unmute
        self.nodes = {n["id"]: n for n in wf["nodes"]}
        self.links = {link[0]: link for link in wf["links"]}
        self.frame: Any = None
        self.cache: dict[tuple[int, int], Any] = {}
        self.warnings: list[dict[str, Any]] = []

    def source(self, node: dict[str, Any], name: str) -> tuple[dict[str, Any], int] | None:
        for inp in node.get("inputs") or []:
            if inp["name"] == name and inp.get("link") is not None:
                link = self.links[inp["link"]]
                return self.nodes[link[1]], link[2]
        return None

    def input(self, node: dict[str, Any], name: str) -> Any:
        src = self.source(node, name)
        return None if src is None else self.output(*src)

    def output(self, node: dict[str, Any], slot: int) -> Any:
        key = (node["id"], slot)
        if key not in self.cache:
            self.cache[key] = self._run(node, slot)
        return self.cache[key]

    def _run(self, node: dict[str, Any], slot: int) -> Any:
        t, wv, mode = node["type"], node.get("widgets_values") or [], node.get("mode", 0)
        if mode == MUTE and self.unmute:
            mode = 0
        if mode == MUTE:
            return None
        if mode == BYPASS:
            # A bypassed context node hands its upstream on; anything else
            # gives nothing and the receiving widget keeps its own value.
            return self.input(node, "upstream") if t.startswith("WP_Context") else None
        if t == "WP_ContextLoop":
            return self.frame if slot == 0 else None
        if t == "WP_ModelInfo":
            # No model here: it hands its upstream on, as with no model wired.
            return self.input(node, "upstream")
        if t == "WP_Context":
            out = WPContext.execute(
                wv[0], _json_value(wv, "modules"), upstream=self.input(node, "upstream"),
            )
            ctx = out.values[0]
            self.warnings += ctx.debug.get("__wp_warnings__", [])
            return ctx
        if t == "WP_ContextInjector":
            slots = {
                i["name"]: self.input(node, i["name"])
                for i in node.get("inputs") or [] if i["name"].startswith("input_")
            }
            return WPContextInjector.execute(
                _json_value(wv, "rows"), upstream=self.input(node, "upstream"), **slots,
            ).values[0]
        if t == "WP_Toggles":
            cfg = json.loads(_json_value(wv, "rows"))
            if self.toggles_on:
                for row in cfg["rows"]:
                    row["on"] = True
            return WPToggles.execute(
                upstream=self.input(node, "upstream"), wp_toggles=json.dumps(cfg),
            ).values[slot]
        if t == "WP_PromptAssembler":
            ctx = self.input(node, "context")
            return WPPromptAssembler.execute(ctx, wv[0], wv[1]).values[slot]
        if t == "WP_PromptCleaner":
            return WPPromptCleaner.execute(
                self.input(node, "prompt"), _json_value(wv, "mode"),
                negative=self.input(node, "negative"),
            ).values[slot]
        if t in VAR_NODES:
            return VAR_NODES[t].execute(self.input(node, "context"), wv[0], wv[1], wv[2]).values[0]
        if t.startswith("Primitive"):
            return wv[0]
        return None  # Model loaders, samplers, images: not ours to run here.

    def loops(self) -> list[dict[str, Any]]:
        return [n for n in self.nodes.values() if n["type"] == "WP_ContextLoop"]

    def frames(self, loop: dict[str, Any] | None = None) -> list[Any]:
        loops = self.loops()
        if not loops:
            return [None]
        wv = (loop or loops[0])["widgets_values"]
        return WPContextLoop.execute([wv[0]], [wv[2]], [_json_value(wv, "strategy")]).values[0]

    def downstream(self, start: dict[str, Any]) -> set[int]:
        """Ids of every node fed, directly or not, by `start`."""
        seen: set[int] = set()
        todo = [start["id"]]
        while todo:
            nid = todo.pop()
            for link in self.links.values():
                if link[1] == nid and link[3] not in seen:
                    seen.add(link[3])
                    todo.append(link[3])
        return seen

    def per_loop(self) -> list[tuple[dict[str, Any] | None, list[dict[str, Any]]]]:
        """Each loop (or None) with the active Prompt Assemblers it feeds."""
        asms = [
            n for n in self.nodes.values() if n["type"] == "WP_PromptAssembler"
            and (n.get("mode", 0) == 0 or (self.unmute and n.get("mode") == MUTE))
        ]
        loops = self.loops()
        if len(loops) <= 1:
            return [(loops[0] if loops else None, asms)]
        return [(lp, [a for a in asms if a["id"] in self.downstream(lp)]) for lp in loops]

    def run_frames(
        self, loop: dict[str, Any] | None, node: dict[str, Any], slot: int = 0,
    ) -> list[Any]:
        out = []
        for frame in self.frames(loop) if loop else [None]:
            self.frame, self.cache = frame, {}
            out.append(self.output(node, slot))
        return out


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_examples_exist():
    assert len(EXAMPLES) >= 3


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_embedded_rows_are_engine_valid(path: Path):
    for node in _load(path)["nodes"]:
        if node["type"] != "WP_Context":
            continue
        value = json.loads(_json_value(node["widgets_values"], "modules"))
        uids = {b["_uid"] for b in value.get("bundles", [])}
        for b in value.get("bundles", []):
            assert b.get("example") is True, f"bundle {b['name']} is not flagged example"
            assert b.get("parent_uid") in (None, *uids)
        for row in value["modules"]:
            handler = dispatcher.get_handler(row["type"])
            assert handler is not None, row["type"]
            handler.validate_payload(row["payload"])
            assert row["payload_hash"] == payload_hash(row["payload"]), row["meta"]["name"]
            assert row.get("example") is True, f"row {row['meta']['name']} is not flagged example"


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_runs_on_an_empty_library_without_warnings(path: Path):
    wf = _load(path)
    graph = Graph(wf, unmute=True)
    groups = graph.per_loop()
    assert any(asms for _, asms in groups)
    for loop, assemblers in groups:
        assert assemblers, f"loop {loop and loop['id']} feeds no Prompt Assembler"
        for frame in graph.frames(loop) if loop else [None]:
            graph.frame, graph.cache = frame, {}
            for asm in assemblers:
                assert graph.output(asm, 0).strip(), f"{asm.get('title')} printed nothing"
            for node in wf["nodes"]:
                if node["type"] == "WP_PromptCleaner" or node["type"] in VAR_NODES:
                    graph.output(node, 0)
    bad = [w for w in graph.warnings if w.get("severity") in ("warn", "warning", "error")]
    assert not bad, bad


def test_lora_toggles_swap_in_the_trigger_words():
    path = next(p for p in EXAMPLES if p.stem.startswith("1 "))
    wf = _load(path)
    asm = next(n for n in wf["nodes"] if n["type"] == "WP_PromptAssembler")
    off = Graph(wf).output(asm, 0)
    on = Graph(wf, toggles_on=True).output(asm, 0)
    words = [n["widgets_values"][0] for n in wf["nodes"] if n["type"].startswith("PrimitiveString")]
    assert len(words) == 3
    assert not any(w in off for w in words)
    assert all(w in on for w in words), on


def test_every_wp_node_is_in_an_example():
    seen = {n["type"] for p in EXAMPLES for n in _load(p)["nodes"]}
    assert ALL_WP_NODES <= seen, sorted(ALL_WP_NODES - seen)


def _sets_and_stories() -> tuple[Graph, dict[str, tuple[dict[str, Any], dict[str, Any]]]]:
    """The Sets and stories workflow: each group's loop, prompt and labels."""
    path = next(p for p in EXAMPLES if p.stem.startswith("4 "))
    wf = _load(path)
    graph = Graph(wf, unmute=True)
    titled = {n["title"]: n for n in wf["nodes"] if n.get("title")}
    out = {}
    toggles = titled["WP Toggles · pick a mode"]
    rows = json.loads(toggles["widgets_values"][0])["rows"]
    modes = {g for r in rows for g in r.get("groups", [])}
    for group in wf["groups"]:
        if group["title"] not in modes:
            continue  # the parts inside a mode row (Lists, Prompt, Image…)
        x, y, w, h = group["bounding"]
        inside = [
            n for n in wf["nodes"] if x <= n["pos"][0] <= x + w and y <= n["pos"][1] <= y + h
        ]
        loop = next(n for n in inside if n["type"] == "WP_ContextLoop")
        asm = next(n for n in inside if n["type"] == "WP_PromptAssembler" and not n.get("title"))
        out[group["title"]] = (loop, asm)
    assert titled["WP Toggles · pick a mode"]
    return graph, out


def _subject(prompt: str) -> str:
    found = re.search(r"\ban? \d+-year-old [^,]+", prompt)
    assert found, prompt
    return found.group(0)


def test_sets_and_stories_modes_hold_what_they_say():
    graph, groups = _sets_and_stories()
    loop, asm = groups["Every frame different"]
    random_people = {_subject(p) for p in graph.run_frames(loop, asm)}
    assert len(random_people) > 3, random_people

    loop, asm = groups["Photo shoot"]
    shots = graph.run_frames(loop, asm)
    assert len({_subject(p) for p in shots}) == 1, shots
    order = ["wide shot", "full body", "cowboy shot", "upper body",
             "portrait", "close-up"]
    assert [next(s for s in order if f", {s}, " in p) for p in shots] == order

    loop, asm = groups["Storyboard"]
    beats = graph.run_frames(loop, asm)
    assert len({_subject(p) for p in beats}) == 1, beats
    assert len(set(beats)) == len(beats)


@pytest.mark.parametrize("pick,quick", [("Quick", True), ("Full", False)])
def test_quick_preview_switch_follows_the_pick(pick: str, quick: bool):
    """Example 2: the Quick toggle has a Value (its steps), so Var → Bool reads its switch
    through `$quick_preview.bool`, not the value."""
    path = next(p for p in EXAMPLES if p.stem.startswith("2 "))
    wf = _load(path)
    tog = next(n for n in wf["nodes"] if n["type"] == "WP_Toggles")
    wv = tog["widgets_values"]
    i = wv.index(_json_value(wv, "rows"))
    cfg = json.loads(wv[i])
    for row in cfg["rows"]:
        row["on"] = row.get("name") == pick
    wv[i] = json.dumps(cfg)
    node = next(n for n in wf["nodes"] if n["type"] == "WP_VarToBool")
    assert Graph(wf).output(node, 0) is quick
