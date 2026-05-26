# WP Var → Float

Reads a `$var` from the upstream **PipelineContext** and emits a `FLOAT`.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `context` | `PIPELINE_CONTEXT` | Required. |
| `var_name` | dropdown | Pick from upstream `$vars`. |
| `index` | `INT` | Which float match in the var's value. |
| `default` | `FLOAT` | Returned when no Nth match. |

## Parsing rule

Scans for substrings matching `-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`. Integers count — `"1920"` index `0` → `1920.0`. Scientific notation supported.

- `"strength: 0.85, scale: 1.5"` index `1` → `1.5`
- `"3.2e-4"` index `0` → `0.00032`
