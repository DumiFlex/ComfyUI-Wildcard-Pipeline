# WP Context Injector

Turns any ComfyUI output (text, a LoRA name, a number) into a `$variable` the rest of the pipeline can use.

<!-- fields:start -->
## Inputs and outputs

- **upstream (in)** `context`: Optional. Another WP Context, Injector, Model Info or Loop to add to. Only nodes after the injector see its variables.
- **input_0 … input_9 (in)**: Wire any ComfyUI output (text, a LoRA name, a number) into the next free input_N. Each wired input becomes a row; a new free one appears as you wire, up to 10.
- **context (out)** `context`: The variables from before, plus one per row.

## Row options

- **Name**: The $variable the value becomes. Letters, digits and underscores, starting with a letter.
- **Template**: Optional. Wrap the value in text, e.g. wearing $input_0. Leave empty to use the value as it is. $$ prints a dollar sign. Inline {a|b} picks need a seed, so they print as written (the editor warns).
- **Negative**: Optional negative words for this variable (it can use $input_0 too, so another node can write it). Only reaches an Assembler that prints the variable. Rows with one show a NEG badge.
- **Hide from prompt (globe)**: The variable still reaches combines and derivations, but prints nothing in the prompt.
<!-- fields:end -->

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
