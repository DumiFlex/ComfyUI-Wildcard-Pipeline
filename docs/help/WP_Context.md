# WP Context

Hold a list of named values you can use later in your prompt. Each value gets a name (like `style` or `subject`) and the value you want it to be (like `watercolor` or `a cat`). Then a **WP Prompt Assembler** can plug those values into your prompt wherever you write `$style` or `$subject`.

## Adding values

A **module** is one small group of values. Click the big purple **Add your first module** button, or **+ add module** if you already have some.

Each module appears as a small card. Right-click the card and pick **Edit** to:

- Give it a name (just a label so you remember what's inside, like "Character details")
- Add as many `name = value` lines as you need
- Paste a bunch of lines at once if you have them ready

Press **Enter** on the value field to add another row quickly. **Ctrl+Enter** saves and closes.

## What the icons on a card mean

- **☰** Drag handle — drag a card to reorder, or drag onto another Context node to move it there
- **▾ / ▸** Show or hide the values preview
- **Toggle (checkbox)** — turn a module off without deleting it. Useful for trying variations.
- **✕** Remove the module. Don't worry about misclicks — an **Undo** button appears for a few seconds.

## Stacking multiple Contexts

Connect another **WP Context** node into the **upstream** input. The upstream Context's values flow through. If both define the same name, this Context wins (it's the closer one to your prompt).

This lets you build a library: "character" Context → "scene" Context → "style" Context → Prompt Assembler.

## Conflict dots

A card may show a small colored dot:

- 🔵 **Blue (info)** — You're overriding something an upstream Context already provides. Usually that's exactly what you want.
- 🟡 **Amber (warning)** — Two of your modules in this Context use the same name. One quietly overwrites the other; check that's intentional.

Hover the dot to see exactly which variable.

## Output

Wire **context** out into a **WP Prompt Assembler** (or another **WP Context** to chain).
