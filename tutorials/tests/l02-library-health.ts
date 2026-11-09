// Library 2: Library health. A tour of the page (problems, warnings, tidy up, filters), Ignore on a
// variable an Injector sets on the canvas, then a planted mistake: Outfit gets "a plain grey wool tunic"
// twice; health lists it, Open goes to the wildcard, Remove option fixes it, Check again clears it.
import { tutorial } from "../tutorial.js";

tutorial(
  "L02",
  {
    title: "Library health",
    description: "Let the manager check your whole library for things that print wrong, likely mistakes and clutter, and fix them from one page.",
    learn: "Problems, warnings and tidy up, Open and Ignore, Check again, and the badge in the sidebar.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("The checks", async () => {
      await t.go("/wp/health");
      await t.say("Library health checks your whole library, without a canvas. It sorts what it finds three ways.");
      await t.beat(800);
      await t.callout("p", page.locator('[data-test="health-card-problem"]'), "Prints wrong, or nothing", 3);
      await t.callout("w", page.locator('[data-test="health-card-warning"]'), "Probably a mistake", 3);
      await t.callout("c", page.locator('[data-test="health-card-tidy"]'), "Clutter: nothing breaks", 3);
      await t.say("Problems print wrong or nothing. Warnings are probably mistakes. Tidy up is clutter that breaks nothing.");
      await t.waitVoice();
      await t.uncallout("p");
      await t.uncallout("w");
      await t.uncallout("c");
    });

    await t.h.step("Ignore what you meant", async () => {
      const group = page.locator('[data-test="health-group-unset_read"]');
      await t.callout("g", group, "Reads a variable nothing sets", 5);
      await t.say("These rules read LoRA variables that no library item sets. That's on purpose: an Injector on the canvas sets them. Press Ignore, and it stays quiet.");
      await t.waitVoice();
      await t.uncallout("g");
      await t.click(page.locator('[data-test^="health-ignore-unset_read"]').first());
      await t.beat(900);
      await t.say("The badge in the sidebar counts the problems left, so you see it from any page.");
      await t.callout("badge", page.locator('[data-test="health-badge"]'), "Problems left", 4);
      await t.waitVoice();
      await t.uncallout("badge");
    });

    await t.h.step("A mistake, found and fixed", async () => {
      await t.say("Now a real mistake. Open Outfit and add a tunic that's already there.");
      await t.go("/wp/wildcards/195238e2/edit");
      await t.beat(800);
      await t.click(page.locator('[data-test="wc-add-opt"]'));
      await t.beat(400);
      await t.click(page.locator('[data-test="wc-opt-row-9"] .wp-rt__host').first());
      await t.type("a plain grey wool tunic", { cps: 16 });
      await t.beat(400);
      await t.click(page.locator('[data-test="save-btn"]'));
      await t.beat(1200);
      await t.go("/wp/health");
      await t.beat(1200);
      const row = page.locator('[data-test^="health-row-duplicate_options"]').first();
      await t.callout("dup", row, "Listed twice", 5);
      await t.say("Health caught it: the same option twice. Raise one option's weight instead. Press Open.");
      await t.waitVoice();
      await t.uncallout("dup");
      await t.click(row.getByRole("button", { name: "Open" }));
      await t.beat(1200);
      const dupe = page.locator('[data-test="wc-opt-row-9"]');
      await t.hover(dupe);
      await t.beat(400);
      await t.say("Remove the copy, and save.");
      await t.click(dupe.getByRole("button", { name: "Remove option" }));
      await t.beat(500);
      await t.click(page.locator('[data-test="save-btn"]'));
      await t.beat(1200);
      await t.go("/wp/health");
      await t.beat(800);
      await t.click(page.locator('[data-test="health-recheck"]'));
      await t.beat(1200);
      await t.callout("w", page.locator('[data-test="health-card-warning"]'), "Back to zero", 4);
      await t.waitVoice();
      await t.uncallout("w");
    });

    await t.h.step("Tidy up", async () => {
      await t.say("Tidy up lists items nothing uses and variables nothing reads. Keep a ComfyUI tab open with your workflow, and Check again counts what sits on the canvas too.");
      await t.scrollTo(page.locator('[data-test="health-group-unused"]'));
      await t.callout("u", page.locator('[data-test="health-group-unused"]'), "Unused: delete, or ignore", 5);
      await t.waitVoice();
      await t.uncallout("u");
    });

    await t.h.step("Outro", async () => {
      await t.say("Check the library now and then, fix the problems, ignore what's on purpose. Next: importing wildcard packs.");
    });
  },
);
