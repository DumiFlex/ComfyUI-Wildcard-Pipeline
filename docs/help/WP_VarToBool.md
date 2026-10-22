# WP Var → Bool

Reads a `$variable` from the upstream Context and emits a `BOOLEAN`.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `context` | context | Required. From a WP Context. |
| `var_name` | dropdown | Pick from upstream `$vars`. |
| `index` | `INT` | Which bool token in the var's value. |
| `default` | `BOOLEAN` | Returned when no Nth match. |

## Parsing rule

Splits the value on spaces, commas, semicolons, pipes and slashes, and checks each word:

- **Truthy:** `true`, `yes`, `on`, `1` (case-insensitive)
- **Falsy:** `false`, `no`, `off`, `0` (case-insensitive)

Tokens that match neither (e.g. `"1.5"`, `"enabled"`) are skipped and don't count for the index.

- `"true false true"` index `2` → `True`
- `"yes,no,yes"` index `1` → `False`
- `"1.5"` index `0` → `default` (1.5 is not a bool token)
