The extension starts faster, especially on slower machines.

### Highlights

- **The webfonts are no longer bundled into JavaScript.** Both fonts were being base64-encoded into a code file that ComfyUI had to download and parse *before* it could finish registering this extension's nodes — about 90 KB of JavaScript that was never really JavaScript. They are now ordinary font files the browser fetches on its own, in the background, while everything else carries on. Node registration no longer waits for them.

  Two things follow from that. Text appears sooner on a slow CPU, because 90 KB stopped going through the JavaScript parser. And the fonts now stay cached when you update — previously every release changed the code file they were hidden inside, so your browser re-downloaded them every time.

  Total download on a fresh install is roughly unchanged: the encoding overhead and the compression that undid it cancel out. The gain is in *when* the work happens, not how much of it there is.

<!-- /modal -->

### Upgrade notes

Nothing to do beyond updating. If the interface renders briefly in a system font on the first load after this update, that is the fonts arriving in the background as intended — it settles within a moment and does not recur.
