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
    if "tags" in data:
        if not isinstance(data["tags"], list):
            errors.append("'tags' must be an array")
        elif not all(isinstance(t, str) for t in data["tags"]):
            errors.append("'tags' must contain only strings")
    return errors


def validate_constraint(data: dict[str, Any]) -> list[str]:
    """Return list of validation errors for a constraint payload."""
    errors: list[str] = []
    missing = _CONSTRAINT_REQUIRED - data.keys()
    if missing:
        errors.append(f"Missing required fields: {', '.join(sorted(missing))}")
    if "rules" in data and not isinstance(data["rules"], list):
        errors.append("'rules' must be an array")
    if "rules" in data and isinstance(data["rules"], list):
        _REQUIRED_RULE_KEYS = {"target", "when_variable", "when_value", "rule_type"}
        _VALID_RULE_TYPES = {"exclusion", "weight_bias"}
        for i, rule in enumerate(data["rules"]):
            if not isinstance(rule, dict):
                errors.append(f"Rule at index {i} must be an object")
                continue
            missing_rule = _REQUIRED_RULE_KEYS - rule.keys()
            if missing_rule:
                errors.append(
                    f"Rule at index {i} missing required fields: {', '.join(sorted(missing_rule))}"
                )
            if rule.get("rule_type") not in _VALID_RULE_TYPES and "rule_type" in rule:
                errors.append(
                    f"Rule at index {i} 'rule_type' must be one of: {', '.join(sorted(_VALID_RULE_TYPES))}"
                )
    if "tags" in data:
        if not isinstance(data["tags"], list):
            errors.append("'tags' must be an array")
        elif not all(isinstance(t, str) for t in data["tags"]):
            errors.append("'tags' must contain only strings")
    return errors


def validate_pipeline(data: dict[str, Any]) -> list[str]:
    """Return list of validation errors for a pipeline payload."""
    errors: list[str] = []
    missing = _PIPELINE_REQUIRED - data.keys()
    if missing:
        errors.append(f"Missing required fields: {', '.join(sorted(missing))}")
    if "modules" in data and not isinstance(data["modules"], list):
        errors.append("'modules' must be an array")
    if "tags" in data:
        if not isinstance(data["tags"], list):
            errors.append("'tags' must be an array")
        elif not all(isinstance(t, str) for t in data["tags"]):
            errors.append("'tags' must contain only strings")
    return errors
