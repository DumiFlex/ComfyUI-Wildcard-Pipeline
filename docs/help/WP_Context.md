# WP Context

The heart of the pipeline. Holds a stack of **modules** (wildcards, fixed values, combines, derivations, constraints and bundles), runs them top to bottom on every queue, and sends the resulting `$variables` downstream.

<!-- video:start -->
▶ **Video:** [WP Context in depth](https://youtu.be/wkuk_8ytG5s) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

<!-- fields:start -->
## Inputs and outputs

- **upstream (in)** `context`: Optional. Another WP Context, an Injector, Model Info or a Loop. This node starts with their variables and can add to them or replace them.
- **seed** `INT`: Decides every random pick in this node. See Seeds & loops.
- **context (out)** `context`: The variables. Wire it into a WP Prompt Assembler, a WP Debug or another WP Context.

## Row markers

- **Coloured dot or label**: Something to look at, such as MISSING VAR or a variable set twice. Blue is for your information, amber is worth a look. Hover for the message. Nothing here stops a run.
- **drift**: The library entry changed after you added it. Right-click → Refresh from library to take the change. On a bundle it reads library updated; right-click the bundle → Reset to library snapshot.
- **missing**: The entry isn't in your library (deleted, or the workflow came from someone else). The row still works from its own copy; right-click → Save to library to add it.
- **mod**: You changed this row on the node, so it differs from the library.
- **held**: Hold across run is on.
- **Lock / globe / bin**: The row buttons: lock the pick, hide the variable from the prompt, remove the row. Set Row buttons to On hover (ComfyUI Settings or the Display Playground) to show them only when the pointer is on the row; a pressed lock or globe always shows.
<!-- fields:end -->

## How to use

1. Click **Add module** and pick one from your library (or **Add Bundle** for a saved group).
2. Order matters: modules run top to bottom. A combine that reads `$mood` must sit below the wildcard that picks `$mood`, and a constraint sits between its two wildcards.
3. Wire **context** into a WP Prompt Assembler and write a template like `a photo of $subject`.

Drag a row by its handle to reorder it, or onto another Context node to move it. Untick a row to switch it off without removing it.

## Tips

- Right-click a row for Edit, Duplicate, Hold across run, Push to library and more.
- **Hide from prompt** in a module's settings keeps its variable out of the prompt while later modules can still read it.
- Wire a **WP Debug** to the output to see exactly what each module picked.
- The manager's docs (**Docs** in the Wildcard Pipeline sidebar) explain every module in detail.
