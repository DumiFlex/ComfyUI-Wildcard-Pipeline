// Video tutorials, recorded by Watchwright: each test is one tutorial and its video. A test drives
// the real ComfyUI canvas and manager with a visible pointer, captions and callouts (tutorial.ts),
// and saves its narration cues; render.mjs turns the take into the finished MP4 with the voice
// (voice/speak.py), subtitles and chapters. See README.md.
import path from "node:path";
import { pack } from "watchwright";
import { benchHelpers } from "../bench/bench.js";
import { lifecycleAfterTask, lifecycleSetup, lifecycleTasks, lifecycleTeardown } from "../bench/lifecycle.js";
import { cursorScript } from "./tutorial.js";

const fixture = (packDir: string) => path.join(packDir, "library.json");

// The ComfyUI the takes record. Set WP_TUTORIALS_URL before starting Watchwright to record a
// clean ComfyUI on another port (see README › Record on a clean ComfyUI).
const baseURL = process.env.WP_TUTORIALS_URL ?? "http://127.0.0.1:8189/wp/";

export default pack({
  name: "Wildcard Pipeline tutorials",
  description: "Records the video tutorials: the canvas and the manager clicked through with a steady pointer, captions and callouts, one video per tutorial.",
  // The bench's site key: a recording never runs while a bench run changes the library.
  site: { key: "wildcard-pipeline", baseURL },
  browser: {
    // Chromium: Firefox's screencast drops frames. 1920 × 1080 is the video's size, since the
    // screencast records CSS pixels (a device scale factor doesn't make it sharper).
    name: "chromium",
    viewport: { width: 1920, height: 1080 },
    context: { colorScheme: "dark" },
  },
  params: {
    reset: {
      type: "boolean",
      default: true,
      description: "Load the tutorial library (library.json) first, so every take starts from the same items. Your library is backed up first and put back after.",
    },
    putBack: { type: "boolean", default: true, description: "Put your library back when the run ends." },
    showcase: {
      type: "boolean",
      default: false,
      description: "End tutorials with real images: the prompt goes into a checkpoint and sampler and a few runs land on screen. Needs a GPU and the checkpoint below.",
    },
    unet: {
      type: "string",
      default: "flux3/flux3-image-klein-int8-convrot.safetensors",
      description: "A diffusion model in models/diffusion_models (Flux 3 Klein by default). When set, the showcase loads it with its own text encoder and VAE below, at cfg 1 with an empty negative; leave it empty to load the checkpoint instead.",
    },
    clip: { type: "string", default: "qwen3vl_4b_int8_convrot.safetensors", description: "The text encoder for the diffusion model, in models/text_encoders." },
    clipType: { type: "string", default: "flux3", description: "The CLIP loader's type for that text encoder." },
    vae: { type: "string", default: "flux2-vae.safetensors", description: "The VAE for the diffusion model, in models/vae." },
    checkpoint: {
      type: "string",
      default: "",
      description: "A checkpoint in models/checkpoints to load instead of the diffusion model (when unet is empty), e.g. an SDXL model.",
    },
    exampleCheckpoint: {
      type: "string",
      default: "juggernautXL_ragnarokBy",
      description: "The SDXL checkpoint the example workflows (E1-E4, N01, N02) load, since they are built on a checkpoint loader. The `checkpoint` param wins when it is set.",
    },
    steps: { type: "number", default: 12, description: "Sampler steps for the showcase (Klein: 8 to 16)." },
    cfg: { type: "number", default: 1, description: "CFG for the showcase (1 for Klein; about 5 for an SDXL checkpoint)." },
    width: { type: "number", default: 1024, description: "Image width for the showcase." },
    height: { type: "number", default: 1280, description: "Image height for the showcase." },
  },
  // One take per tutorial, every take keeps its video, no robot labels in the picture. High quality
  // (Watchwright 0.16+): JPEG 100 frames, every frame kept, encoded after the take; 60 fps so the
  // pointer (moved every 16 ms) glides; followVideo keeps the picture on whichever tab is in front.
  run: {
    video: "always", videoQuality: "high", videoFps: 60, followVideo: true,
    showActions: false, chapters: false, trace: "problems", pauseLimitMinutes: 5, testTimeout: 15 * 60_000,
  },
  helpers: benchHelpers,

  async setup(ctx) {
    const { h, context } = ctx;
    await context.addInitScript({ path: cursorScript(ctx.packDir) });
    h.page.on("dialog", (d) => void d.accept().catch(() => undefined));
    await h.visit("wildcards");
    await lifecycleSetup(ctx, { fixture });
  },
  teardown: lifecycleTeardown,
  afterTask: lifecycleAfterTask,
  tasks: lifecycleTasks(fixture),
});
