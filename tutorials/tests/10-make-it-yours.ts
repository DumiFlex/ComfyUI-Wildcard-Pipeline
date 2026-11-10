// Tutorial 10: the look. ComfyUI's Settings › Wildcard Pipeline holds how the nodes look on the
// canvas, and its Display playground shows every change live. WP nodes follow ComfyUI's colour
// palette (Canvas colors turns that off), and the manager has its own Appearance page with a
// ComfyUI palette theme. Everything is put back to the defaults at the end, so the next videos
// look the same.
import type { Locator } from "playwright";
import { tutorial, type Tutor } from "../tutorial.js";

/** A playground row's drop-down, by the row's label. */
const select = (t: Tutor, label: string): Locator =>
  t.page.locator('[data-test="playground-controls"] label.wp-pg__row').filter({ hasText: label }).locator("select").first();

async function openSettings(t: Tutor): Promise<Locator> {
  await t.click(t.page.getByRole("button", { name: /^settings/i }).first());
  await t.beat(900);
  const dialog = t.page.getByRole("dialog").last();
  await t.click(dialog.getByText("Wildcard Pipeline", { exact: true }).first());
  await t.beat(800);
  return dialog;
}

async function openPlayground(t: Tutor): Promise<void> {
  await t.click(t.page.getByRole("button", { name: "Open playground" }));
  await t.beat(1200);
}

tutorial(
  "T10",
  {
    title: "Make it look your way",
    description: "The Wildcard Pipeline settings in ComfyUI, the Display playground with its live preview, ComfyUI's colour palettes on the canvas and in the manager, and the manager's own Appearance page.",
    learn: "Where the canvas look lives, trying it out live in the playground, following ComfyUI's palette, and the manager's colour themes and looks.",
  },
  async (t) => {
    const page = t.page;

    const ctx = await t.h.step("The settings", async () => {
      await t.go("/");
      // Built before the line that shows it, sped up.
      await t.speedUp();
      const ctx = await t.addNode("WP Context", { x: 620, y: 260 });
      await t.pickModules(ctx, ["Role", "Outfit", "Setting"]);
      await t.normalSpeed();
      await t.say("Wildcard Pipeline fits into ComfyUI. Here is a Context node with three lists, as it looks out of the box.");
      await t.callout("ctx", t.node(ctx), "Out of the box", 6);
      await t.waitVoice();
      await t.uncallout("ctx");
      await t.say("How it looks on the canvas is up to you. Open ComfyUI's Settings and find Wildcard Pipeline at the bottom.");
      const dialog = await openSettings(t);
      await t.callout("groups", dialog.getByText("2. Sizing", { exact: true }).locator("xpath=.."), "Sizing, markers, collapse, accessibility", 6);
      await t.say("Every setting is here, in groups. The easiest way to try them is the playground at the top.");
      await t.waitVoice();
      await t.uncallout("groups");
      return ctx;
    });

    await t.h.step("The playground", async () => {
      await openPlayground(t);
      const preview = page.locator('[data-test="playground-preview"]');
      await t.callout("preview", preview, "Live preview", 6);
      await t.say("On the left are the controls; on the right, a live preview with every kind of row and marker.");
      await t.waitVoice();
      await t.uncallout("preview");
      await t.say("Density sets how much room each row takes. Compact fits more on a node.");
      await t.choose(select(t, "Module density"), "compact");
      await t.waitVoice();
      await t.say("Type style shows each row's kind as a chip, an icon, or both.");
      await t.choose(select(t, "Module type style"), "icon");
      await t.waitVoice();
      await t.say("Color intensity makes the kind colors softer or stronger.");
      await t.choose(select(t, "Color intensity"), "vivid");
      await t.waitVoice();
      await t.say("And the state markers can be badges, or small dots.");
      await t.choose(select(t, "Indicator style"), "dot");
      await t.waitVoice();
      const toasts = page.locator('[data-test="pg-sample-toasts"]');
      await t.scrollInList(toasts, page.locator('[data-test="playground-panel"]'));
      await t.say("Below the preview you can try the warnings too: how long they stay and which ones show.");
      await t.click(toasts);
      await t.waitVoice();
      await t.beat(1200);
    });

    await t.h.step("On the canvas", async () => {
      await t.say("Click Done, close Settings, and your real node has the new look.");
      await t.click(page.getByRole("button", { name: "Done" }));
      await t.beat(600);
      await t.press("Escape");
      await t.beat(900);
      await t.callout("node", t.node(ctx), "Compact, icons, vivid, dots", 6);
      await t.waitVoice();
      await t.uncallout("node");
    });

    await t.h.step("ComfyUI's palettes", async () => {
      await t.say("ComfyUI has colour palettes of its own, under Settings, Appearance. Wildcard Pipeline follows them. Pick Nord.");
      await t.click(page.getByRole("button", { name: /^settings/i }).first());
      await t.beat(900);
      const dialog = page.getByRole("dialog").last();
      await t.click(dialog.getByText("Appearance", { exact: true }).first());
      await t.beat(800);
      const row = dialog.getByText("Color Palette", { exact: true }).first();
      await row.scrollIntoViewIfNeeded().catch(() => undefined);
      await t.callout("pal", row, "ComfyUI's palette", 8);
      // The palette drop-down beside the label; if it can't be worked by hand, set it directly.
      let picked = false;
      const combo = row.locator("xpath=ancestor::*[.//*[@role='combobox']][1]").getByRole("combobox").first();
      if (await combo.isVisible().catch(() => false)) {
        await t.click(combo);
        await t.beat(500);
        const nord = page.getByRole("option", { name: /^nord$/i }).first();
        if (await nord.isVisible().catch(() => false)) {
          await t.click(nord);
          picked = true;
        } else {
          await t.press("Escape");
        }
      }
      if (!picked) await page.evaluate(() => window.app?.extensionManager?.setting?.set("Comfy.ColorPalette", "nord"));
      await t.beat(1200);
      await t.waitVoice();
      await t.uncallout("pal");
      await t.press("Escape");
      await t.beat(900);
      await t.callout("nord", t.node(ctx), "The same node, in Nord", 6);
      await t.say("The node takes the palette's colours, so it sits with the rest of your graph. The kind colours keep their meaning.");
      await t.waitVoice();
      await t.uncallout("nord");
      await openSettings(t);
      await openPlayground(t);
      const canvasColors = page.locator('[data-test="playground-controls"] label.wp-pg__row').filter({ hasText: "Canvas colors" }).first();
      await t.callout("cc", canvasColors, "Follow the palette, or not", 6);
      await t.say("Rather keep Wildcard Pipeline's own colours? Canvas colors switches that.");
      await t.waitVoice();
      await t.uncallout("cc");
    });

    await t.h.step("Back to the defaults", async () => {
      const reset = page.getByRole("button", { name: "Reset all to defaults" });
      await t.callout("reset", reset, "Back to how it came", 6);
      await t.say("Changed your mind? Reset all to defaults puts everything back.");
      await t.waitVoice();
      await t.uncallout("reset");
      await t.click(reset);
      await t.beat(900);
      await t.click(page.getByRole("button", { name: "Done" }));
      await t.beat(500);
      await t.press("Escape");
      await t.waitVoice();
    });

    await t.h.step("The manager's look", async () => {
      await t.go("/wp/settings/appearance");
      await t.say("The manager has its own Appearance page, under Settings.");
      await t.waitVoice();
      const palettes = page.locator('[data-test^="palette-"]');
      await t.callout("palettes", palettes.first().locator("xpath=.."), "Colour themes", 6);
      await t.say("Pick a colour theme: Nebula is violet, Tide is blue, Ember is warm.");
      await t.click(page.locator('[data-test="palette-nebula"]'));
      await t.beat(800);
      await t.uncallout("palettes");
      await t.click(page.locator('[data-test="palette-ember"]'));
      await t.waitVoice();
      await t.say("A look changes everything but the colour: corners, type and borders. Try Soft, or Terminal.");
      await t.click(page.locator('[data-test="look-soft"]'));
      await t.beat(1200);
      await t.click(page.locator('[data-test="look-terminal"]'));
      await t.waitVoice();
      await t.beat(800);
      await t.click(page.locator('[data-test="look-orbit"]'));
      const comfy = page.locator('[data-test="palette-comfyui"]');
      await t.callout("comfy", comfy, "Your ComfyUI palette", 6);
      await t.say("And one colour theme takes its colours from ComfyUI: ComfyUI palette. It wears Nord now, and switches when you change the palette in ComfyUI.");
      await t.click(comfy);
      await t.waitVoice();
      await t.uncallout("comfy");
      await t.beat(800);
      await t.say("There is light mode, your own accent color, density, and an icons-only sidebar too. I'll go back to the defaults.");
      await t.click(page.locator('[data-test="palette-orbit"]'));
      await t.beat(600);
      await t.click(page.locator('[data-test="settings-theme-light"]'));
      await t.beat(1500);
      await t.click(page.locator('[data-test="settings-theme-dark"]'));
      await t.click(page.locator('[data-test="look-orbit"]'));
      await t.click(page.locator('[data-test="palette-orbit"]'));
      await t.waitVoice();
      // Off camera: ComfyUI's palette back to Dark for the next videos.
      await t.h.api("/api/settings/Comfy.ColorPalette", { method: "POST", body: "dark" }).catch(() => undefined);
    });

    await t.h.step("Outro", async () => {
      await t.say("The canvas look lives in ComfyUI's Settings, the manager's in its own. Next: autocomplete.");
    });
  },
);
