# WP Context

The pipeline's module runner. Holds an ordered list of **modules** (wildcards, fixed values, combines, derivations, constraints) plus optional **bundles** that group related modules. Each queue, the engine executes every enabled module in order, building up a context of `$variable` bindings that downstream nodes consume.

## Inputs

- **upstream** *(optional)* — chain another WP Context to inherit its bindings. Same-name bindings in this node override the upstream.
- **seed** — drives every random pick this run (wildcards, weighted lookups). `control_after_generate` rotates per queue. Per-row seed locks override per-instance.
- **modules** *(widget)* — the ordered module list. Picked from the library or created inline.

## Output

- **context** — `PIPELINE_CONTEXT` payload carrying all bindings + run trace + warnings. Feed into WP Prompt Assembler, WP Prompt Cleaner, WP Debug, or chain another Context.

## Module kinds

| Kind | What it does |
|---|---|
| **wildcard** | Picks one option from a weighted list. Roll changes each queue. Supports sub-categories, nested `@{uuid}` refs, null slots. |
| **fixed_values** | Assigns explicit `name = value` bindings — no randomness. Quick way to define static vars. |
| **combine** | Template-fills `$vars` into a string and writes the result to a new binding. E.g. `$mood $subject` → `subject_phrase = "sleepy cat"`. |
| **derivation** | IF/ELIF/ELSE conditional rules over the runtime context. E.g. *if `$mood == sleepy` then `$lighting = soft`*. |
| **constraint** | Re-weights a target wildcard's options based on a source wildcard's pick. E.g. *if `$hair == bald` then exclude `$style == braided`*. First-instance: fires on the first matching target downstream, then consumed. |

Bundles group modules that belong together (e.g. "final framing": all the wildcards + the combine that builds the final prompt). They're reusable across workflows.

## How to use

1. Click **+ Add module** to insert a row. Pick from the library, or create a Fixed Values entry inline.
2. Order matters — modules run top-to-bottom. A combine that reads `$mood` must come after the wildcard that picks `$mood`.
3. Wire the **context** output into a WP Prompt Assembler / WP Prompt Cleaner / WP Debug.

Drag a row by its handle to reorder. Drag onto another Context node to move it. Toggle the checkbox to disable a row without deleting it.

## Per-row indicators

- **MODIFIED** badge — the row diverges from its library entry (instance overrides applied).
- **MISSING VAR** badge — a combine/derivation references a `$var` no upstream module provides.
- **Conflict dots** — blue = overriding an upstream binding (info), amber = sibling collision in this Context (warning).
- **Bundle frame** — colored border grouping related modules. Click the bundle header to collapse / toggle the whole group.

## Tips

- Variables prefixed `__` are engine-internal and hidden from the assembler.
- Right-click a row for Edit / Duplicate / Save-to-library / Open-in-SPA.
- Run once with WP Debug downstream to see exactly what each module produced.
