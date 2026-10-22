# WP Var → Int

Reads a `$variable` from the upstream Context and emits an `INT`.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `context` | context | Required. From a WP Context. |
| `var_name` | dropdown | Pick from upstream `$vars`. Stored as `"$seed"`. |
| `index` | `INT` | Which integer match in the var's value (0-based). |
| `default` | `INT` | Returned when the var is missing or no Nth match. |

## Parsing rule

Finds the whole numbers in the value, in order, and returns the one at `index` (0 is the first).

- `"1920x1080"` index `0` → `1920`
- `"1920x1080"` index `1` → `1080`
- `"hello"` any index → `default`
- `""` / missing var → `default`

## Tip

For width + height in one shot, place two `WP Var → Int` nodes reading the same var with `index=0` and `index=1`.
