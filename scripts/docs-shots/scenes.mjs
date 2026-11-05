/**
 * The docs node pictures (shoot.mjs). Each scene:
 *   image   file name under public/images/docs/ (no .png)
 *   node    the WP node the pins are for (its fields in node-fields.ts)
 *   from    example workflow to start from: "one" | "grids" | "pick" (else empty)
 *   build   `async (S, arg) => id`, run IN THE PAGE from its source text, so
 *           it can't use anything from this file: S is window.__shot
 *           (page-helper.js), arg is the scene's `arg`. Returns the pinned
 *           node's id.
 *   run     queue the graph before shooting
 *   height  picture height in px (644 / 752 / 860)
 *   groups  node-fields groups to pin (default ports + controls)
 */

const TOGGLES = {
  version: 1,
  mode: "any",
  group_var: "",
  rows: [
    { id: "a1000001", kind: "label", name: "Render", color: 5 },
    { id: "a1000002", kind: "toggle", name: "Hires fix", var: "hires", on: true, pin: true, out: 1, style: "switch" },
    { id: "a1000003", kind: "toggle", name: "Quick preview", var: "quick_preview", on: false, pin: true, out: 2, style: "check" },
    { id: "a1000005", kind: "toggle", name: "Detailer", var: "detailer", on: false, pin: false, out: 0, style: "switch", control: "mute" },
  ],
};

export const SCENES = [
  {
    image: "wp-toggles",
    node: "WP_Toggles",
    height: 860,
    run: true,
    arg: TOGGLES,
    build: async (S, cfg) => {
      const t = S.w(S.add("WP_Toggles"), 380);
      S.set(t, "wp_toggles", JSON.stringify(cfg));
      await S.wait(600);
      const det = S.w(S.add("PrimitiveString", { title: "Detailer prompt", widgets: { value: "detailed face" } }), 260);
      const on = S.w(S.add("PrimitiveString", { title: "Hires on", widgets: { value: "upscaled 2x, then refined" } }), 250);
      const off = S.w(S.add("PrimitiveString", { title: "Hires off", widgets: { value: "base size only" } }), 250);
      const sw = S.w(S.add("ComfySwitchNode"), 220);
      const p1 = S.w(S.add("PreviewAny", { title: "Preview as Text" }), 250);
      const p2 = S.w(S.add("PreviewAny", { title: "Preview as Text" }), 250);
      const p3 = S.w(S.add("PreviewAny", { title: "Preview as Text" }), 250);
      S.link(on, "STRING", sw, "on_true");
      S.link(off, "STRING", sw, "on_false");
      S.link(t, "toggle_1", sw, "switch");
      S.link(sw, "output", p1, "source");
      S.link(t, "toggle_1", p2, "source");
      S.link(t, "toggle_2", p3, "source");
      S.link(det, "STRING", t, "ctl_a1000005");
      await S.columns([[{ gap: 150 }, det], [{ gap: 40 }, t], [on, off, p2], [sw, p1, p3]]);
      return t.id;
    },
  },
  {
    image: "wp-context",
    node: "WP_Context",
    from: "one",
    groups: ["ports", "markers"],
    build: async (S) => {
      S.only([3, 5]);
      S.w(3, 440);
      S.w(5, 440);
      await S.columns([[3], [5]]);
      return 3;
    },
  },
  {
    image: "wp-context-injector",
    node: "WP_ContextInjector",
    from: "one",
    run: true,
    groups: ["ports", "rowOptions"],
    build: async (S) => {
      S.only([5, 13, 14, 15, 16, 10, 3]);
      S.link(16, "context", 10, "context");
      S.fold(3, 5);
      S.w(13, 320); S.w(14, 320); S.w(15, 320); S.w(16, 460); S.w(10, 440);
      await S.columns([[3, 5, 13, 14, 15], [{ gap: 60 }, 16], [{ gap: 60 }, 10]], { gapY: 20 });
      return 16;
    },
  },
  {
    image: "wp-context-loop-graph",
    node: "WP_ContextLoop",
    from: "grids",
    run: true,
    height: 860,
    build: async (S) => {
      S.only([3, 5, 6, 8]);
      const p = S.w(S.add("PreviewAny", { title: "Preview as Text" }), 320);
      S.link(8, "prompt", p, "source");
      S.fold(5, 6);
      S.w(3, 420); S.w(8, 400);
      await S.columns([[3], [5, 6, 8], [{ gap: 130 }, p]], { gapY: 20 });
      return 3;
    },
  },
  {
    image: "wp-seed-list",
    node: "WP_SeedList",
    from: "grids",
    run: true,
    build: async (S) => {
      S.only([3, 28]);
      S.mode(28, 0);
      const p = S.w(S.add("PreviewAny", { title: "Preview as Text" }), 300);
      S.link(28, "seed", p, "source");
      S.w(3, 420); S.w(28, 400);
      await S.columns([[3], [28], [p]]);
      return 28;
    },
  },
  {
    image: "wp-debug-viewer",
    node: "WP_Debug",
    from: "one",
    run: true,
    height: 860,
    groups: ["ports", "tabs"],
    build: async (S) => {
      S.only([3, 5, 10]);
      S.link(5, "context", 10, "context");
      S.fold(3);
      S.w(5, 440); S.w(10, 560);
      await S.columns([[3, 5], [{ gap: 56 }, 10]], { gapY: 20 });
      return 10;
    },
  },
  {
    image: "wp-prompt-assembler",
    node: "WP_PromptAssembler",
    from: "one",
    run: true,
    height: 860,
    build: async (S) => {
      S.only([3, 5, 7]);
      S.link(5, "context", 7, "context");
      const p1 = S.w(S.add("PreviewAny", { title: "Preview as Text · prompt" }), 360);
      const p2 = S.w(S.add("PreviewAny", { title: "Preview as Text · negative" }), 360);
      S.link(7, "prompt", p1, "source");
      S.link(7, "negative", p2, "source");
      S.fold(3, 5);
      S.w(7, 440);
      await S.columns([[3, 5], [7], [p1, p2]], { gapY: 20 });
      return 7;
    },
  },
  {
    image: "wp-prompt-cleaner",
    node: "WP_PromptCleaner",
    from: "one",
    run: true,
    height: 860,
    build: async (S) => {
      S.only([8]);
      const a = S.w(S.add("PrimitiveStringMultiline", { title: "Prompt", widgets: { value: "masterpiece, best quality, , 1girl, red hair, Red Hair, ((smile)), (, ), solo,, < lora : style : 0.8 >" } }), 340);
      const b = S.w(S.add("PrimitiveStringMultiline", { title: "Negative", widgets: { value: "lowres, bad hands, , lowres, red hair" } }), 340);
      const p1 = S.w(S.add("PreviewAny", { title: "Preview as Text · prompt" }), 340);
      const p2 = S.w(S.add("PreviewAny", { title: "Preview as Text · negative" }), 340);
      S.link(a, "STRING", 8, "prompt");
      S.link(b, "STRING", 8, "negative");
      S.link(8, "prompt", p1, "source");
      S.link(8, "negative", p2, "source");
      S.w(8, 440);
      await S.columns([[a, b], [8], [p1, p2]]);
      return 8;
    },
  },
];

/** Var → Int / Float / Choice: the example's Render Context, its model family
 *  given by a text into WP Model Info (no checkpoint needed), then the node. */
for (const [image, node, id, into, port, height] of [
  ["wp-var-to-int", "WP_VarToInt", 33, 25, "value", 644],
  ["wp-var-to-float", "WP_VarToFloat", 35, 26, "value", 752],
  ["wp-var-to-choice", "WP_VarToChoice", 36, 26, "choice", 752],
]) {
  SCENES.push({
    image,
    node,
    from: "one",
    run: true,
    height,
    arg: { id, into, port },
    build: async (S, a) => {
      S.only([31, 32, a.id, a.into]);
      const fam = S.w(S.add("PrimitiveString", { title: "Model family", widgets: { value: "sdxl" } }), 240);
      S.link(fam, "STRING", 31, "family");
      const p = S.w(S.add("PreviewAny", { title: "Preview as Text" }), 300);
      S.link(a.id, a.port, p, "source");
      S.fold(fam, 31, 32);
      S.w(a.id, 380); S.w(a.into, 300);
      await S.columns([[fam, 31, 32], [a.id], [a.into, p]], { gapY: 18 });
      return a.id;
    },
  });
}

SCENES.push(
  {
    image: "wp-var-to-bool",
    node: "WP_VarToBool",
    from: "grids",
    run: true,
    height: 752,
    build: async (S) => {
      S.only([12, 14, 15, 16, 17]);
      const p = S.w(S.add("PreviewAny", { title: "Preview as Text" }), 260);
      S.link(14, "value", p, "source");
      S.w(12, 380); S.w(14, 380); S.w(15, 260); S.w(16, 260); S.w(17, 240);
      await S.columns([[12], [14, 15], [p, 16, 17]], { gapY: 24 });
      return 14;
    },
  },
  {
    image: "wp-model-info",
    node: "WP_ModelInfo",
    from: "one",
    run: true,
    build: async (S) => {
      // No checkpoint in the shooting ComfyUI: the family comes in as text.
      S.only([31, 32, 33]);
      const fam = S.w(S.add("PrimitiveString", { title: "Model family", widgets: { value: "sdxl" } }), 240);
      S.link(fam, "STRING", 31, "family");
      const file = S.w(S.add("PrimitiveString", { title: "Checkpoint file", widgets: { value: "ponyDiffusionV6XL.safetensors" } }), 300);
      S.link(file, "STRING", 31, "name");
      const p = S.w(S.add("PreviewAny", { title: "Preview as Text" }), 240);
      S.link(33, "value", p, "source");
      S.w(31, 440);
      S.fold(32, 33, p);
      await S.columns([[{ gap: 40 }, fam, file], [31], [{ gap: 20 }, 32, 33, p]], { gapY: 18 });
      return 31;
    },
  },
  {
    image: "wp-node-group",
    node: "WP_NodeGroup",
    height: 752,
    arg: {
      version: 1, mode: "any", group_var: "",
      rows: [
        { id: "b2000001", kind: "toggle", name: "Detailer", var: "detailer", on: false, pin: false, out: 0, style: "buttons", control: "mute" },
        { id: "b2000002", kind: "toggle", name: "Upscale", var: "upscale", on: true, pin: false, out: 0, style: "switch" },
      ],
    },
    build: async (S, cfg) => {
      const dec = S.w(S.add("VAEDecode", { title: "Detailer decode" }), 260);
      const up = S.w(S.add("ImageScaleBy", { title: "Detail upscale" }), 320);
      const g = S.w(S.add("WP_NodeGroup"), 420);
      await S.wait(400);
      S.link(dec, "IMAGE", g, "node_1");
      await S.wait(400);
      S.link(up, "IMAGE", g, "node_2");
      const t = S.w(S.add("WP_Toggles"), 400);
      S.set(t, "wp_toggles", JSON.stringify(cfg));
      await S.wait(600);
      S.link(g, "nodes", t, "ctl_b2000001");
      await S.wait(600);
      await S.columns([[dec, up], [g], [t]]);
      return g.id;
    },
  },
  {
    image: "wp-mode-relay",
    node: "WP_ModeRelay",
    from: "one",
    build: async (S) => {
      S.only([22, 31, 32, 33, 34, 37, 38]);
      S.mode(31, 2);
      S.fold(22, 31, 32, 33, 34);
      S.w(38, 380); S.w(37, 400);
      await S.columns([[22, 31, { gap: 40 }, 32, 33, 34], [38], [37]], { gapY: 18 });
      return 38;
    },
  },
  {
    image: "wp-label-grid",
    node: "WP_LabelGrid",
    from: "grids",
    run: true,
    height: 860,
    groups: ["ports", "label", "grid"],
    build: async (S) => {
      S.only([3, 5, 6, 8, 10, 25]);
      const img = S.w(S.add("DocsDemoLandscape", { title: "Your images (stand-in for the sampler)", widgets: { width: 384, height: 384 } }), 300);
      S.link(8, "prompt", img, "text");
      S.link(img, "IMAGE", 25, "images");
      const prev = S.w(S.add("PreviewImage"), 420);
      S.link(25, "grid", prev, "images");
      S.fold(3, 5, 6, 8, 10, prev);
      S.w(25, 460);
      await S.columns([[3, 5, 6, 8, 10, { gap: 20 }, img, prev], [25]], { gapY: 16 });
      return 25;
    },
  },
  {
    image: "wp-image-filter",
    node: "WP_ImageFilter",
    from: "pick",
    run: true,
    height: 860,
    groups: ["ports", "settings"],
    answer: { action: "picks", picks: [[0, 0], [1, 1], [3, 0]] },
    build: async (S) => {
      S.only([3, 4, 5, 6, 7, 17]);
      const img = S.w(S.add("DocsDemoLandscape", { title: "Your images (stand-in for the sampler)", widgets: { width: 384, height: 384, count: 2 } }), 300);
      S.link(7, "prompt", img, "text");
      S.link(img, "IMAGE", 17, "images");
      const prev = S.w(S.add("PreviewImage"), 380);
      S.link(17, "images", prev, "images");
      S.fold(3, 4, 5, 6, 7);
      S.w(17, 460);
      await S.columns([[3, 4, 5, 6, 7, { gap: 20 }, img], [17], [prev]], { gapY: 16 });
      return 17;
    },
  },
  {
    image: "wp-note",
    height: 752,
    arg: [
      { title: "Load your model", cfg: { tone: "step", look: "card", step: 1, icon: "info-circle", color: "", text: "Pick the **checkpoint** in the loader. `$model_family` follows it, so the prompt fits the model.\n\n[WP Model Info](docs:wp-model-info){button pi-microchip}\n[Writing prompts for your model](docs:howto-model-prompts){button pi-file}" } },
      { title: "Lock before you compare", cfg: { tone: "icon", look: "card", step: 1, icon: "exclamation-triangle", color: "warning", text: "Lock the seed :pi-lock:{#f59e0b} before you compare two settings, or each run rolls new picks." } },
      { title: "Tip", cfg: { tone: "icon", look: "sticky", step: 1, icon: "lightbulb", color: "tip", text: "Right-click a wildcard row and pick **Test** to see 20 rolls at once." } },
      { title: "Label each frame", cfg: { tone: "step", look: "label", step: 2, icon: "info-circle", color: "", text: "A second **Assembler** writes `$outfit · $time` per frame; the Label & Grid reads them as rows and columns.\n\n[The grid](docs:wp-label-grid#s-the-grid){button pi-th-large}" } },
    ],
    build: async (S, notes) => {
      const made = notes.map(({ title, cfg }) => {
        const n = S.w(S.add("WP_Note", { title }), 420);
        S.set(n, "wp_note", JSON.stringify({ version: 1, bookmark: null, ...cfg }));
        return n;
      });
      await S.columns([[made[0], made[3]], [made[1], made[2]]], { gapY: 40 });
      return made[0].id;
    },
  },
  {
    image: "wp-bookmark",
    node: "WP_Bookmark",
    from: "one",
    height: 752,
    edit: true,
    scale: 0.85,
    build: async (S) => {
      S.only([26, 28]);
      S.w(26, 320);
      await S.columns([[26], [28]]);
      return 28;
    },
  },
);
