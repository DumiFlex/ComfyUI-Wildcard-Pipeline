// Tutorial 9: working in the Context node. The seed's after-run mode (randomize, fixed, +1),
// locking one item's seed, the right-click menu on a row, and changing an item for this node only
// in its edit view. Ends with the ? help over a selected node.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T09",
  {
    title: "Working in the Context node",
    description: "Seed modes, locking one item's seed, the right-click menu, and changing an item for one node without touching the library.",
    learn: "The seed's after-run modes, item seed locks, the row menu, per-node edits, and node help.",
  },
  async (t) => {
    const page = t.page;

    const nodes = await t.h.step("The seed", async () => {
      await t.go("/");
      await t.say("So far we rolled by clicking plus. The Context node can roll for you.");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Hero", "Outfit", "Setting"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero wearing $outfit, in $setting");
      await t.beat(800);
      const mode = t.node(ctx).getByRole("button", { name: /^(Randomize|Fixed|Increment|Decrement) Value$/ }).first();
      await t.callout("mode", mode, "What happens after a run", 6);
      await t.say("This button sets what the seed does after each run.");
      await t.waitVoice();
      await t.uncallout("mode");
      await t.click(mode);
      await t.beat(700);
      const choices = page.getByRole("radiogroup").last();
      await t.callout("choices", choices, "Fixed, +1, −1 or Randomize", 6);
      await t.say("Randomize gives every run a new seed. Fixed keeps the same one, and plus one steps through seeds in order, so you can come back to any of them.");
      await t.waitVoice();
      await t.uncallout("choices");
      await t.say("Pick Randomize, so every run rolls something new.");
      await t.click(page.locator('label[for$="-randomize"]').last());
      await t.beat(500);
      // addNode pins new nodes to Fixed underneath while the menu can still show Randomize, so a click
      // on the shown choice changes nothing: set the widget to match what the video shows.
      await page.evaluate((id) => {
        const node = window.app?.graph?.getNodeById(id) as { widgets?: { name: string; value: unknown }[] } | null | undefined;
        for (const w of node?.widgets ?? []) if (w.name === "control_after_generate") w.value = "randomize";
      }, ctx);
      // Escape doesn't close this popover; a click on empty canvas does.
      await t.click({ x: 960, y: 860 });
      await t.beat(400);
      return { ctx, asm };
    });

    const plus = t.node(nodes.ctx).getByRole("button", { name: /increment|increase|\+/i }).first();

    await t.h.step("Lock one item", async () => {
      await t.say("Like this hero? Lock it. The lock button keeps the seed it rolled.");
      const lock = t.moduleRow(nodes.ctx, "Hero").locator('[data-test="row-action-lock"]');
      await t.callout("lock", lock, "Lock this item's seed", 6);
      await t.click(lock);
      await t.waitVoice();
      await t.uncallout("lock");
      await t.say("Roll again. The hero stays, and the outfit and the setting keep changing.");
      for (let i = 0; i < 4; i++) {
        await t.click(plus);
        await t.beat(900);
      }
      await t.say("Click the lock again to let it roll.");
      await t.click(lock);
      await t.waitVoice();
    });

    await t.h.step("The row menu", async () => {
      await t.say("Right-click a row for everything else you can do with it.");
      const name = t.moduleRow(nodes.ctx, "Hero").locator(".wp-module-name");
      await t.click(name, { right: true });
      await t.beat(700);
      const menu = page.getByRole("menu").last();
      await t.callout("menu", menu, "Edit, hold, duplicate, move, remove", 8);
      await t.say("Edit it, hold it for a whole batch, push it to the library, duplicate it, wrap it into a bundle, or move it.");
      await t.waitVoice();
      await t.uncallout("menu");
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
    });

    await t.h.step("Change it for this node", async () => {
      const modal = page.getByRole("dialog").last();
      await t.say("Edit opens the item right here, with its options and their odds.");
      const thief = modal.locator('[data-test="opt-check"][aria-label="Use option a street thief"]');
      await t.callout("thief", thief, "Off for this node", 6);
      await t.say("Switch the street thief off. This change is only for this node: the Hero list in your library stays as it is.");
      await t.click(thief);
      await t.waitVoice();
      await t.uncallout("thief");
      const saves = [modal.locator('[data-test="wcm-save-lib"]'), modal.locator('[data-test="wcm-save"]')];
      await t.callout("saves", saves, "Library, or this node only", 6);
      await t.say("Save keeps it on this node. Save to library would change the list everywhere.");
      await t.waitVoice();
      await t.uncallout("saves");
      await t.click(saves[1]);
      await t.beat(900);
      const badge = t.moduleRow(nodes.ctx, "Hero").locator(".wp-mod-badge--mod");
      await t.callout("badge", badge, "Changed on this node", 6);
      await t.say("The badge marks a row that differs from the library. Reset overrides in the same window puts it back.");
      await t.waitVoice();
      await t.uncallout("badge");
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("Now press Run a few times. Randomize gives each run a new seed, no clicking needed.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1440, y: 150, width: 450, height: 780 }, chain: { x: 1820, y: 960 } });
        await t.callout("picks", t.node(dbg), "What this picture rolled");
        await t.say("Debug shows what each run rolled. No street thief, on this node.");
        await t.waitVoice();
        await t.uncallout("picks");
      });
    }

    await t.h.step("Help on every node", async () => {
      await t.say("Lost? Select any Wildcard Pipeline node and press the question mark above it.");
      const box = await t.node(nodes.ctx).boundingBox();
      if (box) await t.click({ x: box.x + box.width / 2, y: box.y + 14 });
      await t.beat(600);
      const help = page.locator(".wp-tb-icon--help").first().locator("xpath=ancestor::button[1]");
      await t.callout("help", help, "This node's help", 6);
      await t.click(help);
      await t.uncallout("help");
      await t.beat(1500);
      await t.say("Its help page opens right over the canvas.");
      await t.waitVoice();
      await t.press("Escape");
    });

    await t.h.step("Outro", async () => {
      await t.say("Roll on every run, lock what you like, and change an item for one node without touching your library. Next: make it look your way.");
    });
  },
);
