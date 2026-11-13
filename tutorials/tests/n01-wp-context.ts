// Nodes 1: WP Context in depth. Rows run top to bottom, so a combine above what it reads comes out
// empty (Move to bottom fixes it; a row's handle drags it, onto another Context too). The tick box
// switches a row off without removing it. The three row buttons. A second Context downstream starts
// with everything upstream; its own Role replaces the first one's (the blue info dot), and what was
// built upstream from the old value stays built. The right-click menu: Hold across run, Push vs
// Save to library, Wrap into bundle, Move. Prompt-only: no model. T09 already shows the seed modes,
// a lock, Edit for one node and the mod badge; 08 shows bundles.
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
      const dot = t.moduleRow(c2, "Role").locator(".wp-conflict-dot, .wp-conflict-badge").first();
      await t.callout("dot", dot, "Replaces the one upstream", 4);
      await t.say("The blue dot is information: this Role writes over the one from upstream. Amber means have a look. Neither ever stops a run. Hover a dot to read it.");
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

    await t.h.step("Outro", async () => {
      await t.say("Order your rows like a recipe, chain Contexts for stages, and use the dots to spot what writes over what. The Context page in the docs lists every marker.");
      await t.waitVoice();
    });
  },
);
