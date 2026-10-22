# WP Context

The heart of the pipeline. Holds a stack of **modules** (wildcards, fixed values, combines, derivations, constraints and bundles), runs them top to bottom on every queue, and sends the resulting `$variables` downstream.

## Inputs

- **upstream** *(optional)*: another WP Context (or Injector, Model Info, Loop). This node starts with its variables; a variable set again here replaces the upstream value.
- **seed**: drives every random pick. **control after generate** changes it after each queue. A module with **Lock pick** keeps its pick whatever the seed.

## Output

- **context**: the variables and what happened during the run. Wire it into a WP Prompt Assembler, a WP Debug, or another WP Context.

## How to use

1. Click **Add module** and pick one from your library (or **Add Bundle** for a saved group).
2. Order matters: modules run top to bottom. A combine that reads `$mood` must sit below the wildcard that picks `$mood`, and a constraint sits between its two wildcards.
3. Wire **context** into a WP Prompt Assembler and write a template like `a photo of $subject`.

Drag a row by its handle to reorder it, or onto another Context node to move it. Untick a row to switch it off without removing it.

## What the row markers mean

- **Coloured dots and labels** such as `MISSING VAR`: something to look at. Blue is just so you know (for example this row overrides an upstream variable), amber is worth a look (a duplicate or a missing variable). Hover for the message. Nothing here ever stops a run.
- **drift**: the library entry changed since you added it. Right-click the row → **Refresh from library** to pull the change. On a bundle the label reads **library updated**: right-click the bundle → **Reset to library snapshot**.
- **missing**: the entry isn't in your library (deleted, or the workflow came from someone else). The row keeps working from its own copy; right-click → **Save to library** to add it.
- **mod**: you changed this row on the node, so it differs from the library entry.
- **held**: Hold across run is on.
- The **lock** button locks the pick, the **globe** button hides the variable from the prompt, the bin removes the row.

## Tips

- Right-click a row for Edit, Duplicate, Hold across run, Push to library and more.
- **Hide from prompt** in a module's settings keeps its variable out of the prompt while later modules can still read it.
- Wire a **WP Debug** to the output to see exactly what each module picked.
- The manager's docs (**Docs** in the Wildcard Pipeline sidebar) explain every module in detail.
