// Nodes 14: WP Note in depth (the depth standard). A Role Context to explain. A Step card: tone, step
// number, colour, Pinned (new notes start unpinned, #400), title; the text window with the formatting
// bar (bold from the bar, undo), links built with the bar's Link panel (a Docs page drawn as a button
// with an icon, a Library button), a preview; Also a bookmark, then its row in the dock. A Sticky
// warning with an icon. A Label whose picture comes from the bar's Pictures panel, read by hovering.
// Double-click to edit again. How it works, recipes, gotchas. Nothing hand-typed as link markdown.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N14",
  {
    title: "WP Note in depth",
    description: "Explain a workflow on the canvas: numbered steps, warnings, labels, links into the docs, pictures, and a button that adds the workflow's items to a library.",
    learn: "Tone, step number, colour, look, Pinned, title, the text window and its bar (bold, undo, Link, Icon, Pictures), docs and library buttons, Also a bookmark, labels, editing again.",
  },
  async (t) => {
    // The text is written in its own window (opened from the node), which is on the page, not the node.
    const textArea = () => t.page.locator('[data-test="note-text-window"] textarea[data-test="note-text"], [data-test="note-text-window"] [data-test="note-text"] textarea').first();
    const openText = async (id: string) => {
      await t.click(t.node(id).locator('[data-test="note-text-edit"]'));
      await textArea().waitFor({ state: "visible", timeout: 5000 });
      await t.beat(400);
    };
    const textDone = async () => {
      await t.click(t.page.locator('[data-test="note-text-done"]'));
      await t.beat(500);
    };
    const title = (id: string) => t.node(id).locator('input[data-test="note-title"], [data-test="note-title"] input').first();

    await t.h.step("Something to explain", async () => {
      await t.go("/");
      await t.say("Here's a Context with Role. Someone opening this workflow might not know where to start, so leave them a note.");
      const ctx = await t.addNode("WP Context", { x: 1400, y: 200 });
      await t.pickModules(ctx, ["Role"]);
      await t.waitVoice();
    });

    const step = await t.h.step("A step", async () => {
      await t.say("Add a WP Note. It opens in its editor. Tone Step puts a numbered circle in front, and the number is yours to set. Card is the look, and the colour is any preset or your own.");
      const note = await t.addNode("WP Note", { x: 420, y: 170 });
      await t.beat(600);
      await t.click(t.node(note).locator('[data-test="note-tone-step"]'));
      await t.beat(300);
      await t.callout("num", t.node(note).locator('[data-test="note-step-input"]'), "Step number", 3);
      await t.click(t.node(note).locator('[data-test="note-color-tip"]'));
      await t.beat(300);
      await t.waitVoice();
      await t.uncallout("num");
      await t.callout("pin", t.node(note).locator('[data-test="note-pinned"]'), "Can't be moved by accident", 4);
      await t.say("Pinned is ComfyUI's own pin. A new note starts unpinned, so you can place it first.");
      await t.waitVoice();
      await t.uncallout("pin");
      await t.say("The title shows in bold at the top.");
      await t.fill(title(note), "Pick your character", { cps: 14 });
      await t.waitVoice();
      return note;
    });

    await t.h.step("The text window", async () => {
      const bar = (name: string) => t.page.locator(`[data-test="note-text-window"] [data-test="${name}"]`).first();
      await t.say("Edit text opens the text window: Markdown on the left, the note as it will read on the right, and a formatting bar.");
      await openText(step);
      await t.fill(textArea(), "Choose a role in the Context on the right.", { cps: 20 });
      await t.beat(400);
      await t.waitVoice();
      await t.say("Select the line and press Bold on the bar. Italic, strikethrough, code, lists and quotes work the same way, and undo steps back through it all.");
      await t.press("Shift+Home");
      await t.click(bar("note-fmt-bold"));
      await t.beat(600);
      await t.callout("bar", [bar("note-undo"), bar("note-fmt-quote")], "The formatting bar", 4);
      await t.waitVoice();
      await t.uncallout("bar");
      await t.click(textArea());
      await t.press("ControlOrMeta+End");
      await t.press("Enter");
      await t.press("Enter");
      await t.say("Links come from the Link button, never typed by hand. A Docs link: type to find a page.");
      await t.click(bar("note-fmt-link"));
      await t.beat(700);
      const panel = t.page.locator('[data-test="note-link-panel"]').last();
      await t.click(panel.locator('[data-test="note-link-kind-docs"]'));
      await t.beat(300);
      // The kit Combobox puts data-test on its popover root, not on the text field: find the field by role.
      await t.click(panel.getByRole("combobox", { name: "Docs page" }));
      await t.type("Seeds", { cps: 14, rest: false });
      await t.beat(600);
      await t.click(t.page.getByRole("option", { name: /Seeds/ }).first());
      await t.beat(600);
      await t.waitVoice();
      await t.say("Pick a section or the whole page, give it text, and draw it as a button with an icon. Its colour follows the note unless you pick one.");
      await t.fill(panel.locator('[data-test="note-link-text"] input, input[data-test="note-link-text"]').first(), "Seeds", { cps: 14 });
      await t.click(panel.locator('[data-test="note-link-style-button"]'));
      await t.beat(300);
      await t.click(panel.locator('[data-test="note-link-icon"]'));
      await t.beat(600);
      const iconSearch = panel.locator('[aria-label="Search icons"] input, input[aria-label="Search icons"]').first();
      if (await iconSearch.isVisible().catch(() => false)) await t.fill(iconSearch, "play", { cps: 14 });
      await t.beat(500);
      await t.click(panel.locator('[data-test="note-link-icons"] .wp-iconpick__cell').first());
      await t.beat(500);
      await t.waitVoice();
      await t.click(panel.locator('[data-test="note-link-insert"]'));
      await t.beat(800);
      await t.callout("prev", t.page.locator('[data-test="note-text-preview"]').last(), "A button in the note", 4);
      await t.say("Insert link puts it where the caret was, and the preview draws the button.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("Web links and community packs work the same way. A Library button adds this workflow's items to whoever opens it, after a review: only what isn't in their library yet.");
      await t.click(textArea());
      await t.press("ControlOrMeta+End");
      await t.type("  ", { cps: 10, rest: false });
      await t.click(bar("note-fmt-link"));
      await t.beat(700);
      await t.click(panel.locator('[data-test="note-link-kind-library"]'));
      await t.beat(400);
      await t.fill(panel.locator('[data-test="note-link-text"] input, input[data-test="note-link-text"]').first(), "Add the pack", { cps: 14 });
      await t.click(panel.locator('[data-test="note-link-insert"]'));
      await t.beat(800);
      await t.waitVoice();
      await t.say("The bar also inserts icons and pictures. Done, or Control Enter, puts the text on the note; Cancel leaves it as it was.");
      await t.waitVoice();
      await textDone();
    });

    await t.h.step("Also a bookmark", async () => {
      const bm = t.node(step).locator('[data-test="note-bookmark"]');
      await t.callout("bm", bm, "Also a jump target", 4);
      await t.say("Also a bookmark puts the note in the Bookmarks dock, with its own shortcut, so a step is also a stop when you show the workflow.");
      await t.click(bm);
      await t.beat(800);
      await t.waitVoice();
      await t.uncallout("bm");
      await t.click(t.node(step).locator('[data-test="note-done"]'));
      await t.beat(1000);
      const row = t.page.locator('[data-test="bm-dock-row-0"]');
      if (await row.isVisible().catch(() => false)) {
        await t.callout("row", row, "Its step number in the dock", 4);
        await t.say("Done shows it as a panel, and the dock lists it with its step number.");
        await t.waitVoice();
        await t.uncallout("row");
      }
      await t.callout("note", t.node(step), "A panel, not a node", 4);
      await t.say("It never runs, and it's saved with the workflow. Its buttons work right on the canvas.");
      await t.waitVoice();
      await t.uncallout("note");
    });

    await t.h.step("A warning", async () => {
      await t.say("Sticky is tinted with its colour. Icon tone puts an icon in front: a warning here.");
      const note = await t.addNode("WP Note", { x: 420, y: 560 });
      await t.beat(600);
      await t.click(t.node(note).locator('[data-test="note-tone-icon"]'));
      await t.click(t.node(note).locator('[data-test="note-look-sticky"]'));
      await t.click(t.node(note).locator('[data-test="note-color-warning"]'));
      await t.beat(300);
      await t.waitVoice();
      await t.say("Give it a title and a line of text, then Done.");
      await t.fill(title(note), "Same seed, same picture", { cps: 14 });
      await openText(note);
      await t.fill(textArea(), "Change the seed on the Context to roll something new.", { cps: 20 });
      await t.beat(400);
      await t.say("Done closes the text window, and Done on the node leaves the edit view.");
      await textDone();
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
      await t.waitVoice();
      await t.say("Give it a title, and text with a picture: a small one from the node's toolbar.");
      await t.fill(title(note), "Need help?", { cps: 14 });
      await openText(note);
      await t.fill(textArea(), "Every node's ? button opens its help.", { cps: 22 });
      await t.press("Enter");
      await t.beat(400);
      await t.say("Pictures, on the bar, adds one from a file, a paste or a drop, or one the extension ships. Search for the help button.");
      await t.click(t.page.locator('[data-test="note-text-window"] [data-test="note-fmt-image"]').first());
      await t.beat(700);
      const find = t.page.locator('[data-test="note-image-panel"] input[aria-label="Find a picture from the extension"]').first();
      await t.fill(find, "help", { cps: 14 });
      await t.beat(900);
      const tile = t.page.locator('[data-test="note-assets"] img').first();
      if (!(await tile.isVisible().catch(() => false))) throw new StepError("No shipped picture matched help.");
      await t.click(tile);
      await t.beat(900);
      await t.callout("w", t.page.locator('[data-test="note-image-width"]').first(), "Its width in the note", 4);
      await t.say("It goes in on a line of its own, and the panel lists the note's pictures with a width, own size, and remove.");
      await t.waitVoice();
      await t.uncallout("w");
      await textDone();
      await t.click(t.node(note).locator('[data-test="note-done"]'));
      await t.beat(900);
      await t.waitVoice();
      // No callout here: its label landed on the pill, which ended the hover and closed the peek.
      // Hover first, so the peek is up for the whole line.
      await t.hover(t.node(note).locator('[data-test="note-title-text"]'));
      // The line is about the picture, so it must be showing (rendered, not the markdown).
      const pic = t.page.locator('[data-test="note-peek"] img').first();
      if (!(await pic.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false))) throw new StepError("Hovering the label didn't show its picture.");
      // A line moves the hand off any open tooltip; this one is the point, so keep it.
      t.keepTooltip = true;
      await t.say("Hover it, and its text shows, picture and all.");
      await t.waitVoice();
      t.keepTooltip = false;
      await t.beat(500);
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
      // Still open (the button can sit under the window edge): press it directly.
      if (await done.isVisible().catch(() => false)) {
        await done.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
        await t.beat(800);
      }
      await t.waitVoice();
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("A note is frontend only: it never runs and never reaches the prompt, and it's saved inside the workflow, so whoever opens it sees the same notes and buttons.");
      await t.waitVoice();
      await t.say("Recipes: number the steps of a shared workflow, one Step card per stage. Put a warning Sticky next to anything easy to break. End with a Library button, so the workflow's items land in the viewer's library in one click.");
      await t.waitVoice();
      await t.say("Gotchas: a Label only shows its text on hover, so keep the title meaningful. A Library button only adds what the viewer's library doesn't have. And pin a note once it's placed, or a drag on the canvas can move it.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Steps, warnings and labels, with buttons into the docs and the library, built from the bar. Next: bookmarks, to jump around a big workflow.");
      await t.waitVoice();
    });
  },
);
