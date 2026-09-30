# WP Debug

Inspect every variable flowing through the WP chain at this point. Terminal node — no output.

## Input

- **context** — connect to any WP node's PIPELINE_CONTEXT output.

## How to use

1. Drop it anywhere in the chain.
2. Run the workflow.
3. The body shows tabs:
   - **Variables** — every bound variable + value and the step that set it. A variable's negative words sit under it in red, naming their module when it isn't the variable's own; the tab bar counts variables with negatives.
   - **Trace** — every step in run order, grouped by Context node; open one for why it did what it did. An "Add to negative" derivation action reads `negative: …`.
   - **Warnings** — unknown vars, constraints that never fired, etc.
   - **Raw** — the snapshot JSON (including the negatives table).

Drag the bottom-right corner to resize.

## Tips

- Always re-runs on queue (not cached) so seed-driven values refresh.
- Use the filter box at the top of each tab to narrow on a variable name.
