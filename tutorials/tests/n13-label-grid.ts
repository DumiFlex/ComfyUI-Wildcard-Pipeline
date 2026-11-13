// Nodes 13: WP Label & Grid in depth (the depth standard: the job first, every port, every field
// changed on screen and run, how it works, recipes, gotchas).
// 1. The job, on the "Batches and grids" example: a sweep's labels Assembler, the XY plot it makes
//    (run only with showcase: nine images need a model).
// 2. A bare node on plain Empty Image stand-ins (a batch of four, no model, each run takes a second)
//    with typed labels in parts, so every field can be changed and run: Text and its tokens, Place,
//    Over image, alignment, Font and size, Colours, the GRID switch, Layout, Rows / Columns from label
//    parts and typed, Title, Spacing, cell width, grid Colours, Reset, the presets, the wired inputs.
// 3. Gotchas on the same scene, then recipes: Save Image after it, the Image Filter's labels in
//    "Pick and refine".
import { StepError } from "watchwright";
import { openExample, showcasing, tutorial, useCheckpoint } from "../tutorial.js";

const LABELS = [
  "portrait · warm light · seed 11",
  "portrait · cold light · seed 12",
  "full body · warm light · seed 13",
  "full body · cold light · seed 14",
];

tutorial(
  "N13",
  {
    title: "WP Label & Grid in depth",
    description: "Everything WP Label & Grid does: what to wire in and out, every label and grid setting run on screen, label parts as headers, XY plots, presets, and the nodes it works with.",
    learn: "Inputs and outputs, Text tokens, Place, Font, Colours, Layout, Rows and Columns from label parts or typed, Title, Spacing, presets, wired text inputs, Image Filter labels, Save Image.",
  },
  async (t) => {
    const page = t.page;
    const idOf = (type: string, title?: RegExp) =>
      page.evaluate(
        ([ty, re]) => {
          const nodes = (window.app?.graph?.nodes ?? []) as unknown as { type: string; id: number; title?: string }[];
          const rx = re ? new RegExp(re) : null;
          return String(nodes.find((n) => n.type === ty && (!rx || rx.test(n.title ?? "")))?.id ?? "");
        },
        [type, title?.source ?? ""] as const,
      );
    const setWidgets = (id: string, vals: Record<string, unknown>) =>
      page.evaluate(
        ([nid, v]) => {
          const g = window.app?.graph;
          const node = (g?.getNodeById(nid) ?? g?.getNodeById(Number(nid))) as { widgets?: { name: string; value: unknown }[] } | null | undefined;
          for (const w of node?.widgets ?? []) if (w.name in v) w.value = v[w.name];
          window.app?.canvas?.setDirty(true, true);
        },
        [id, vals] as const,
      );
    // A wire into a text input whose dot only shows on hover: drag it like a person, else connect it.
    const wireText = async (from: string, out: string, to: string, inp: string) => {
      try {
        await t.wire(from, out, to, inp);
      } catch {
        await page.evaluate(
          ([a, o, b, i]) => {
            type N = { inputs?: { name: string }[]; outputs?: { name: string }[]; connect(s: number, n: N, d: number): unknown };
            const g = window.app?.graph;
            const get = (id: string) => (g?.getNodeById(id) ?? g?.getNodeById(Number(id))) as unknown as N | null;
            const na = get(a);
            const nb = get(b);
            if (!na || !nb) return;
            na.connect((na.outputs ?? []).findIndex((x) => x.name === o), nb, (nb.inputs ?? []).findIndex((x) => x.name === i));
            window.app?.canvas?.setDirty(true, true);
          },
          [from, out, to, inp] as const,
        );
        await t.beat(500);
      }
    };

    // ---- 1. the job -------------------------------------------------------------------------------
    await t.h.step("What it's for", async () => {
      await t.go("/");
      await t.say("WP Label and Grid writes a caption on every image and lays a whole run out as one picture: a contact sheet, a before and after, or an XY plot with headers.");
      await openExample(t, "2 - Batches and grids");
      await useCheckpoint(t);
      await t.waitVoice();
      const labelsAsm = await idOf("WP_PromptAssembler", /grid labels/);
      if (labelsAsm) {
        const back = await t.zoomOn(labelsAsm, { scale: 0.9 });
        await t.callout("asm", t.node(labelsAsm), "One label per frame", 6);
        await t.say("In the Batches and grids example, a Context Loop sweeps three shots against three lights. This second Assembler writes each frame's label: the shot, a dot, the light.");
        await t.waitVoice();
        await t.uncallout("asm");
        await t.setView(back);
      }
      const lg = await idOf("WP_LabelGrid");
      if (!lg) throw new StepError("The example has no WP Label & Grid.");
      const back = await t.zoomOn(lg, { scale: 0.9 });
      await t.say("Label and Grid takes the nine images and those nine labels. Rows come from the first part of each label, columns from the second.");
      await t.waitVoice();
      await t.setView(back);
      if (showcasing(t)) {
        await t.say("Run it.");
        await t.fastForward(() => t.run(), 20);
        await t.click(page.locator('[data-test="bm-dock-row-5"]'));
        await t.beat(1500);
        await t.say("Shots down, lights across, each row and column headed, and a title on top. One picture that compares the whole run. That's the job.");
        await t.waitVoice();
      } else {
        await t.say("Run it, and you get one picture: shots down, lights across, each row and column headed, and a title on top.");
        await t.waitVoice();
      }
    });

    // ---- 2. a bare node -------------------------------------------------------------------------
    const n = await t.h.step("Inputs and outputs", async () => {
      await t.go("/");
      await t.speedUp();
      const img = await t.addNode("EmptyImage", { x: 230, y: 190 });
      await setWidgets(img, { width: 512, height: 512, batch_size: 4, color: 0x5b7fa6 });
      const text = await t.addNode("Text (Multiline)", { x: 230, y: 560 });
      const lg = await t.addNode("WP Label & Grid", { x: 760, y: 150 });
      await t.normalSpeed();
      await t.say("Now a bare one, on plain stand-in images so every change runs in a second. Empty Image makes a batch of four.");
      await t.wire(img, "IMAGE", lg, "images");
      await t.waitVoice();
      await t.callout("in", t.node(lg), "images: the only required input", 5);
      await t.say("images is the one input it needs. It takes one image, a batch, a list, or a list of batches, like a Context Loop's frames.");
      await t.waitVoice();
      await t.uncallout("in");
      await t.say("labels is text, one line per image. A label can have parts, split by a dot with a space on each side.");
      await t.click(t.node(text).locator("textarea").first());
      await t.type(LABELS.join("\n"), { cps: 30 });
      await t.press("Escape");
      await t.wire(text, "STRING", lg, "labels");
      await t.waitVoice();
      await t.say("Shot, light, and seed: three parts. The Image Filter's labels output, or an Assembler like the one in the example, fit straight in too.");
      await t.waitVoice();
      const back = await t.zoomOn(lg, { scale: 0.8, top: 110 });
      await t.callout("outs", t.node(lg), "images (out) and grid (out)", 6);
      await t.say(
        "Two outputs. images (out) gives every image back with its label drawn on, in the shape it came in: a batch stays a batch. grid (out) is all of them in one picture.",
        "Two outputs. Images gives every image back with its label drawn on, in the shape it came in: a batch stays a batch. Grid is all of them in one picture.",
      );
      await t.waitVoice();
      await t.uncallout("outs");
      await t.say("Run.");
      await t.run();
      const runLine = t.node(lg).locator('[data-test="lg-run"]');
      await runLine.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
        throw new StepError("Label & Grid shows no run line after the run.");
      });
      await t.callout("run", runLine, "What came in", 4);
      await t.say("The top line says what came in: one batch of four. The node also shows the grid itself, so it can end a branch on its own.");
      await t.waitVoice();
      await t.uncallout("run");
      return { img, text, lg, back };
    });

    const node = () => t.node(n.lg);
    const field = (test: string) =>
      node().locator(`input[data-test="${test}"], [data-test="${test}"] input, textarea[data-test="${test}"], [data-test="${test}"] textarea`).first();
    const select = (test: string) => node().locator(`select[data-test="${test}"], [data-test="${test}"] select`).first();
    const runAgain = async () => {
      await t.run();
      await t.beat(900);
    };
    const pickColour = async (test: string, hex: string) => {
      await t.click(node().locator(`[data-test="${test}"]`).first());
      await t.beat(500);
      await t.fill(page.locator(`[data-test="${test}-hex"]`).last(), hex, { cps: 14 });
      await t.press("Enter");
      await t.beat(300);
      await t.press("Escape");
      await t.beat(400);
    };

    await t.h.step("Label: Text and tokens", async () => {
      const tokens = node().locator('[data-test^="lg-token-"]');
      await t.callout("txt", [field("lg-template"), tokens.first().locator("..")], "Text, and its tokens", 6);
      await t.say("The LABEL half decides what each image shows. Text left empty draws the incoming label as it is. The tokens above it fill in numbers.");
      await t.waitVoice();
      await t.uncallout("txt");
      await t.fill(field("lg-template"), "{index} of {count}: {label}", { cps: 16 });
      await t.press("Tab");
      await runAgain();
      await t.say(
        "{index} counts across every image and {count} is how many there are. {frame} and {image} count inside each input item, which matters for a list of batches. A backslash n breaks the line.",
        "Index counts across every image and count is how many there are. Frame and image count inside each input item, which matters for a list of batches. A backslash n breaks the line.",
      );
      await t.waitVoice();
      await t.fill(field("lg-template"), "", { cps: 16 });
      await t.press("Tab");
      await t.beat(400);
    });

    await t.h.step("Label: Place", async () => {
      const place = node().locator('[aria-label="Label position"]');
      await t.callout("place", place, "Where the label goes", 5);
      await t.say("Place puts a strip above, below, left or right of each image. Below.");
      await t.click(node().locator('[data-test="lg-side-bottom"]'));
      await runAgain();
      await t.waitVoice();
      await t.uncallout("place");
      await t.say("Left or right suits long labels on tall images.");
      await t.click(node().locator('[data-test="lg-side-left"]'));
      await runAgain();
      await t.waitVoice();
      await t.say("Back on top, and switch on Over image: a see-through band over the picture instead of a strip, so the image keeps its size. It works above or below.");
      await t.click(node().locator('[data-test="lg-side-top"]'));
      await t.beat(400);
      await t.click(node().locator('[data-test="lg-over"]'));
      await runAgain();
      await t.waitVoice();
      await t.say("The last button draws no label at all, for a grid of bare images. Beside the font, three buttons line the text up left, centre or right.");
      await t.callout("none", node().locator('[data-test="lg-side-none"]'), "No label", 4);
      await t.waitVoice();
      await t.uncallout("none");
      await t.click(node().locator('[data-test="lg-over"]'));
      await t.beat(400);
    });

    await t.h.step("Label: Font and size", async () => {
      const box = node().locator('[data-test="lg-font"] input').first();
      await t.callout("font", node().locator('[data-test="lg-font"]'), "Any installed font", 5);
      await t.say("Font lists your system fonts, plus any you drop into the extension's fonts folder. Type to search.");
      await t.click(box);
      await t.type("Georgia", { cps: 14, rest: false });
      await t.beat(600);
      const option = page.getByRole("option").first();
      if (await option.isVisible().catch(() => false)) await t.click(option);
      else await t.press("Escape");
      await t.beat(500);
      await t.waitVoice();
      await t.uncallout("font");
      await t.say("Size left empty is automatic: a share of the image width, so a label reads the same at 512 pixels and at 4K. A number fixes it. Type 40.");
      await t.fill(field("lg-font-size"), "40", { cps: 10 });
      await t.press("Tab");
      await runAgain();
      await t.waitVoice();
    });

    await t.h.step("Label: Colours", async () => {
      await t.say("Colours: the text, and the strip or band behind it. Click a swatch for the colour square and a hex box. Make the text a warm yellow.");
      await pickColour("lg-text-color", "#ffd166");
      await runAgain();
      await t.waitVoice();
      await t.callout("strip", node().locator('[data-test="lg-label-color"]'), "Opacity, or None", 4);
      await t.say("The strip's colour also has an opacity, and None drops the strip, leaving only the text.");
      await t.waitVoice();
      await t.uncallout("strip");
    });

    await t.h.step("Grid: on or off, and Layout", async () => {
      await t.callout("grid", node().locator('[data-test="lg-grid"]'), "Make a grid", 4);
      await t.say("The GRID half lays everything out as one picture. Switched off, the node only labels the images, and grid (out) stays empty.", "The grid half lays everything out as one picture. Switched off, the node only labels the images, and the grid output stays empty.");
      await t.waitVoice();
      await t.uncallout("grid");
      await t.say("Layout decides the shape. Fill rows, with four columns, puts the batch in one row.");
      await t.choose(select("lg-arrange"), "fill");
      await t.fill(field("lg-columns"), "4", { cps: 10 });
      await t.press("Tab");
      await runAgain();
      await t.waitVoice();
      await t.say("All in one column stacks them instead.");
      await t.choose(select("lg-arrange"), "stack");
      await runAgain();
      await t.waitVoice();
      await t.say("Fit the run follows what comes in: a near-square sheet for one batch, a row for a few single images, and one row per frame for a list of batches. One row or one column per frame is for a Context Loop that makes a batch each frame.");
      await t.choose(select("lg-arrange"), "auto");
      await runAgain();
      await t.waitVoice();
    });

    await t.h.step("Grid: Rows and Columns", async () => {
      await t.callout("rc", [select("lg-rows-from"), select("lg-columns-from")], "Headers from label parts", 6);
      await t.say("Rows and Columns turn label parts into headers. After a run, each choice shows what that part held, so you can tell which part is which.");
      await t.waitVoice();
      await t.uncallout("rc");
      await t.say("Rows from part one, columns from part two.");
      await t.choose(select("lg-rows-from"), "part:1");
      await t.choose(select("lg-columns-from"), "part:2");
      await runAgain();
      await t.waitVoice();
      await t.say("Portrait and full body down, warm and cold light across. The parts that became headers leave the cell labels, so each cell keeps only its seed.");
      await t.waitVoice();
      await t.callout("lay", select("lg-arrange"), "Set by the label parts", 4);
      await t.say("Layout greys out: headers from label parts set the rows and columns themselves.");
      await t.waitVoice();
      await t.uncallout("lay");
      await t.say("Typed takes one header per line instead, for labels that don't say it. Columns: typed, Warm and Cold.");
      await t.choose(select("lg-columns-from"), "typed");
      await t.beat(400);
      await t.fill(field("lg-column-headers"), "Warm\nCold", { cps: 12 });
      await t.press("Tab");
      await runAgain();
      await t.waitVoice();
      await t.choose(select("lg-columns-from"), "part:2");
      await t.beat(400);
    });

    await t.h.step("Grid: Title, Spacing and Colours", async () => {
      await t.say("Title draws one line above the grid.");
      await t.fill(field("lg-title"), "Lighting test", { cps: 14 });
      await t.press("Tab");
      await t.waitVoice();
      await t.say("Spacing: the gap between cells, and the edge around the grid.");
      await t.fill(field("lg-gap"), "24", { cps: 10 });
      await t.press("Tab");
      await t.fill(field("lg-margin"), "48", { cps: 10 });
      await t.press("Tab");
      await t.waitVoice();
      await t.say("The last box is the cell width. Empty keeps each image's own size; a number scales every cell to it, which keeps the grid of a big run from getting huge.");
      await t.fill(field("lg-cell-width"), "256", { cps: 10 });
      await t.press("Tab");
      await t.waitVoice();
      await t.say("Colours: the grid's background, and the colour of the headers and the title. A dark background, white headers.");
      await pickColour("lg-background", "#1e1e2e");
      await pickColour("lg-header-color", "#ffffff");
      await runAgain();
      await t.waitVoice();
      const reset = node().locator('[data-test="lg-reset-style"]');
      await t.callout("reset", reset, "Back to the defaults", 4);
      await t.say("Reset puts spacing and these colours back.");
      await t.waitVoice();
      await t.uncallout("reset");
    });

    await t.h.step("Presets", async () => {
      const presets = node().locator('[aria-label="Grid presets"]');
      await t.callout("pre", presets, "The whole grid in one click", 6);
      await t.say("The buttons at the top of GRID set it all in one click: Fit the run, Sheet, Side by side, Frame rows, Frame columns, XY plot, and No grid.", "The buttons at the top of the grid half set it all in one click: Fit the run, Sheet, Side by side, Frame rows, Frame columns, XY plot, and No grid.");
      await t.waitVoice();
      await t.uncallout("pre");
      await t.say("XY plot picks the two label parts that change across the run, and skips one that's different on every image, like the seed. After a run, the panel lights up the preset that fits it.");
      await t.click(node().locator('[data-test="lg-preset-xy"]'));
      await runAgain();
      await t.waitVoice();
    });

    await t.h.step("Text from other nodes", async () => {
      await t.speedUp();
      const str = await t.addNode("Text (Multiline)", { x: 230, y: 900 });
      await t.click(t.node(str).locator("input, textarea").first());
      await t.type("Wired title", { cps: 30 });
      await t.press("Escape");
      await t.normalSpeed();
      await t.say("Every text field can come from another node instead. Wire a text box into title.");
      await wireText(str, "STRING", n.lg, "title");
      await t.beat(600);
      await t.waitVoice();
      const wired = node().locator('[data-test="lg-title-wired"]');
      if (await wired.isVisible().catch(() => false)) {
        await t.callout("w", wired, "From the wire", 4);
        await t.say("The Title box now says it comes from the wire.");
        await t.waitVoice();
        await t.uncallout("w");
      }
      await t.say(
        "label_text does the same for Text, and its tokens still work. row_headers and column_headers take one header per line, and replace their dropdowns. A list gives one entry per item.",
        "Label text does the same for Text, and its tokens still work. Row headers and column headers take one header per line, and replace their dropdowns. A list gives one entry per item.",
      );
      await t.waitVoice();
    });

    // ---- 3. gotchas and recipes ---------------------------------------------------------------------
    await t.h.step("Gotchas", async () => {
      await t.say("A few things that trip people up. Fewer label lines than images: the rest get no label. Delete the last line, and run.");
      const box = t.node(n.text).locator("textarea").first();
      await t.fill(box, LABELS.slice(0, 3).join("\n"), { cps: 60 });
      await t.press("Escape");
      await runAgain();
      await t.waitVoice();
      await t.say("The fourth cell has no seed, and no headers either. A single line, though, labels every image.");
      await t.waitVoice();
      await t.fill(box, LABELS.join("\n"), { cps: 60 });
      await t.press("Escape");
      await t.say("Parts split only on a dot with a space on each side. A full stop or a dash keeps the label in one piece, and the header lists stay empty.");
      await t.waitVoice();
      await t.say("And a part that's different on every image, like the seed, gives a header per image. Pick parts that repeat.");
      await t.waitVoice();
    });

    await t.h.step("Recipe: save what it makes", async () => {
      await t.speedUp();
      const save = await t.addNode("Save Image", { x: 1500, y: 150 });
      await t.normalSpeed();
      await t.say("Recipes. Save Image after grid (out) keeps the sheet. Wire images (out) to a second one to also keep every labelled image on its own.", "Recipes. A Save Image after the grid output keeps the sheet. Wire the images output to a second one to also keep every labelled image on its own.");
      await t.wire(n.lg, "grid", save, "images");
      await t.waitVoice();
      await t.say("The labelled images can also go on to an upscaler or a video node: they're plain images.");
      await t.waitVoice();
    });

    await t.h.step("Recipe: the Image Filter's picks", async () => {
      await t.say("In the Pick and refine example, the Image Filter's labels output goes straight into labels.");
      await openExample(t, "3 - Pick and refine");
      await t.waitVoice();
      const filter = await idOf("WP_ImageFilter");
      const lg = await idOf("WP_LabelGrid");
      if (!filter || !lg) throw new StepError("Pick and refine has no Image Filter or Label & Grid.");
      const back = await t.zoomOn(lg, { scale: 0.7 });
      await t.callout("pair", [t.node(filter), t.node(lg)], "labels into labels", 6);
      await t.say("Each pick arrives labelled with its frame and image, like hash three, dot, two, or the name you typed for it in the picker. So the contact sheet says which draft each pick was.");
      await t.waitVoice();
      await t.uncallout("pair");
      await t.say("With a Context Loop that makes a batch per frame, Frame rows puts each frame on its own row, headed hash one, hash two, and so on.");
      await t.waitVoice();
      await t.setView(back);
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for Label and Grid at the end of any run you want to compare: sweeps, loops, picks. Give it labels in parts, pick a preset, and adjust. The Label and Grid page in the docs lists every field.");
      await t.waitVoice();
    });
  },
);
