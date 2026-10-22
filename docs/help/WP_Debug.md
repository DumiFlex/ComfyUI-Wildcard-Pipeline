# WP Debug

See what happened at this point of the chain: every variable, which module set it, and any warnings. It has no output and changes nothing.

## Input

- **context**: any WP node's context output.

## How to use

1. Wire it after a Context (or anywhere in the chain).
2. Run.
3. Read the tabs:
   - **Variables**: every variable, its value and the module that set it. Negative words show under the value in red.
   - **Trace**: every module in the order it ran, grouped by Context. Open one to see why it did what it did.
   - **Warnings**: what came up during the run, such as a missing variable or a constraint that changed nothing.
   - **Raw**: everything as JSON, handy for bug reports.

Drag the bottom-right corner to resize.

## Tips

- It updates on every run.
- The filter box at the top of each tab searches by variable name.
- Use several Debug nodes to see different points of the chain.
