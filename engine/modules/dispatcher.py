"""Module-type dispatcher.

Each module type registers a ``ModuleHandler`` subclass keyed by ``type_id``.
Graph execution calls ``resolve_module(snapshot, ctx)`` which routes to the
matching handler. Handlers receive only the snapshot's payload + per-instance
overrides + the runtime context — never the library DB.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class UnknownModuleType(KeyError):
    """Raised when a snapshot's ``type`` has no registered handler."""


class ModuleHandler(ABC):
    """Base class for per-type module handlers."""

    type_id: str = ""

    @classmethod
    @abstractmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        """Return a mapping of variable_name → resolved string."""


_HANDLERS: dict[str, type[ModuleHandler]] = {}


def register_handler(handler: type[ModuleHandler]) -> None:
    """Register a handler under its ``type_id``. Re-registration replaces."""
    if not handler.type_id:
        raise ValueError(f"{handler.__name__} missing type_id")
    _HANDLERS[handler.type_id] = handler


def resolve_module(snapshot: dict[str, Any], ctx: Any) -> dict[str, str]:
    """Route a snapshot to its registered handler and return the resolution."""
    type_id = snapshot.get("type")
    if not isinstance(type_id, str):
        raise UnknownModuleType(type_id)
    handler = _HANDLERS.get(type_id)
    if handler is None:
        raise UnknownModuleType(type_id)
    return handler.resolve(
        snapshot.get("payload", {}),
        snapshot.get("instance", {}),
        ctx,
    )
