"""A small builder for saved (UI-format) ComfyUI workflows.

Nodes start from `node_templates.json` (one saved node per type, taken from
real workflows, so widgets and sockets are what ComfyUI writes) and get
positions, titles, widget values and links here.
"""

from __future__ import annotations

import copy
import json
import uuid
from pathlib import Path
from typing import Any

TEMPLATES: dict[str, dict[str, Any]] = json.loads(
    (Path(__file__).with_name("node_templates.json")).read_text(encoding="utf-8")
)

MUTE, BYPASS = 2, 4


def note_value(text: str, *, tone: str = "step", step: int = 1, icon: str = "info-circle",
               color: str = "", bookmark: dict[str, Any] | None = None, look: str = "card") -> str:
    return json.dumps({"version": 1, "tone": tone, "look": look, "step": step, "icon": icon,
                       "text": text, "color": color, "bookmark": bookmark}, ensure_ascii=False)


def view(x: float, y: float, zoom: float, shortcut: str, order: int) -> dict[str, Any]:
    return {"anchor": "custom", "view": {"x": x, "y": y}, "zoomMode": "fixed", "zoom": zoom,
            "shortcut": shortcut, "order": order}


class Workflow:
    def __init__(self, wid: str) -> None:
        self.id = wid
        self.nodes: list[dict[str, Any]] = []
        self.links: list[list[Any]] = []
        self.groups: list[dict[str, Any]] = []
        self.reroutes: list[dict[str, Any]] = []
        self.link_parents: dict[int, int] = {}
        self.last_link = 0  # ids never reused, even after a link is dropped

    # nodes

    def add(self, kind: str, pos: tuple[float, float], size: tuple[float, float] | None = None,
            *, title: str | None = None, widgets: dict[str, Any] | None = None,
            mode: int = 0, props: dict[str, Any] | None = None) -> dict[str, Any]:
        n = copy.deepcopy(TEMPLATES[kind])
        n["id"] = len(self.nodes) + 1
        n["pos"] = [pos[0], pos[1]]
        if size:
            n["size"] = [size[0], size[1]]
        if title:
            n["title"] = title
        n["mode"] = mode
        n["order"] = len(self.nodes)
        if props:
            n.setdefault("properties", {}).update(props)
        if widgets:
            self.set(n, **widgets)
        self.nodes.append(n)
        return n

    @staticmethod
    def set(n: dict[str, Any], **values: Any) -> None:
        """Set widget values by name (the keys of `widgets_values_named`)."""
        named = n.get("widgets_values_named")
        if not isinstance(named, dict):
            raise KeyError(f"{n['type']} has no named widgets")
        keys = list(named)
        for k, v in values.items():
            if k not in named:
                raise KeyError(f"{n['type']}: no widget {k!r} (has {keys})")
            named[k] = v
            n["widgets_values"][keys.index(k)] = v

    def reroute(self, x: float, y: float, parent: int | None = None) -> int:
        """A native wire reroute (a dot the wire passes through). `parent` is the
        reroute before it, nearer the wire's source."""
        r: dict[str, Any] = {"id": len(self.reroutes) + 1, "pos": [x, y], "linkIds": []}
        if parent is not None:
            r["parentId"] = parent
        self.reroutes.append(r)
        return r["id"]

    def route(self, *points: tuple[float, float], after: int | None = None) -> int:
        """A chain of reroutes from the source side to the target side; returns
        the last one, to pass as `via`. `after` continues a shared chain."""
        last: int | None = after
        for x, y in points:
            last = self.reroute(x, y, last)
        assert last is not None and points
        return last

    def link(self, a: dict[str, Any], out: str, b: dict[str, Any], inp: str,
             via: int | None = None) -> None:
        oi = next(i for i, o in enumerate(a["outputs"]) if o["name"] == out)
        try:
            ii = next(i for i, x in enumerate(b["inputs"]) if x["name"] == inp)
        except StopIteration:
            # dynamic sockets (Toggles control dots, Node Group slots)
            b["inputs"].append({"name": inp, "type": "*", "link": None})
            ii = len(b["inputs"]) - 1
        self.last_link += 1
        lid = self.last_link
        kind = a["outputs"][oi]["type"]
        self.links.append([lid, a["id"], oi, b["id"], ii, kind])
        if a["outputs"][oi].get("links") is None:
            a["outputs"][oi]["links"] = []
        a["outputs"][oi]["links"].append(lid)
        b["inputs"][ii]["link"] = lid
        if via is not None:
            self.link_parents[lid] = via
            rid: int | None = via
            while rid is not None:
                r = self.reroutes[rid - 1]
                r["linkIds"].append(lid)
                rid = r.get("parentId")

    def group(self, title: str, x: float, y: float, w: float, h: float, color: str) -> None:
        self.groups.append({"id": len(self.groups) + 1, "title": title, "bounding": [x, y, w, h],
                            "color": color, "flags": {}})

    def save(self, path: Path, ds: tuple[float, float, float]) -> None:
        for n in self.nodes:
            for o in n.get("outputs", []):
                if o.get("links") == []:
                    o["links"] = None
        wf = {
            "id": self.id, "revision": 0, "last_node_id": len(self.nodes),
            "last_link_id": self.last_link, "nodes": self.nodes, "links": self.links,
            "groups": self.groups, "config": {},
            "extra": {"ds": {"scale": ds[0], "offset": [ds[1], ds[2]]}}, "version": 0.4,
        }
        if self.reroutes:
            wf["extra"]["reroutes"] = self.reroutes
            wf["extra"]["linkExtensions"] = [
                {"id": lid, "parentId": rid} for lid, rid in self.link_parents.items()]
        path.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def stable_uuid(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "wildcard-pipeline/examples/" + name))
