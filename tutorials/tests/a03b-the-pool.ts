// Advanced 3b: the pool. A Context with Role and Setting. Setting's Edit window has a Pool: tick
// castle and only castle settings roll on this node; tick city too and either may (pills in one group
// are OR). The Advanced switch shows the same filter as an expression, and a typed one can say more
// ("not forest"), with "reads as" and a match count. By variable is shown last and left to A15.
import { tutorial } from "../tutorial.js";

tutorial(
  "A03b",
  {
    title: "The pool and the Advanced switch",
    description: "Narrow what a list can roll on one node by its tags, with pills or a written filter, without changing the library.",
    learn: "The Pool's tag pills, OR inside a group, the Advanced filter, reads as and the match count.",
  },
  async (t) => {
    const page = t.page;

    const nodes = await t.h.step("A list to narrow", async () => {
      await t.go("/");
      await t.say("Setting has six places, each tagged castle, forest or city. On this node, we only want some of them.");
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Role", "Setting"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $setting.", { cps: 16 });
      await t.beat(800);
      await t.waitVoice();
      return { ctx, asm };
    });

    const modal = await t.h.step("The pool", async () => {
      await t.say("Right-click Setting and press Edit. These changes stay on this node; the library keeps all six.");
      await t.click(t.moduleRow(nodes.ctx, "Setting").locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      const modal = page.getByRole("dialog").last();
      const collapse = modal.locator('[data-test="pool-collapse"]');
      if ((await collapse.getAttribute("aria-expanded")) !== "true") {
        await t.click(collapse);
        await t.beat(500);
      }
      const castle = modal.locator('[data-test="cat-chip-castle"]');
      await t.scrollTo(castle, { at: 0.45 });
      await t.waitVoice();
      await t.callout("pills", modal.locator(".pool__groups").first(), "Every tag, with how many options carry it", 6);
      await t.say("The Pool lists the tags, each with how many options carry it. Tick castle.");
      await t.waitVoice();
      await t.uncallout("pills");
      await t.click(castle);
      await t.beat(700);
      await t.say("Now only the two castle places can roll here.");
      await t.waitVoice();
      await t.say("Tick city too. Tags in the same group mean either one: a castle or a city, never the forest.");
      await t.click(modal.locator('[data-test="cat-chip-city"]'));
      await t.beat(700);
      const eff = modal.locator('[data-test="pool-effective"]');
      await t.callout("eff", eff, "The filter they make", 6);
      await t.waitVoice();
      await t.uncallout("eff");
      return modal;
    });

    await t.h.step("The Advanced switch", async () => {
      await t.say("The Advanced switch shows the same filter as text. Pills can only say which tags to keep. Text can say more, like not.");
      await t.click(modal.locator('[data-test="pool-advanced"]'));
      await t.beat(800);
      await t.waitVoice();
      const expr = modal.locator('[data-test="expr-input"]');
      await t.say("Write not forest instead. That keeps everything without a forest tag.");
      await t.fill(expr, "not forest", { cps: 10 });
      await t.beat(800);
      await t.callout("reads", [modal.locator('[data-test="expr-reads-as"]'), modal.locator('[data-test="expr-match-count"]')], "How it reads, and what it keeps", 6);
      await t.waitVoice();
      await t.say("Below it, reads as says how the filter is understood, and the count says how many options it keeps: four of six. And, or, not and brackets all work, and the chips underneath type a tag for you.");
      await t.waitVoice();
      await t.uncallout("reads");
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(900);
    });

    await t.h.step("Roll it", async () => {
      const plus = t.node(nodes.ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      const prev = t.node(nodes.asm).locator('[data-test="asm-preview"]');
      await t.callout("prev", prev, "Castles and streets, never a forest", 6);
      await t.say("Roll a few seeds. The forest never comes up on this node.");
      for (let i = 0; i < 5; i++) {
        await t.click(plus);
        await t.beat(900);
      }
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("The Pool also has By variable, which keeps the options tagged with a variable's value as the prompt runs. Model-aware prompts uses it to follow the loaded model.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("The Pool narrows a list on one node, with pills or a written filter, while the library keeps every option. Next: reading a pick's parts.");
    });
  },
);
