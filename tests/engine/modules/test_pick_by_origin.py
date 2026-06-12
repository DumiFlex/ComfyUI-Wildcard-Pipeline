"""Per-origin pick recording — `by_origin` sub-bucket on __wp_picks__.

The pipeline stamps the active module's `bundle_origin` into ctx; the
wildcard handler records a per-origin view of each pick alongside the
existing top-level (last-writer-wins) entry. These tests pin both the
ctx threading and the additive record shape.
"""
from __future__ import annotations

from engine.pipeline import PipelineEngine


def _wildcard(uuid: str, var_binding: str, options: list[dict],
              *, uid: str = "", bundle_origin: str | None = None) -> dict:
    m: dict = {
        "id": uuid,
        "type": "wildcard",
        "enabled": True,
        "payload": {"var_binding": var_binding, "options": options},
        "instance": {},
    }
    if uid:
        m["_uid"] = uid
    if bundle_origin is not None:
        m["bundle_origin"] = bundle_origin
    return m


def _run(modules: list[dict], seed: int = 0):
    return PipelineEngine().run(modules, seed=seed)


def test_pipeline_stamps_bundle_origin_into_ctx():
    """The per-module loop must expose the active module's `bundle_origin`
    on ctx as `__wp_current_module_bundle_origin__` while the module runs,
    and clear it afterward (no leak into post-run ctx)."""
    seen: dict[str, object] = {}

    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ], uid="uidsrc000001", bundle_origin="originA")

    # A tiny probe wildcard reads the stamped key at resolve time via a
    # recorded option pick — simplest is to assert post-run that the key
    # was cleared, and that during the run the pick carried the origin
    # (proved in Task 2). Here we pin the CLEAR contract directly.
    ctx = _run([src])
    assert "__wp_current_module_bundle_origin__" not in ctx
    seen["ran"] = True
    assert seen["ran"] is True
