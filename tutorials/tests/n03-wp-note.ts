// Nodes 3: WP Note. A Role Context to explain; a Step card with a docs button and an add-to-library
// button; a Sticky warning with an icon; a Label with a shipped picture, read by hovering it; double
// click to edit again; "Also a bookmark" pointed at.
import { tutorial } from "../tutorial.js";

tutorial(
  "N03",
  {
    title: "WP Note",
    description: "Explain a workflow on the canvas: numbered steps, warnings, labels, links into the docs, pictures, and a button that adds the workflow's items to a library.",
    learn: "Tones and looks, colours, Markdown, docs links and buttons, pictures, labels, editing again.",
  },
  async (t) => {
    const textArea = (id: string) => t.node(id).locator('textarea[data-test="note-text"], [data-test="note-text"] textarea').first();
    const title = (id: string) => t.node(id).locator('input[data-test="note-title"], [data-test="note-title"] input').first();

    await t.h.step("Something to explain", async () => {
      await t.go("/");
      await t.say("Here's a Context with Role. Someone opening this workflow might not know where to start, so leave them a note.");
      const ctx = await t.addNode("WP Context", { x: 1400, y: 200 });
      await t.pickModules(ctx, ["Role"]);
      await t.waitVoice();
    });

    const step = await t.h.step("A step", async () => {
      await t.say("Add a WP Note. It opens in its editor. Step tone numbers it, Card is the look, and the colour is yours.");
      const note = await t.addNode("WP Note", { x: 420, y: 170 });
      await t.beat(600);
      await t.click(t.node(note).locator('[data-test="note-tone-step"]'));
      await t.beat(300);
      await t.click(t.node(note).locator('[data-test="note-color-tip"]'));
      await t.beat(300);
      await t.fill(title(note), "Pick your character", { cps: 14 });
      await t.waitVoice();
      await t.say("The text takes Markdown: bold, lists, links. A docs link can be drawn as a button.");
      await t.fill(textArea(note), "Choose a **role** in the Context on the right.\n\n[Seeds](docs:seeds-and-loops){button pi-play}", { cps: 20 });
      await t.beat(500);
      await t.waitVoice();
      await t.say("And wp library makes a button that adds this workflow's items to whoever opens it, after a review.");
      await t.type("  [Add the pack](wp:library){button pi-download}", { cps: 20 });
      await t.beat(500);
      await t.callout("bm", t.node(note).locator('[data-test="note-bookmark"]'), "Also a jump target", 4);
      await t.say("Also a bookmark puts the note in the Bookmarks dock, which the next video shows.");
      await t.waitVoice();
      await t.uncallout("bm");
      await t.click(t.node(note).locator('[data-test="note-done"]'));
      await t.beat(1000);
      await t.callout("note", t.node(note), "A panel, not a node", 4);
      await t.say("Done shows it as a panel. It never runs, and it's saved with the workflow.");
      await t.waitVoice();
      await t.uncallout("note");
      return note;
    });

    await t.h.step("A warning", async () => {
      await t.say("Sticky is tinted with its colour. Icon tone puts an icon in front: a warning here.");
      const note = await t.addNode("WP Note", { x: 420, y: 560 });
      await t.beat(600);
      await t.click(t.node(note).locator('[data-test="note-tone-icon"]'));
      await t.click(t.node(note).locator('[data-test="note-look-sticky"]'));
      await t.click(t.node(note).locator('[data-test="note-color-warning"]'));
      await t.beat(300);
      await t.fill(title(note), "Same seed, same picture", { cps: 14 });
      await t.fill(textArea(note), "Change the seed on the Context to roll something new.", { cps: 20 });
      await t.beat(400);
      await t.click(t.node(note).locator('[data-test="note-done"]'));
      await t.beat(900);
      await t.waitVoice();
    });

    await t.h.step("A label", async () => {
      await t.say("Label is a small pill with just the title. Its text shows when you hover it, pictures too.");
      const note = await t.addNode("WP Note", { x: 880, y: 560 });
      await t.beat(600);
      await t.click(t.node(note).locator('[data-test="note-look-label"]'));
      await t.click(t.node(note).locator('[data-test="note-tone-plain"]'));
      await t.fill(title(note), "Need help?", { cps: 14 });
      await t.fill(textArea(note), "Every node's ? button opens its help.\n\n![The ? button](wp:asset/toolbar-help){width=90%}", { cps: 22 });
      await t.beat(400);
      await t.click(t.node(note).locator('[data-test="note-done"]'));
      await t.beat(900);
      await t.hover(t.node(note).locator('[data-test="note-title-text"]'));
      await t.beat(1200);
      await t.waitVoice();
      await t.moveTo({ x: 900, y: 950 });
      await t.beat(600);
    });

    await t.h.step("Edit again", async () => {
      await t.say("To change a note, double-click it. Done goes back to reading.");
      // Double-click the title line: the body's text and buttons take their own clicks.
      const box = await t.node(step).locator('[data-test="note-panel"]').boundingBox();
      if (!box) throw new Error("The note's panel isn't on screen.");
      await t.click({ x: box.x + box.width * 0.6, y: box.y + 16 }, { double: true });
      await t.beat(1000);
      const done = t.node(step).locator('[data-test="note-done"]');
      await t.click(done);
      await t.beat(800);
      // The review saw the editor still open in the outro: make sure Done took.
      if (await done.isVisible().catch(() => false)) {
        await t.click(done);
        await t.beat(800);
      }
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Steps, warnings and labels, with links into the docs. Next: bookmarks, to jump around a big workflow.");
    });
  },
);
