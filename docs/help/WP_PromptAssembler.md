# WP Prompt Assembler

Write your prompt as a fill-in-the-blank template. Anywhere you put `$something`, the Assembler swaps in the matching value from the upstream Context.

## Writing a template

Type your prompt in the **template** box. Use `$name` to reference any variable from the connected Context.

**Example template:**
```
a portrait of $subject, $style, $mood
```

If the upstream Context provides:
- `subject = a cat`
- `style = watercolor`
- `mood = sleepy`

…the final prompt becomes:
```
a portrait of a cat, watercolor, sleepy
```

## The helper below the template

**Variables** lists every value available from the upstream Context. Click any chip to insert `$name` into your template at the cursor — saves typing and avoids typos.

**Preview** shows what the final prompt will look like, color-coded:

- **Filled in (purple highlight)** — the variable is resolved, you see its actual value.
- **Outlined chip** — the name will resolve, just briefly during loading.
- **Amber wavy underline** — missing! Nothing upstream provides this name, so it'll render empty.

If your template is empty, the preview shows a placeholder instead.

## Special characters

- Use `$$` if you want a literal `$` in your prompt (e.g. `$$10` to mean "ten dollars" rather than a variable named `10`).
- Variable names can contain letters, numbers, and underscores only. `$my_var` works; `$my-var` doesn't.

## Output

**prompt** is the final assembled string. Connect it to a **CLIP Text Encode** node (or any text input).

## Pre-flight warnings

When you press the **Run** button, the extension scans your template for `$variables` that aren't provided anywhere upstream. If it finds any, you'll see one toast at the top of the screen listing them. The run still happens — missing variables just become empty strings — but it's a heads-up in case you have a typo.
