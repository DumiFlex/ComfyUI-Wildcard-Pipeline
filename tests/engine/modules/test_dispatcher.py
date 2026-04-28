"""Tests for the module-handler dispatcher."""
import pytest

from engine.modules.dispatcher import (
    ModuleHandler,
    UnknownModuleType,
    register_handler,
    resolve_module,
)


class _FakeHandler(ModuleHandler):
    type_id = "fake"

    @classmethod
    def resolve(cls, payload, instance, ctx):
        return {"result": payload.get("v", "")}


@pytest.fixture(autouse=True)
def _reset_registry():
    """Snapshot + restore the handler registry around each test."""
    from engine.modules import dispatcher as d
    saved = dict(d._HANDLERS)
    yield
    d._HANDLERS.clear()
    d._HANDLERS.update(saved)


def test_register_and_resolve_round_trip():
    register_handler(_FakeHandler)
    snap = {"type": "fake", "payload": {"v": "x"}, "instance": {}}
    assert resolve_module(snap, ctx=None) == {"result": "x"}


def test_resolve_unknown_type_raises():
    snap = {"type": "ghost", "payload": {}, "instance": {}}
    with pytest.raises(UnknownModuleType):
        resolve_module(snap, ctx=None)


def test_resolve_passes_instance_to_handler():
    captured = {}

    class _Capture(ModuleHandler):
        type_id = "capture"

        @classmethod
        def resolve(cls, payload, instance, ctx):
            captured["payload"] = payload
            captured["instance"] = instance
            captured["ctx"] = ctx
            return {}

    register_handler(_Capture)
    resolve_module(
        {
            "type": "capture",
            "payload": {"a": 1},
            "instance": {"variable_binding": "$x"},
        },
        ctx="some-ctx",
    )
    assert captured == {
        "payload": {"a": 1},
        "instance": {"variable_binding": "$x"},
        "ctx": "some-ctx",
    }


def test_resolve_tolerates_missing_instance_key():
    """Legacy or partial snapshots may lack the `instance` key."""
    register_handler(_FakeHandler)
    snap = {"type": "fake", "payload": {"v": "y"}}
    assert resolve_module(snap, ctx=None) == {"result": "y"}


def test_resolve_tolerates_missing_payload_key():
    register_handler(_FakeHandler)
    snap = {"type": "fake", "instance": {}}
    assert resolve_module(snap, ctx=None) == {"result": ""}


def test_register_handler_rejects_empty_type_id():
    class _NoId(ModuleHandler):
        type_id = ""

        @classmethod
        def resolve(cls, payload, instance, ctx):
            return {}

    with pytest.raises(ValueError, match="type_id"):
        register_handler(_NoId)


def test_register_handler_overwrites_existing_for_same_type_id():
    """Re-registration replaces the previous handler — useful for tests."""
    class _A(ModuleHandler):
        type_id = "swap"

        @classmethod
        def resolve(cls, payload, instance, ctx):
            return {"who": "A"}

    class _B(ModuleHandler):
        type_id = "swap"

        @classmethod
        def resolve(cls, payload, instance, ctx):
            return {"who": "B"}

    register_handler(_A)
    register_handler(_B)
    out = resolve_module({"type": "swap", "payload": {}, "instance": {}}, ctx=None)
    assert out == {"who": "B"}


def test_unknown_module_type_inherits_keyerror():
    """UnknownModuleType must be a KeyError subclass for caller convenience."""
    assert issubclass(UnknownModuleType, KeyError)


def test_resolve_missing_type_key_raises():
    """Snapshots without a `type` key are malformed; raise UnknownModuleType."""
    with pytest.raises(UnknownModuleType):
        resolve_module({"payload": {}, "instance": {}}, ctx=None)


def test_resolve_non_string_type_raises():
    """Snapshots with a non-string type value are malformed."""
    with pytest.raises(UnknownModuleType):
        resolve_module({"type": 42, "payload": {}, "instance": {}}, ctx=None)
