# WP Debug

Drop this anywhere in your pipeline to see exactly what variables are flowing through that point. Like a window into the chain.

## How to use

1. Connect the **context** input to any WP node (Context or Prompt Assembler).
2. Run the workflow once.
3. The viewer below shows every variable name and its value at that point in the chain.

That's it. There's nothing to wire on the output side — Debug is read-only.

## When it's useful

- **"Why is `$style` showing as empty?"** Drop a Debug after each Context to see where the value gets lost or overridden.
- **"Did my new module override the old one correctly?"** The trace shows which module set each variable.
- **"Are upstream variables coming through the chain?"** Drop a Debug right before your Prompt Assembler to confirm.

## Tips

- The viewer fills the node body. Drag the bottom-right corner of the node to make it bigger if you have lots of variables.
- Debug nodes always re-run, even when nothing visually changed. Helpful when you're cycling seeds and want to see the values shift.
