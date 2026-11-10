# Video tutorials

The tutorial videos, recorded by [Watchwright](https://github.com/DumiFlex/watchwright). Each test in `tests/` is one tutorial and one video. A test clicks through the real ComfyUI canvas and manager like a person would: it adds nodes from the search box, drags wires, types templates and presses Run. While it does, the video shows:

- a steady pointer that moves like a hand, with a ring where it clicks;
- a caption for each narration line;
- callout boxes around the part being talked about.

After the take, `render.mjs` adds a text-to-speech voice and writes the finished MP4, with subtitles and chapters.

| File | What it does |
|---|---|
| `pack.ts` | The Watchwright pack. It records in Chromium at 1920 × 1080 in dark mode, keeps a video of every take, and puts your library back afterwards (`../bench/lifecycle.ts`). |
| `tutorial.ts` | The presenter (`Tutor`): `say`, `click`, `drag`, `type`, `fill`, `scrollTo`, `go`, `callout`, `addNode`, `wire`, `pickModules`, `run`, `fastForward`, plus `showcase` for rendering real images. |
| `cursor.js` | The page script that draws the pointer, captions, callouts and the sync mark. |
| `library.json` | The library every take starts from: a small fantasy-portrait pack (Role, Hair, Eyes, Outfit, Setting, Time of day …, the rules between them and six bundles). It is written by `build_library.py`; edit that and run `python tutorials/build_library.py`, never the JSON. Viewers get the same file as `WP Tutorials library.json` next to the videos; T01 shows how to import it into an empty library. |
| `voice/speak.py` | Speaks every `t.say("…")` line into `voice/cache/` and writes `voice/lines.json`: Qwen3-TTS on a GPU (the narrator) or Kokoro-82M on the CPU. |
| `render.mjs` | Turns a take into `out/<id>-<title>.mp4`, `.srt` and `.chapters.txt`. |

## Make a video

1. **Voice.** The narrator is Qwen3-TTS 1.7B cloning Kokoro's `af_heart`. It needs a CUDA GPU (about 5 GB of VRAM): run `pip install qwen-tts kokoro-onnx soundfile` with a CUDA build of torch (optionally `faster-whisper` too, so each take is also checked by its words), then `python tutorials/voice/speak.py`. The first run downloads Kokoro (~350 MB, into `voice/models/`) and the Qwen3 model (~4.5 GB, from Hugging Face), and Kokoro speaks the reference into `voice/ref/`. Qwen3 now and then drifts on a line (runs on, mumbles, stops early), so each take is checked and spoken again with another seed; a line that fails every try gets Kokoro as a stand-in, is listed at the end, and is tried again on the next run. Voicing every line takes about an hour. Without a GPU, `--engine kokoro` speaks every line with Kokoro on the CPU in a few minutes. `--voice` picks the Kokoro voice (`af_heart` is the default; others are `af_bella`, `am_michael`, `bf_emma` and `bm_george`). It speaks only lines that are new or changed. Run it before recording, because each line's length decides how long the hands wait for the voice.
2. **Record.** Start ComfyUI with this extension on port 8189, or a clean one (see below). Add this folder as a pack in Watchwright (0.16 or newer), then start a run with the tutorials you want. Each take's video and `files/cues.json` land in its attempt folder. The pack asks for High quality at 60 frames a second, following the tab in front (`run` in `pack.ts`). Watchwright encodes each video after its take (the attempt page says **Finishing this video…**), and until then it keeps the raw frames, about 1 GB for three minutes, so leave room on the drive.
3. **Render.** Once the video is finished, run `node tutorials/render.mjs <attempt folder>`. It needs a full ffmpeg with libx264 and aac on `PATH` (or pass `--ffmpeg <path>`); Playwright's own ffmpeg can't do it, and one with zimg (`zscale`, in the usual full builds) converts the colours exactly. It writes 60 fps (`--fps 30` for smaller files) and turns Watchwright's full-range video into the limited range players expect. Each voice line is cleaned on the way in (rumble cut, light denoise, breaths in the pauses turned down 20 dB, a de-esser for Qwen3's fizz on every word); `--no-clean` leaves the lines as they are. The finished files go to `tutorials/out/`.

### Record on a clean ComfyUI

Other custom nodes add their own buttons, menus, badges and node colours to the canvas, and some change how it behaves, so the videos look different for everyone. Record on a second ComfyUI that loads only this extension. It uses the same install and models, but its own user folder, so its settings, open tabs and library are separate from the ComfyUI you work in. Your own ComfyUI keeps running.

```bash
# from the ComfyUI folder; the user folder must already exist; any empty folder will do
python main.py --port 8190 --disable-all-custom-nodes --whitelist-custom-nodes ComfyUI-Wildcard-Pipeline ComfyUI-Easy-Use --user-directory <empty folder>
```

The whitelist names are folder names in `custom_nodes`. ComfyUI-Easy-Use is only there for its Show Any node, which lists every frame of a loop (A05, A16); ComfyUI's Preview as Text shows one. Then start Watchwright with `WP_TUTORIALS_URL=http://127.0.0.1:8190/wp/` in its environment, so the pack records that ComfyUI instead of the one on 8189.

The pack's `reset` setting (on by default) loads `library.json` before the first tutorial, so every take shows the same items. Your library is backed up first and put back when the run ends, the same way the bench packs do it (see `../bench/README.md` › Putting your library back).

## Write a tutorial

```ts
import { tutorial } from "../tutorial.js";

tutorial("T07", { title: "Your next tutorial" }, async (t) => {
  await t.h.step("Add a Context node", async () => {
    await t.say("Double-click the canvas and search for WP Context.");
    const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
    await t.callout("ctx", t.node(ctx), "Your lists live here");
    await t.waitVoice();
    await t.uncallout("ctx");
  });
});
```

- `t.say(line)` shows the caption and returns right away, so the hands work while the voice speaks. The next `say` waits until the line has been spoken. Use `t.waitVoice()` to wait on purpose, for example to keep a callout up until its line ends. Each line must be a plain string literal so `speak.py` can find it. Write the caption the way it looks on screen (`library.json`, `$gear.SHOES`, `<lora:`): the voice reads it through `speak.py`'s `spoken_text` rules (`$role` as "role", "WP" as "W P", "LoRAs" as "loras", `library.json` as "library dot json", "2.22" as "two twenty-two"). When those don't fit, give the spoken words as a second string: `t.say("$gear.SHOES prints the shoe.", "Dollar gear dot shoes prints the shoe.")`. A line whose spoken text changes is spoken again.
- Every `t.h.step` becomes a chapter.
- `t.addNode(search, {x, y})` drops the node centred on that point. Leave the bottom 140 px free for the caption.
- Wrap a long wait in `t.fastForward(() => …)`, such as a model run. The video plays that part 6× faster.
- `addNode` sets new seeds to fixed, so what the video shows matches what the narration says.

### Pack settings

| Setting | Default | What it does |
|---|---|---|
| `reset` | on | Loads `library.json` before the first tutorial. |
| `showcase` | off | Ends each tutorial by rendering real images from its prompt (needs a GPU and the model below). Leave it off where no model is installed. |
| `unet`, `clip`, `clipType`, `vae` | Flux 3 Klein int8, `qwen3vl_4b_int8_convrot`, `flux3`, `flux2-vae` | The diffusion model the showcase loads, with its text encoder and VAE. It runs at cfg 1 with an empty negative, like Klein's own workflow, so negatives show in WP Debug but don't change the image. A missing file stops the take and lists the ones ComfyUI has. |
| `checkpoint` | empty | Load this checkpoint instead (an SDXL model, say) when `unet` is empty. Set `cfg` to about 5 with it. |
| `steps`, `cfg`, `width`, `height` | 12, 1, 1024, 1280 | The showcase sampler's steps and CFG, and the image size. |

The recording ComfyUI finds the Klein files in another install's models folder through `--extra-model-paths-config <yaml>`, passed to that ComfyUI only.

### More helpers

- `t.go("/wp/wildcards")` opens a manager page, or `t.go("/")` for an empty canvas. The load plays fast and the caption stays up.
- `t.fill(locator, text)` clicks a field, clears it and types, the way a person would.
- `t.scrollTo(locator)` wheel-scrolls the page until the target is near the top. `t.click` scrolls by itself when its target is off screen or under the caption.
- `t.pickModules(contextId, ["Role", "Setting"])` opens a Context node's picker, scrolls to each row and ticks it (in that order), then adds them.
- `if (showcasing(t)) await showcase(t, { from: assembler, preview, chain })` builds a folded checkpoint → sampler chain fed by the Assembler, adds a preview and runs it a few times, fast-forwarded. `between(i)` runs before each run after the first (change a seed, flip a toggle).

## Notes

- The screencast records CSS pixels, and the device scale factor doesn't change that. So the video is the size of the viewport: 1920 × 1080.
- Playwright's own action titles and fading pointer are off (`showActions: false`), because `cursor.js` draws a pointer that stays on screen.
- Record in Chromium. Firefox's screencast drops frames.
