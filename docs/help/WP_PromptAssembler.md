# WP Prompt Assembler

Fill-in-the-blank prompt template. Anywhere you write `$variable`, the assembler substitutes the matching value from the upstream Context.

## Inputs

- **context** — `PIPELINE_CONTEXT` from any WP node.
- **template** — your prompt text. Use `$varname` to reference bound values.

## Output

- **prompt** — the resolved STRING. Feed into CLIP encoders, WP Prompt Cleaner, etc.

## How to use

1. Wire a WP Context (or chain) into the context input.
2. Write your template:
   ```
   A $style portrait of $subject, $lighting
   ```
3. Run the workflow. Each `$var` gets replaced with its current value.

## Helper widget

Below the template, the **Variables** strip lists every value available from upstream — click any chip to insert `$name` at the cursor.

**Preview** color-codes the resolved prompt:
- purple highlight = resolved value
- amber wavy underline = missing variable (will render empty)

## Tips

- Use `$$` for a literal `$` in your prompt.
- Variable names: letters, numbers, underscores only.
- Pre-flight warning toasts surface missing `$vars` at queue time.
