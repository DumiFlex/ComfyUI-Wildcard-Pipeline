// Tutorial 8: bundles. A bundle is a saved set of modules (and other bundles) that goes into a
// Context in one click. The Character bundle holds Role, the Shared lists, Look and Outfit
// sub-bundles and the Subject combine; the Scene bundle holds the place rule, setting, time,
// lighting rule, scene combine, framing and style. Ends with a frame's right-click menu: Edit
// bundle, to rename and recolour it on this node.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T08",
  {
    title: "Bundles: a whole set in one click",
    description: "Open a bundle with sub-bundles in the manager, add two bundles to a Context, build a prompt from them, and rename and recolour a frame.",
    learn: "What a bundle holds, how sub-bundles nest, adding bundles to a Context node, and a frame's right-click menu.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("A bundle", async () => {
      await t.go("/wp/bundles/7e3d3ec2/edit");
      await t.say("Once your lists work well together, keep them together. A bundle is a saved set of modules.");
      await t.beat(800);
      const children = page.locator('[data-test="bundle-children-list"]');
      await t.scrollTo(children);
      await t.callout("kids", children, "What Character holds", 6);
      await t.say("Character holds the Role list, the Subject combine, and three smaller bundles inside it: Shared lists, Look and Outfit.");
      await t.waitVoice();
      await t.uncallout("kids");
      await t.say("Bundles can nest, so you build big sets out of small ones and reuse the small ones anywhere.");
      await t.waitVoice();
    });

    const nodes = await t.h.step("Add bundles to a Context", async () => {
      await t.go("/");
      await t.say("On the canvas, a Context node takes a bundle just like a module. Click Add Bundle.");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 110 });
      for (const id of ["7e3d3ec2", "86360bc3"]) {
        await t.click(t.node(ctx).locator('[data-testid="open-bundle-picker"]').first());
        await t.beat(700);
        const row = page.locator(`[data-testid="bundle-picker-row-${id}"]`);
        if (id === "7e3d3ec2") {
          await t.callout("row", row, "Character", 6);
          await t.say("Pick Character first, then Scene, because the scene's rule reads the role.");
          await t.waitVoice();
          await t.uncallout("row");
        }
        await t.click(row);
        await t.beat(900);
      }
      await t.say("Each bundle sits in its own frame. Open Character to see what came in.");
      await t.foldBundle(ctx, "Scene");
      await t.expandBundles(ctx, "Character");
      await t.waitVoice();
      await t.callout("character", t.bundleFrame(ctx, "Character"), "Role, Subject and three sub-bundles", 4);
      await t.say("Character brings Role, the Shared lists, Look with hair and eyes, the Subject combine, and Outfit with the clothes and the rules that fit them to the role.");
      await t.waitVoice();
      await t.uncallout("character");
      await t.say("Hair colors is switched off, because Hair reads it through a reference. And Subject already holds the role, hair and eyes, so hide those three with their globe buttons. Then fold the frame.");
      await t.hide(ctx, ["Role", "Hair", "Eyes"]);
      await t.foldBundle(ctx, "Character");
      await t.waitVoice();
      await t.say("Now open Scene.");
      await t.expandBundles(ctx, "Scene");
      await t.waitVoice();
      await t.callout("scene", t.bundleFrame(ctx, "Scene"), "The whole scene", 4);
      await t.say("Scene brings a rule that fits the place to the role, the setting, the time of day, the lighting rule, the scene combine, the framing and the style.");
      await t.waitVoice();
      await t.uncallout("scene");
      await t.say("The scene combine reads the setting, the time and the lighting, so hide those three too, and fold Scene.");
      await t.hide(ctx, ["Setting", "Time of day", "Lighting from time"]);
      await t.foldBundle(ctx, "Scene");
      await t.waitVoice();
      await t.say("Fold a frame, switch it off with its checkbox, or open an item to change it for this node only.");
      await t.waitVoice();
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$framing of $subject, wearing $outfit and holding $held, $scene. $style");
      await t.beat(1000);
      await t.say("Every variable from both bundles is ready to use. Roll a few seeds.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(900);
      }
      return { ctx, asm, plus };
    });

    await t.h.step("A frame's own menu", async () => {
      await t.say("Each frame has its own menu. Right-click the Scene header.");
      const header = t.node(nodes.ctx).locator(".wp-bundle-header").filter({ hasText: "Scene" }).first();
      await t.click(header, { right: true });
      await t.beat(700);
      const menu = page.getByRole("menu").last();
      await t.callout("menu", menu, "Edit, fold, switch off, sync, duplicate", 8);
      await t.say("Edit it, fold it, switch it off with everything inside, sync it with the library, duplicate it, or take the frame away.");
      await t.waitVoice();
      await t.uncallout("menu");
      await t.click(page.getByRole("menuitem", { name: /Edit bundle/ }));
      await t.beat(1000);
      const modal = page.getByRole("dialog").last();
      await t.say("Edit bundle changes how it shows on this node. Give it a name of its own,");
      await t.fill(modal.locator('[data-test="bdm-name"] input, input[data-test="bdm-name"]').first(), "Place and light", { cps: 14 });
      await t.beat(400);
      await t.waitVoice();
      await t.say("and a frame color.");
      await t.click(modal.getByRole("radio").nth(4));
      await t.beat(600);
      await t.waitVoice();
      await t.say("Save. The library's Scene bundle keeps its own name and color.");
      await t.click(modal.locator('[data-test="bdm-save"]'));
      await t.beat(900);
      await t.callout("frame", t.node(nodes.ctx).locator(".wp-bundle-header").filter({ hasText: "Place and light" }).first(), "Renamed on this node", 6);
      await t.waitVoice();
      await t.uncallout("frame");
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("First, add WP Debug under the Context, so every run shows what it rolled.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1440, y: 150, width: 450, height: 780 }, chain: { x: 1820, y: 960 }, between: () => t.click(nodes.plus) });
        await t.callout("picks", t.node(dbg), "What this picture rolled");
        await t.say("Debug shows the picks behind the last picture, so you can see the prompt change from run to run.");
        await t.waitVoice();
        await t.uncallout("picks");
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Next: the Context node itself, and how it can roll for you.");
    });
  },
);
