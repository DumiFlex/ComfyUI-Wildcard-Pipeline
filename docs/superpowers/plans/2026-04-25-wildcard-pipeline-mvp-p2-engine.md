# P2 — Pure Python Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `engine/` package — the pure-Python brain that runs an ordered list of modules against a context dict and returns the updated context plus a per-module execution trace. No ComfyUI imports. No external runtime deps. Stdlib only. TDD throughout.

**Architecture:** Five small modules under `engine/`, each with one responsibility: `template.py` (`$var` substitution), `context.py` (context shape + internals stripping), `modules.py` (dataclass definitions + JSON round-trip), `handlers.py` (per-module-type execution — just `fixed_values` in MVP), `pipeline.py` (dispatcher, tracing, loop). Engine is callable as `PipelineEngine().run(modules, ctx, seed)`.

**Tech Stack:** Python ≥ 3.10. Stdlib only (`dataclasses`, `typing`, `logging`, `random`, `re`, `hashlib`, `importlib.util`). Tests run under pytest via the conftest sys.path shim already established in P1.

**Project root (absolute):** `E:\ComfyUIDev\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-WildcardPipeline`

Throughout this plan, `$PROJECT_ROOT` refers to the absolute path above. Commands are run from that directory unless stated otherwise. The repo is on branch `main` with 20 prior commits (P1 complete).

---

## Task 1: `engine/template.py` — `$var` substitution with `$$` escape

**Files:**
- Create: `$PROJECT_ROOT/engine/__init__.py`
- Create: `$PROJECT_ROOT/engine/template.py`
- Create: `$PROJECT_ROOT/tests/test_template.py`

### Task goal
Implement `resolve_variables(template: str, ctx: dict[str, Any]) -> str` with three rules:
1. `$var` → `str(ctx[var])` when `var` is a key in `ctx`.
2. `$var` with `var` absent from `ctx` → literal `$var` (left as-is).
3. `$$` → literal `$` (escape).
4. Keys beginning with `__` (engine internals) are never substituted — `$__seed` stays as `$__seed` regardless of whether `__seed` is in `ctx`.

- [ ] **Step 1: Write `tests/test_template.py` with failing tests**

```python
"""Unit tests for engine.template."""

from __future__ import annotations

import pytest

from engine.template import resolve_variables


class TestResolveVariables:
    def test_basic_substitution(self):
        assert resolve_variables("$name", {"name": "Alice"}) == "Alice"

    def test_missing_var_left_as_is(self):
        assert resolve_variables("$unknown", {}) == "$unknown"

    def test_dollar_escape(self):
        assert resolve_variables("$$name", {"name": "Alice"}) == "$name"

    def test_dollar_escape_twice(self):
        assert resolve_variables("$$$$", {}) == "$$"

    def test_internal_key_never_substituted(self):
        assert resolve_variables(
            "$__seed", {"__seed": 42}
        ) == "$__seed"

    def test_mixed(self):
        ctx = {"name": "Alice", "count": 3}
        assert resolve_variables(
            "Hi $name — you have $$ $count items",
            ctx,
        ) == "Hi Alice — you have $ 3 items"

    def test_non_string_value_casts_to_str(self):
        assert resolve_variables("$n", {"n": 42}) == "42"
        assert resolve_variables("$b", {"b": True}) == "True"

    def test_word_boundary_stops_at_non_identifier(self):
        # $name. should substitute $name then keep the dot
        assert resolve_variables("$name.", {"name": "A"}) == "A."

    def test_adjacent_identifier_chars_extend_name(self):
        # $name1 looks up "name1", not "name"
        assert resolve_variables(
            "$name1", {"name": "A", "name1": "B"}
        ) == "B"

    def test_empty_template(self):
        assert resolve_variables("", {"a": "x"}) == ""

    def test_no_dollar_no_change(self):
        assert resolve_variables("plain text", {"x": "y"}) == "plain text"

    @pytest.mark.parametrize(
        ("template", "expected"),
        [
            ("$$", "$"),
            ("$$$name", "$Alice"),  # $$ is $, then $name resolves
            ("$name$$", "Alice$"),
        ],
    )
    def test_escape_combinations(self, template, expected):
        assert resolve_variables(template, {"name": "Alice"}) == expected
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_template.py -v
```

Expected: `ModuleNotFoundError: No module named 'engine'` or `engine.template` — any import failure is fine; we haven't written the module yet.

- [ ] **Step 3: Write `engine/__init__.py`**

```python
"""Pure Python pipeline engine — zero ComfyUI imports, stdlib only."""
```

- [ ] **Step 4: Write `engine/template.py`**

```python
"""Template variable substitution: $var, $$ escape, __internal skip."""

from __future__ import annotations

import re
from typing import Any

_VAR_RE = re.compile(r"\$(\w+)")
_SENTINEL = "\x00DOLLAR\x00"


def resolve_variables(template: str, ctx: dict[str, Any]) -> str:
    """Replace ``$var`` with ``str(ctx[var])``. ``$$`` escapes a literal ``$``.

    Keys beginning with ``__`` are engine internals and are never substituted.
    Missing vars are left unchanged.
    """
    result = template.replace("$$", _SENTINEL)

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name.startswith("__"):
            return match.group(0)
        if name in ctx:
            return str(ctx[name])
        return match.group(0)

    result = _VAR_RE.sub(_replace, result)
    return result.replace(_SENTINEL, "$")
```

- [ ] **Step 5: Run tests — confirm all pass**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_template.py -v
```

Expected: all tests pass. If any fails, fix the implementation (not the test) and re-run.

- [ ] **Step 6: Run ruff + full pytest suite**

```bash
cd "$PROJECT_ROOT"
ruff check engine tests
pytest
```

Expected: ruff clean, full suite (old sanity test + new template tests) green.

- [ ] **Step 7: Commit**

```bash
cd "$PROJECT_ROOT"
git add engine/__init__.py engine/template.py tests/test_template.py
git commit -m "feat(engine): add template.resolve_variables with \$var and \$\$ escape"
```

Conventional-commit `feat` triggers a minor bump on next release. That's intentional — this is the first functional feature.

---

## Task 2: `engine/context.py` — internals stripping helper

**Files:**
- Create: `$PROJECT_ROOT/engine/context.py`
- Create: `$PROJECT_ROOT/tests/test_context.py`

### Task goal
Define the `Context` type alias and internals-handling helpers. MVP exposes `strip_internals(ctx) -> dict[str, Any]` — returns a new dict with all `__`-prefixed keys removed. Nodes use this at the socket boundary (so downstream nodes never see engine internals).

- [ ] **Step 1: Write `tests/test_context.py`**

```python
"""Unit tests for engine.context."""

from __future__ import annotations

from engine.context import strip_internals


class TestStripInternals:
    def test_empty(self):
        assert strip_internals({}) == {}

    def test_only_user_keys(self):
        ctx = {"name": "A", "count": 3}
        assert strip_internals(ctx) == ctx

    def test_only_internal_keys(self):
        ctx = {"__wp_node_seed__": 42, "__wp_trace__": []}
        assert strip_internals(ctx) == {}

    def test_mixed(self):
        ctx = {"name": "A", "__wp_node_seed__": 42, "count": 3}
        assert strip_internals(ctx) == {"name": "A", "count": 3}

    def test_returns_new_dict(self):
        ctx = {"name": "A", "__seed": 1}
        stripped = strip_internals(ctx)
        stripped["name"] = "B"
        assert ctx["name"] == "A"  # original unchanged

    def test_single_underscore_prefix_not_stripped(self):
        # Only the `__` double-underscore convention is internal.
        ctx = {"_private": 1, "__internal": 2, "normal": 3}
        assert strip_internals(ctx) == {"_private": 1, "normal": 3}
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_context.py -v
```

Expected: `ImportError: cannot import name 'strip_internals' from 'engine.context'` (or the module itself missing).

- [ ] **Step 3: Write `engine/context.py`**

```python
"""Context type definitions and internals helpers.

The engine uses a flat ``dict[str, Any]`` for context. Keys starting with ``__``
are reserved for engine internals (seed, trace, internal flags). User-defined
variables use plain identifier names.
"""

from __future__ import annotations

from typing import Any, TypedDict


class ContextInternals(TypedDict, total=False):
    """Documents the reserved internal keys. Not enforced at runtime."""

    __wp_node_seed__: int
    __wp_internal_flags__: dict[str, bool]
    __wp_trace__: list[dict[str, Any]]


Context = dict[str, Any]


def strip_internals(ctx: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``ctx`` without ``__``-prefixed internal keys."""
    return {k: v for k, v in ctx.items() if not k.startswith("__")}
```

- [ ] **Step 4: Run tests — all pass**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_context.py -v
```

- [ ] **Step 5: Ruff + full suite**

```bash
cd "$PROJECT_ROOT"
ruff check engine tests
pytest
```

- [ ] **Step 6: Commit**

```bash
cd "$PROJECT_ROOT"
git add engine/context.py tests/test_context.py
git commit -m "feat(engine): add Context type and strip_internals helper"
```

---

## Task 3: `engine/modules.py` — dataclasses + JSON round-trip

**Files:**
- Create: `$PROJECT_ROOT/engine/modules.py`
- Create: `$PROJECT_ROOT/tests/test_modules.py`

### Task goal
Define `ModuleMeta`, `FixedValueEntry`, `FixedValueModule` dataclasses and the discriminated union `Module`. Provide `module_from_dict(d)` and `module_to_dict(m)` round-trip helpers. The widget serializes module lists to JSON; node execution deserializes. Round-trip must be stable.

- [ ] **Step 1: Write `tests/test_modules.py`**

```python
"""Unit tests for engine.modules."""

from __future__ import annotations

import pytest

from engine.modules import (
    FixedValueEntry,
    FixedValueModule,
    ModuleMeta,
    module_from_dict,
    module_to_dict,
)


class TestFixedValueModuleDefaults:
    def test_minimal_instantiation(self):
        m = FixedValueModule(id="abcd1234")
        assert m.id == "abcd1234"
        assert m.type == "fixed_values"
        assert m.enabled is True
        assert m.entries == []
        assert m.meta == ModuleMeta()

    def test_with_entries(self):
        m = FixedValueModule(
            id="abcd1234",
            entries=[FixedValueEntry(variable_name="style", value="photo")],
        )
        assert m.entries[0].variable_name == "style"
        assert m.entries[0].value == "photo"


class TestModuleMeta:
    def test_defaults(self):
        meta = ModuleMeta()
        assert meta.name == ""
        assert meta.description == ""
        assert meta.category == ""
        assert meta.tags == []

    def test_custom(self):
        meta = ModuleMeta(name="style defaults", tags=["character", "style"])
        assert meta.name == "style defaults"
        assert meta.tags == ["character", "style"]


class TestModuleFromDict:
    def test_fixed_values_minimal(self):
        d = {"id": "abcd1234", "type": "fixed_values"}
        m = module_from_dict(d)
        assert isinstance(m, FixedValueModule)
        assert m.id == "abcd1234"
        assert m.enabled is True
        assert m.entries == []

    def test_fixed_values_full(self):
        d = {
            "id": "abcd1234",
            "type": "fixed_values",
            "enabled": False,
            "meta": {
                "name": "style defaults",
                "description": "portrait baseline",
                "category": "style",
                "tags": ["portrait"],
            },
            "entries": [
                {"variable_name": "style", "value": "photoreal"},
                {"variable_name": "light", "value": "soft"},
            ],
        }
        m = module_from_dict(d)
        assert isinstance(m, FixedValueModule)
        assert m.enabled is False
        assert m.meta.name == "style defaults"
        assert m.meta.tags == ["portrait"]
        assert len(m.entries) == 2
        assert m.entries[1].variable_name == "light"

    def test_unknown_type_raises(self):
        with pytest.raises(ValueError, match="Unknown module type"):
            module_from_dict({"id": "x", "type": "mystery"})

    def test_missing_type_raises(self):
        with pytest.raises(ValueError, match="missing 'type'"):
            module_from_dict({"id": "x"})

    def test_missing_id_raises(self):
        with pytest.raises(ValueError, match="missing 'id'"):
            module_from_dict({"type": "fixed_values"})


class TestModuleToDict:
    def test_minimal_round_trip(self):
        m = FixedValueModule(id="abcd1234")
        d = module_to_dict(m)
        assert d["id"] == "abcd1234"
        assert d["type"] == "fixed_values"
        assert d["enabled"] is True
        assert d["entries"] == []
        assert d["meta"] == {
            "name": "",
            "description": "",
            "category": "",
            "tags": [],
        }

    def test_full_round_trip(self):
        original = FixedValueModule(
            id="abcd1234",
            enabled=False,
            meta=ModuleMeta(name="n", tags=["t1"]),
            entries=[FixedValueEntry(variable_name="v", value="x")],
        )
        d = module_to_dict(original)
        reconstructed = module_from_dict(d)
        assert reconstructed == original
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_modules.py -v
```

- [ ] **Step 3: Write `engine/modules.py`**

```python
"""Module dataclasses and JSON round-trip helpers.

Each module type is a separate dataclass with a ``type`` literal tag. The
discriminated union ``Module`` widens as new types land (wildcard, combine,
constraint, derivation — follow-up specs).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Union


@dataclass
class ModuleMeta:
    """Shared metadata on every module. SPA library uses these for listing."""

    name: str = ""
    description: str = ""
    category: str = ""
    tags: list[str] = field(default_factory=list)


@dataclass
class FixedValueEntry:
    """One literal assignment inside a fixed_values module."""

    variable_name: str
    value: str


@dataclass
class FixedValueModule:
    """Module type: sets one or more variables to literal strings."""

    id: str
    type: Literal["fixed_values"] = "fixed_values"
    enabled: bool = True
    meta: ModuleMeta = field(default_factory=ModuleMeta)
    entries: list[FixedValueEntry] = field(default_factory=list)


Module = Union[FixedValueModule]  # widens as new types land


def module_to_dict(module: Module) -> dict[str, Any]:
    """Serialize a module dataclass to a plain dict (widget payload shape)."""
    return asdict(module)


def module_from_dict(data: dict[str, Any]) -> Module:
    """Deserialize a plain dict (widget payload shape) into a module dataclass.

    Raises ``ValueError`` for missing ``id``, missing ``type``, or unknown type.
    """
    if "type" not in data:
        raise ValueError(f"missing 'type' in module data: {data!r}")
    if "id" not in data:
        raise ValueError(f"missing 'id' in module data: {data!r}")

    type_tag = data["type"]
    if type_tag == "fixed_values":
        return _fixed_value_from_dict(data)

    raise ValueError(f"Unknown module type: {type_tag!r}")


def _fixed_value_from_dict(data: dict[str, Any]) -> FixedValueModule:
    meta_data = data.get("meta", {}) or {}
    meta = ModuleMeta(
        name=meta_data.get("name", ""),
        description=meta_data.get("description", ""),
        category=meta_data.get("category", ""),
        tags=list(meta_data.get("tags", []) or []),
    )
    entries = [
        FixedValueEntry(
            variable_name=entry.get("variable_name", ""),
            value=entry.get("value", ""),
        )
        for entry in (data.get("entries") or [])
    ]
    return FixedValueModule(
        id=data["id"],
        enabled=bool(data.get("enabled", True)),
        meta=meta,
        entries=entries,
    )
```

- [ ] **Step 4: Run tests — all pass**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_modules.py -v
```

- [ ] **Step 5: Ruff + full suite**

```bash
cd "$PROJECT_ROOT"
ruff check engine tests
pytest
```

- [ ] **Step 6: Commit**

```bash
cd "$PROJECT_ROOT"
git add engine/modules.py tests/test_modules.py
git commit -m "feat(engine): add module dataclasses and JSON round-trip helpers"
```

---

## Task 4: `engine/handlers.py` — fixed_values handler

**Files:**
- Create: `$PROJECT_ROOT/engine/handlers.py`
- Create: `$PROJECT_ROOT/tests/test_handlers.py`

### Task goal
Implement `handle_fixed_values(module, ctx, rng) -> Context`. Writes each entry into `ctx`, normalizing `$name` → `name` (strip leading `$`). `rng` is unused for this handler but kept in the signature for parity with future seed-consuming handlers. Disabled entries are not filtered here — the pipeline short-circuits disabled modules before calling handlers, so the handler always runs on enabled modules.

- [ ] **Step 1: Write `tests/test_handlers.py`**

```python
"""Unit tests for engine.handlers."""

from __future__ import annotations

import random

from engine.handlers import handle_fixed_values
from engine.modules import FixedValueEntry, FixedValueModule


class TestHandleFixedValues:
    def _rng(self):
        return random.Random(0)

    def test_single_entry(self):
        module = FixedValueModule(
            id="a",
            entries=[FixedValueEntry("style", "photoreal")],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"style": "photoreal"}

    def test_multiple_entries_preserve_order(self):
        module = FixedValueModule(
            id="a",
            entries=[
                FixedValueEntry("style", "photoreal"),
                FixedValueEntry("light", "soft"),
            ],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"style": "photoreal", "light": "soft"}

    def test_later_entry_overwrites_earlier(self):
        module = FixedValueModule(
            id="a",
            entries=[
                FixedValueEntry("style", "photoreal"),
                FixedValueEntry("style", "painted"),
            ],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"style": "painted"}

    def test_dollar_prefix_stripped(self):
        module = FixedValueModule(
            id="a",
            entries=[FixedValueEntry("$style", "photoreal")],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"style": "photoreal"}

    def test_empty_variable_name_skipped(self):
        module = FixedValueModule(
            id="a",
            entries=[
                FixedValueEntry("", "nothing"),
                FixedValueEntry("$", "also nothing"),
                FixedValueEntry("kept", "here"),
            ],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"kept": "here"}

    def test_mutates_passed_ctx(self):
        module = FixedValueModule(id="a", entries=[FixedValueEntry("x", "1")])
        ctx: dict[str, object] = {"existing": "value"}
        returned = handle_fixed_values(module, ctx, self._rng())
        assert returned is ctx
        assert ctx == {"existing": "value", "x": "1"}

    def test_overwrites_existing_key(self):
        module = FixedValueModule(id="a", entries=[FixedValueEntry("x", "new")])
        ctx = handle_fixed_values(module, {"x": "old"}, self._rng())
        assert ctx == {"x": "new"}

    def test_empty_entries_noop(self):
        module = FixedValueModule(id="a")
        ctx = handle_fixed_values(module, {"k": "v"}, self._rng())
        assert ctx == {"k": "v"}
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_handlers.py -v
```

- [ ] **Step 3: Write `engine/handlers.py`**

```python
"""Per-module-type handlers. One function per module type.

Handler signature is ``(module, ctx, rng) -> Context``. Returns the (possibly
mutated) context. ``rng`` is a ``random.Random`` supplied by the pipeline —
``fixed_values`` ignores it; seed-consuming handlers (wildcard, derivation)
use it in later specs.
"""

from __future__ import annotations

import logging
import random
from typing import Any, Callable

from .context import Context
from .modules import FixedValueModule, Module

logger = logging.getLogger(__name__)

ModuleHandler = Callable[[Any, Context, random.Random], Context]


def handle_fixed_values(
    module: FixedValueModule,
    ctx: Context,
    rng: random.Random,  # noqa: ARG001 — parity with future seed-consuming handlers
) -> Context:
    """Write each entry's value into ``ctx``. Mutates and returns ``ctx``."""
    for entry in module.entries:
        name = entry.variable_name.lstrip("$")
        if not name:
            logger.warning(
                "Skipping entry with empty variable_name in module %s", module.id
            )
            continue
        ctx[name] = entry.value
    return ctx
```

Note: `# noqa: ARG001` on the unused `rng` parameter matches ruff's `B` rule set enabled in `pyproject.toml`. If ruff flags it under a different code, adjust to match.

- [ ] **Step 4: Run tests — all pass**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_handlers.py -v
```

- [ ] **Step 5: Ruff + full suite**

```bash
cd "$PROJECT_ROOT"
ruff check engine tests
pytest
```

- [ ] **Step 6: Commit**

```bash
cd "$PROJECT_ROOT"
git add engine/handlers.py tests/test_handlers.py
git commit -m "feat(engine): add handle_fixed_values handler"
```

---

## Task 5: `engine/pipeline.py` — dispatcher, loop, and tracing

**Files:**
- Create: `$PROJECT_ROOT/engine/pipeline.py`
- Create: `$PROJECT_ROOT/tests/test_pipeline.py`

### Task goal
Implement `PipelineEngine.run(modules, ctx=None, seed=0) -> Context`:
1. If `ctx` is `None`, start with a fresh empty dict.
2. Store `seed` at `ctx["__wp_node_seed__"]`.
3. Initialize `ctx["__wp_trace__"]` to an empty list if not already present.
4. Initialize `ctx["__wp_internal_flags__"]` to an empty dict if not present (forward-compat).
5. Iterate modules in order. Skip `enabled is False`. Dispatch on `module.type` via `HANDLERS` dict. Unknown type → `logger.warning` + skip.
6. After each handler call, append a trace entry: `{"id", "type", "enabled", "writes"}` where `writes` is the list of user-var (non-`__`) keys added or changed between before/after snapshots.
7. Return the final ctx.

Trace entry `writes` shape per spec:
```python
{"variable": k, "value": after[k], "source": module.type}  # new write
{"variable": k, "value": after[k], "source": module.type, "overwrite": True}  # overwrite
```

- [ ] **Step 1: Write `tests/test_pipeline.py`**

```python
"""Unit tests for engine.pipeline."""

from __future__ import annotations

import random

from engine.modules import FixedValueEntry, FixedValueModule
from engine.pipeline import PipelineEngine


class TestPipelineRun:
    def test_empty_modules_sets_seed_and_trace(self):
        ctx = PipelineEngine().run([], seed=42)
        assert ctx["__wp_node_seed__"] == 42
        assert ctx["__wp_trace__"] == []
        assert ctx["__wp_internal_flags__"] == {}

    def test_single_fixed_values_module(self):
        module = FixedValueModule(
            id="m1",
            entries=[FixedValueEntry("style", "photoreal")],
        )
        ctx = PipelineEngine().run([module], seed=0)
        assert ctx["style"] == "photoreal"

    def test_trace_records_new_write(self):
        module = FixedValueModule(
            id="m1",
            entries=[FixedValueEntry("style", "photoreal")],
        )
        ctx = PipelineEngine().run([module], seed=0)
        trace = ctx["__wp_trace__"]
        assert len(trace) == 1
        entry = trace[0]
        assert entry["id"] == "m1"
        assert entry["type"] == "fixed_values"
        assert entry["enabled"] is True
        assert entry["writes"] == [
            {"variable": "style", "value": "photoreal", "source": "fixed_values"}
        ]

    def test_trace_records_overwrite_flag(self):
        m1 = FixedValueModule(id="m1", entries=[FixedValueEntry("style", "a")])
        m2 = FixedValueModule(id="m2", entries=[FixedValueEntry("style", "b")])
        ctx = PipelineEngine().run([m1, m2], seed=0)
        writes2 = ctx["__wp_trace__"][1]["writes"]
        assert writes2 == [
            {
                "variable": "style",
                "value": "b",
                "source": "fixed_values",
                "overwrite": True,
            }
        ]

    def test_disabled_module_skipped(self):
        m1 = FixedValueModule(
            id="m1", enabled=False, entries=[FixedValueEntry("x", "1")]
        )
        m2 = FixedValueModule(id="m2", entries=[FixedValueEntry("y", "2")])
        ctx = PipelineEngine().run([m1, m2], seed=0)
        assert "x" not in ctx
        assert ctx["y"] == "2"
        # Only the enabled module produces a trace entry.
        assert [e["id"] for e in ctx["__wp_trace__"]] == ["m2"]

    def test_inherits_upstream_ctx(self):
        upstream = {"upstream_var": "hello"}
        module = FixedValueModule(
            id="m1", entries=[FixedValueEntry("local", "world")]
        )
        ctx = PipelineEngine().run([module], ctx=upstream, seed=0)
        assert ctx["upstream_var"] == "hello"
        assert ctx["local"] == "world"

    def test_inherited_trace_is_appended(self):
        upstream = {"__wp_trace__": [{"id": "prev", "type": "fixed_values",
                                       "enabled": True, "writes": []}]}
        module = FixedValueModule(id="m1", entries=[FixedValueEntry("x", "1")])
        ctx = PipelineEngine().run([module], ctx=upstream, seed=0)
        ids = [e["id"] for e in ctx["__wp_trace__"]]
        assert ids == ["prev", "m1"]

    def test_unknown_type_is_skipped(self, caplog):
        class Weird:
            id = "weird"
            type = "does_not_exist"
            enabled = True

        ctx = PipelineEngine().run([Weird()], seed=0)  # type: ignore[list-item]
        assert ctx["__wp_trace__"] == []
        assert any(
            "Unknown module type" in rec.message for rec in caplog.records
        )

    def test_seed_deterministic_rng_passed_to_handlers(self):
        # Current fixed_values handler ignores rng, but we verify the pipeline
        # creates a seeded Random. Capture it via a stub handler.
        captured: list[random.Random] = []

        def stub_handler(module, ctx, rng):
            captured.append(rng)
            return ctx

        engine = PipelineEngine()
        engine.HANDLERS = {**engine.HANDLERS, "fixed_values": stub_handler}
        module = FixedValueModule(id="m1", entries=[])
        engine.run([module], seed=12345)
        assert len(captured) == 1
        rng = captured[0]
        # Two Random instances seeded identically produce the same sequence.
        other = random.Random(12345)
        assert rng.random() == other.random()
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_pipeline.py -v
```

- [ ] **Step 3: Write `engine/pipeline.py`**

```python
"""PipelineEngine — dispatches modules through per-type handlers, records trace."""

from __future__ import annotations

import logging
import random
from typing import Any

from .context import Context
from .handlers import ModuleHandler, handle_fixed_values
from .modules import Module

logger = logging.getLogger(__name__)


class PipelineEngine:
    """Runs an ordered list of modules against a context dict."""

    HANDLERS: dict[str, ModuleHandler] = {
        "fixed_values": handle_fixed_values,
    }

    def run(
        self,
        modules: list[Module],
        ctx: Context | None = None,
        seed: int = 0,
    ) -> Context:
        """Execute ``modules`` top-to-bottom against ``ctx``.

        Initializes internal keys (``__wp_node_seed__``, ``__wp_trace__``,
        ``__wp_internal_flags__``) if absent. Skips modules with
        ``enabled is False``. Unknown module types are logged and skipped.
        Returns the mutated context.
        """
        ctx = {} if ctx is None else ctx
        ctx["__wp_node_seed__"] = seed
        ctx.setdefault("__wp_trace__", [])
        ctx.setdefault("__wp_internal_flags__", {})

        rng = random.Random(seed)

        for index, module in enumerate(modules):
            if getattr(module, "enabled", True) is False:
                continue

            module_type = getattr(module, "type", None)
            handler = self.HANDLERS.get(module_type or "")
            if handler is None:
                logger.warning(
                    "Unknown module type %r at index %s — skipped",
                    module_type,
                    index,
                )
                continue

            before = dict(ctx)
            ctx = handler(module, ctx, rng)
            ctx["__wp_trace__"].append(self._trace_entry(module, before, ctx))

        return ctx

    @staticmethod
    def _trace_entry(
        module: Module,
        before: dict[str, Any],
        after: dict[str, Any],
    ) -> dict[str, Any]:
        """Build a trace record describing what ``module`` wrote."""
        module_type = getattr(module, "type", "")
        writes: list[dict[str, Any]] = []

        for key in after.keys() - before.keys():
            if key.startswith("__"):
                continue
            writes.append(
                {"variable": key, "value": after[key], "source": module_type}
            )

        for key in after.keys() & before.keys():
            if key.startswith("__"):
                continue
            if after[key] == before[key]:
                continue
            writes.append(
                {
                    "variable": key,
                    "value": after[key],
                    "source": module_type,
                    "overwrite": True,
                }
            )

        return {
            "id": getattr(module, "id", ""),
            "type": module_type,
            "enabled": getattr(module, "enabled", True),
            "writes": writes,
        }
```

- [ ] **Step 4: Run tests — all pass**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_pipeline.py -v
```

- [ ] **Step 5: Ruff + full suite**

```bash
cd "$PROJECT_ROOT"
ruff check engine tests
pytest
```

- [ ] **Step 6: Commit**

```bash
cd "$PROJECT_ROOT"
git add engine/pipeline.py tests/test_pipeline.py
git commit -m "feat(engine): add PipelineEngine with dispatcher and per-module tracing"
```

---

## Task 6: End-to-end engine integration test

**Files:**
- Create: `$PROJECT_ROOT/tests/test_engine_integration.py`

### Task goal
Exercise the full engine surface as a user would: deserialize a JSON-shaped module list, run through the engine, render the result with `resolve_variables`. Catches wiring regressions that unit tests miss.

- [ ] **Step 1: Write `tests/test_engine_integration.py`**

```python
"""End-to-end engine integration tests — JSON in, rendered prompt out."""

from __future__ import annotations

from engine.context import strip_internals
from engine.modules import module_from_dict
from engine.pipeline import PipelineEngine
from engine.template import resolve_variables


def test_full_pipeline_json_to_rendered_prompt():
    """Round-trip: JSON module list → engine.run → template resolve."""
    raw_modules = [
        {
            "id": "char01a2",
            "type": "fixed_values",
            "enabled": True,
            "meta": {"name": "character", "tags": ["char"]},
            "entries": [
                {"variable_name": "subject", "value": "knight"},
                {"variable_name": "style", "value": "photoreal"},
            ],
        },
        {
            "id": "env01b2",
            "type": "fixed_values",
            "enabled": True,
            "meta": {"name": "environment"},
            "entries": [
                {"variable_name": "location", "value": "forest"},
                {"variable_name": "light", "value": "golden hour"},
            ],
        },
    ]

    modules = [module_from_dict(d) for d in raw_modules]
    ctx = PipelineEngine().run(modules, seed=42)

    template = "A $style painting of a $subject in a $location, $light"
    prompt = resolve_variables(template, ctx)

    assert prompt == (
        "A photoreal painting of a knight in a forest, golden hour"
    )

    # Trace records both modules, ordered.
    trace_ids = [entry["id"] for entry in ctx["__wp_trace__"]]
    assert trace_ids == ["char01a2", "env01b2"]

    # Socket-boundary snapshot: user vars only.
    user_ctx = strip_internals(ctx)
    assert user_ctx == {
        "subject": "knight",
        "style": "photoreal",
        "location": "forest",
        "light": "golden hour",
    }


def test_chain_simulates_downstream_context_node():
    """Upstream ctx flows into downstream Context node — last-write-wins."""
    upstream_modules = [
        module_from_dict({
            "id": "upstream",
            "type": "fixed_values",
            "entries": [
                {"variable_name": "style", "value": "photoreal"},
                {"variable_name": "subject", "value": "knight"},
            ],
        })
    ]
    upstream_ctx = PipelineEngine().run(upstream_modules, seed=1)

    # Downstream starts from a COPY of upstream's user vars — mirrors what
    # WP_Context.execute will do when wrapping an upstream ContextPayload.
    downstream_start = strip_internals(upstream_ctx)
    downstream_modules = [
        module_from_dict({
            "id": "override",
            "type": "fixed_values",
            "entries": [{"variable_name": "style", "value": "painted"}],
        })
    ]
    downstream_ctx = PipelineEngine().run(
        downstream_modules, ctx=downstream_start, seed=2
    )

    # Downstream overrides upstream's style; subject flows through unchanged.
    assert downstream_ctx["style"] == "painted"
    assert downstream_ctx["subject"] == "knight"

    # Only the override is in the downstream trace — upstream's trace was
    # not inherited because we stripped internals at the socket boundary.
    trace_ids = [entry["id"] for entry in downstream_ctx["__wp_trace__"]]
    assert trace_ids == ["override"]
    assert downstream_ctx["__wp_trace__"][0]["writes"] == [
        {
            "variable": "style",
            "value": "painted",
            "source": "fixed_values",
            "overwrite": True,
        }
    ]
```

- [ ] **Step 2: Run tests — confirm pass (these should pass without any new implementation since Tasks 1-5 covered it)**

```bash
cd "$PROJECT_ROOT"
pytest tests/test_engine_integration.py -v
```

Expected: both tests pass. If the `overwrite` assertion fails, the trace's before/after comparison logic is off — fix in `pipeline.py:_trace_entry`.

- [ ] **Step 3: Full suite + ruff**

```bash
cd "$PROJECT_ROOT"
ruff check engine tests
pytest
```

Expected: all tests pass across the suite (sanity + template + context + modules + handlers + pipeline + integration).

- [ ] **Step 4: Commit**

```bash
cd "$PROJECT_ROOT"
git add tests/test_engine_integration.py
git commit -m "test(engine): add end-to-end integration tests for JSON→run→render"
```

---

## Task 7: Final P2 validation

No new files. Confirms the engine ships in a shippable state.

- [ ] **Step 1: Clean run — full suite + ruff + typecheck + build**

```bash
cd "$PROJECT_ROOT"
ruff check .
pytest -v
pnpm typecheck
pnpm lint
pnpm build:extension
pnpm size
```

Expected: all commands exit 0. Pytest should now show ~30+ tests passing across 6 test files (sanity + 5 engine modules).

- [ ] **Step 2: Verify no ComfyUI imports snuck into `engine/`**

```bash
cd "$PROJECT_ROOT"
grep -rn "import comfy_api\|import comfy\b\|import torch" engine/ 2>&1 || echo "clean — no ComfyUI or torch imports in engine/"
```

Expected: `clean — no ComfyUI or torch imports in engine/`. If any imports found, STOP and investigate. Engine isolation is load-bearing.

- [ ] **Step 3: Confirm package count**

```bash
cd "$PROJECT_ROOT"
ls engine/
```

Expected exactly these files: `__init__.py`, `context.py`, `handlers.py`, `modules.py`, `pipeline.py`, `template.py`.

- [ ] **Step 4: No commit — validation only**

Final state:
```bash
cd "$PROJECT_ROOT"
git log --oneline | head -10
git status
```

Expected: `main` is ahead of P1 by 6 commits (one per Task 1-6), working tree clean.

---

## Self-Review Checklist

**Spec coverage (§4 Engine Internals of the design doc):**
- [x] `resolve_variables` with `$var`, `$$` escape, `__` internal skip — Task 1.
- [x] `Context` type + `strip_internals` — Task 2.
- [x] Module dataclasses (`ModuleMeta`, `FixedValueEntry`, `FixedValueModule`) + JSON round-trip — Task 3.
- [x] `handle_fixed_values` — Task 4.
- [x] `PipelineEngine.run` with tracing, disabled-module skip, unknown-type handling, seeded RNG — Task 5.
- [x] Engine isolation invariants (stdlib only, no ComfyUI) — verified in Task 7.

**Placeholder scan:** no TBD/TODO/FIXME in the plan. Every step contains real code or a concrete command.

**Type consistency:** signatures match across files:
- `handle_fixed_values(module, ctx, rng)` (Task 4) matches `HANDLERS["fixed_values"]` in pipeline (Task 5).
- `module_from_dict(d)` / `module_to_dict(m)` (Task 3) round-trip used in Task 6 integration test.
- `Context = dict[str, Any]` (Task 2) used in handler signature (Task 4) and pipeline signature (Task 5).

**Gaps noted:** none. Next plan (P3) wraps these engine primitives in ComfyUI V3 nodes.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-wildcard-pipeline-mvp-p2-engine.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, per-task spec + code quality review, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
