// Library 1: the Test Runner. Stack Hero and Setting, run 100 seeds and read the shares; add the Hero
// fits the place constraint at the end (100 warnings: it runs after its target), move Setting after
// it and run again; open a sample's trace; switch to random seeds and a larger count.
import { tutorial } from "../tutorial.js";

tutorial(
  "L01",
  {
    title: "Test Runner",
    description: "Run a stack of items on hundreds of seeds at once, read how often each value comes up, and trace any one seed.",
    learn: "The stack, seed range or random, number of seeds, the Variables and Samples tabs, warnings and a seed's trace.",
  },
  async (t) => {
    const page = t.page;
    const add = async (name: RegExp) => {
      await t.click(page.locator('[data-test="stack-add"]'));
      await t.beat(700);
      await t.click(page.locator('[data-test="picker-option"]', { hasText: name }).first());
      await t.beat(700);
    };

    await t.h.step("A stack", async () => {
      await t.go("/wp/test");
      await t.say("The Test Runner rolls your items on many seeds at once, without a canvas. Add the items you want to test, like the modules on a Context node.");
      await add(/^Hero \$hero/);
      await add(/^Setting \$setting/);
      await t.waitVoice();
      await t.say("It runs seeds zero to ninety nine. Press Run.");
      await t.callout("seeds", page.locator('[data-test="seed-control"]'), "Which seeds, and how many", 4);
      await t.click(page.locator('[data-test="run-btn"]'));
      await t.beat(2500);
      await t.uncallout("seeds");
      await t.callout("vars", page.locator('[data-test="variables-panel"]'), "How often each value came up", 6);
      await t.say("Each variable shows how often every value came up. A hundred seeds in a fraction of a second.");
      await t.waitVoice();
      await t.uncallout("vars");
    });

    await t.h.step("Order and warnings", async () => {
      await t.say("Now add the Hero fits the place constraint, at the end, and run.");
      await add(/^Hero fits the place/);
      await t.click(page.locator('[data-test="run-btn"]'));
      await t.beat(2500);
      await t.callout("warn", page.locator('[data-test="run-stats"]'), "A warning on every seed", 5);
      await t.say("A warning on every seed. The stack runs left to right, and the constraint comes after the setting it should change, so it never applies.");
      await t.waitVoice();
      await t.uncallout("warn");
      await t.say("Remove Setting and add it again, so it comes after the constraint. You can also drag cards to reorder.");
      await t.click(page.locator('[data-test="stack-card"]').nth(1).locator('[data-test="stack-remove"]'));
      await t.beat(600);
      await add(/^Setting \$setting/);
      await t.click(page.locator('[data-test="run-btn"]'));
      await t.beat(2500);
      await t.callout("vars", page.locator('[data-test="variables-panel"]'), "No warnings, and the odds moved", 6);
      await t.say("No warnings now, and the settings' shares moved, because each hero leans to its own places.");
      await t.waitVoice();
      await t.uncallout("vars");
    });

    await t.h.step("Trace a seed", async () => {
      await t.say("Samples lists every seed and what it rolled. Click one to trace it.");
      await t.click(page.locator('[data-test="tab-samples"]'));
      await t.beat(800);
      await t.click(page.locator('[data-test="sample-row"]').first());
      await t.beat(1000);
      await t.callout("trace", page.locator('[data-test="trace-drawer"]'), "Each step, in order", 6);
      await t.say("The trace shows each step in order: what the hero rolled, what the constraint did, and the setting it picked. The same seed on a canvas Context gives the same values, and Copy seed takes it there.");
      await t.waitVoice();
      await t.uncallout("trace");
      await t.click(page.locator('[data-test="close-trace"]'));
      await t.beat(600);
    });

    await t.h.step("More seeds", async () => {
      await t.say("Range runs seeds in a row from the first one. Random picks seeds at random. Raise the count to five hundred for finer shares.");
      await t.click(page.locator('[data-test="seed-mode-random"]'));
      await t.beat(500);
      await t.fill(page.locator('[data-test="seed-count"]'), "500", { cps: 10 });
      await t.press("Tab");
      await t.beat(400);
      await t.click(page.locator('[data-test="run-btn"]'));
      await t.beat(3000);
      await t.click(page.locator('[data-test="tab-variables"]'));
      await t.beat(800);
      await t.callout("stats", page.locator('[data-test="run-stats"]'), "500 random seeds", 5);
      await t.waitVoice();
      await t.uncallout("stats");
      await t.say("Pin a value to stand in for one an upstream node would pass in. Save the scenario to keep it, and Compare shows what changed against a saved baseline after you edit an item.");
      await t.callout("pin", page.locator('[data-test="pin-open"]'), "Stand-in values", 3);
      await t.callout("save", page.locator('[data-test="save-btn"]'), "Keep this stack", 3);
      await t.waitVoice();
      await t.uncallout("pin");
      await t.uncallout("save");
    });

    await t.h.step("Outro", async () => {
      await t.say("Test a stack on hundreds of seeds, fix what the warnings point at, and trace any seed. Next: Library health.");
    });
  },
);
