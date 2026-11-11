// Tutorial 12: where to find help. The ? over a selected node, the example workflows in ComfyUI's
// Templates, the button that opens the manager, the built-in docs, the shortcut sheet and command
// palette, and What's new after an update.
import { tutorial, hideOtherPacks } from "../tutorial.js";

tutorial(
  "T12",
  {
    title: "Where to find help",
    description: "Node help on the canvas, the example workflows, the manager's documentation, keyboard shortcuts, the command palette and What's new.",
    learn: "Every place the extension explains itself, and the ready-made example workflows.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("Help on a node", async () => {
      await t.go("/");
      await t.say("Last in the basics: where to look when you're stuck. Every Wildcard Pipeline node has its own help.");
      const ctx = await t.addNode("WP Context", { x: 700, y: 300 });
      await t.beat(500);
      const box = await t.node(ctx).boundingBox();
      if (box) await t.click({ x: box.x + box.width / 2, y: box.y + 14 });
      await t.beat(500);
      const help = page.locator(".wp-tb-icon--help").first().locator("xpath=ancestor::button[1]");
      await t.callout("help", help, "This node's help", 6);
      // The box stays up for the whole line and the click comes after it, so the two line up.
      await t.say("Select it and press the question mark above it.");
      await t.waitVoice();
      await t.beat(300);
      await t.click(help);
      await t.uncallout("help");
      await t.say("Its page opens over the canvas: what each part does, with a picture.");
      await t.beat(1500);
      await t.waitVoice();
      await t.press("Escape");
      await t.beat(600);
    });

    await t.h.step("Example workflows", async () => {
      await t.say("Want to see it all working together? There are four example workflows, in ComfyUI's Templates.");
      await t.click(page.getByRole("button", { name: /^templates/i }).first());
      await t.beat(1200);
      const dialog = page.getByRole("dialog").last();
      const ours = dialog.getByText("ComfyUI-Wildcard-Pipeline", { exact: true });
      await ours.waitFor({ state: "attached", timeout: 15_000 });
      await hideOtherPacks(ours);
      // It sits at the bottom of the list, below the window's edge on a 1080p screen.
      await t.moveTo({ x: 370, y: 700 });
      await ours.scrollIntoViewIfNeeded();
      await t.beat(400);
      await t.click(ours);
      await t.beat(1000);
      await t.waitVoice();
      await t.callout("examples", dialog.getByText("1 - One image", { exact: true }).locator("xpath=ancestor::*[contains(@class,'grid')][1]"), "Four ready-made workflows", 6);
      await t.say("Under Extensions, Wildcard Pipeline. Each one runs on an empty library, with notes that walk you through it. Open one, pick your checkpoint and press Run.");
      await t.waitVoice();
      await t.uncallout("examples");
      await t.say("The example workflow videos go through each of them.");
      await t.press("Escape");
      // The closing dialog still covers the toolbar for a moment, and a box drawn over it is taken
      // for hidden and dropped at once (the "Opens the manager" box flashed for half a second).
      await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
      await t.waitVoice();
      await t.beat(400);
    });

    await t.h.step("The manager's docs", async () => {
      const open = page.getByRole("button", { name: /Wildcard Pipeline Workspace/ }).first();
      if ((await open.count()) > 0) {
        // The box comes up with its line and stays for all of it.
        await t.say("This button opens the manager. Its Documentation covers every node and every module, with examples.");
        await t.callout("open", open, "Opens the manager", 6);
        await t.waitVoice();
        await t.uncallout("open");
      }
      await t.go("/wp/docs");
      await t.say("Here it is. The list on the left has how-tos, guides, each node and each module.");
      await t.waitVoice();
      await t.click(page.getByRole("link", { name: "Start from an example" }).first());
      await t.beat(1200);
      await t.say("Search finds any page; the AI assistant reads these pages too, if you set one up.");
      await t.waitVoice();
    });

    await t.h.step("Shortcuts", async () => {
      await t.say("Control and slash shows every keyboard shortcut.");
      await t.press("Control+/");
      await t.beat(1200);
      // The dialog role sits on a full-width wrapper; box the panel inside it.
      await t.callout("keys", page.getByRole("dialog").last().locator(".wp-modal").first(), "Keyboard shortcuts", 4);
      await t.waitVoice();
      await t.uncallout("keys");
      await t.press("Escape");
      await t.beat(500);
      await t.say("And Control K opens the command palette: type what you want, and go there.");
      await t.press("Control+k");
      await t.beat(700);
      await t.type("bundles", { cps: 12 });
      await t.beat(1200);
      await t.waitVoice();
      await t.press("Escape");
      await t.beat(500);
    });

    await t.h.step("What's new", async () => {
      const news = page.locator('[data-test="topbar-whats-new"]');
      await t.callout("news", news, "What's new", 6);
      await t.say("After an update, the megaphone gets a dot. It shows what changed in each version.");
      await t.waitVoice();
      await t.beat(300);
      await t.click(news);
      await t.uncallout("news");
      await t.beat(1500);
      const discord = page.locator('[data-test="topbar-discord"]');
      if ((await discord.count()) > 0) {
        await t.callout("discord", discord, "Ask on Discord", 4);
        await t.say("And for anything else, the Discord button is right next to it.");
        await t.waitVoice();
        await t.uncallout("discord");
      }
    });

    await t.h.step("Outro", async () => {
      await t.say("That's the basics. The advanced videos take each part further, one at a time.");
    });
  },
);
