# WP Context Injector

Lifts arbitrary ComfyUI outputs into named `$variable` bindings on the PipelineContext. Use when you want a value from a non-WP node (LoRA loader, prompt picker, CLIP text) available as `$var` downstream.

## Inputs

- **upstream** *(optional)* — chain another WP Context / Injector.
- **slot_0 … slot_9** — wire any ComfyUI output here. Each connected slot becomes a row.

## Output

- **context** — `PIPELINE_CONTEXT` carrying the injected bindings on top of any upstream values.

## How to use

1. Drag wires from external nodes into the slot sockets.
2. Each connected slot adds a row. Type the variable name (e.g. `style`).
3. Optionally tick **internal** to hide it from the assembled prompt while keeping it readable by Combine / Derivation rules.
4. Optionally write a template (`"I love $input_0"`) — the slot's raw value substitutes `$<slot_name>` before being written to ctx.

## Tips

- Rows reorder freely — engine reads by `slot_name`, not position.
- Names must match `^[a-zA-Z][a-zA-Z0-9_]*$`.
- Capped at 10 sockets. Chain a second injector if you need more.
- Non-primitive values (LATENT/IMAGE/etc.) stringify via Python `str()` — typically used for STRING/INT/FLOAT only.
