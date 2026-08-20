"""The assembler must resolve `$var.AXIS` when the axis table arrives via the
SOCKET — i.e. on `ContextPayload.internals`, not pre-merged into the ctx.

`tests/engine/test_assembler_accessor.py` covers the resolver helper with
`__wp_axes__` already present in the ctx; it never exercised the NODE. The node
reads a socket payload where `build_payload` files the table under `internals`
(the `__`-prefixed key is stripped from the user-facing `context`). The node
merged only `__wp_internal_flags__` back, so `$outfit.SHOES` rendered "" across
the socket while the identical read resolved one node upstream — a green helper
test over a broken node. These tests exercise the node's socket path directly.
"""
from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.types import ContextPayload


def _payload() -> ContextPayload:
    # Exactly the shape build_payload emits: axes stripped from `context`,
    # carried on `internals`.
    return ContextPayload(
        context={"outfit": "a white t-shirt and denim skirt"},
        internals={
            "__wp_axes__": {"outfit": {"SHOES": "sandals"}},
            "__wp_picks__": {},
        },
    )


def test_axis_read_resolves_from_socket_internals():
    out = WPPromptAssembler.execute(_payload(), "wearing $outfit.SHOES")
    assert out.values[0] == "wearing sandals"


def test_plain_var_still_resolves():
    out = WPPromptAssembler.execute(_payload(), "wearing $outfit")
    assert out.values[0] == "wearing a white t-shirt and denim skirt"


def test_internal_flagged_var_still_hidden_after_merge():
    # The flag map also rides on internals; merging the WHOLE carve-out must not
    # regress the hide-from-prompt filter.
    p = ContextPayload(
        context={"outfit": "tee", "secret": "hidden"},
        internals={
            "__wp_internal_flags__": {"secret": True},
            "__wp_axes__": {},
        },
    )
    out = WPPromptAssembler.execute(p, "$outfit $secret")
    assert out.values[0].strip() == "tee"
