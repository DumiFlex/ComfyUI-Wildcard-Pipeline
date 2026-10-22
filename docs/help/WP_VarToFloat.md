# WP Var → Float

Reads a `$variable` from the upstream Context and emits a `FLOAT`.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `context` | context | Required. From a WP Context. |
| `var_name` | dropdown | Pick from upstream `$vars`. |
| `index` | `INT` | Which float match in the var's value. |
| `default` | `FLOAT` | Returned when no Nth match. |

## Parsing rule

Finds the numbers in the value, in order, and returns the one at `index` (0 is the first). Whole numbers count (`"1920"` → `1920.0`), and so does scientific notation.

- `"strength: 0.85, scale: 1.5"` index `1` → `1.5`
- `"3.2e-4"` index `0` → `0.00032`
