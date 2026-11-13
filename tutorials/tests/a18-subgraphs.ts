// Advanced 18: subgraphs. Time of day in one Context → a Context with Role + Lighting from time →
// Assembler → Preview as Text. The second Context and the Assembler become a subgraph; variables still
// cross its edge (run). Delete the first Context and the subgraph's badge says what broke inside
// (missing $time, on its header); Undo. Enter the subgraph to see the nodes inside. Show the inner
// Context's panel on the subgraph node with the toolbar eye (#403; right-click Show on subgraph node,
// #398, as a fallback), Choose what shows (#402) unticks Role, Move up / down, and the ×.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "A18",
  {
    title: "Subgraphs",
    description: "Fold Contexts and Assemblers into a subgraph: variables still flow in and out, and a badge tells you what's wrong inside without opening it.",
    learn: "Convert to subgraph, variables across its edge, the subgraph badge, entering a subgraph, showing a panel on the subgraph node and choosing what shows.",
  },
  async (t) => {
    const page = t.page;
    const titleBar = async (id: string) => {
      const box = await t.node(id).boundingBox();
      return { x: (box?.x ?? 0) + 120, y: (box?.y ?? 0) + 14 };
    };

    const nodes = await t.h.step("A small pipeline", async () => {
      await t.go("/");
      await t.say("One Context sets the time of day. The next adds a role and the lighting rule, which reads the time, into an Assembler.");
      // The setup earlier videos taught: sped up.
      await t.speedUp();
      const up = await t.addNode("WP Context", { x: 360, y: 170 });
      await t.pickModules(up, ["Time of day"]);
      const ctx = await t.addNode("WP Context", { x: 1010, y: 170 });
      await t.wire(up, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role", "Lighting from time"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1010, y: 640 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $time, $lighting", { cps: 16 });
      await t.beat(500);
      const text = await t.addNode("Preview as Text", { x: 1620, y: 640 });
      await t.wire(asm, "prompt", text, "source");
      await t.waitVoice();
      await t.normalSpeed();
      return { up, ctx, asm, text };
    });

    await t.h.step("Make a subgraph", async () => {
      await t.say("Select the second Context and the Assembler.");
      await t.click(await titleBar(nodes.ctx));
      await t.beat(300);
      await page.keyboard.down("Shift");
      await t.click(await titleBar(nodes.asm));
      await page.keyboard.up("Shift");
      await t.beat(700);
      const convert = page.getByRole("button", { name: "Convert Selection to Subgraph" });
      // The selection toolbar slides in: box the button once it has settled, or the box lands
      // where it was and goes (last review: it flashed after the line).
      await convert.waitFor({ state: "visible", timeout: 10_000 });
      await t.beat(600);
      await t.waitVoice();
      await t.callout("convert", convert, "Convert to subgraph", 6);
      await t.say("Then press Convert to subgraph in the toolbar.");
      await t.waitVoice();
      await t.uncallout("convert");
      await t.click(convert);
      await t.beat(1500);
      await t.moveTo({ x: 960, y: 950 });
      await t.waitVoice();
      await t.say("They fold into one node. The wires crossing its edge became its inputs and outputs. Run.");
      await t.run();
      await t.beat(1200);
      await t.callout("out", t.node(nodes.text), "Time came in from outside", 5);
      await t.say("The time still reaches the lighting inside: variables flow across a subgraph's edge, in and out.");
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("The badge", async () => {
      await t.say("Now delete the first Context.");
      await t.click(await titleBar(nodes.up));
      await t.beat(300);
      await t.press("Delete");
      await t.beat(1500);
      const sub = await page.evaluate(() => {
        const g = window.app?.graph as { nodes?: { id: number | string; subgraph?: unknown }[] } | undefined;
        return String(g?.nodes?.find((n) => n.subgraph)?.id ?? "");
      });
      const badge = t.node(sub).getByText(/missing \$time|\d+ conflicts?/).first();
      await badge.waitFor({ timeout: 8000 });
      await t.callout("badge", badge, "What broke inside", 6);
      await t.say("Nothing sets time any more, and the subgraph's badge says so, without opening it. It shows the worst problem inside, or how many there are.");
      await t.waitVoice();
      await t.uncallout("badge");
      await t.say("Undo puts it back.");
      await t.press("ControlOrMeta+z");
      await t.beat(1500);
      await t.waitVoice();
      return sub;
    }).then(async (sub) => {
      await t.h.step("Inside", async () => {
        await t.say("Enter subgraph opens it. Inside are the same nodes, with the subgraph's inputs on the left and outputs on the right.");
        await t.click(t.node(sub).getByText("Enter subgraph"));
        await t.beat(2000);
        await t.waitVoice();
      });

      await t.h.step("A panel on the subgraph node", async () => {
        await t.say("Folded away, the Context's modules are out of reach from outside. Select the Context in here: the eye in its toolbar shows its panel on the subgraph node.");
        const inner = await page.evaluate(() => {
          const g = (window.app?.canvas as { graph?: { nodes?: { id: number | string; type?: string }[] } } | undefined)?.graph;
          return String(g?.nodes?.find((n) => n.type === "WP_Context")?.id ?? "");
        });
        if (!inner) throw new StepError("No WP Context inside the subgraph.");
        await t.click(await titleBar(inner));
        await t.beat(800);
        const eye = page.locator(".wp-tb-icon--show").first().locator("xpath=ancestor::button[1]");
        if (await eye.isVisible().catch(() => false)) {
          await t.callout("eye", eye, "Show on the subgraph node", 4);
          await t.waitVoice();
          await t.click(eye);
          await t.beat(900);
          await t.uncallout("eye");
        } else {
          // An older build without the toolbar eye: the right-click item does the same.
          await t.click(await titleBar(inner), { right: true });
          await t.beat(700);
          const show = page.getByText("Show on subgraph node", { exact: true }).last();
          await show.waitFor({ state: "visible", timeout: 5000 }).catch(() => {
            throw new StepError("Neither the toolbar eye nor Show on subgraph node is there.");
          });
          await t.click(show);
          await t.beat(900);
        }
        await t.say("Right-click, Show on subgraph node, does the same.");
        await t.waitVoice();
        await t.say("Back out to the main graph.");
        const crumb = page.locator('[class*="breadcrumb"]').getByText(/^\s*(Graph|Unsaved Workflow.*)\s*$/).first();
        if (await crumb.isVisible().catch(() => false)) await t.click(crumb);
        else await page.evaluate(() => (window.app?.canvas as { setGraph?: (g: unknown) => void } | undefined)?.setGraph?.(window.app?.graph));
        await t.beat(1500);
        await t.waitVoice();
        await t.callout("copy", t.node(sub), "The Context's panel, outside", 5);
        await t.say("The subgraph node now carries a copy of the panel. Change a module here or inside: both sides follow, and the node inside is still what runs. Every subgraph node made from this subgraph shows it, and it's saved with the workflow.");
        await t.waitVoice();
        await t.uncallout("copy");
        const choose = t.node(sub).locator('[aria-label="Choose what shows"]').first();
        await t.callout("choose", choose, "Choose what shows", 4);
        await t.say("The sliders on its header choose what shows on this copy. Untick Role, and only the lighting rule stays out here; the node inside keeps everything.");
        await t.click(choose);
        await t.beat(700);
        await t.uncallout("choose");
        const role = page.locator('[role="menuitemcheckbox"], [role="menuitem"]').filter({ hasText: /^\s*Role\s*$/ }).first();
        if (await role.isVisible().catch(() => false)) {
          await t.click(role);
          await t.beat(700);
        }
        await t.press("Escape");
        await t.beat(700);
        await t.waitVoice();
        await t.say("The same menu's Move up and Move down order the panels when the subgraph node shows several. They always sit below ComfyUI's own widgets.");
        await t.waitVoice();
        const hide = t.node(sub).locator('[aria-label="Hide from subgraph node"]').first();
        await t.callout("hide", hide, "Take the copy off", 4);
        await t.say("The cross takes the copy off again, as does the eye on the node inside. ComfyUI's own subgraph Parameters panel lists WP panels under hidden parameters too, and its eye shows or hides them the same way.");
        await t.waitVoice();
        await t.uncallout("hide");
      });
    });

    await t.h.step("Outro", async () => {
      await t.say("Fold a busy part into a subgraph: its variables still flow, and the badge keeps watch. Next: warnings on the canvas.");
    });
  },
);
