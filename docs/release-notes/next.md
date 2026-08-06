A much faster ComfyUI start, filters on two more editors, and a bulk-delete fix worth reading.

### Highlights

- **This extension was making ComfyUI slow to load, and it will clean up after itself on the next start.** Our frontend files carry a content hash in their names, so every release produced new filenames — and ComfyUI Manager installs an update by writing the new files over the old ones without removing what the new version no longer ships. Nothing ever deleted the previous version's files, so they piled up with every update.

  On a real install that had been updated a dozen times: **1,774 files taking 60 MB, where about 300 were live.** ComfyUI requests every JavaScript file an extension exposes when the page loads, so that install was fetching 237 of our chunks instead of 58 — nearly 10 MB, which was 42% of all extension code on that page and by a wide margin the largest single contributor to its load time.

  This release records what each build produces and deletes anything left over from an older version when ComfyUI starts. **No action needed — the first start after updating does the cleanup**, and it is conservative: only files this project's build system generates are ever removed. On the install measured above it freed 52 MB and removed 1,579 files.

- **Sourcemaps are no longer shipped.** They were being written on every build and included in the package, but never linked, so no browser had ever requested one — 22.5 MB of files that existed only to be ignored. Debug builds can still produce them.

- **"Select all" now means the rows you can see.** With a filter active, the header checkbox selected *every* row, not the filtered ones — so narrowing a list down to a handful, selecting all and deleting removed the whole list, most of it never on screen and with no warning. This affected the **wildcard** and **fixed-values** editors, and on wildcards it reached bulk weight and tag changes too: setting a weight on a filtered selection silently rewrote every option's weight, with no change in row count to hint at it. Select-all is now scoped to what the filter is showing, in both directions. If you have ever lost options or had a weight distribution flattened, this was why.

- **A constraint can no longer hold two rules for the same pair.** Adding the same source/target combination twice — say `rain → sandals` as both *exclude* and *boost ×3* — looked like two active rules, but only one ever applied: whichever came last in the list. Order decided the outcome, nothing showed you the order, and in the worst case a deliberate **exclude was silently thrown away** by a later duplicate. Saving or importing a constraint with a repeated pair is now refused, naming the pair so you know which one to remove. Existing constraints keep working exactly as before — nothing already in your library is rejected, and no generation changes.

- **Constraint exceptions and derivation rules have a filter bar.** The wildcard and fixed-values editors got one previously; these two did not, which was backwards — an exception list is routinely longer than the wildcard it filters. Type to narrow the list, with a count and a clear button.

  Rules keep their real numbers while filtered, so "Rule 5" stays Rule 5 instead of renumbering to 1, and editing or deleting a filtered row acts on that row rather than the one that happens to share its position.

- **The library-change check stopped re-downloading your whole library every five seconds.** Both the manager and the in-graph Context node watch for library edits made elsewhere, by polling a list of module hashes. That list was re-sent in full on every tick with no caching headers — 33 KB every five seconds on a real library, roughly **24 MB an hour per open tab**, sitting idle. Producing it also re-read and re-parsed every module payload in the database each time.

  The check now answers "nothing changed" with an empty response the browser already knows how to handle, and works that out from a cheap row count rather than by rebuilding the list. On a local install this was invisible; if you reach ComfyUI over Tailscale, a VPN or any metered connection, it was the largest thing this extension did.

- **The webfonts are no longer bundled into JavaScript.** Both fonts were being base64-encoded into a code file that ComfyUI had to download and parse *before* it could finish registering this extension's nodes — about 90 KB of JavaScript that was never really JavaScript. They are now ordinary font files the browser fetches on its own, in the background, while everything else carries on. Node registration no longer waits for them.

  Two things follow from that. Text appears sooner on a slow CPU, because 90 KB stopped going through the JavaScript parser. And the fonts now stay cached when you update — previously every release changed the code file they were hidden inside, so your browser re-downloaded them every time.

  Total download on a fresh install is roughly unchanged: the encoding overhead and the compression that undid it cancel out. The gain is in *when* the work happens, not how much of it there is.

<!-- /modal -->

### Upgrade notes

Nothing to do beyond updating. If the interface renders briefly in a system font on the first load after this update, that is the fonts arriving in the background as intended — it settles within a moment and does not recur.
