// Nodes 15: WP Bookmark in depth (the depth standard). A Role Context and an Assembler; a bookmark
// "Prompt" at their top left with every field shown: icon (searched), colour, name, Lands at, Use this
// view, Zoom, the shortcut with the bolt and the clash check, Show on canvas, Pinned, Go, Done. A
// second one from the canvas menu. Jumping: the dock, the shortcut, Back, previous / next. The
// top-bar Bookmarks button. The dock's edit mode: drag the header to another spot of its 3×3 grid,
// reorder by the grips, the eye, Land clear of the dock, Bookmark this view. How it works, recipes,
// gotchas. New bookmarks start unpinned (#400). Frontend only: no model.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N15",
  {
    title: "WP Bookmark in depth",
    description: "Jump around a big workflow: every bookmark setting, the shortcut and its clash check, the Bookmarks dock and its edit mode, the top-bar button, and stepping through bookmarks like slides.",
    learn: "Icon, colour, name, Lands at, Use this view, Zoom, Shortcut, Show on canvas, Pinned, Go; the dock (Back, previous / next, edit mode, Land clear of the dock, Bookmark this view); the top-bar button; the commands.",
  },
  async (t) => {
    const page = t.page;
    const dock = page.locator('[data-test="bm-dock"]');
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
    // Done can lose its first click to the name field's blur: make sure the editor closed.
    const done = async (id: string) => {
      const btn = t.node(id).locator('[data-test="bm-done"]');
      for (let i = 0; i < 2 && (await btn.isVisible().catch(() => false)); i++) {
        await t.click(btn);
        await t.beat(900);
      }
      if (await btn.isVisible().catch(() => false)) {
        await btn.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
        await t.beat(800);
      }
    };

    await t.h.step("What it's for", async () => {
      await t.go("/");
      await t.say("In a big workflow you scroll around a lot. A bookmark brings you back to a spot in one click or one key.");
      await t.speedUp();
      const ctx = await t.addNode("WP Context", { x: 900, y: 420 });
      await t.pickModules(ctx, ["Role"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1500, y: 420 });
      await t.wire(ctx, "context", asm, "context");
      await t.normalSpeed();
      await t.waitVoice();
    });

    const bm = await t.h.step("Add a bookmark", async () => {
      await t.say("Add a WP Bookmark at the top left of the part you want. It has no frame: it opens straight in its editor. Name it Prompt.");
      const b = await t.addNode("WP Bookmark", { x: 480, y: 290 });
      await t.beat(600);
      await t.fill(titleOf(b), "Prompt", { cps: 14 });
      await t.beat(400);
      await t.waitVoice();
      await t.say("The button on the left picks its icon from the full list. Search for star.");
      await t.click(t.node(b).locator('[data-test="bm-icon"]'));
      await t.beat(700);
      const search = t.node(b).locator('[aria-label="Search icons"] input, input[aria-label="Search icons"]').first();
      if (await search.isVisible().catch(() => false)) {
        await t.fill(search, "star", { cps: 14 });
        await t.beat(600);
      }
      await t.click(t.node(b).locator(".wp-iconpick__cell").first());
      await t.beat(600);
      await t.waitVoice();
      await t.callout("col", t.node(b).locator('[data-test="bm-color"]'), "Colours the pill and its dock row", 4);
      await t.say("Beside it, the colour marks the pill and its row in the dock.");
      await t.waitVoice();
      await t.uncallout("col");
      return b;
    });

    await t.h.step("Where it lands", async () => {
      const grid = t.node(bm).locator('[data-test="bm-anchor-tl"]').locator("xpath=..");
      await t.callout("land", grid, "Where the bookmark sits after a jump", 5);
      await t.say("Lands at is a three by three grid: where the bookmark sits on screen after a jump. Top left puts this corner of your work at the top left of the free canvas, clear of the side panels and toolbars. Centre puts it in the middle.");
      await t.click(t.node(bm).locator('[data-test="bm-anchor-c"]'));
      await t.beat(600);
      await t.click(t.node(bm).locator('[data-test="bm-anchor-tl"]'));
      await t.beat(400);
      await t.waitVoice();
      await t.uncallout("land");
      await t.callout("view", t.node(bm).locator('[data-test="bm-use-view"]'), "This exact view", 4);
      await t.say("Use this view lands on the view on screen right now, at its zoom, instead of a grid spot.");
      await t.waitVoice();
      await t.uncallout("view");
      await t.callout("zoom", t.node(bm).locator('[aria-label="Zoom"]'), "Keep, or set a zoom", 4);
      await t.say("Zoom: keep current leaves your zoom alone. Set jumps to a zoom you choose, and the magnifier takes the one you're at.");
      await t.waitVoice();
      await t.uncallout("zoom");
    });

    let shortcut = "";
    await t.h.step("The shortcut", async () => {
      const rec = t.node(bm).locator('[data-test="bm-record"]');
      await t.callout("key", rec, "Its shortcut", 4);
      await t.say("A new bookmark gets the first free Alt shortcut, shown here. Click it and press other keys to record one: Escape cancels, Backspace clears.");
      await t.waitVoice();
      await t.uncallout("key");
      await t.callout("bolt", t.node(bm).locator('[data-test="bm-suggest"]'), "A free one", 4);
      await t.say("The bolt picks another free combination each time you press it.");
      await t.waitVoice();
      await t.uncallout("bolt");
      await t.say("Every key is checked against ComfyUI's shortcuts, other extensions, and other bookmarks. A clash shows a warning here and on the pill, so you can pick another.");
      await t.waitVoice();
      // Its keys are drawn as separate caps ("Alt 1"): join them the way Playwright names a chord.
      shortcut = ((await rec.innerText().catch(() => "")) || "").split(/[\s+]+/).filter(Boolean).join("+");
    });

    await t.h.step("Show on canvas, Pinned, Go and Done", async () => {
      await t.callout("vis", t.node(bm).locator('[data-test="bm-visible"]'), "Hide the pill", 4);
      await t.say("Show on canvas off hides the bookmark once you press Done: not drawn, not clickable. It still works from the dock and its key.");
      await t.waitVoice();
      await t.uncallout("vis");
      await t.callout("pin", t.node(bm).locator('[data-test="bm-pin"]'), "Can't be moved by accident", 4);
      await t.say("Pinned is ComfyUI's own pin. A new bookmark starts unpinned; pin it once it sits where you want it.");
      await t.waitVoice();
      await t.uncallout("pin");
      await t.say("Go tries the jump. Done closes the editor and leaves a small pill. Double-click the pill to edit it again.");
      await t.click(t.node(bm).locator('[data-test="bm-go"]'));
      await t.beat(1200);
      await done(bm);
      await t.waitVoice();
    });

    const bm2 = await t.h.step("Other ways to add one", async () => {
      await t.say("Right-click empty canvas, and Add WP Bookmark here. Name this one Output.");
      await t.click({ x: 1460, y: 820 }, { right: true });
      await t.beat(700);
      const before = await page.evaluate(() => (window.app?.graph?.nodes ?? []).map((n) => String(n.id)));
      const item = page.getByText("Add WP Bookmark here", { exact: true }).last();
      await item.waitFor({ state: "visible", timeout: 5000 }).catch(() => {
        throw new StepError("The canvas menu has no Add WP Bookmark here.");
      });
      await t.click(item);
      await t.beat(900);
      const after = await page.evaluate(() => (window.app?.graph?.nodes ?? []).map((n) => String(n.id)));
      const id = after.find((x) => !before.includes(x));
      if (!id) throw new StepError("No bookmark was added from the canvas menu.");
      await t.fill(titleOf(id), "Output", { cps: 14 });
      await done(id);
      await t.waitVoice();
      await t.say("Bookmark this view, in the dock's edit mode or as a command, adds one for the view on screen, at its zoom.");
      await t.waitVoice();
      return id;
    });

    await t.h.step("Jump back", async () => {
      await t.say("Now wander off somewhere else.");
      await pan(-1700, -900);
      await t.waitVoice();
      await t.callout("dock", dock, "The Bookmarks dock", 5);
      await t.say("The Bookmarks dock lists every bookmark in the workflow, with its number, icon and key. Click one to jump.");
      await t.waitVoice();
      await t.uncallout("dock");
      await t.click(page.locator('[data-test="bm-dock-row-0"]'));
      await t.beat(1500);
      await t.say("Or, from anywhere, press its shortcut.");
      await pan(1400, -700);
      await t.press(shortcut || "Alt+1");
      await t.beat(1500);
      await t.waitVoice();
      await t.callout("back", page.locator('[data-test="bm-dock-back"]'), "Where you were", 4);
      await t.say("Back returns to where you were before the last jump.");
      await t.click(page.locator('[data-test="bm-dock-back"]'));
      await t.beat(1500);
      await t.waitVoice();
      await t.uncallout("back");
    });

    await t.h.step("Step through them", async () => {
      const nav = [page.locator('[data-test="bm-dock-prev"]'), page.locator('[data-test="bm-dock-next"]')];
      await t.callout("nav", nav, "Previous and next", 4);
      await t.say("The arrows step through the bookmarks in dock order, like slides. Good for showing a workflow to someone.");
      await t.click(nav[1]);
      await t.beat(1400);
      await t.click(nav[1]);
      await t.beat(1400);
      await t.waitVoice();
      await t.uncallout("nav");
    });

    await t.h.step("Grid or list", async () => {
      const layout = page.locator('[data-test="bm-dock-layout"]');
      await t.callout("layout", layout, "Grid or list", 4);
      await t.say("The grid button shows the bookmarks as small tiles instead, four to a line, each with its icon in its colour and its key, so you find one by its icon.");
      await t.click(layout);
      await t.beat(900);
      await t.waitVoice();
      await t.uncallout("layout");
      const tile = page.locator('[data-test="bm-dock-tile-0"]');
      if (!(await tile.isVisible().catch(() => false))) throw new StepError("The dock shows no tiles after the grid button.");
      await t.say("Click a tile to jump. The list button brings the rows back, and the dock remembers which you picked.");
      await t.click(tile);
      await t.beat(1400);
      await t.waitVoice();
      await t.click(layout);
      await t.beat(700);
    });

    await t.h.step("The top-bar button", async () => {
      const btn = page.locator('button[aria-label="Bookmarks (Wildcard Pipeline)"]').first();
      if (!(await btn.isVisible().catch(() => false))) throw new StepError("The Bookmarks button isn't in the top bar.");
      await t.callout("top", btn, "Show or hide the dock", 4);
      await t.say("Up in the top bar, next to the Wildcard Pipeline button, the bookmark button shows or hides the dock.");
      await t.click(btn);
      await t.beat(900);
      await t.click(btn);
      await t.beat(900);
      await t.waitVoice();
      await t.uncallout("top");
    });

    await t.h.step("The dock's edit mode", async () => {
      await t.say("The pencil opens the dock's edit mode.");
      await t.click(page.locator('[data-test="bm-dock-edit"]'));
      await t.beat(900);
      await t.waitVoice();
      await t.say("Drag the dock by its header. It snaps to the nearest spot of a three by three grid on the free canvas, and a dashed outline shows where it will go.");
      const head = await t.centre(page.locator('[data-test="bm-dock-head"]'));
      const vp = page.viewportSize() ?? { width: 1920, height: 1080 };
      await t.drag(head, { x: 260, y: vp.height - 260 });
      await t.beat(1000);
      await t.waitVoice();
      await t.say("The grips reorder the bookmarks, which is the order the arrows step through. Move Output to the top.");
      const grips = dock.locator(".wp-sortable__grip");
      if ((await grips.count()) >= 2) {
        const from = await t.centre(grips.nth(1));
        const first = await grips.nth(0).boundingBox();
        if (first) await t.drag(from, { x: from.x, y: first.y + 2 });
        await t.beat(900);
      }
      await t.waitVoice();
      const eye = page.locator('[data-test="bm-dock-eye-0"]');
      await t.callout("eye", eye, "Show or hide on the canvas", 4);
      await t.say("The eye hides a bookmark on the canvas, like Show on canvas, and shows it again.");
      await t.click(eye);
      await t.beat(800);
      await t.click(eye);
      await t.beat(600);
      await t.waitVoice();
      await t.uncallout("eye");
      const clear = page.locator('[data-test="bm-dock-clear"]');
      await t.callout("clear", clear, "Jumps avoid the dock", 5);
      await t.say("Land clear of the dock, on by default, moves a jump out from under the dock, so the dock never covers what you jumped to. Off, bookmarks land exactly where they would without it, behind the see-through dock.");
      await t.waitVoice();
      await t.uncallout("clear");
      const add = page.locator('[data-test="bm-dock-add"]');
      const spots = page.locator('[aria-label="Where Bookmark this view puts the new bookmark on screen"]');
      await t.callout("add", [add, spots], "A bookmark for this view", 6);
      await t.say("Bookmark this view adds one for the view on screen. The three by three grid beside it picks where on screen the new bookmark sits. Pick the centre.");
      await t.click(page.locator('[data-test="bm-dock-spot-c"]'));
      await t.beat(500);
      await t.waitVoice();
      await t.uncallout("add");
      const rowsBefore = await dock.locator('[data-test^="bm-dock-row-"]').count();
      await t.say("Add it, and press Done.");
      await t.click(add);
      await t.beat(800);
      await t.click(page.locator('[data-test="bm-dock-done"]'));
      await t.beat(700);
      await t.waitVoice();
      const newRow = page.locator(`[data-test="bm-dock-row-${rowsBefore}"]`);
      if (!(await newRow.isVisible().catch(() => false))) throw new StepError("Bookmark this view added no row to the dock.");
      await t.say("Wander off, and jump to it: the view comes back exactly as it was.");
      await pan(1500, 800);
      await t.beat(600);
      await t.click(newRow);
      await t.beat(1500);
      await t.waitVoice();
    });

    await t.h.step("How it works", async () => {
      await t.say("A bookmark never runs and never reaches the prompt; it lives in the workflow, so it's saved and shared with it. A jump measures the free part of the screen, between the toolbar, the side panel and the bottom panel, and lands the same way every time, however often you press the key.");
      await t.waitVoice();
      await t.say("Pop-ups like the run progress, the error card or a toast never move the dock or a jump; they float over it.");
      await t.waitVoice();
    });

    await t.h.step("Recipes and gotchas", async () => {
      await t.say("Recipe one: a bookmark per stage, Alt 1 to Alt 5, left to right, then step through them to show the workflow. Recipe two: a WP Note can be a bookmark too, so a step's explanation is also a stop in the dock. Recipe three: hide a bookmark that clutters the canvas; the key still works.");
      await t.waitVoice();
      await t.say("Gotchas: a muted or bypassed bookmark shows off in the dock and its key does nothing. A bookmark inside a subgraph opens the subgraph when you jump. And the commands, next, previous, back, bookmark this view and show the dock, have no keys until you bind them in Settings, Keybinding.");
      await t.waitVoice();
      if (!(await t.node(bm2).count())) throw new StepError("The second bookmark is gone.");
    });

    await t.h.step("Outro", async () => {
      await t.say("Bookmark the spots you return to, give them keys, and step through them to show a workflow. The Bookmark page in the docs lists every setting.");
      await t.waitVoice();
    });
  },
);
