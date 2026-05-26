# WP Var → Bool

Reads a `$var` from the upstream **PipelineContext** and emits a `BOOLEAN`.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `context` | `PIPELINE_CONTEXT` | Required. |
| `var_name` | dropdown | Pick from upstream `$vars`. |
| `index` | `INT` | Which bool token in the var's value. |
| `default` | `BOOLEAN` | Returned when no Nth match. |

## Parsing rule

Splits the var's value on `[\s,;|/]+` and checks each token against the truthy/falsy sets:

- **Truthy:** `true`, `yes`, `on`, `1` (case-insensitive)
- **Falsy:** `false`, `no`, `off`, `0` (case-insensitive)

Tokens that match neither (e.g. `"1.5"`, `"enabled"`) are skipped — they do NOT consume an index slot.

- `"true false true"` index `2` → `True`
- `"yes,no,yes"` index `1` → `False`
- `"1.5"` index `0` → `default` (1.5 is not a bool token)
