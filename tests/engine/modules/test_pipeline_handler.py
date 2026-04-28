"""Tests for PipelineHandler — composes other modules in order."""
import pytest

from engine.modules.pipeline_handler import PipelineHandler


class _FakeRepo:
    """In-memory stand-in for ModuleRepository.get."""

    def __init__(self, rows):
        self._rows = rows

    def get(self, module_id):
        if module_id not in self._rows:
            raise KeyError(module_id)
        return self._rows[module_id]


def test_handler_type_id_is_pipeline():
    assert PipelineHandler.type_id == "pipeline"


def test_validate_payload_accepts_well_formed():
    PipelineHandler.validate_payload({
        "steps": [
            {"id": "s1", "module_id": "m1", "enabled": True, "instance": {}},
            {"id": "s2", "module_id": "m2", "enabled": False, "instance": {}},
        ],
    })


def test_validate_payload_rejects_non_list_steps():
    with pytest.raises(ValueError, match="steps"):
        PipelineHandler.validate_payload({"steps": {}})


def test_validate_payload_rejects_step_missing_module_id():
    with pytest.raises(ValueError, match="module_id"):
        PipelineHandler.validate_payload({"steps": [
            {"id": "s1", "enabled": True, "instance": {}},
        ]})


def test_validate_payload_rejects_step_blank_id():
    with pytest.raises(ValueError, match=r"steps\[0\].id"):
        PipelineHandler.validate_payload({"steps": [
            {"id": "", "module_id": "m1"},
        ]})


def test_validate_payload_rejects_non_bool_enabled():
    with pytest.raises(ValueError, match="enabled"):
        PipelineHandler.validate_payload({"steps": [
            {"id": "s1", "module_id": "m1", "enabled": "yes"},
        ]})


def test_resolve_without_repo_raises_runtime_error():
    with pytest.raises(RuntimeError, match="_repo"):
        PipelineHandler.resolve(
            {"steps": [{"id": "s1", "module_id": "m1"}]},
            instance={},
            ctx={},
        )


def test_resolve_runs_enabled_steps_in_order():
    repo = _FakeRepo({
        "m1": {
            "type": "fixed_values",
            "payload": {"values": [{"id": "v", "name": "$a", "value": "1"}]},
        },
        "m2": {
            "type": "fixed_values",
            "payload": {"values": [{"id": "v", "name": "$b", "value": "2"}]},
        },
    })
    ctx = {"_repo": repo}
    out = PipelineHandler.resolve(
        {"steps": [
            {"id": "s1", "module_id": "m1", "enabled": True, "instance": {}},
            {"id": "s2", "module_id": "m2", "enabled": True, "instance": {}},
        ]},
        instance={},
        ctx=ctx,
    )
    assert out == {"$a": "1", "$b": "2"}


def test_resolve_skips_disabled_steps():
    repo = _FakeRepo({
        "m1": {
            "type": "fixed_values",
            "payload": {"values": [{"id": "v", "name": "$a", "value": "1"}]},
        },
        "m2": {
            "type": "fixed_values",
            "payload": {"values": [{"id": "v", "name": "$b", "value": "2"}]},
        },
    })
    ctx = {"_repo": repo}
    out = PipelineHandler.resolve(
        {"steps": [
            {"id": "s1", "module_id": "m1", "enabled": False, "instance": {}},
            {"id": "s2", "module_id": "m2", "enabled": True, "instance": {}},
        ]},
        instance={},
        ctx=ctx,
    )
    assert out == {"$b": "2"}


def test_resolve_default_enabled_true():
    """Steps without an explicit ``enabled`` key default to True."""
    repo = _FakeRepo({
        "m1": {
            "type": "fixed_values",
            "payload": {"values": [{"id": "v", "name": "$x", "value": "ok"}]},
        },
    })
    ctx = {"_repo": repo}
    out = PipelineHandler.resolve(
        {"steps": [{"id": "s1", "module_id": "m1", "instance": {}}]},
        instance={},
        ctx=ctx,
    )
    assert out == {"$x": "ok"}


def test_resolve_via_dispatcher_after_import():
    from engine.modules import resolve_module
    repo = _FakeRepo({
        "m1": {
            "type": "fixed_values",
            "payload": {"values": [{"id": "v", "name": "$only", "value": "yes"}]},
        },
    })
    snap = {
        "type": "pipeline",
        "payload": {"steps": [{"id": "s1", "module_id": "m1", "enabled": True}]},
        "instance": {},
    }
    out = resolve_module(snap, ctx={"_repo": repo})
    assert out == {"$only": "yes"}
