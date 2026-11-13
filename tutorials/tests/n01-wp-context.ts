// Nodes 1: WP Context in depth. Rows run top to bottom, so a combine above what it reads comes out
// empty (Move to bottom fixes it). Inputs and outputs, the seed and its mode. The tick box. The row
// buttons shown working: a lock keeps Hair through a seed change, the globe hides $hair from the
// prompt while Subject still reads it. Edit for this node (a weight, the seed lock) → the mod mark,
// Push to library (cancelled), Reset overrides. Duplicate → a copy with its own variable ($hair_2). A second Context
// downstream; its own Role replaces the first one's. Hair dragged onto the second Context and back.
// A bundle on a node. The right-click menu. Drift: the library's Eyes changed through the API →
// drift mark → Refresh from library (the library is put back at the end); missing. Prompt-only.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N01",
  {
    title: "WP Context in depth",
    description: "Everything about the rows on a Context: order, lock, globe, editing a row for one node, duplicates, dragging rows between nodes, upstream Contexts, bundles, and keeping rows in sync with the library.",
    learn: "Run order, seed, the tick box, lock / globe / bin, Edit with weights and a seed lock, the mod / drift / missing marks, Push and Refresh from library, Duplicate, drag across Contexts, upstream Contexts, bundles, Hold across run.",
  },
  async (t) => {
    const page = t.page;
    const preview = (asm: string) => t.node(asm).locator('[data-test="asm-preview"]');
    const menuOn = async (ctx: string, name: string) => {
      await t.click(t.moduleRow(ctx, name).locator(".wp-module-name"), { right: true });
      await t.beat(600);
      return page.getByRole("menu").last();
    };
    const previewHas = async (asm: string, re: RegExp, what: string) => {
      for (let i = 0; i < 20; i++) {
        if (re.test(await preview(asm).innerText().catch(() => ""))) return;
        await t.beat(300);
      }
      throw new StepError(`The Assembler preview never showed ${what}.`);
    };

    const n = await t.h.step("Rows run top to bottom", async () => {
      await t.go("/");
      await t.speedUp();
      const ctx = await t.addNode("WP Context", { x: 480, y: 170 });
      // Subject first, on purpose: it reads $role, $hair and $eyes, which come after it.
      await t.pickModules(ctx, ["Subject", "Role", "Hair", "Eyes"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $subject");
      await t.press("Escape");
      await t.beat(800);
      await t.normalSpeed();
      await t.say("A Context runs its rows from top to bottom, like a recipe. Here Subject sits first, and it joins the role, the hair and the eyes.");
      await t.waitVoice();
      await t.callout("prev", preview(asm), "Subject ran too early", 6);
      await t.say("But when Subject ran, nothing below it had rolled yet, so it came out with empty gaps.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("Right-click Subject, and Move to bottom.");
      const menu = await menuOn(ctx, "Subject");
      await t.click(menu.getByRole("menuitem", { name: "Move to bottom" }));
      await t.beat(900);
      await previewHas(asm, /with .+ and .+/, "a full subject");
      await t.callout("prev", preview(asm), "Now it has everything", 6);
      await t.say("Now it runs last and reads all three. A rule, a combine or a constraint goes below the lists it reads.");
      await t.waitVoice();
      await t.uncallout("prev");
      const handle = t.moduleRow(ctx, "Role").locator(".wp-drag-handle");
      await t.callout("handle", handle, "Drag to reorder", 4);
      await t.say("You can also drag a row by its handle. Drop it on another Context to move it there.");
      await t.waitVoice();
      await t.uncallout("handle");
      return { ctx, asm };
    });

    await t.h.step("Inputs and outputs", async () => {
      await t.callout("out", t.node(n.ctx), "context (out)", 5);
      await t.say("context (out) carries every variable on, into an Assembler, a WP Debug, or another Context. upstream (in) is the other end: a Context, an Injector, Model Info, Toggles or a Loop to build on. We'll chain one in a moment.", "The context output carries every variable on, into an Assembler, a WP Debug, or another Context. Upstream is the other end: a Context, an Injector, Model Info, Toggles or a Loop to build on. We'll chain one in a moment.");
      await t.waitVoice();
      await t.uncallout("out");
      const seed = t.node(n.ctx).locator('[data-widget-name="seed"]');
      await t.callout("seed", seed, "Decides every pick", 4);
      await t.say("seed decides every random pick in this node. Type 42, and every row rolls again.", "Seed decides every random pick in this node. Type 42, and every row rolls again.");
      await t.fill(seed.locator("input").first(), "42", { cps: 10 });
      await t.press("Tab");
      await t.beat(1000);
      await t.waitVoice();
      await t.uncallout("seed");
      const mode = t.node(n.ctx).locator('[data-widget-name="control_after_generate"]');
      if (await mode.isVisible().catch(() => false)) {
        await t.callout("mode", mode, "What happens after a run", 4);
        await t.say("Under it, what happens to the seed after each run: fixed keeps it, increment adds one, randomize rolls a new one. Fixed repeats the same prompt.");
        await t.waitVoice();
        await t.uncallout("mode");
      }
      await t.say("Add module, at the bottom, adds rows from your library: wildcards, fixed values, combines, rules, constraints and bundles.");
      await t.waitVoice();
    });

    await t.h.step("Switch a row off", async () => {
      const box = t.moduleRow(n.ctx, "Eyes").locator('[data-test="module-enabled"]');
      await t.callout("tick", box, "Off, but kept", 4);
      await t.say("The tick box switches a row off without removing it. Untick Eyes.");
      await t.click(box);
      await t.beat(800);
      await t.waitVoice();
      await t.uncallout("tick");
      await t.callout("prev", preview(n.asm), "No eyes this time", 6);
      await t.say("Eyes doesn't run, so Subject has nothing for them. WP Debug lists a switched-off row as skipped, and its settings stay for when you tick it again.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.click(box);
      await t.beat(600);
    });

    await t.h.step("The row buttons", async () => {
      const row = t.moduleRow(n.ctx, "Hair");
      const buttons = [row.locator('[data-test="row-action-lock"]'), row.locator('[data-test="row-action-internal"]'), row.locator('[data-test="row-action-remove"]')];
      await t.callout("btns", buttons, "Lock, globe, bin", 4);
      await t.say("Every row has three buttons: a lock, a globe and a bin. Try each one.");
      await t.waitVoice();
      await t.uncallout("btns");
      await t.say("Lock Hair, then change the seed to 7.");
      await t.click(row.locator('[data-test="row-action-lock"]'));
      await t.beat(600);
      const seed = t.node(n.ctx).locator('[data-widget-name="seed"] input').first();
      await t.fill(seed, "7", { cps: 10 });
      await t.press("Tab");
      await t.beat(1000);
      await t.waitVoice();
      await t.callout("prev", preview(n.asm), "Same hair, new everything else", 6);
      await t.say("The role and the eyes rolled again; the hair kept its pick. A lock holds one row while you reroll the rest. Click it again to let it roll.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.click(row.locator('[data-test="row-action-lock"]'));
      await t.beat(600);
      await t.say("Now the globe. Print the hair on its own as well: add comma, dollar hair to the template.");
      await t.click(t.node(n.asm).locator("textarea, [contenteditable='true']").first());
      await t.press("ControlOrMeta+End");
      await t.type(", $hair");
      await t.press("Escape");
      await t.beat(900);
      await t.waitVoice();
      await t.say("Click the globe on Hair.");
      await t.click(row.locator('[data-test="row-action-internal"]'));
      await t.beat(900);
      await t.callout("prev", preview(n.asm), "Hair still in the subject", 6);
      await t.say("Dollar hair now prints nothing, but Subject still has the hair. A hidden variable is for rules and combines to read, never printed on its own. Click it again to show it.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.click(row.locator('[data-test="row-action-internal"]'));
      await t.beat(600);
      await t.say("The bin removes the row. If the buttons crowd the node, the Display playground in Settings can show them only on hover.");
      await t.waitVoice();
    });

    await t.h.step("Edit a row for this node", async () => {
      await t.say("Right-click Eyes, and Edit. The changes you make here are for this node only; the library keeps its own.");
      const menu = await menuOn(n.ctx, "Eyes");
      await t.click(menu.getByRole("menuitem", { name: "Edit", exact: true }));
      await t.beat(1000);
      const dlg = page.getByRole("dialog").last();
      await dlg.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
        throw new StepError("The Eyes editor didn't open.");
      });
      await t.waitVoice();
      const weight = dlg.locator('[data-test="opt-weight"] input, input[data-test="opt-weight"]').first();
      await t.callout("w", weight, "Weight on this node", 4);
      await t.say("Give the first colour weight 5, so it comes up five times as often here.");
      await t.fill(weight, "5", { cps: 10 });
      await t.press("Tab");
      await t.beat(600);
      await t.waitVoice();
      await t.uncallout("w");
      const lock = dlg.locator('[data-test="runtime-lock"]');
      await t.say("Seed lock gives this row its own fixed seed, so it ignores the node's seed and rolls the same every time, with dice for a new one.");
      await t.click(lock);
      await t.beat(700);
      await t.callout("seed", [lock, dlg.locator('[data-test="runtime-seed"]')], "Its own seed", 4);
      await t.waitVoice();
      await t.uncallout("seed");
      await t.click(lock);
      await t.beat(500);
      await t.say("Save.");
      await t.click(dlg.locator('[data-test="wcm-save"]'));
      await t.beat(900);
      if (!(await t.moduleRow(n.ctx, "Eyes").locator(".wp-mod-badge--mod").count())) throw new StepError("Eyes didn't get the mod mark.");
      await t.callout("mod", t.moduleRow(n.ctx, "Eyes"), "Changed on this node", 4);
      await t.say("The row says mod: it differs from the library item now. The library and other workflows are untouched.");
      await t.waitVoice();
      await t.uncallout("mod");
      await t.say("To send the change back, right-click, Push to library. It shows what changes, and which saved bundles get it too. Cancel for now.");
      const m2 = await menuOn(n.ctx, "Eyes");
      await t.click(m2.getByRole("menuitem", { name: /^Push to library/ }));
      await t.beat(1000);
      await t.waitVoice();
      await t.click(page.locator('[data-test="ptl-cancel"]').last());
      await t.beat(600);
      await t.say("To drop the change instead, Edit, Reset overrides, confirm, and Save.");
      const m3 = await menuOn(n.ctx, "Eyes");
      await t.click(m3.getByRole("menuitem", { name: "Edit", exact: true }));
      await t.beat(900);
      const dlg2 = page.getByRole("dialog").filter({ has: page.locator('[data-test="wcm-save"]') }).last();
      await t.click(dlg2.locator('[data-test="wcm-clear-all"]'));
      await t.beat(500);
      // Reset overrides asks first ("Reset overrides?"): confirm it, or it stays open over the canvas.
      // The confirm sits inside the editor's dialog, so a role filter matched the editor and clicked a
      // field's own Reset: use the confirm's own button.
      await t.click(page.locator('[data-test="confirm-confirm"]').last());
      await t.beat(500);
      await t.click(dlg2.locator('[data-test="wcm-save"]'));
      await t.beat(800);
      await t.waitVoice();
    });

    await t.h.step("Duplicates", async () => {
      await t.say("Right-click Hair, and Duplicate.");
      const menu = await menuOn(n.ctx, "Hair");
      await t.click(menu.getByRole("menuitem", { name: "Duplicate", exact: true }));
      await t.beat(1000);
      await t.waitVoice();
      const rows = t.node(n.ctx).locator(".wp-module").filter({ has: page.locator(".wp-module-name", { hasText: /^\s*Hair\s*$/ }) });
      // The copy gets its own variable ($hair_2) and both rows a "#n of 2" chip: nothing is overwritten.
      const copy = rows.last().locator('[data-test="sibling-chip"]').locator("..");
      await t.callout("dup", copy, "Its own variable: $hair_2", 5);
      await t.say("The copy writes its own variable, dollar hair underscore 2, so it rolls a second hair of its own. The chips number the copies, one of two and two of two.");
      await t.waitVoice();
      await t.uncallout("dup");
      await t.say("Use it when a prompt needs two picks from one list, like two hair colours or two companions, and print dollar hair underscore 2 where the second one goes. Here one is enough, so remove it.");
      await t.waitVoice();
      await t.click(rows.last().locator('[data-test="row-action-remove"]'));
      await t.beat(800);
    });

    const ctx2 = await t.h.step("What comes from upstream", async () => {
      await t.say("Contexts chain. Add a second one and wire the first into its upstream.");
      // Below the gap between the first Context and the Assembler. Its lower rows sit under the caption in
      // the drag and bundle steps; 490 overlaps both nodes, and right of the Assembler pans the first
      // Context off screen. A setView zoom-out for those two steps is the way to improve it.
      const c2 = await t.addNode("WP Context", { x: 820, y: 640 });
      await t.wire(n.ctx, "context", c2, "upstream");
      await t.wire(c2, "context", n.asm, "context");
      await t.beat(800);
      await t.waitVoice();
      await t.callout("prev", preview(n.asm), "Everything from upstream", 6);
      await t.say("It starts with everything the first one made, so the Assembler, now after it, still prints the subject.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("Now give the second Context its own Role.");
      await t.pickModules(c2, ["Role"]);
      await t.beat(900);
      await t.waitVoice();
      const dot = t.moduleRow(c2, "Role").locator(".wp-conflict-badge").first();
      await t.callout("dot", dot, "Replaces the one upstream", 4);
      await t.say("The blue badge is information: this Role writes over the one from upstream. Amber means have a look. Neither ever stops a run. Hover a badge to read it.");
      await t.waitVoice();
      await t.uncallout("dot");
      await t.click(t.node(n.asm).locator("textarea, [contenteditable='true']").first());
      await t.press("ControlOrMeta+End");
      await t.type(", $role");
      await t.press("Escape");
      await t.beat(900);
      await t.callout("prev", preview(n.asm), "Two different roles", 6);
      await t.say("Subject was built upstream, with the first role. A later write changes $role, but it doesn't rebuild what was already made from it.");
      await t.waitVoice();
      await t.uncallout("prev");
      return c2;
    });

    await t.h.step("Drag a row to another Context", async () => {
      await t.say("Rows also move between Contexts. Drag Hair by its handle onto the second one.");
      const from = await t.centre(t.moduleRow(n.ctx, "Hair").locator(".wp-drag-handle").first());
      const rb = await t.moduleRow(ctx2, "Role").boundingBox();
      if (!rb) throw new StepError("The second Context's Role row isn't on screen.");
      await t.drag(from, { x: rb.x + 40, y: rb.y + rb.height - 4 });
      await t.beat(900);
      if (!(await t.moduleRow(ctx2, "Hair").count())) throw new StepError("Hair didn't move to the second Context.");
      await t.waitVoice();
      await t.callout("prev", preview(n.asm), "Subject lost its hair", 6);
      await t.say("Hair moved, settings and all. But it now rolls after Subject, which was made upstream, so Subject has no hair. Drag it back, above Subject.");
      await t.waitVoice();
      await t.uncallout("prev");
      const back = await t.centre(t.moduleRow(ctx2, "Hair").locator(".wp-drag-handle").first());
      const eb = await t.moduleRow(n.ctx, "Eyes").boundingBox();
      if (!eb) throw new StepError("The first Context's Eyes row isn't on screen.");
      await t.drag(back, { x: eb.x + 40, y: eb.y + 4 });
      await t.beat(900);
      if (!(await t.moduleRow(n.ctx, "Hair").count())) throw new StepError("Hair didn't come back to the first Context.");
      await t.say("Back where it reads in time. On a focused row, Control Shift and the arrows move it, and Control D duplicates it.");
      await t.waitVoice();
    });

    await t.h.step("A bundle on a Context", async () => {
      await t.say("A bundle adds several rows as one. Add the Look bundle to the second Context.");
      // Bundles have their own picker (Add Bundle), as in AI3; Add module lists only modules.
      await t.click(t.node(ctx2).locator('[data-testid="open-bundle-picker"]').first());
      await t.beat(700);
      await t.click(page.locator('[data-testid^="bundle-picker-row-"]').filter({ has: page.getByText("Look", { exact: true }) }).first());
      await t.beat(800);
      await t.waitVoice();
      await t.expandBundles(ctx2, "Look");
      await t.callout("b", t.bundleFrame(ctx2, "Look"), "Its rows, in order", 5);
      await t.say("Open it, and its children are rows like any other: lock one, switch one off, or edit one for this node only. Fold it to keep the node short.");
      await t.waitVoice();
      await t.uncallout("b");
      await t.foldBundle(ctx2, "Look");
      await t.say("When the library's bundle changes, the node says library updated. Right-click it, Reset to library snapshot, to take the new version.");
      await t.waitVoice();
    });

    await t.h.step("The right-click menu", async () => {
      await t.say("Right-click a row for the rest.");
      const menu = await menuOn(n.ctx, "Hair");
      await t.callout("menu", menu, "Everything else for this row", 8);
      await t.say("Edit opens it here. Hold across run keeps one pick for a whole batch or loop.");
      await t.waitVoice();
      await t.uncallout("menu");
      await t.click(menu.getByRole("menuitem", { name: "Hold across run" }));
      await t.beat(700);
      await t.callout("held", t.moduleRow(n.ctx, "Hair").locator('[data-test="mod-held"]'), "Held", 4);
      await t.say("The row says held. Every image of the next batch gets the same hair.");
      await t.waitVoice();
      await t.uncallout("held");
      const again = await menuOn(n.ctx, "Hair");
      await t.callout("menu", again, "Push, wrap, move", 8);
      await t.say("Push to library sends this node's changes back to the library item, for every workflow. Save to library, on a row the library doesn't have, adds it as a new item.");
      await t.waitVoice();
      await t.say("Wrap into new bundle turns rows into a bundle, and Move to top or bottom reorders them.");
      await t.waitVoice();
      await t.uncallout("menu");
      await t.click(again.getByRole("menuitem", { name: "Release hold" }));
      await t.beat(600);
      await t.deselect();
      if (!(await t.node(ctx2).isVisible())) throw new StepError("The second Context left the screen.");
    });

    let restore: (() => Promise<void>) | null = null;
    try {
    await t.h.step("Library sync: drift and missing", async () => {
      const id = await t.h.idOf("wildcards", "Eyes");
      const got = (await t.h.api(`/wp/api/modules/${id}`)).json as { payload?: { options?: unknown[] } } | null;
      const original = got?.payload;
      if (!original?.options) throw new StepError("Couldn't read Eyes from the library.");
      restore = async () => {
        await t.h.api(`/wp/api/modules/${id}`, { method: "PUT", body: { payload: original, propagate_to_bundles: false } });
      };
      await t.say("Every row remembers the library version it came from. Say the library's Eyes gets a new colour, from the manager or another workflow.");
      const changed = { ...original, options: [...original.options, { id: "5e1f0a9c", value: "silver eyes", weight: 1, sub_categories: [] }] };
      const r = await t.h.api(`/wp/api/modules/${id}`, { method: "PUT", body: { payload: changed, propagate_to_bundles: false } });
      if (r.status >= 300) throw new StepError(`The library refused the changed Eyes (${r.status}).`);
      const drift = t.moduleRow(n.ctx, "Eyes").locator(".wp-mod-badge--drift");
      await drift.waitFor({ state: "attached", timeout: 20_000 }).catch(() => {
        throw new StepError("Eyes never showed the drift mark.");
      });
      await t.waitVoice();
      await t.callout("drift", t.moduleRow(n.ctx, "Eyes"), "The library moved on", 5);
      await t.say("Within a few seconds the row says drift: the library item changed after it was added. The row keeps running its own copy until you decide.");
      await t.waitVoice();
      await t.uncallout("drift");
      await t.say("Right-click, Refresh from library, to take the new version.");
      const menu = await menuOn(n.ctx, "Eyes");
      await t.click(menu.getByRole("menuitem", { name: /^Refresh from library/ }));
      await t.beat(1000);
      await t.waitVoice();
      await t.say("The mark is gone, and silver eyes can come up now. With several drifted rows, the node offers to refresh them all at once.");
      await t.waitVoice();
      await t.say("Missing means the item isn't in your library at all, often in a workflow from someone else. The row still runs from its own copy; right-click, Save to library, to keep it.");
      await t.waitVoice();
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("When a run reaches the Context, it takes what came from upstream, rolls each ticked row in order on its own seed, and writes the variables into the context it passes on. The canvas preview runs the same rolls, so the Assembler shows them before you run.");
      await t.waitVoice();
      await t.say("Recipes: one Context per stage, like person, outfit, place, each with a Debug after it. A Context Loop before the first, for a set of frames. An Injector before it, so its rules can read a value from another node.");
      await t.waitVoice();
      await t.say("Gotchas: a rule above what it reads comes out empty, a later Context replaces a variable without rebuilding what was made from it, and a locked row ignores the seed until you unlock it.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Order your rows like a recipe, chain Contexts for stages, and use the badges to spot what writes over what. The Context page in the docs lists every marker.");
      await t.waitVoice();
    });
    } finally {
      await restore?.();
    }
  },
);
