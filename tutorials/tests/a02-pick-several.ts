// Advanced 2: several picks from one wildcard. On the node: Pick 2–3 in the item's edit view, its
// separator and Allow repeats. Inline (in a fixed value; the Assembler template doesn't resolve
// them): {2$$ and $$a|b|c}, a range {1-3$$…} and ~ for repeats.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "A02",
  {
    title: "Pick several at once",
    description: "Make one wildcard pick two or three options for a node, choose the separator, and write several picks inline with {2$$ and $$a|b|c} in a fixed value.",
    learn: "Pick counts and ranges, separators, Allow repeats, and the inline multi-pick syntax.",
  },
  async (t) => {
    const page = t.page;

    const nodes = await t.h.step("The setup", async () => {
      await t.go("/");
      await t.say("A wildcard picks one option. Sometimes you want two or three: here, the colors in two-tone hair.");
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Role", "Hair colors"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role with $hair_color hair.");
      await t.beat(800);
      await t.waitVoice();
      return { ctx, asm };
    });

    const plus = t.node(nodes.ctx).getByRole("button", { name: /increment|increase|\+/i }).first();

    await t.h.step("Pick two or three", async () => {
      await t.say("Right-click Hair colors and open Edit.");
      await t.click(t.moduleRow(nodes.ctx, "Hair colors").locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      const modal = page.getByRole("dialog").last();
      const pick = modal.locator('[data-test="pool-pick"]');
      await t.callout("pick", pick, "How many to pick", 6);
      await t.say("Pick sets how many options it rolls. Set it to two up to three.");
      await t.fill(modal.locator('input[data-test="pool-pick-min"]'), "2");
      await t.press("Tab");
      await t.fill(modal.locator('input[data-test="pool-pick-max"]'), "3");
      await t.press("Tab");
      await t.waitVoice();
      await t.uncallout("pick");
      await t.say("The separator goes between them. Make it and, with a space each side.");
      await t.fill(modal.locator('[data-test="pool-pick-sep"] input, input[data-test="pool-pick-sep"]').first(), " and ");
      await t.press("Tab");
      await t.waitVoice();
      const repeats = modal.locator('[data-test="pool-allow-repeats"]');
      await t.callout("rep", repeats, "Off: never the same color twice", 4);
      await t.say("Allow repeats stays off, so a color never comes up twice.");
      await t.waitVoice();
      await t.uncallout("rep");
      await t.say("Save keeps this on this node only.");
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(900);
      await t.waitVoice();
      await t.say("Roll a few seeds: two or three colors each time.");
      for (let i = 0; i < 4; i++) {
        await t.click(plus);
        await t.beat(1000);
      }
      await t.waitVoice();
    });

    await t.h.step("Inline", async () => {
      // Inline picks resolve inside an option, a fixed value or a combine, never in the
      // Assembler's template (it only fills in $variables), so the demo writes one in a fixed value.
      await t.say("You can also write several picks inline, inside a wildcard option, a fixed value or a combine. Not in the Assembler: its template only fills in variables. Add the Style fixed value.");
      await t.pickModules(nodes.ctx, ["Style"]);
      await t.waitVoice();
      await t.say("Right-click Style, open Edit, and change its value on this node.");
      await t.click(t.moduleRow(nodes.ctx, "Style").locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      const modal = page.getByRole("dialog").last();
      await t.click(modal.locator('[data-test="row-value"] [contenteditable="true"], [data-test="row-value"] textarea').first());
      await t.press("ControlOrMeta+a");
      await t.waitVoice();
      await t.say("Curly brackets, a count, two dollar signs, the joiner, two more dollar signs, then the choices.");
      await t.type("A {2$$ and $$watercolor|ink|oil paint|charcoal} painting.", { cps: 16 });
      await t.beat(600);
      await t.waitVoice();
      await t.click(modal.locator('[data-test="fvm-save"]'));
      await t.beat(900);
      await t.say("Then print it in the template.");
      await t.click(t.node(nodes.asm).locator("textarea, [contenteditable='true']").first());
      await t.press("End");
      await t.type(" $style", { cps: 16 });
      await t.press("Escape");
      await t.beat(800);
      await t.waitVoice();
      await t.say("Two means exactly two. One dash three picks one to three, and a tilde after the count lets one come up twice.");
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(1000);
      }
      await t.waitVoice();
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("Now the pictures. WP Debug under the Context shows each run's picks.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1440, y: 150, width: 450, height: 780 }, chain: { x: 1820, y: 960 }, between: () => t.click(plus) });
        await t.callout("picks", t.node(dbg), "What this picture rolled");
        await t.waitVoice();
        await t.uncallout("picks");
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Pick several on the node for a library list, or inline inside a value for a quick one. Next: wildcards inside wildcards.");
    });
  },
);
