// Nodes 12: WP Image Filter in depth, on the "Pick and refine" example. Before the run: the filter's
// clip input (wired, so a prompt edit is re-encoded), its masks output into a Set Latent Noise Mask
// in front of the refine pass, and its labels output into Label & Grid. In the picker: picking, a
// label renamed, a prompt edited (✎), a mask painted with the brush, erase, lasso and fill, the
// sliders, Undo and the two mask views, Compare, Zoom, tucking the picker away and the waiting pill,
// Send to Loop, then Keep picked. After the run: only the masked face changed and the grid prints the
// new name. Last, the node's own settings (mode, Send picks as, timeout, extra slots, the sweep table).
// The run needs a model, so without showcase the video only walks the node.
import { StepError } from "watchwright";
import { jumpTo, openExample, showcasing, tutorial, useCheckpoint } from "../tutorial.js";

tutorial(
  "N12",
  {
    title: "WP Image Filter in depth",
    description: "Everything the Image Filter can do while a run waits: rename a pick, edit its prompt, paint a mask for a refine pass, compare and zoom, send picks back to the loop, and the node's own settings.",
    learn: "clip, masks and labels wiring, labels, prompt edits with and without clip, the mask painter (brush, erase, lasso, fill, size, hardness, strength, undo, views), Compare, Zoom, the waiting pill, Send to Loop, Mode, Send picks as, Timeout, extra slots.",
  },
  async (t) => {
    const page = t.page;
    const picker = page.locator('[data-test="image-filter-picker"]');
    const queueEmpty = async () => {
      const end = await t.h.waitUntil(
        async () => {
          const q = await t.h.api("/queue");
          const j = q.json as { queue_running?: unknown[]; queue_pending?: unknown[] } | undefined;
          return !!j && (j.queue_running?.length ?? 0) === 0 && (j.queue_pending?.length ?? 0) === 0;
        },
        { timeout: 10 * 60_000, interval: 500, what: "the run to finish" },
      );
      if (end !== "done") throw new Error("The run didn't finish.");
    };
    // A node of the example, by its type (and title, when the example has two).
    const find = (type: string, title?: string) =>
      page.evaluate(
        ({ type, title }) =>
          String(
            ((window.app?.graph?.nodes ?? []) as unknown as { type: string; id: number; title?: string }[]).find(
              (n) => n.type === type && (!title || n.title === title),
            )?.id ?? "",
          ),
        { type, title },
      );
    // Glides the canvas so these nodes all fit in the free part of the screen (no zoom past 0.8).
    const fit = async (ids: string[]) => {
      const view = page.viewportSize() ?? { width: 1920, height: 1080 };
      const area = { x: 340, y: 120, w: view.width - 400, h: view.height - 360 };
      const target = await page.evaluate(
        ({ ids, area }) => {
          const g = (window.app as unknown as { graph: { getNodeById(i: string | number): { pos: [number, number]; size: [number, number] } | null } }).graph;
          const boxes = ids.map((id) => g.getNodeById(id) ?? g.getNodeById(Number(id))).filter((n) => !!n);
          if (!boxes.length) return null;
          const l = Math.min(...boxes.map((n) => n.pos[0]));
          const tp = Math.min(...boxes.map((n) => n.pos[1] - 34));
          const r = Math.max(...boxes.map((n) => n.pos[0] + n.size[0]));
          const b = Math.max(...boxes.map((n) => n.pos[1] + n.size[1]));
          const scale = Math.min(0.8, area.w / (r - l), area.h / (b - tp));
          // Screen = (graph + offset) * scale: centre the box in the area.
          const ox = (area.x + (area.w - (r - l) * scale) / 2) / scale - l;
          const oy = (area.y + (area.h - (b - tp) * scale) / 2) / scale - tp;
          return { scale, offset: [ox, oy] as [number, number] };
        },
        { ids, area },
      );
      if (target) await t.setView(target);
      await t.beat(300);
    };
    // A stroke with the button held, through several points, at a hand's pace.
    const stroke = async (pts: { x: number; y: number }[]) => {
      const [first, ...rest] = pts;
      if (!first) return;
      await t.moveTo(first);
      await page.mouse.down();
      for (const p of rest) await t.moveTo(p, { speed: 1.6 });
      await page.mouse.up();
      await t.beat(400);
    };
    // Points on the detail image, as fractions of its box.
    const onImage = async (fx: number, fy: number) => {
      // While painting, the mask painter takes the image's place.
      const img = page.locator('[data-test="image-filter-mask"] .wp-ifm__canvas, [data-test="image-filter-detail-img"]').first();
      const box = await img.boundingBox({ timeout: 5_000 }).catch(() => null);
      if (!box) throw new StepError("The detail image isn't on screen.");
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };

    const filter = await t.h.step("Wire it up", async () => {
      await t.go("/");
      await t.say("Open the Pick and refine example from Templates. A loop drafts four looks of one person, and the Image Filter pauses the run so you pick.");
      await openExample(t, "3 - Pick and refine");
      await useCheckpoint(t);
      await t.waitVoice();
      const id = await find("WP_ImageFilter");
      if (!id) throw new StepError("The example has no Image Filter.");
      await t.zoomOn(id, { scale: 0.9 });
      await t.callout("clip", t.node(id).locator('[data-slot-key$="-in-10"]').first(), "clip: re-encodes edits", 6);
      await t.say("Every input has a matching output, sliced to your picks. clip is the one without: wire your CLIP here, and a prompt you edit in the picker is encoded again.");
      await t.waitVoice();
      await t.uncallout("clip");
      return id;
    });

    if (!showcasing(t)) {
      await t.h.step("The picker", async () => {
        await t.say("When you run it, the picker opens with every draft. You can rename a pick, edit its prompt, paint a mask for the refine pass, and send your picks back to the loop.");
        await t.waitVoice();
      });
    } else {
      await t.h.step("Masks and labels out", async () => {
        const up = await find("LatentUpscaleBy");
        const refine = await find("KSampler", "KSampler · refine");
        const grid = await find("WP_LabelGrid");
        if (!up || !refine || !grid) throw new StepError("The example's refine pass or grid wasn't found.");
        await t.say("Two more wires. A Set Latent Noise Mask in front of the refine pass, so it only changes what you paint.");
        // Both ends of every wire on screen at once, clear of the bookmark dock on the left and the
        // caption at the bottom: a wire dragged to a node off screen drops on empty canvas.
        await fit([filter, up, refine]);
        const box = await t.node(refine).boundingBox();
        const mask = await t.addNode("Set Latent Noise Mask", { x: (box?.x ?? 900) + 120, y: (box?.y ?? 300) + (box?.height ?? 300) + 90 });
        await fit([filter, up, refine, mask]);
        await t.wire(up, "LATENT", mask, "samples");
        await t.wire(mask, "LATENT", refine, "latent_image");
        await t.wire(filter, "masks", mask, "mask");
        await t.waitVoice();
        await t.say("And the filter's labels output into Label and Grid, so the grid prints the names you give the picks.");
        await fit([filter, grid]);
        await t.wire(filter, "labels", grid, "labels");
        await t.beat(600);
        await t.waitVoice();
      });

      await t.h.step("Pick, and name a pick", async () => {
        await t.say("Run.");
        await t.click(page.getByRole("button", { name: "Run", exact: true }).first());
        await t.fastForward(() => picker.waitFor({ state: "visible", timeout: 10 * 60_000 }), 8);
        await t.beat(1200);
        await t.press("g");
        await t.beat(600);
        await t.say("Pick two drafts, then open the first in Detail.");
        await t.click(page.locator('[data-test="image-filter-tile-0-0"]'));
        await t.click(page.locator('[data-test="image-filter-tile-2-0"]'));
        await t.beat(500);
        await t.press("d");
        await t.beat(1000);
        await t.waitVoice();
        const label = page.locator('[data-test="image-filter-label"]');
        await t.callout("lab", label, "The labels output carries it", 2);
        await t.say("Each image has a label: frame, the swept values and the image number. Click it and call this one hero shot. Clear it to get the default back.");
        await t.click(label.locator("button").first());
        await t.beat(300);
        await page.keyboard.press("Control+A");
        await t.type("hero shot", { cps: 14 });
        await t.press("Enter");
        await t.beat(300);
        // Off the label, so the hand doesn't sit on the name while the line ends.
        await t.moveTo({ x: 960, y: 520 });
        await t.beat(300);
        await t.waitVoice();
        await t.uncallout("lab");
      });

      await t.h.step("Edit its prompt", async () => {
        await t.say("Prompt shows the text that made it, each part in its variable's colour. Click it to edit. Add a green scarf.");
        await t.click(page.locator('[data-test="image-filter-tab-prompt"]'));
        await t.beat(800);
        await t.click(page.locator('[data-test="image-filter-positive-marked"]'));
        await t.beat(400);
        const box = page.locator('[data-test="image-filter-positive"]');
        await t.click(box);
        await page.keyboard.press("Control+End");
        await t.type(", wearing a green scarf", { cps: 16 });
        await t.beat(600);
        await t.waitVoice();
        await t.say("With clip wired, the refine pass gets the new prompt encoded. Without it, a text only tag shows here: the text outputs change, the conditioning doesn't. The tile shows a pencil for an edited prompt.");
        await t.waitVoice();
      });

      await t.h.step("Paint a mask", async () => {
        await t.say("Mask paints the part the refine pass may change. Press M to paint.");
        await t.click(page.locator('[data-test="image-filter-tab-mask"]'));
        await t.beat(600);
        await t.press("m");
        await t.beat(700);
        await t.waitVoice();
        // Brush first, so the line and the first stroke start together.
        await t.click(page.locator('[data-test="image-filter-tool-brush"]'));
        await t.say("The brush paints. Go over the face.");
        const face = [[0.44, 0.22], [0.56, 0.22], [0.58, 0.32], [0.5, 0.38], [0.42, 0.32], [0.46, 0.27], [0.54, 0.28]] as const;
        await stroke(await Promise.all(face.map(([x, y]) => onImage(x, y))));
        await t.waitVoice();
        await t.say("X swaps to Erase, to take some away.");
        await t.press("x");
        await t.beat(400);
        await stroke([await onImage(0.57, 0.33), await onImage(0.6, 0.36)]);
        await t.press("x");
        await t.waitVoice();
        await t.say("Lasso fills what you draw around. Fill fills the area under the pointer, up to the lines you painted.");
        await t.click(page.locator('[data-test="image-filter-tool-lasso"]'));
        const loopPts = [[0.4, 0.45], [0.6, 0.45], [0.62, 0.55], [0.4, 0.56], [0.4, 0.45]] as const;
        await stroke(await Promise.all(loopPts.map(([x, y]) => onImage(x, y))));
        await t.waitVoice();
        await t.say("Undo with Ctrl Z.");
        await page.keyboard.press("Control+z");
        await t.beat(700);
        await t.click(page.locator('[data-test="image-filter-tool-brush"]'));
        await t.waitVoice();
        await t.callout("br", page.locator('[data-test="image-filter-brush"]'), "Size, hardness, strength", 4);
        await t.say("Size, with the square brackets too. Hardness softens the edge. Strength masks part-way, so inpainting changes that part less.");
        await t.waitVoice();
        await t.uncallout("br");
        await t.click(page.locator('[data-test="image-filter-paint"]'));
        await t.beat(700);
        await t.say("Done. Over image shows the mask as a tint, and Mask only shows it the way the masks output sends it.");
        await t.click(page.locator('[data-test="image-filter-mask-view-only"]'));
        await t.beat(1200);
        await t.waitVoice();
        await t.click(page.locator('[data-test="image-filter-mask-view-over"]'));
        await t.beat(500);
        await t.say("Images you don't paint get no mask, so the refine pass leaves them as they are.");
        await t.waitVoice();
      });

      await t.h.step("Compare and zoom", async () => {
        // The hand last clicked the mask view switch, which keeps the arrow keys: give the keys back to the picker.
        const focusPicker = () => page.locator('[data-test="image-filter-picker"]').evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
        await focusPicker();
        await t.say("C pins this image. Step to another with the arrow key, and the two sit side by side. C again to stop.");
        await t.press("c");
        await t.beat(500);
        await t.press("ArrowRight");
        await t.beat(1500);
        await t.waitVoice();
        await t.press("c");
        await t.beat(500);
        await t.say("Z is Zoom, only the picture: fit, a hundred or two hundred percent with the number keys, and a mini-map while you're in close.");
        await t.press("z");
        await t.beat(800);
        await focusPicker();
        await t.press("2");
        await t.beat(1500);
        await t.press("0");
        await t.beat(600);
        await t.waitVoice();
        await t.press("g");
        await t.beat(600);
      });

      await t.h.step("Tuck it away", async () => {
        await t.say("Need the canvas? The minus button tucks the picker away, or Escape from the grid. The run keeps waiting, and this pill opens it again. A chime and a dot in the tab's title tell you when a picker is waiting.");
        // Escape in Detail goes back to the grid first: the minus button tucks it from anywhere.
        await t.click(page.locator('[data-test="image-filter-minimize"]'));
        await t.beat(900);
        const pill = page.locator('[data-test="image-filter-pill"]');
        await t.callout("pill", pill, "Still waiting", 4);
        await t.waitVoice();
        await t.uncallout("pill");
        await t.click(pill);
        await t.beat(900);
      });

      await t.h.step("Send to Loop, and keep", async () => {
        const send = page.locator('[data-test="image-filter-send-loop"]');
        await t.callout("send", send, "Repeat only the keepers", 4);
        await t.say("Send to Loop locks the picked frames' seeds in the Context Loop and bypasses the rest, so the next Run makes only your keepers again.");
        await t.click(send);
        await t.beat(1000);
        await t.waitVoice();
        await t.uncallout("send");
        await t.say("Keep picked sends the two on.");
        await t.click(page.locator('[data-test="image-filter-keep-picked"]'));
        await t.fastForward(queueEmpty, 8);
        await jumpTo(t, 5);
        // The bookmark lands on the grid's top: fit the whole grid above the caption.
        const shown = await find("WP_LabelGrid");
        if (shown) await fit([shown]);
        await t.say("Only the painted face changed in the refine pass, with the green scarf, and the grid prints hero shot.");
        if (shown) await t.callout("grid", t.node(shown), "hero shot, with the scarf", 4);
        await t.waitVoice();
        if (shown) await t.uncallout("grid");
      });
    }

    await t.h.step("On the node", async () => {
      const back = await t.zoomOn(filter, { scale: 1 });
      const w = t.node(filter).locator('[data-test="image-filter-widget"]');
      await t.callout("mode", w.locator('[aria-label="Mode"]').first(), "Pause, reuse, or pass all", 4);
      await t.say("On the node: Pause and pick asks every run. Reuse last picks repeats your picks without asking, and Pass all lets everything through.");
      await t.waitVoice();
      await t.uncallout("mode");
      await t.callout("as", w.locator('[data-test="if-send-as"]').first(), "One batch, or one per image", 4);
      await t.say("Send picks as. Same shape keeps a frame's picks as one batch, and one prompt edit covers the frame. One per image sends each pick on its own, with its own copy of the prompt.");
      await t.waitVoice();
      await t.uncallout("as");
      await t.callout("to", w.locator('[data-test="if-timeout"]').first(), "For an unattended queue", 4);
      await t.say("Timeout keeps a queue moving while you're away: after it, keep all, keep the first, or stop the branch.");
      await t.waitVoice();
      await t.uncallout("to");
      // The node is taller than the screen at this zoom: bring its inputs (top) into view.
      await t.zoomOn(filter, { scale: 1, top: 140 });
      // The two slot rows (dot and name), as a pair.
      const exRow = (i: number) => t.node(filter).locator(`[data-slot-key$="-in-${i}"]`).first().locator("xpath=..");
      await t.callout("ex", [exRow(8), exRow(9)], "Any type, follows its frame", 6);
      await t.say("extra one and two take anything, like a ControlNet image, and it follows its frame through the filter.");
      await t.waitVoice();
      await t.uncallout("ex");
      await t.say("And when the loop sweeps two wildcards, the picker opens as a table, rows and columns by value, so you can pick a whole row at once.");
      await t.waitVoice();
      await t.setView(back);
    });

    await t.h.step("Outro", async () => {
      await t.say("Draft fast, pick by eye, fix what's close, and spend the time only on the keepers. The Image Filter page in the docs has every field.");
    });
  },
);
