"""Log a repeating message once, so the ComfyUI console doesn't fill up.

Seed cycling re-runs the pipeline on every queue and the editors call the
API on every keystroke, so a warning raised there would print again and
again. `log_once` prints it the first time its key is seen and drops it to
DEBUG after that; `forget` lets a key print again (when its state changed).
"""
from __future__ import annotations

import logging
from collections import OrderedDict
from collections.abc import Hashable
from typing import Any

_MAX_KEYS = 512
_seen: OrderedDict[Hashable, None] = OrderedDict()


def log_once(logger: logging.Logger, level: int, key: Hashable, msg: str,
             *args: Any, exc_info: bool = False) -> bool:
    """Log at `level` the first time `key` is seen, at DEBUG (no traceback)
    after that. Returns whether it logged at `level`."""
    if key in _seen:
        _seen.move_to_end(key)
        logger.debug(msg, *args)
        return False
    _seen[key] = None
    while len(_seen) > _MAX_KEYS:
        _seen.popitem(last=False)
    logger.log(level, msg, *args, exc_info=exc_info)
    return True


def forget(key: Hashable) -> None:
    """Let `key` log at its level again."""
    _seen.pop(key, None)


def reset() -> None:
    """Forget every key. For tests."""
    _seen.clear()
