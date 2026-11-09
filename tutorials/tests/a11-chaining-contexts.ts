// Advanced 11: chaining Contexts. A character Context (Role, Hair, Eyes, Subject) feeds a scene Context
// (Time of day, Setting, Lighting from time, Scene); the Assembler reads both. The scene's inputs are
// hidden but Scene still reads them; Hair is changed for this node only (name + one option off).
import { tutorial } from "../tutorial.js";

tutorial(
  "A11",
  {
    title: "Chaining Contexts",
    description: "Split a prompt into a character Context and a scene Context, pass variables down the chain, hide the in-between ones, and change an item for one node.",
    learn: "Chained Contexts, what passes down a chain, hidden variables, and per-node item changes.",
  },
  async (t) => {
    const page = t.page;
    const editItem = async (ctx: string, name: string) => {
      await t.click(t.moduleRow(ctx, name).locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      return page.getByRole("dialog").last();
    };

    const nodes = await t.h.step("Two Contexts", async () => {
      await t.go("/");
      await t.say("A big prompt reads better in parts. One Context for the character: Role, Hair, Eyes, and the Subject combine that joins them.");
      const a = await t.addNode("WP Context", { x: 340, y: 170 });
      await t.pickModules(a, ["Role", "Hair", "Eyes", "Subject"]);
      await t.waitVoice();
      await t.say("A second Context for the scene, wired into the first one's upstream: Time of day, Setting, the lighting rule and the Scene combine.");
      const b = await t.addNode("WP Context", { x: 1000, y: 170 });
      await t.wire(a, "context", b, "upstream");
      await t.pickModules(b, ["Time of day", "Setting", "Lighting from time", "Scene"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1560, y: 170 });
      await t.wire(b, "context", asm, "context");
      await t.waitVoice();
      await t.callout("vars", t.node(asm), "Variables from both Contexts", 4);
      await t.say("Everything set upstream flows down the chain. The Assembler offers variables from both Contexts.");
      await t.waitVoice();
      await t.uncallout("vars");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $subject $scene.", { cps: 16 });
      await t.beat(600);
      return { a, b, asm };
    });

    await t.h.step("Hidden in between", async () => {
      await t.say("Time, setting and lighting only feed the scene. Hide them with their globe buttons, and on the character Context, hide what Subject already holds.");
      await t.hide(nodes.b, ["Time of day", "Setting", "Lighting from time"]);
      await t.hide(nodes.a, ["Role", "Eyes"]);
      await t.waitVoice();
      await t.callout("vars", t.node(nodes.asm), "Fewer chips, same scene", 4);
      await t.say("They leave the Assembler's list, but the combines, and any later Context, still read them. Hidden means not offered to templates, not gone.");
      await t.waitVoice();
      await t.uncallout("vars");
    });

    await t.h.step("For this node only", async () => {
      await t.say("You can change an item for one node without touching the library. Edit Hair on the character Context.");
      const modal = await editItem(nodes.a, "Hair");
      await t.fill(modal.getByLabel("Display name"), "Hair for this story", { cps: 16 });
      await t.press("Tab");
      await t.beat(400);
      await t.click(modal.getByLabel("Use option a shaved head"));
      await t.beat(500);
      await t.waitVoice();
      await t.say("Rename it here and untick the shaved head. Reset overrides would bring back the library's version.");
      await t.callout("reset", modal.getByRole("button", { name: "Reset overrides" }), "Back to the library's", 4);
      await t.waitVoice();
      await t.uncallout("reset");
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(800);
      await t.callout("row", t.moduleRow(nodes.a, "Hair for this story"), "Changed on this node only", 4);
      await t.say("The row shows its new name. Every other node, and the library, keep the original.");
      await t.waitVoice();
      await t.uncallout("row");
    });

    await t.h.step("Roll", async () => {
      const plus = t.node(nodes.a).getByRole("button", { name: /increment|increase|\+/i }).first();
      await t.say("Roll a few seeds. A later Context can also set a variable again: the last one wins, and the node shows a small note when it does.");
      for (let i = 0; i < 4; i++) {
        await t.click(plus);
        await t.beat(1000);
      }
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Chain Contexts to split a prompt into parts, hide what only feeds other items, and change items per node. Next: the Context Injector.");
    });
  },
);
