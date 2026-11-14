# WP Debug

See what happened at this point of the chain: every variable, which module set it, and any warnings. It has no output and changes nothing.

<!-- video:start -->
▶ **Video:** [WP Debug in depth](https://youtu.be/iwPrjMEK6kg) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

<!-- fields:start -->
## Inputs and outputs

- **context (in)** `context`: Any WP node's context output. The node has no output and changes nothing; drag its corner to resize.

## Tabs

- **Variables**: Every $variable and its value at this point, with the module or node that set it (its icon and colour on the left edge say which kind: wildcard, derivation, Toggles, Model Info, Context Loop, Injector …). The quickest way to check what your wildcards picked. Negative words show under the value in red, with the module they came from when it isn't the variable's own.
- **Trace**: Every module and node row in the order it ran, grouped by the node it ran in. Open one to see why it did what it did: a wildcard's odds and the constraints that changed them, which derivation branch ran, the negative each one left, and for rows from other nodes where the value came from (a Loop frame and its seed, a Model Info detection, a Toggles switch set upstream).
- **Warnings**: What came up during the run, such as missing variables or a constraint that changed nothing. Look here first when something seems off.
- **Raw**: Everything as JSON, with a download button. Handy for bug reports.
<!-- fields:end -->

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
