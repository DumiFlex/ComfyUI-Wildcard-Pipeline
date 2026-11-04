# Video tutorials

The tutorial videos, recorded by [Watchwright](https://github.com/DumiFlex/watchwright). Each test in `tests/` is one tutorial and one video. A test clicks through the real ComfyUI canvas and manager like a person would: it adds nodes from the search box, drags wires, types templates and presses Run. While it does, the video shows:

- a steady pointer that moves like a hand, with a ring where it clicks;
- a caption for each narration line;
- callout boxes around the part being talked about.

After the take, `render.mjs` adds a text-to-speech voice and writes the finished MP4, with subtitles and chapters.

| File | What it does |
|---|---|
| `pack.ts` | The Watchwright pack. It records in Chromium at 1920 × 1080 in dark mode, keeps a video of every take, and puts your library back afterwards (`../bench/lifecycle.ts`). |
| `tutorial.ts` | The presenter (`Tutor`): `say`, `click`, `drag`, `type`, `callout`, `addNode`, `wire`, `run`, `fastForward`. |
| `cursor.js` | The page script that draws the pointer, captions, callouts and the sync mark. |
| `library.json` | The library every take starts from (the example workflows' rows). |
| `voice/speak.py` | Speaks every `t.say("…")` line with Kokoro-82M into `voice/cache/` and writes `voice/lines.json`. |
| `render.mjs` | Turns a take into `out/<id>-<title>.mp4`, `.srt` and `.chapters.txt`. |

## Make a video

1. **Voice.** Run `pip install kokoro-onnx soundfile` once, then `python tutorials/voice/speak.py`. The first run downloads the model (~350 MB) into `voice/models/`. It speaks only lines that are new or changed. `--voice` picks another voice (`af_heart` is the default; others are `af_bella`, `am_michael`, `bf_emma` and `bm_george`). Run it before recording, because each line's length decides how long the hands wait for the voice.
2. **Record.** Start ComfyUI with this extension on port 8189. Add this folder as a pack in Watchwright, then start a run with the tutorials you want. Each take's video and `files/cues.json` land in its attempt folder.
3. **Render.** Run `node tutorials/render.mjs <attempt folder>`. It needs a full ffmpeg with libx264 and aac on `PATH` (or pass `--ffmpeg <path>`); Playwright's own ffmpeg can't do it. The finished files go to `tutorials/out/`.

The pack's `reset` setting (on by default) loads `library.json` before the first tutorial, so every take shows the same items. Your library is backed up first and put back when the run ends, the same way the bench packs do it (see `../bench/README.md` › Putting your library back).

## Write a tutorial

```ts
import { tutorial } from "../tutorial.js";

tutorial("T02", { title: "Make your own wildcard" }, async (t) => {
  await t.h.step("Add a Context node", async () => {
    await t.say("Double-click the canvas and search for WP Context.");
    const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
    await t.callout("ctx", t.node(ctx), "Your lists live here");
    await t.waitVoice();
    await t.uncallout("ctx");
  });
});
```

- `t.say(line)` shows the caption and returns right away, so the hands work while the voice speaks. The next `say` waits until the line has been spoken. Use `t.waitVoice()` to wait on purpose, for example to keep a callout up until its line ends. Each line must be a plain string literal so `speak.py` can find it. In a line, `$hero` is read as "hero" and "WP" as "W P".
- Every `t.h.step` becomes a chapter.
- `t.addNode(search, {x, y})` drops the node centred on that point. Leave the bottom 140 px free for the caption.
- Wrap a long wait in `t.fastForward(() => …)`, such as a model run. The video plays that part 6× faster.
- `addNode` sets new seeds to fixed, so what the video shows matches what the narration says.

## Notes

- The screencast records CSS pixels, and the device scale factor doesn't change that. So the video is the size of the viewport: 1920 × 1080.
- Playwright's own action titles and fading pointer are off (`showActions: false`), because `cursor.js` draws a pointer that stays on screen.
- Record in Chromium. Firefox's screencast drops frames.
