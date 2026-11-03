# WP Var → Int

Reads a `$variable` from the upstream Context and emits an `INT`.

<!-- fields:start -->
## On the node

- **context (in)** `context`: The Context that holds the $variable.
- **var_name** `variable`: The $variable to read. The list shows every variable the wired Context has.
- **index** `INT`: Which number to take when there are several: 0 is the first, 1 the second. Usually 0.
- **default** `INT`: The value to use when the variable is missing, has no numbers in it, or the index is beyond what was found. The node never stops the run; it uses this instead.
- **value (out)** `INT`: The whole number, for any INT input: width, steps, batch size and so on.
<!-- fields:end -->

## Parsing rule

Finds the whole numbers in the value, in order, and returns the one at `index` (0 is the first).

- `"1920x1080"` index `0` → `1920`
- `"1920x1080"` index `1` → `1080`
- `"hello"` any index → `default`
- `""` / missing var → `default`

## Tip

For width + height in one shot, place two `WP Var → Int` nodes reading the same var with `index=0` and `index=1`.
