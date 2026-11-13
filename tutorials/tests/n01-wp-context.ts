// Nodes 1: WP Context in depth. Rows run top to bottom, so a combine above what it reads comes out
// empty (Move to bottom fixes it; a row's handle drags it, onto another Context too). The tick box
// switches a row off without removing it. The three row buttons. A second Context downstream starts
// with everything upstream; its own Role replaces the first one's (the blue info dot), and what was
// built upstream from the old value stays built. The right-click menu: Hold across run, Push vs
// Save to library, Wrap into bundle, Move. Prompt-only: no model. T09 already shows the seed modes,
// a lock, Edit for one node and the mod badge; 08 shows bundles. Depth pass (13/11): inputs and
// outputs with the seed and its mode, Add module, row markers, a bundle on a node, how it works,
// recipes and gotchas.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N01",
  {
    title: "WP Context in depth",
    description: "How a Context runs its rows: order, switching a row off, the row buttons and markers, what comes from upstream, and the right-click menu.",
    learn: "Run order, the tick box, lock / globe / bin, info and warning dots, upstream Contexts, Hold across run, Push vs Save to library, Wrap into bundle, Move.",
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
      const row = t.moduleRow(n.ctx, "Role");
      const buttons = [row.locator('[data-test="row-action-lock"]'), row.locator('[data-test="row-action-internal"]'), row.locator('[data-test="row-action-remove"]')];
      await t.callout("btns", buttons, "Lock, globe, bin", 4);
      await t.say("Every row has three buttons. The lock keeps the pick it rolled. The globe keeps its variable out of the prompt, for rules only. The bin removes the row.");
      await t.waitVoice();
      await t.uncallout("btns");
      await t.say("If they crowd the node, the Display playground in Settings can show them only on hover.");
      await t.waitVoice();
    });

    await t.h.step("Markers on a row", async () => {
      await t.say("A row can carry a small mark. mod: you changed the row on this node, so it differs from the library. drift: the library item changed after you added it; right-click, Refresh from library, to take the change.", "A row can carry a small mark. Mod: you changed the row on this node, so it differs from the library. Drift: the library item changed after you added it; right-click, Refresh from library, to take the change.");
      await t.waitVoice();
      await t.say("missing: the item isn't in your library, often in a workflow from someone else. The row still works from its own copy; right-click, Save to library, to keep it. held: Hold across run is on.", "Missing: the item isn't in your library, often in a workflow from someone else. The row still works from its own copy; right-click, Save to library, to keep it. Held: Hold across run is on.");
      await t.waitVoice();
    });

    const ctx2 = await t.h.step("What comes from upstream", async () => {
      await t.say("Contexts chain. Add a second one and wire the first into its upstream.");
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

    await t.h.step("A bundle on a Context", async () => {
      await t.say("A bundle adds several rows as one. Add the Look bundle to the second Context.");
      await t.pickModules(ctx2, ["Look"]);
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
  },
);
