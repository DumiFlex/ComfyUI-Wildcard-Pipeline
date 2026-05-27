# Docs image shopping list

Drop PNGs into the SPA public folder at `public/images/docs/`. DocImage resolves each path against the app base URL and swaps the placeholder for the real image automatically — the placeholder shows until the file exists.

## Resolution

The docs content column caps at **860 px wide** (`DocPage` `max-width: 860px`). For crisp display on HiDPI / retina screens, export each image at **2× = 1720 px wide**. 1× (860 px) works but looks soft on retina.

The **height** below matches each page's `DocImage` aspect ratio — capture/crop to that height so the real image doesn't shift the layout when it replaces the placeholder box. (The displayed `<img>` is `width: 100%` at natural aspect, so being a few px off is harmless — these are targets, not hard requirements.) PNG, sRGB. Capture the ComfyUI canvas / SPA editors at 2× device-pixel-ratio (or a 200 %-zoom browser screenshot) to hit 1720 px wide natively rather than upscaling.

Ratio → size cheat-sheet (all 1720 px wide):

| Ratio | Size (px) |
|-------|-----------|
| 16:5  | 1720 × 538 |
| 16:6  | 1720 × 645 |
| 16:7  | 1720 × 753 |
| 16:8  | 1720 × 860 |

## Overview

- [ ] `images/docs/introduction-graph.png` — `/docs/introduction` — **1720 × 645** (16:6) — A minimal finished graph: WP Context (with a subject wildcard) → WP Prompt Assembler → CLIP Text Encode → KSampler.
- [ ] `images/docs/quick-start-starter.png` — `/docs/quick-start` — **1720 × 753** (16:7) — The wildcard editor pre-filled with the 'subject' starter: name, $variable binding, and three options ready to save.
- [ ] `images/docs/quick-start-graph.png` — `/docs/quick-start` — **1720 × 645** (16:6) — The finished three-node graph: WP Context → WP Prompt Assembler → CLIP Text Encode, with the subject wildcard loaded in the context widget.

## How it connects

- [ ] `images/docs/context-chaining.png` — `/docs/context-chaining` — **1720 × 753** (16:7) — Two WP Context nodes chained: the first sets $subject and $style; the second overrides only $style. Show the PIPELINE_CONTEXT wire connecting them and the final $style value reaching the Assembler.
- [ ] `images/docs/constraints-matrix.png` — `/docs/constraints` — **1720 × 753** (16:7) — The constraint matrix editor open on a Constraint module, showing source subcategory rows, target subcategory columns, and mode/factor cells being filled in.
- [ ] `images/docs/conflicts-warning.png` — `/docs/conflicts-and-warnings` — **1720 × 645** (16:6) — A WP Context node in the canvas showing an advisory warning badge, and the WP Debug Warnings tab open alongside it listing the same warning with its message.
- [ ] `images/docs/bundles-concept.png` — `/docs/bundles-concept` — **1720 × 645** (16:6) — A collapsed bundle row in the module stack, showing its name and child count. The expand arrow reveals the individual modules inside.

## Nodes

- [ ] `images/docs/wp-context.png` — `/docs/wp-context` — **1720 × 645** (16:6) — A WP Context node showing the module-stack widget with a wildcard, a fixed value, and a combine module. Its context output connects to a WP Prompt Assembler.
- [ ] `images/docs/wp-context-loop-graph.png` — `/docs/wp-context-loop` — **1720 × 645** (16:6) — The WP Context Loop node wired in front of a WP Context → WP Prompt Assembler → KSampler chain, with its count set to 4. Show the node and its widget clearly.
- [ ] `images/docs/wp-context-loop-grid.png` — `/docs/wp-context-loop` — **1720 × 753** (16:7) — A 2×2 grid of four generated images, each captioned "frame 1 of 4" … "frame 4 of 4", showing $iteration count up while the rest of the prompt stays constant.
- [ ] `images/docs/wp-context-injector.png` — `/docs/wp-context-injector` — **1720 × 645** (16:6) — A WP Context Injector with two rows visible in the widget, each named and wired to an input socket. The context output connects to a WP Prompt Assembler.
- [ ] `images/docs/wp-prompt-assembler.png` — `/docs/wp-prompt-assembler` — **1720 × 753** (16:7) — The WP Prompt Assembler node showing the template field with $variable placeholders, the variable chip strip below it with each upstream binding listed, and the resolved preview text.
- [ ] `images/docs/wp-prompt-cleaner.png` — `/docs/wp-prompt-cleaner` — **1720 × 538** (16:5) — A before-and-after view: the raw assembled prompt on the left shows duplicate tags and stray commas; the cleaned output on the right has them removed.
- [ ] `images/docs/wp-debug-viewer.png` — `/docs/wp-debug` — **1720 × 860** (16:8) — The WP Debug viewer open on the Snapshot tab, showing a list of resolved $variables and their values. The tab strip shows Snapshot, Trace, Picks, and Warnings tabs.
- [ ] `images/docs/wp-debug-two.png` — `/docs/wp-debug` — **1720 × 538** (16:5) — A workflow with two WP Debug nodes — one wired after the first WP Context and one after the second — showing how each captures the pipeline state at that point.
- [ ] `images/docs/wp-var-to-int.png` — `/docs/wp-var-to-int` — **1720 × 538** (16:5) — The WP Var → Int node with its var_name picker open, showing the list of available $variables. Its INT output connects to the width input of an Empty Latent Image node.
- [ ] `images/docs/wp-var-to-float.png` — `/docs/wp-var-to-float` — **1720 × 538** (16:5) — The WP Var → Float node with its var_name picker open. Its FLOAT output connects to the cfg input of a KSampler node.
- [ ] `images/docs/wp-var-to-bool.png` — `/docs/wp-var-to-bool` — **1720 × 538** (16:5) — The WP Var → Bool node with its var_name picker showing a $hires_fix variable. Its BOOLEAN output connects to the enabled input of an upscaler node.

## Modules

- [ ] `images/docs/wildcard-editor.png` — `/docs/wildcard` — **1720 × 753** (16:7) — The wildcard option-pool editor open on a wildcard called $subject, showing three options ('a cat', 'a dog', 'a fox') each with a weight field and a sub-category chip.
- [ ] `images/docs/wildcard-constraint-order.png` — `/docs/wildcard` — **1720 × 645** (16:6) — A module stack showing a $weather wildcard, then a Constraint module, then a $mood wildcard. The Constraint sits between its source and target.
- [ ] `images/docs/fixed-values.png` — `/docs/fixed-values` — **1720 × 645** (16:6) — The Fixed Values editor showing two rows: 'style = oil painting' and 'quality = 8k, masterpiece', each with a name field, a value field, and an enable toggle.
- [ ] `images/docs/combine.png` — `/docs/combine` — **1720 × 753** (16:7) — The Combine editor showing a template field containing '$style portrait of $subject, $mood lighting', the detected $var chips listed below it, and the output variable set to $prompt_fragment.
- [ ] `images/docs/derivation.png` — `/docs/derivation` — **1720 × 753** (16:7) — A Derivation rule card open in the editor: an IF branch checking '$subject equals ocean' with an Append action on $mood, and an ELSE branch that does nothing.
- [ ] `images/docs/constraint-matrix.png` — `/docs/constraint` — **1720 × 753** (16:7) — The constraint matrix editor with a $weather wildcard as the source and $mood as the target. Cells in the grid show Boost, Reduce, Allow, or Exclude for each source-option / target-option pair.
- [ ] `images/docs/bundles.png` — `/docs/bundles` — **1720 × 645** (16:6) — A Context widget stack showing a collapsed bundle row labeled 'Portrait lighting kit' with a disclosure arrow. Below it, the same bundle expanded to reveal three child module rows inside.
