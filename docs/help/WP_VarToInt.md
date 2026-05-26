# WP Var → Int

Reads a `$var` from the upstream **PipelineContext** and emits an `INT`.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `context` | `PIPELINE_CONTEXT` | Required. Comes from a `WP Context` chain. |
| `var_name` | dropdown | Pick from upstream `$vars`. Stored as `"$seed"`. |
| `index` | `INT` | Which integer match in the var's value (0-based). |
| `default` | `INT` | Returned when the var is missing or no Nth match. |

## Parsing rule

Scans the var's value for substrings matching `-?\d+`, returns the Nth match.

- `"1920x1080"` index `0` → `1920`
- `"1920x1080"` index `1` → `1080`
- `"hello"` any index → `default`
- `""` / missing var → `default`

## Tip

For width + height in one shot, place two `WP Var → Int` nodes reading the same var with `index=0` and `index=1`.
