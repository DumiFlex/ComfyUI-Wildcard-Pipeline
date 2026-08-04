Full support for ComfyUI's Nodes 2.0 renderer, and a pass over everything to do with knowing where a value came from.

### Highlights

- **Every node works under Nodes 2.0.** ComfyUI's new Vue renderer changed how nodes are laid out, sized and scrolled, and our widgets were built against the old one. Nodes now render, resize, scroll and merge their wires correctly under both renderers — including switching between them with a workflow already open.
- **See where a variable or reference comes from.** Hover any `$var` or `@{ref}` chip and the card names the module that writes it, the node it lives in, and — for references — the pool it resolves against and how many options currently match. Variables produced by a Context Injector, by a sibling module, or by another node are all attributed instead of reading "binds at runtime".
- **The `@` and `$` pickers were rebuilt.** Rows carry an identity so two similarly-named entries are tellable apart, pools supplied by a node are marked as such, and the sub-category filter panel is redesigned — chips reflect the parsed expression, and exception values get a picker of real option values instead of a free-text box.
- **Wildcard options and fixed values became editable at scale.** A pinned search bar, tag filtering, drag-to-reorder, and bulk edit that can move rows to top or bottom and add or remove sub-categories across a selection.
- **Text editing in options no longer breaks.** Cut, paste and select-all could leave a field stuck, mangled, or typing into the wrong place, and a selection would skip over chips. Keystrokes also no longer escape a modal into ComfyUI's global shortcuts — pressing a plain letter could trigger a node-definition refresh and freeze the page.

<!-- /modal -->

<details>
<summary><b>Also in this release</b> — 20 smaller changes</summary>

**Library and organisation**

- Categories get an icon picker, and the icon follows the category everywhere it appears
- Export and import pickers gain cross-bucket search and per-row detail (`$variable`, option counts)
- Copy payload emits an importable envelope, stamped with its schema version
- Re-link matches bundles on child content rather than only a stored hash, and offers itself for modules that have no hash at all
- An unlinked bundle now reads as missing rather than modified, and reset-to-snapshot refuses to empty one

**Chips and references**

- Nested `@{uuid}` references are discovered even when written outside a wildcard payload
- Reference hovers name the pool they counted and flag drift against the library
- Wildcard option chips get the same hover card as every other surface
- Sub-category filter state is derived from the parsed expression, so the chips match what the filter actually does

**Editing and layout**

- Fixed-value and combine fields grow with their content, with a corner grip that stays reachable and a manual drag that overrides the auto height
- A scrollable field no longer hands its scroll to the page behind it
- Rule previews truncate with an ellipsis instead of being clipped or faded, and long values wrap
- Tag menus stay inside the viewport, keep their own scroll, and fold by axis
- Dropdowns say "type to filter", which they have always supported
- The save shortcut reads `Ctrl` on Windows and Linux instead of a Mac-only glyph
- Test-runner histogram rows are banded so a row reads across its columns, and its module picker survives duplicate names

**Performance and correctness**

- Canvas polling is roughly eight times cheaper on a large graph — the walkers now share one parse instead of re-parsing a 294 KB widget value ten times per node every cycle (~21% of a core down to ~2.6%)
- Wildcard snapshots refresh when the window regains focus instead of waiting out a timer, and expire so the canvas stops drifting from the library
- The Prompt Cleaner no longer rewrites `embedding:name` or `<lora:name:1.0>` references — punctuation stripping renamed embeddings ending in `_`, and fuzzy dedupe dropped one of two versioned files
- Variable override counts report writers rather than write statements, so a module that creates a variable is no longer described as overriding writes that never happened

</details>

<!--
HOW TO WRITE THIS FILE

Order, and nothing else:

  Headline                  one sentence, what this release is about
  ### Highlights            4-5 max
  <!- /modal ->             the update dialog stops rendering here
  <details> Also in this…   grouped one-liners, collapsed
  ### Upgrade notes         only when the reader must act; delete otherwise
                            — keep this OUTSIDE the <details>, it needs seeing

This file IS the release body — the compare link is appended automatically and
the per-commit list is deliberately not included. It is consumed at release
time and cleared afterwards, so anything left here ships.

RULES

1. Highlights are capped at 4-5. The cap is the mechanism: it is what keeps a
   6-commit release and an 80-commit release roughly the same height. If a
   sixth feels essential, something else was not a highlight.

2. A highlight passes one of three tests:
     - new capability — you can do something you could not before
     - wall removed   — something that blocked you now works
     - surprising     — behaviour changed in a way you should not meet alone
   Polish, truncation, layout and invisible perf fail all three.

3. Commit count is NOT a test. The categories icon picker was two commits and a
   real feature; `ui` was nine commits and almost entirely polish.

4. The tail is grouped by area, one line each, no bold-lead paragraphs. Group
   names are free-form — use whatever the release actually contains. It sits in
   a <details> so a long release does not double the page; put the count in the
   summary so the reader knows what they are opening. Note that collapsed text
   is not reliably reachable by browser find-in-page, which is the cost.

5. Write what changed for the user, not what changed in the code. Name the
   symptom, not the fix: "the field went blank" beats "guarded a null deref".

6. Perf belongs in the tail WITH its numbers, so the people it affects
   recognise themselves. "Performance improvements" tells nobody anything.
-->
