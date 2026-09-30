# WP Prompt Assembler

Fill-in-the-blank prompt template. Anywhere you write `$variable`, the assembler substitutes the matching value from the upstream Context.

## Inputs

- **context** — `PIPELINE_CONTEXT` from any WP node.
- **template** — your prompt text. Use `$varname` to reference bound values.
- **negative_template** — optional negative template (collapsible section under the preview). `$negatives` marks where the collected negative words go; it reads `$vars` too.

## Outputs

- **prompt** — the resolved STRING. Feed into CLIP encoders, WP Prompt Cleaner, etc.
- **negative** — the negative words of every variable the template rendered, filled into the negative template. Feed into your negative CLIP encoder.

## Negative output

Wildcard options, fixed values, combines, derivation "Add to negative" actions and Injector rows can carry negative words for the variable they set. The negative output only takes the words of variables this template actually rendered, so a detailer Assembler that renders just `$face` gets only the face words. Internal variables add nothing.

- `lowres, bad anatomy, $negatives` puts the collected words at the slot.
- An empty negative template outputs just the collected words.
- A negative template without `$negatives` gets them appended at the end.
- Repeated tags are dropped (case-insensitive, `(blurry:1.2)` counts as `blurry`), including tags already in the negative template.

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

## Save / Load template

Two toolbar buttons next to **Clear template**:

- **Load** — opens a library picker with search plus category / tags / favorites filters. Click a template to load it; this replaces the current template (confirms first if you've already typed something). The assembler remembers which template you loaded.
- **Save** — opens a save dialog (name, category, tags, description, live preview). When the name matches an existing template — or you loaded one — you get two actions: **Update existing** (overwrite that library entry) and **Save as new entry** (create a fresh copy, auto-suffixed). Otherwise it's a plain **Save**. After saving, the assembler tracks that entry so the next Save defaults to updating it.

Any `$vars` the loaded template needs that aren't in the upstream chain show as the usual amber "missing" markers. Manage saved templates in the SPA **Templates** tab.

## Tips

- Use `$$` for a literal `$` in your prompt.
- Variable names: letters, numbers, underscores only.
- Pre-flight warning toasts surface missing `$vars` at queue time.
