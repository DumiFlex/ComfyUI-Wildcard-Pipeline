# WP Context Injector

Turns any ComfyUI output (text, a LoRA name, a number) into a `$variable` the rest of the pipeline can use.

## Inputs

- **upstream** *(optional)*: another WP Context or Injector to add to.
- **slot_0 … slot_9**: wire any ComfyUI output here. Each connected slot becomes a row.

## Output

- **context**: the variables from before, plus the ones this node adds.

## How to use

1. Drag wires from external nodes into the slot sockets.
2. Each connected slot adds a row. Type the variable name (e.g. `style`).
3. Optionally tick **internal** to keep it out of the prompt while combines and derivations can still read it.
4. Optionally write a template, like `I love $input_0`: the wired value goes where `$input_0` is.
5. Optionally write a **Negative** (row Edit panel, under Template) with the same `$slot` grammar. It replaces the variable's negative words and reaches only Assemblers that render the variable. Template rows take one too.

## Tips

- Rows can be reordered freely.
- Names use letters, digits and underscores, and start with a letter.
- Capped at 10 sockets. Chain a second injector if you need more.
- Text and numbers work best. An IMAGE or LATENT is turned into text, which is rarely useful in a prompt.
