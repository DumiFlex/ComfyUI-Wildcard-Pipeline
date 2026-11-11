// Advanced 9: how far a constraint reaches. Three chained Contexts: Role (only the inventor) + the
// constraint, then Setting, then Setting again bound to $later. Reach "all" keeps both settings out of
// the forest; "first" covers only the next one, so the later one can roll a forest; "pick" ticks exactly
// which ones. The constraint's reach is changed for this node in its Edit view. One Int node feeds
// all three seeds, so a step rolls the whole chain. Last, a wildcard that reads Setting through an
// @{} reference ("Daydream", made off camera) shows the constraint reaching inside nested picks too.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

// Off camera: a wildcard whose option reads Setting through an @{} reference.
const DAYDREAM = {
  id: "9e1a7c42",
  type: "wildcard",
  name: "Daydream",
  description: "Reads Setting through an @{} reference, so a constraint on Setting reaches inside it.",
  payload: {
    var_binding: "daydream",
    sub_categories: [],
    options: [{ id: "d1a7c420", value: "dreaming of being @{aa76ada8#Setting}", weight: 1, sub_categories: [] }],
  },
};

tutorial(
  "A09",
  {
    title: "How far a constraint reaches",
    description: "Choose which of the wildcards after a constraint it covers: the first, the next few, all of them, or ones you pick, even across chained Contexts and inside nested wildcards.",
    learn: "Target reach (first / next N / all / pick), chained Contexts, nested wildcards, and how several constraints combine.",
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

    await t.tidyLibrary();
    const made = await t.h.api("/wp/api/modules", { method: "POST", body: DAYDREAM });
    if (made.status >= 300) throw new StepError(`Couldn't add "Daydream" (${made.status}).`);

    const nodes = await t.h.step("Two settings", async () => {
      await t.go("/");
      await t.say("A story in two places. The first Context picks the role and the Role fits the place constraint.");
      const c1 = await t.addNode("WP Context", { x: 340, y: 170 });
      await t.pickModules(c1, ["Role", "Role fits the place"]);
      await t.say("For a clear test, keep only the clockwork inventor on this node. Inventors are never sent to the forest.");
      let modal = await editItem(c1, "Role");
      for (const who of ["a knight", "a battle mage", "a forest ranger"]) {
        await t.click(modal.getByLabel(`Use option ${who}`));
        await t.beat(200);
      }
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.say("A second Context picks the first setting, and a third picks Setting again, renamed to later for this node.");
      const c2 = await t.addNode("WP Context", { x: 1000, y: 170 });
      await t.wire(c1, "context", c2, "upstream");
      await t.pickModules(c2, ["Setting"]);
      const c3 = await t.addNode("WP Context", { x: 1000, y: 560 });
      await t.wire(c2, "context", c3, "upstream");
      await t.pickModules(c3, ["Setting"]);
      await t.waitVoice();
      await t.say("Edit the third one's Setting, and change its variable to later, so the two settings don't overwrite each other.");
      modal = await editItem(c3, "Setting");
      const binding = modal.getByLabel("Variable binding");
      await t.fill(binding, "later", { cps: 12 });
      await t.press("Tab");
      await t.beat(500);
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(700);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1560, y: 170 });
      await t.wire(c3, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $setting, and later $later", { cps: 16 });
      await t.beat(600);
      await t.waitVoice();
      await t.say("Each Context has its own seed. To roll the whole chain at once, add an Int node and wire it into all three seeds.");
      const seed = await t.addNode("Int", { x: 360, y: 680 });
      for (const c of [c1, c2, c3]) {
        await t.wire(seed, "INT", c, "seed");
        await t.beat(300);
      }
      await t.waitVoice();
      return { c1, c2, c3, asm, seed };
    });

    const prev = t.node(nodes.asm).locator('[data-test="asm-preview"]');
    const plus = t.node(nodes.seed).getByRole("button", { name: /increment|increase|\+/i }).first();
    const roll = async (n: number, until?: RegExp) => {
      for (let i = 0; i < n; i++) {
        await t.click(plus);
        await t.beat(800);
        if (until && until.test(((await prev.count()) > 0 ? ((await prev.textContent()) ?? "") : ""))) break;
      }
    };

    await t.h.step("All", async () => {
      await t.say("Reach is all by default: the constraint covers every Setting after it, in this Context or in the ones it feeds. Neither place is ever a forest.");
      await t.callout("prev", prev, "Castle or city, both times", 6);
      await roll(4);
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("First", async () => {
      await t.say("Edit the constraint on this node.");
      const modal = await editItem(nodes.c1, "Role fits the place");
      const section = modal.locator('[data-test="reach-section"]');
      await t.scrollTo(section, { at: 0.5 });
      await t.callout("reach", section, "Reach: which Settings it changes", 6);
      await t.say("Reach says which Settings it changes. Set it to first.");
      await t.waitVoice();
      await t.click(modal.locator('[data-test="reach-mode-first"]'));
      await t.uncallout("reach");
      await t.beat(600);
      await t.callout("hint", modal.locator('[data-test="reach-hint"]'), "Only the next Setting", 6);
      await t.waitVoice();
      await t.uncallout("hint");
      await t.click(modal.locator('[data-test="reach-mode-next"]'));
      await t.beat(500);
      await t.callout("next", section, "Next N: a count", 6);
      await t.say("Next N covers the next few, by a count.");
      await t.waitVoice();
      await t.beat(600);
      await t.uncallout("next");
      await t.click(modal.locator('[data-test="reach-mode-first"]'));
      await t.beat(400);
      await t.waitVoice();
      await t.click(modal.locator('[data-test="cnm-save"]'));
      await t.beat(700);
      await t.say("Now only the first place follows the rule. Change the seed until the later one lands somewhere new.");
      await roll(14, /later in a (misty pine forest|mossy clearing)/);
      if (!/later in a (misty pine forest|mossy clearing)/.test((await prev.textContent()) ?? "")) {
        throw new Error("The preview never put the later place in a forest with reach first");
      }
      await t.callout("prev", prev, "The later place can be a forest", 6);
      await t.say("The later one rolls freely, forests included.");
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("Pick", async () => {
      const modal = await editItem(nodes.c1, "Role fits the place");
      await t.scrollTo(modal.locator('[data-test="reach-section"]'), { at: 0.5 });
      await t.click(modal.locator('[data-test="reach-mode-pick"]'));
      await t.beat(700);
      const list = modal.locator('[data-test="reach-picklist"]');
      await t.callout("list", list, "Each Setting, on its node", 6);
      await t.say("Pick lists every Setting the constraint can reach, with its node, so you tick exactly the ones it covers.");
      const boxes = list.getByRole("checkbox");
      await t.click(boxes.last());
      await t.beat(600);
      await t.waitVoice();
      await t.uncallout("list");
      await t.click(modal.locator('[data-test="cnm-save"]'));
      await t.beat(700);
      await t.say("Ticking only the later one flips it: now the first place is free and the later one obeys.");
      await roll(3);
      await t.waitVoice();
    });

    await t.h.step("Inside nested wildcards", async () => {
      // Checked against the engine: with reach all, a Setting read through @{} in another wildcard's
      // option is re-weighted like a direct one (the inventor never dreams of a forest).
      await t.say("Reach also goes inside nested wildcards. Daydream reads Setting through an at reference. Add it to the third Context.");
      await t.pickModules(nodes.c3, ["Daydream"]);
      await t.click(t.node(nodes.asm).locator("textarea, [contenteditable='true']").first());
      await t.press("End");
      await t.type(", $daydream", { cps: 14 });
      await t.beat(600);
      await t.waitVoice();
      const modal = await editItem(nodes.c1, "Role fits the place");
      await t.scrollTo(modal.locator('[data-test="reach-section"]'), { at: 0.5 });
      const nested = modal.locator('[data-test="reach-picklist"] .rh-pick__row').filter({ has: page.locator(".rh-pick__tag--nested") }).first();
      await t.callout("nested", nested, "Setting, inside Daydream", 6);
      await t.say("The list now shows the Setting inside Daydream too, marked nested: a pick can tick it like any other.");
      await t.waitVoice();
      await t.uncallout("nested");
      await t.say("Set reach back to all.");
      await t.click(modal.locator('[data-test="reach-mode-all"]'));
      await t.beat(600);
      await t.click(modal.locator('[data-test="cnm-save"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.say("Now every Setting follows the rule, the ones on the nodes and the one inside Daydream. The inventor never even dreams of a forest.");
      await t.callout("prev", prev, "No forest, not even in the dream", 6);
      for (let i = 0; i < 5; i++) {
        await t.click(plus);
        await t.beat(800);
        if (/forest/.test((await prev.textContent()) ?? "")) throw new StepError("A forest got through with reach all.");
      }
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("Several constraints", async () => {
      await t.say("When several constraints cover the same wildcard, they all apply: their factors multiply, and an exclude always wins.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("First, next N, all or pick: reach decides which wildcards after a constraint it changes, across a whole chain and inside nested ones. Next: negatives.");
      // The item stays until the next video's tidyLibrary: deleting it here, still on camera, made
      // the canvas show it as missing at the end.
    });
  },
);
