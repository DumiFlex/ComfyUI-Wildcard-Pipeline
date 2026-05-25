# WP Context

Holds named values (`$style = watercolor`, `$subject = cat`) that downstream nodes can plug into prompts via `$variable` placeholders.

## Inputs

- **upstream** *(optional)* — chain another WP Context to inherit its values.
- **seed** — drives wildcard / random picks. `control_after_generate` rotates per queue.

## Output

- **context** — the `PIPELINE_CONTEXT` payload carrying all bound values. Feed to WP Prompt Assembler, WP Prompt Cleaner, or chain into another Context.

## How to use

1. Click **+** in the body to add a row.
2. Pick a module from the library, or create a Fixed Values entry inline.
3. Name the variable + set its value. Wildcards roll on each queue using the seed.

Run the workflow once — open **WP Debug** downstream to see the bound values.

## Tips

- Variables prefixed `__` are engine-internal and hidden from the assembler.
- Bundles let you snapshot a group of related modules and reuse them across workflows.
- Conflict dots: blue = overriding an upstream value, amber = sibling collision in this Context.
