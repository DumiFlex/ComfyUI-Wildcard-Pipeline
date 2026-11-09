// Advanced 16: loops and seeds. A Context Loop runs four frames of Role, Hair and Time of day;
// $iteration (shown, not internal) numbers each prompt. The seeds window lists each frame's seed and
// locks one. Sweep combinations runs every Time of day × Hair pair while the role holds. A WP Seed
// List on loop_config gives the sampler one seed per frame. Run with Easy-Use's Show Any, which lists every frame (Preview as Text shows only one).
import { tutorial } from "../tutorial.js";

tutorial(
  "A16",
  {
    title: "Loops and seeds",
    description: "Make several prompts from one click with the Context Loop, number them, keep a frame's seed, sweep every combination, and give each image its own sampler seed.",
    learn: "Context Loop count and $iteration, per-frame seeds and locks, Sweep combinations, WP Seed List.",
  },
  async (t) => {
    const page = t.page;
    // A highlight on a Show Any waits until the run's text is in it, not just until the run ends.
    const filled = async (node: string, re: RegExp) => {
      for (let i = 0; i < 60; i++) {
        if (re.test(await t.node(node).innerText().catch(() => ""))) break;
        await t.beat(250);
      }
      await t.beat(400);
    };

    const nodes = await t.h.step("Four frames", async () => {
      await t.go("/");
      await t.say("A Context Loop runs everything after it several times from one Run. Put it before your first Context.");
      const loop = await t.addNode("WP Context Loop", { x: 270, y: 170 });
      const ctx = await t.addNode("WP Context", { x: 790, y: 170 });
      await t.wire(loop, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role", "Hair", "Time of day"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.say("To read the prompts, add Show Any from the Easy-Use pack: it lists every prompt the loop makes.");
      const text = await t.addNode("Show Any", { x: 1340, y: 620 });
      await t.wire(asm, "prompt", text, "anything");
      await t.waitVoice();
      await t.say("The loop writes iteration, the frame's number. It's hidden by default, so it stays out of prompts. Untick hidden to print it.");
      const hidden = t.node(loop).locator('[data-test="loop-iteration-internal"]');
      await t.callout("it", t.node(loop).locator('[data-test="loop-iteration-var"]'), "$iteration: 1, 2, 3 …", 4);
      await t.click(hidden);
      await t.beat(600);
      await t.waitVoice();
      await t.uncallout("it");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("frame $iteration: a painting of $role with $hair, $time", { cps: 16 });
      await t.beat(600);
      await t.say("Set the count to four, and Run.");
      const more = t.node(loop).locator('[data-widget-name="count"] button').last();
      for (let i = 0; i < 3; i++) {
        await t.click(more);
        await t.beat(350);
      }
      await t.run();
      await filled(text, /frame 4/);
      await t.callout("out", t.node(text), "Four numbered prompts", 6);
      await t.say("Four prompts from one click, each with its own picks.");
      await t.waitVoice();
      await t.uncallout("out");
      return { loop, ctx, asm, text };
    });

    await t.h.step("A seed per frame", async () => {
      await t.say("Each frame rolls on its own seed. The seeds button lists them.");
      await t.click(t.node(nodes.loop).locator('[data-test="loop-seeds-btn"]'));
      await t.beat(900);
      const modal = page.locator('[data-test="seed-modal"]').last();
      await t.callout("seeds", modal, "One seed per frame", 5);
      await t.waitVoice();
      await t.uncallout("seeds");
      await t.say("Lock a frame you like, and it keeps its seed while the others change. That's how you keep a good one and reroll the rest.");
      const lock = modal.locator('[data-test="seedrow-lock"]').nth(1);
      await t.click(lock);
      await t.beat(700);
      await t.waitVoice();
      await t.say("Same base seed, same strategy, same batch: a loop is repeatable.");
      await t.click(modal.locator('[data-test="seed-modal-done"]'));
      await t.beat(700);
      await t.waitVoice();
    });

    await t.h.step("Sweep every combination", async () => {
      await t.say("Instead of random rolls, a sweep runs every combination you choose. Open Sweep combinations and switch it on.");
      await t.click(t.node(nodes.loop).locator('[data-test="loop-sweep-btn"]'));
      await t.beat(900);
      const modal = page.locator('[data-test="sweep-modal"]').last();
      await t.click(modal.locator('[data-test="sweep-toggle"]'));
      await t.beat(600);
      await t.waitVoice();
      await t.say("Add Time of day, then Hair.");
      for (const name of [/time/i, /^hair\b/i]) {
        // The add list is a native drop-down: choose the option whose label matches.
        const add = modal.locator('[data-test="sweep-add"]');
        const select = (await add.evaluate((el) => el.tagName)) === "SELECT" ? add : add.locator("select").first();
        const value = await select.locator("option").evaluateAll(
          (opts, src) => (opts as HTMLOptionElement[]).find((o) => new RegExp(src, "i").test(o.text))?.value ?? "",
          name.source,
        );
        await t.choose(select, value);
        await t.beat(800);
      }
      await t.callout("total", modal.locator('[data-test="sweep-total"]'), "3 times 4: twelve frames", 5);
      await t.say("Three times of day by four hair styles: twelve frames. The role isn't swept, so Hold other picks keeps one role on all of them.");
      await t.waitVoice();
      await t.uncallout("total");
      await t.click(modal.locator('[data-test="sweep-modal-done"]'));
      await t.beat(700);
      await t.say("Run.");
      await t.run();
      await filled(nodes.text, /frame 12/);
      await t.callout("out", t.node(nodes.text), "Every pair, one role", 6);
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("Seeds for the sampler", async () => {
      await t.say("The loop varies the prompt. For a new image seed per frame too, wire loop config into a WP Seed List, and its seed output into your KSampler.");
      const sl = await t.addNode("WP Seed List", { x: 270, y: 680 });
      await t.wire(nodes.loop, "loop_config", sl, "loop_config");
      const p2 = await t.addNode("Show Any", { x: 790, y: 720 });
      await t.wire(sl, "seed", p2, "anything");
      await t.run();
      await filled(p2, /\d{4,}[\s\S]*\d{4,}/);
      await t.callout("sl", t.node(p2), "One sampler seed per frame", 5);
      await t.waitVoice();
      await t.uncallout("sl");
      await t.say("Without it, a plain KSampler uses one seed for every frame, which is what you want for a clean sweep comparison.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Loops make batches, number them, keep the seeds you like and sweep combinations. Next: switches.");
    });
  },
);
