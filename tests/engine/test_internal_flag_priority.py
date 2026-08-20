"""`instance.internal` is last-write-wins, exactly like the value.

A var written first by an internal module and then overridden by a PUBLIC
module must end up public — the assembler renders it. The flag map used to be
add-only: once any writer marked a var internal it stayed hidden forever, even
when its final value came from a public module. Reported from the canvas:
"mark first $outfit internal, mark the second $outfit not internal, and the
assembler still can't see it."
"""
from engine.context import strip_internals
from engine.pipeline import PipelineEngine


def _fixed(binding: str, value: str, *, internal: bool) -> dict:
    return {
        "type": "fixed_values",
        "id": binding.ljust(8, "0")[:8],
        "payload": {"values": [{"id": "v1", "name": binding, "value": value}]},
        "instance": {"internal": internal},
    }


def test_public_override_of_internal_var_is_visible():
    ctx = PipelineEngine().run([
        _fixed("outfit", "hidden one", internal=True),
        _fixed("outfit", "public one", internal=False),
    ])
    assert ctx["outfit"] == "public one"
    assert ctx["__wp_internal_flags__"].get("outfit") in (None, False)
    # The render boundary must now KEEP it.
    assert strip_internals(ctx).get("outfit") == "public one"


def test_internal_override_of_public_var_hides_it():
    # The mirror: last writer internal -> hidden, even if an earlier writer
    # was public.
    ctx = PipelineEngine().run([
        _fixed("outfit", "public one", internal=False),
        _fixed("outfit", "hidden one", internal=True),
    ])
    assert ctx["__wp_internal_flags__"].get("outfit") is True
    assert "outfit" not in strip_internals(ctx)


def test_a_lone_internal_var_still_hides():
    ctx = PipelineEngine().run([_fixed("scratch", "x", internal=True)])
    assert "scratch" not in strip_internals(ctx)
