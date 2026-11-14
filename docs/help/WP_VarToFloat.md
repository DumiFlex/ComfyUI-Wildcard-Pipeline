# WP Var → Float

Reads a `$variable` from the upstream Context and emits a `FLOAT`.

<!-- video:start -->
▶ **Video:** [WP Var to Float in depth](https://youtu.be/VH7Ssu56szE) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

<!-- fields:start -->
## On the node

- **context (in)** `context`: The Context that holds the $variable.
- **var_name** `variable`: The $variable to read. The list shows every variable the wired Context has.
- **index** `INT`: Which number to take when there are several: 0 is the first, 1 the second. Usually 0.
- **default** `FLOAT`: Used when the variable is missing, has no number, or has fewer numbers than the index. The node never stops the run; it uses this instead.
- **value (out)** `FLOAT`: The number, for any FLOAT input: CFG, denoise, a LoRA strength and so on.
<!-- fields:end -->

## Parsing rule

Finds the numbers in the value, in order, and returns the one at `index` (0 is the first). Whole numbers count (`"1920"` → `1920.0`), and so does scientific notation.

- `"strength: 0.85, scale: 1.5"` index `1` → `1.5`
- `"3.2e-4"` index `0` → `0.00032`
