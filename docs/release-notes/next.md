A faster start, filters on two more editors, and a bulk-delete fix worth reading.

### Highlights

- **"Select all" now means the rows you can see.** With a filter active in the fixed-values editor, the header checkbox selected *every* value, not the filtered ones — so narrowing a list of 40 down to 3, selecting all and deleting removed all 40, with 37 of them never on screen and no warning. It now selects only what the filter is showing. If you have ever lost values this way, this was why.

- **Constraint exceptions and derivation rules have a filter bar.** The wildcard and fixed-values editors got one previously; these two did not, which was backwards — an exception list is routinely longer than the wildcard it filters. Type to narrow the list, with a count and a clear button.

  Rules keep their real numbers while filtered, so "Rule 5" stays Rule 5 instead of renumbering to 1, and editing or deleting a filtered row acts on that row rather than the one that happens to share its position.

- **The webfonts are no longer bundled into JavaScript.** Both fonts were being base64-encoded into a code file that ComfyUI had to download and parse *before* it could finish registering this extension's nodes — about 90 KB of JavaScript that was never really JavaScript. They are now ordinary font files the browser fetches on its own, in the background, while everything else carries on. Node registration no longer waits for them.

  Two things follow from that. Text appears sooner on a slow CPU, because 90 KB stopped going through the JavaScript parser. And the fonts now stay cached when you update — previously every release changed the code file they were hidden inside, so your browser re-downloaded them every time.

  Total download on a fresh install is roughly unchanged: the encoding overhead and the compression that undid it cancel out. The gain is in *when* the work happens, not how much of it there is.

<!-- /modal -->

### Upgrade notes

Nothing to do beyond updating. If the interface renders briefly in a system font on the first load after this update, that is the fonts arriving in the background as intended — it settles within a moment and does not recur.
