"""Shared utility helpers used across the engine + wp_api packages."""
from __future__ import annotations

import datetime as _dt


def now_iso() -> str:
    """UTC ISO timestamp with millisecond precision and ``Z`` suffix.

    Used for `created_at`, `updated_at`, `library_snapshot_at`,
    migration `applied_at`, and import-export `exported_at`. Single source
    of truth so the format never drifts between callers.
    """
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
