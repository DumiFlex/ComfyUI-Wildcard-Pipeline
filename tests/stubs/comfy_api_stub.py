"""Minimal stub of the subset of ``comfy_api.latest`` the project uses.

Exposes:
- ``ComfyExtension`` — base class with ``async get_node_list()``.
- ``io.ComfyNode`` — base class for V3 nodes.
- ``io.Schema`` — dataclass capturing node_id, display_name, category,
  inputs, outputs, and boolean flags like ``not_idempotent``,
  ``is_output_node``.
- ``io.Int``, ``io.String`` — built-in widget types.
- ``io.Custom(name)`` — factory for custom socket/widget types.
- ``io.NodeOutput`` — container for execute() return values.
- ``io._io.comfytype`` / ``ComfyTypeIO`` — decorator + base for strongly
  typed custom types.

The stub aims for **structural** parity: attribute access + .Input()/.Output()
factory calls succeed, and io.NodeOutput carries the positional values plus
an optional ``ui`` dict. Actual runtime semantics (caching, widget rendering,
socket wiring) are not simulated — those are verified via manual QA in ComfyUI.
"""

from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------- Schema ---


@dataclass
class Schema:
    node_id: str
    display_name: str = ""
    category: str = ""
    description: str = ""
    inputs: list[Any] = field(default_factory=list)
    outputs: list[Any] = field(default_factory=list)
    hidden: list[Any] = field(default_factory=list)
    is_output_node: bool = False
    not_idempotent: bool = False
    is_experimental: bool = False
    is_deprecated: bool = False


# ------------------------------------------------------------ NodeOutput ---


class NodeOutput:
    """Structural stub — matches real ``io.NodeOutput`` surface."""

    def __init__(self, *values: Any, ui: dict[str, Any] | None = None):
        self.values = values
        self.ui = ui


# ------------------------------------------------------------- ComfyNode ---


class ComfyNode:
    """V3 node base class. Real ComfyUI instantiates these via classmethods."""

    @classmethod
    def define_schema(cls) -> Schema:  # pragma: no cover - overridden
        raise NotImplementedError

    @classmethod
    def execute(cls, *args: Any, **kwargs: Any) -> NodeOutput:  # pragma: no cover
        raise NotImplementedError


# ----------------------------------------- Input/Output descriptor helpers ---


@dataclass
class _Slot:
    """A single input or output slot descriptor captured by tests."""

    kind: str  # "input" or "output"
    type_name: str
    name: str = ""
    default: Any = None
    optional: bool = False
    multiline: bool = False
    socketless: bool = False
    min: Any = None
    max: Any = None
    control_after_generate: bool = False


class _IOType:
    """Factory for a concrete io type (Int, String, custom)."""

    def __init__(self, type_name: str):
        self._type_name = type_name

    def Input(self, name: str = "", **kwargs: Any) -> _Slot:
        return _Slot(kind="input", type_name=self._type_name, name=name, **kwargs)

    def Output(self, name: str = "") -> _Slot:
        return _Slot(kind="output", type_name=self._type_name, name=name)


Int = _IOType("INT")
String = _IOType("STRING")


def Custom(type_name: str) -> _IOType:
    """Create an io type with the given custom type name."""
    return _IOType(type_name)


# ------------------------------------------------- @comfytype / ComfyTypeIO ---


class ComfyTypeIO:
    """Base for typed custom types — set ``Type = ...`` in subclass."""

    Type: Any = None

    @classmethod
    def Input(cls, name: str = "", **kwargs: Any) -> _Slot:
        return _Slot(
            kind="input",
            type_name=getattr(cls, "_io_type", "CUSTOM"),
            name=name,
            **kwargs,
        )

    @classmethod
    def Output(cls, name: str = "") -> _Slot:
        return _Slot(
            kind="output",
            type_name=getattr(cls, "_io_type", "CUSTOM"),
            name=name,
        )


def comfytype(io_type: str):
    """Decorator that tags a class (and any nested Input/Output) with an io type."""

    def _wrap(cls):
        cls._io_type = io_type
        # Propagate io_type to nested Input/Output subclasses so ``WidgetInput``
        # subclass instances expose ``.type_name`` correctly without manual wiring.
        # Only propagate when ``Input``/``Output`` is an actual class — the
        # ``ComfyTypeIO`` base exposes them as classmethods which can't take
        # arbitrary attributes.
        nested_input = getattr(cls, "Input", None)
        if isinstance(nested_input, type):
            nested_input._io_type = io_type
        nested_output = getattr(cls, "Output", None)
        if isinstance(nested_output, type):
            nested_output._io_type = io_type
        return cls

    return _wrap


# ------------------------------------------------------------------ io ns ---


class WidgetInput:
    """Stub matching ``comfy_api.latest.WidgetInput`` surface.

    Custom widget types in ``nodes/types.py`` subclass this so they can accept
    ``socketless`` at declaration time — a kwarg the base ``Input`` does not
    support.
    """

    # Subclass should set this (by convention, via @comfytype descending through
    # the ``Parent.io_type`` chain in the real API). In our stub, tests check
    # ``type_name`` directly, so subclasses of WidgetInput should set
    # ``type_name`` on ``self`` in their ``__init__`` after calling super, OR
    # the @comfytype decorator propagates an ``_io_type`` class attribute.
    _io_type: str = "WIDGET_INPUT"

    def __init__(
        self,
        id: str,
        display_name: str | None = None,
        optional: bool = False,
        tooltip: str | None = None,
        lazy: bool | None = None,
        default: Any = None,
        socketless: bool | None = None,
        widget_type: str | None = None,
        force_input: bool | None = None,
        extra_dict: dict[str, Any] | None = None,
        raw_link: bool | None = None,
        advanced: bool | None = None,
    ):
        self.id = id
        self.name = id  # back-compat for tests
        self.type_name = self._io_type
        self.display_name = display_name
        self.optional = optional
        self.tooltip = tooltip
        self.lazy = lazy
        self.default = default
        self.socketless = socketless
        self.widget_type = widget_type
        self.force_input = force_input
        self.extra_dict = extra_dict
        self.raw_link = raw_link
        self.advanced = advanced


class _IONamespace:
    """Mirrors ``comfy_api.latest.io``. Attribute access for types."""

    ComfyNode = ComfyNode
    Schema = Schema
    NodeOutput = NodeOutput
    Int = Int
    String = String
    Custom = staticmethod(Custom)
    WidgetInput = WidgetInput
    _io: "_IOInternal"


# Sub-namespace: io._io exposes @comfytype + ComfyTypeIO (real module path).
class _IOInternal:
    comfytype = staticmethod(comfytype)
    ComfyTypeIO = ComfyTypeIO


io = _IONamespace()
io._io = _IOInternal()


# ----------------------------------------------------------- ComfyExtension ---


class ComfyExtension:
    """Real base class exposes async ``get_node_list``. Stub mirrors shape."""

    async def get_node_list(self) -> list[type[ComfyNode]]:  # pragma: no cover
        return []
