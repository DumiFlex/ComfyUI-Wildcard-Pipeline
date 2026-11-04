// Tutorial 8: bundles. A bundle is a saved set of modules (and other bundles) that goes into a
// Context in one click. The Character bundle holds Hero plus the Look, Outfit and Shared lists
// sub-bundles; the Scene bundle holds the setting, time, lighting rule, scene line and style.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T08",
  {
    title: "Bundles: a whole set in one click",
    description: "Open a bundle with sub-bundles in the manager, then add two bundles to a Context and build a prompt from them.",
    learn: "What a bundle holds, how sub-bundles nest, and adding bundles to a Context node.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("A bundle", async () => {
      await t.say("Once your lists work well together, keep them together. A bundle is a saved set of modules.");
      await t.go("/wp/bundles/7e3d3ec2/edit");
      await t.beat(800);
      const children = page.locator('[data-test="bundle-children-list"]');
      await t.scrollTo(children);
      await t.callout("kids", children, "What Character holds", 6);
      await t.say("Character holds the Hero list, and three smaller bundles inside it: Look, Outfit and Shared lists.");
      await t.waitVoice();
      await t.uncallout("kids");
      await t.say("Bundles can nest, so you build big sets out of small ones and reuse the small ones anywhere.");
      await t.waitVoice();
    });

    const nodes = await t.h.step("Add bundles to a Context", async () => {
      await t.say("On the canvas, a Context node takes a bundle just like a module. Click Add Bundle.");
      await t.go("/");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 220 });
      for (const id of ["7e3d3ec2", "86360bc3"]) {
        await t.click(t.node(ctx).locator('[data-testid="open-bundle-picker"]').first());
        await t.beat(700);
        const row = page.locator(`[data-testid="bundle-picker-row-${id}"]`);
        if (id === "7e3d3ec2") {
          await t.callout("row", row, "Character", 6);
          await t.say("Pick Character first, then Scene, because the scene's rule reads the hero.");
          await t.waitVoice();
          await t.uncallout("row");
        }
        await t.click(row);
        await t.beat(900);
      }
      await t.say("Each bundle sits in its own frame. Open them to see what came in.");
      await t.expandBundles(ctx);
      await t.waitVoice();
      const fold = async (name: string) => {
        const header = t.node(ctx).locator(".wp-bundle-header").filter({ hasText: name }).first();
        await t.click(header.locator(".wp-bundle-collapse"));
        await t.beat(500);
      };
      await t.callout("character", t.bundleFrame(ctx, "Character"), "Hero plus three sub-bundles", 4);
      await t.say("Character brings the Hero list, then Look with the hair, eyes and colors, Outfit, and the Shared lists.");
      await t.waitVoice();
      await t.uncallout("character");
      await t.say("The hair list already reads the colors, so hide Colors with its globe button. Then fold the frame.");
      await t.hide(ctx, ["Colors"]);
      await fold("Character");
      await t.waitVoice();
      await t.callout("scene", t.bundleFrame(ctx, "Scene"), "The whole scene", 4);
      await t.say("Scene brings the setting, the time of day, the lighting rule, the scene line and the style.");
      await t.waitVoice();
      await t.uncallout("scene");
      await t.say("The scene line reads the setting, the time and the lighting, so hide those three too, and fold Scene.");
      await t.hide(ctx, ["Setting", "Time of day", "Lighting from time"]);
      await fold("Scene");
      await t.waitVoice();
      await t.say("Fold a frame, switch it off with its checkbox, or open an item to change it for this node only.");
      await t.waitVoice();
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 220 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$style, $hero with $hair and $eyes, wearing $outfit, $scene");
      await t.beat(1000);
      await t.say("Every variable from both bundles is ready to use. Roll a few seeds.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(900);
      }
      return { ctx, asm, plus };
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("First, add WP Debug under the Context, so every run shows what it rolled.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1560, y: 440, width: 340, height: 500 }, chain: { x: 1820, y: 960 }, between: () => t.click(nodes.plus) });
        await t.callout("picks", t.node(dbg), "What this picture rolled");
        await t.say("Debug shows the picks behind the last picture, so you can see the prompt change from run to run.");
        await t.waitVoice();
        await t.uncallout("picks");
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("That's the basics of Wildcard Pipeline. The advanced videos go further: nested lists, LoRAs, loops and more.");
    });
  },
);
