# WP Var → Bool

Reads a `$variable` from the upstream Context and emits a `BOOLEAN`.

<!-- video:start -->
▶ **Video:** [WP Var to Bool in depth](https://youtu.be/vVwMWvdM44I) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

<!-- fields:start -->
## On the node

- **context (in)** `context`: The Context that holds the $variable.
- **var_name** `variable`: The $variable to read. The list shows every variable the wired Context has.
- **index** `INT`: Which yes/no word to use when there are several: 0 is the first, 1 the second. Other words don't count.
- **default** `BOOLEAN`: Used when the variable is missing or has no yes/no word. The node never stops the run; it uses this instead.
- **value (out)** `BOOLEAN`: True or false, for any BOOLEAN input: a switch node, a toggle and so on.
<!-- fields:end -->

## Parsing rule

Splits the value on spaces, commas, semicolons, pipes and slashes, and checks each word:

- **Truthy:** `true`, `yes`, `on`, `1` (case-insensitive)
- **Falsy:** `false`, `no`, `off`, `0` (case-insensitive)

Tokens that match neither (e.g. `"1.5"`, `"enabled"`) are skipped and don't count for the index.

- `"true false true"` index `2` → `True`
- `"yes,no,yes"` index `1` → `False`
- `"1.5"` index `0` → `default` (1.5 is not a bool token)
