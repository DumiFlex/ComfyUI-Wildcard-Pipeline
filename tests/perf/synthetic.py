"""A synthetic, feature-heavy pipeline for the determinism guard and the
engine benchmarks.

Built from a fixed ``random.Random`` seed, so the same ``scale`` always gives
the same modules. It covers what the per-queue hot paths touch: wildcards with
nested ``@{uuid}`` refs (plain and tag-filtered), inline ``{a|b}`` choices,
weights, null options, a fallback option, an ``accepts`` tag axis, option
negatives, constraints (matrix + exceptions, reach ``all`` / ``next`` /
``first``, nested-ref targets), derivations (if/else, replace/append),
combines with negatives, fixed values with negatives, a locked seed and an
internal module.

``scale="test"`` is small enough for every pytest run; ``scale="bench"`` is
the heavy pipeline the performance numbers were measured on.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

TAGS = [f"t{i}" for i in range(16)]
SHOES = ["sandals", "heels", "boots", "sneakers"]
WORDS = (
    "red blue soft bold silk cotton bright dark misty sunny gentle wild "
    "ornate plain tall short velvet leather neon pastel"
).split()

SCALES: dict[str, dict[str, Any]] = {
    # ~2 s for the whole golden test on a laptop.
    "test": {"n_top": 10, "n_leaf": 5, "big": [120, 90, 60], "small": (20, 60), "leaf": (20, 60),
             "exceptions": 8},
    # The pipeline the research numbers came from (~4.4k top options).
    "bench": {"n_top": 24, "n_leaf": 10, "big": [500, 400, 300], "small": (50, 250),
              "leaf": (50, 200), "exceptions": 20},
}


@dataclass
class Synthetic:
    modules: list[dict[str, Any]]
    #: Every wildcard the modules reach: uuid -> (name, payload). The leaf
    #: wildcards are reached only through ``@{uuid}`` refs.
    wildcards: dict[str, tuple[str, dict[str, Any]]] = field(default_factory=dict)
    leaf_ids: list[str] = field(default_factory=list)

    def template(self) -> str:
        names = [m["payload"]["var_binding"] for m in self.modules if m["type"] == "wildcard"]
        return (
            "masterpiece, " + ", ".join(f"${n}" for n in names)
            + ", $cb0, $cb1, $d0_0, $fv1, $fv2, {sunny|rainy} day, $w0.SHOES"
        )

    def catalog(self) -> dict[str, dict[str, Any]]:
        """A fully embedded catalog (what the engine sees after the live-DB walk)."""
        return {
            wid: {
                "snapshot_version": 1, "uuid": wid, "type": "wildcard", "name": name,
                "payload": payload, "payload_hash": "", "source": {"kind": "user"},
            }
            for wid, (name, payload) in self.wildcards.items()
        }

    def write_db(self, path: Path) -> None:
        """Create a library DB at ``path`` holding every wildcard."""
        from engine.db.connection import get_connection
        from engine.db.migrations import migrate
        from engine.db.repositories import ModuleRepository

        conn = get_connection(path)
        try:
            migrate(conn)
            repo = ModuleRepository(conn)
            for wid, (name, payload) in self.wildcards.items():
                repo.create(type="wildcard", name=name, description="", category_id=None,
                            tags=[], payload=payload, id=wid)
        finally:
            conn.close()


def build(scale: str = "test") -> Synthetic:
    cfg = SCALES[scale]
    r = random.Random(1234)

    def hid(prefix: int, i: int) -> str:
        return f"{prefix + i:08x}"

    def phrase(n: int = 4) -> str:
        return " ".join(r.choice(WORDS) for _ in range(n))

    def wildcard_payload(binding: str, n_opts: int, leaf_ids: list[str], ref_rate: float,
                         axes: bool = False) -> dict[str, Any]:
        opts = []
        for j in range(n_opts):
            val = f"{phrase(r.randint(2, 6))} {binding}{j}"
            if leaf_ids and r.random() < ref_rate:
                lid = r.choice(leaf_ids)
                if r.random() < 0.3:
                    val += f" with @{{{lid}:{r.choice(TAGS)}}}"
                else:
                    val += f" with @{{{lid}}}"
                if r.random() < 0.3:
                    val += f" and @{{{r.choice(leaf_ids)}}}"
            if r.random() < 0.15:
                val += " {small|medium|large}"
            o: dict[str, Any] = {
                "id": f"{r.getrandbits(32):08x}", "value": val,
                "weight": r.choice([1, 1, 1, 2, 0.5]),
                "sub_categories": r.sample(TAGS, r.randint(0, 2)),
            }
            if axes and r.random() < 0.5:
                o["sub_categories"] += r.sample(SHOES, 2)
            if r.random() < 0.1:
                o["negative"] = phrase(2)
            opts.append(o)
        opts.append({"id": f"{r.getrandbits(32):08x}", "value": "", "weight": 1,
                     "sub_categories": [], "is_null": True})
        opts[0]["fallback"] = True
        p: dict[str, Any] = {"var_binding": binding, "sub_categories": list(TAGS), "options": opts}
        if axes:
            p["sub_categories"] = TAGS + SHOES
            p["tag_groups"] = {"SHOES": list(SHOES)}
            p["tag_group_kinds"] = {"SHOES": "accepts"}
        return p

    n_top, n_leaf = cfg["n_top"], cfg["n_leaf"]
    leaf: dict[str, tuple[str, dict[str, Any]]] = {}
    top: dict[str, tuple[str, dict[str, Any]]] = {}
    leaf_ids = [hid(0xA0000000, i) for i in range(n_leaf)]
    for i, lid in enumerate(leaf_ids):
        leaf[lid] = (f"leaf{i}", wildcard_payload(f"leaf{i}", r.randint(*cfg["leaf"]), [], 0))
    top_ids = [hid(0xB0000000, i) for i in range(n_top)]
    sizes = list(cfg["big"]) + [r.randint(*cfg["small"]) for _ in range(n_top - len(cfg["big"]))]
    for i, wid in enumerate(top_ids):
        top[wid] = (f"w{i}", wildcard_payload(f"w{i}", sizes[i], leaf_ids, 0.35, axes=(i % 4 == 0)))

    def mod(mid: str, typ: str, name: str, payload: dict[str, Any],
            instance: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"id": mid, "_uid": f"{r.getrandbits(32):08x}", "type": typ, "enabled": True,
                "name": name, "meta": {"name": name}, "payload": payload,
                "instance": instance or {}}

    mods: list[dict[str, Any]] = [mod(hid(0xC0000000, 0), "fixed_values", "style", {"values": [
        {"id": f"val{k:05d}", "name": f"fv{k}", "value": phrase(3),
         **({"negative": phrase(2)} if k % 3 == 0 else {})} for k in range(10)]})]

    constraints = []
    for k in range(8):
        s, t = sorted(r.sample(range(n_top), 2))
        constraints.append((s, t, k))
    leaf_cons = [(0, leaf_ids[0], 8), (1, leaf_ids[1], 9)]
    sel = [{"mode": "all"}, {"mode": "next", "count": 2}, {"mode": "first"}, {"mode": "all"}]

    def cons_payload(src_id: str, tgt_id: str, src_p: dict[str, Any], tgt_p: dict[str, Any],
                     k: int) -> dict[str, Any]:
        matrix: dict[str, Any] = {}
        for a in r.sample(TAGS, 5):
            matrix[a] = {b: r.choice([{"mode": "exclude", "factor": 0},
                                      {"mode": "boost", "factor": 3},
                                      {"mode": "reduce", "factor": 0.5}])
                         for b in r.sample(TAGS, 5)}
        excs = [{"source_value": r.choice(src_p["options"])["value"],
                 "target_value": r.choice(tgt_p["options"])["value"],
                 "mode": "exclude", "factor": 0} for _ in range(cfg["exceptions"])]
        return {"source_wildcard_id": src_id, "target_wildcard_id": tgt_id, "matrix": matrix,
                "exceptions": excs, "target_select": sel[k % 4]}

    for i, wid in enumerate(top_ids):
        for (s, t, k) in constraints:
            if t == i:
                mods.append(mod(hid(0xD0000000, k), "constraint", f"c{k}",
                                cons_payload(top_ids[s], wid, top[top_ids[s]][1], top[wid][1], k)))
        for (s, lid, k) in leaf_cons:
            if s == i - 1 and i > 0:
                mods.append(mod(hid(0xD0000000, k), "constraint", f"c{k}",
                                cons_payload(top_ids[s], lid, top[top_ids[s]][1], leaf[lid][1], k)))
        instance: dict[str, Any] = {}
        if i == 2:
            instance["locked_seed"] = 4242
        if i == 5:
            instance["internal"] = True
        mods.append(mod(wid, "wildcard", top[wid][0], top[wid][1], instance))
        if i % 4 == 3:
            d = i // 4
            rules = []
            for rr in range(3):
                br = [{"condition": {"var": f"w{r.randint(0, i)}",
                                     "op": r.choice(["contains", "equals", "matches"]),
                                     "value": r.choice(WORDS)},
                       "action": {"target_var": f"d{d}_{rr}",
                                  "mode": r.choice(["replace", "append"]),
                                  "value": f"$w{r.randint(0, i)} {{x|y|z}}"}} for _ in range(3)]
                rules.append({"id": f"rule{d}{rr:03d}", "branches": br,
                              "else": {"action": {"target_var": f"d{d}_{rr}", "mode": "replace",
                                                  "value": phrase(2)}}})
            mods.append(mod(hid(0xE0000000, d), "derivation", f"d{d}", {"rules": rules}))
    for c in range(4):
        vars_ = r.sample([f"w{i}" for i in range(n_top)], 6)
        tpl = ", ".join(f"${v}" for v in vars_) + " {a|b}"
        mods.append(mod(hid(0xF0000000, c), "combine", f"cb{c}",
                        {"template": tpl, "output_var": f"cb{c}", "input_vars": vars_,
                         "negative": "blurry"}))
    return Synthetic(modules=mods, wildcards={**leaf, **top}, leaf_ids=leaf_ids)


def with_holds(modules: list[dict[str, Any]], names: tuple[str, ...]) -> list[dict[str, Any]]:
    """A copy of ``modules`` with ``seed_scope: hold`` on the named wildcards."""
    import copy

    out = copy.deepcopy(modules)
    for m in out:
        if m["type"] == "wildcard" and m["name"] in names:
            m["instance"]["seed_scope"] = "hold"
    return out
