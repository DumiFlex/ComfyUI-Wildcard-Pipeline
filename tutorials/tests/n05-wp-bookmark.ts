// Nodes 5: WP Bookmark. A Role Context and an Assembler; a bookmark "Prompt" at their top left (where
// it lands, zoom, shortcut Alt+1); the view wanders off and comes back from the Bookmarks dock, then
// with Alt+1; a second bookmark, and the dock's previous / next.
import { tutorial } from "../tutorial.js";

tutorial(
  "N05",
  {
    title: "WP Bookmark",
    description: "Jump around a big workflow: bookmarks, the Bookmarks dock, shortcuts, and stepping through them like slides.",
    learn: "Where a bookmark lands, its zoom and shortcut, the Bookmarks dock, previous and next.",
  },
  async (t) => {
    const page = t.page;
    const titleOf = (id: string) => t.node(id).locator('input[data-test="bm-title"], [data-test="bm-title"] input').first();
    // Pans the canvas smoothly by (dx, dy) screen pixels, as a long drag would.
    const pan = async (dx: number, dy: number) => {
      await page.evaluate(
        ([x, y]) =>
          new Promise<void>((resolve) => {
            const c = window.app?.canvas as { ds: { offset: number[]; scale: number }; setDirty: (a: boolean, b: boolean) => void } | undefined;
            if (!c) return resolve();
            const from = [c.ds.offset[0] ?? 0, c.ds.offset[1] ?? 0];
            const start = performance.now();
            const tick = (now: number) => {
              const k = Math.min(1, (now - start) / 1100);
              const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
              c.ds.offset[0] = (from[0] ?? 0) + (x / c.ds.scale) * e;
              c.ds.offset[1] = (from[1] ?? 0) + (y / c.ds.scale) * e;
              c.setDirty(true, true);
              if (k < 1) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          }),
        [dx, dy],
      );
      await t.beat(500);
    };

    await t.h.step("A spot worth coming back to", async () => {
      await t.go("/");
      await t.say("In a big workflow you scroll around a lot. A bookmark brings you back to a spot in one click.");
      const ctx = await t.addNode("WP Context", { x: 900, y: 420 });
      await t.pickModules(ctx, ["Role"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1500, y: 420 });
      await t.wire(ctx, "context", asm, "context");
      await t.waitVoice();
    });

    let shortcut = "";
    await t.h.step("Add a bookmark", async () => {
      await t.say("Add a WP Bookmark at the top left of the part you want. Give it a name.");
      const bm = await t.addNode("WP Bookmark", { x: 480, y: 290 });
      await t.beat(600);
      await t.fill(titleOf(bm), "Prompt", { cps: 14 });
      await t.beat(400);
      await t.callout("land", t.node(bm).locator('[data-test="bm-anchor-tl"]').locator("xpath=.."), "Where it lands on screen", 5);
      await t.say("Lands at says where the bookmark sits on screen after a jump: top left here. Zoom can be set, or kept as it is.");
      await t.waitVoice();
      await t.uncallout("land");
      await t.callout("key", t.node(bm).locator('[data-test="bm-record"]'), "Its shortcut", 4);
      await t.say("Each bookmark gets a shortcut key, shown here. Press it to record another.");
      await t.waitVoice();
      await t.uncallout("key");
      // Its keys are drawn as separate caps ("Alt 1"): join them the way Playwright names a chord.
      shortcut = ((await t.node(bm).locator('[data-test="bm-record"]').innerText().catch(() => "")) || "").split(/[\s+]+/).filter(Boolean).join("+");
      await t.click(t.node(bm).locator('[data-test="bm-done"]'));
      await t.beat(900);
      await t.say("Done leaves a small pill on the canvas.");
      await t.waitVoice();
    });

    await t.h.step("Jump back", async () => {
      await t.say("Now wander off somewhere else.");
      await pan(-1700, -900);
      await t.waitVoice();
      await t.callout("dock", page.locator('[data-test="bm-dock"]'), "The Bookmarks dock", 5);
      await t.say("The Bookmarks dock lists every bookmark in the workflow. Click one to jump.");
      await t.waitVoice();
      await t.uncallout("dock");
      await t.click(page.locator('[data-test="bm-dock-row-0"]'));
      await t.beat(1500);
      await t.say("Or, from anywhere, press its shortcut.");
      await pan(1400, -700);
      await t.press(shortcut || "Alt+1");
      await t.beat(1500);
      await t.waitVoice();
    });

    await t.h.step("Step through them", async () => {
      await t.say("Add a second one, by the Assembler.");
      const bm2 = await t.addNode("WP Bookmark", { x: 1500, y: 860 });
      await t.beat(600);
      await t.fill(titleOf(bm2), "Output", { cps: 14 });
      await t.click(t.node(bm2).locator('[data-test="bm-done"]'));
      await t.beat(900);
      await t.say("With several, previous and next in the dock step through them in order, like slides. Good for showing a workflow to someone.");
      await t.callout("nav", [page.locator('[data-test="bm-dock-prev"]'), page.locator('[data-test="bm-dock-next"]')], "Previous and next", 4);
      await t.click(page.locator('[data-test="bm-dock-next"]'));
      await t.beat(1400);
      await t.click(page.locator('[data-test="bm-dock-next"]'));
      await t.beat(1400);
      await t.waitVoice();
      await t.uncallout("nav");
    });

    await t.h.step("Outro", async () => {
      await t.say("Bookmark the spots you return to, then jump with the dock or a shortcut. A note can be a bookmark too.");
    });
  },
);
