# WP Debug

Inspect every variable flowing through the WP chain at this point. Terminal node — no output.

## Input

- **context** — connect to any WP node's PIPELINE_CONTEXT output.

## How to use

1. Drop it anywhere in the chain.
2. Run the workflow.
3. The body shows tabs:
   - **Snapshot** — every bound variable + value.
   - **Trace** — per-module resolution history.
   - **Picks** — what each wildcard rolled.
   - **Warnings** — unknown vars, constraints that never fired, etc.

Drag the bottom-right corner to resize.

## Tips

- Always re-runs on queue (not cached) so seed-driven values refresh.
- Use the filter box at the top of each tab to narrow on a variable name.
