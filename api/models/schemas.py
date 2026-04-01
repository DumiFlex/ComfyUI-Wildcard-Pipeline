"""JSON schemas and validation for API request/response data."""

from __future__ import annotations

from typing import Any

# -- Required top-level keys per resource type --------------------------------

_WILDCARD_REQUIRED = {"name", "options"}
_CONSTRAINT_REQUIRED = {"name", "rules"}
_PIPELINE_REQUIRED = {"name", "modules"}


def validate_wildcard(data: dict[str, Any]) -> list[str]:
    """Return list of validation errors for a wildcard payload."""
    errors: list[str] = []
    missing = _WILDCARD_REQUIRED - data.keys()
    if missing:
        errors.append(f"Missing required fields: {', '.join(sorted(missing))}")
    if "options" in data and not isinstance(data["options"], list):
        errors.append("'options' must be an array")
    return errors


def validate_constraint(data: dict[str, Any]) -> list[str]:
    """Return list of validation errors for a constraint payload."""
    errors: list[str] = []
    missing = _CONSTRAINT_REQUIRED - data.keys()
    if missing:
        errors.append(f"Missing required fields: {', '.join(sorted(missing))}")
    if "rules" in data and not isinstance(data["rules"], list):
        errors.append("'rules' must be an array")
    return errors


def validate_pipeline(data: dict[str, Any]) -> list[str]:
    """Return list of validation errors for a pipeline payload."""
    errors: list[str] = []
    missing = _PIPELINE_REQUIRED - data.keys()
    if missing:
        errors.append(f"Missing required fields: {', '.join(sorted(missing))}")
    if "modules" in data and not isinstance(data["modules"], list):
        errors.append("'modules' must be an array")
    return errors
