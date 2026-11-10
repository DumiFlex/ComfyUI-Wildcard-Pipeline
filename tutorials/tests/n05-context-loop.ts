// Nodes 5: WP Context Loop in depth. Loop → Context (Role, Setting, Time of day, Lighting from time,
// Framing, Companion) → Assembler → Show Any (Easy-Use, it lists every frame). What runs again and how
// a loop differs from ComfyUI's batch size and Run count; the Edit frame chips (a frame's own pick, a
// lock on one frame, a module off on one frame and on for one frame only); Override Context seed and
// the strategies; the seeds panel; Ctrl-click to skip a frame and Alt-click to lock its seed; the
// values input; a derivation on $iteration ("Shot per frame", made off camera) against a frame edit;
// then WP Seed List, Hold across run and Bypass loop. Prompt-only: no model.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

// A rule on $iteration, made off camera: frame 1 is the establishing shot, the rest close-ups.
const SHOT = {
  type: "derivation",
  name: "Shot per frame",
  description: "Frame 1 is a wide establishing shot, every other frame a close-up.",
  payload: {
    rules: [
      {
        id: "a51c0e01",
        branches: [{ condition: { var: "iteration", op: "equals", value: "1" }, action: { target_var: "shot", mode: "replace", value: "wide establishing shot" } }],
        else: { action: { target_var: "shot", mode: "replace", value: "close-up" } },
      },
    ],
  },
};

tutorial(
  "N05",
  {
    title: "WP Context Loop in depth",
    description: "Everything the Context Loop does: frames vs ComfyUI's batch, editing one frame, skipping and locking frames, seeds and strategies, a list of values, and how it works with the nodes around it.",
    learn: "Loop vs batch size vs Run count, Edit frame chips, per-frame locks and on/off, Override Context seed, strategies, the seeds panel, Ctrl/Alt-click, values, $iteration rules, Seed List, Hold, Bypass loop.",
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
    const chip = (loop: string, n: number | "base") => t.node(loop).locator(`[data-test="loop-frame-${n}"]`);
    // Ctrl / Alt held through one click, as a person does it.
    const modClick = async (key: "Control" | "Alt", target: ReturnType<typeof chip>) => {
      await t.moveTo(await t.centre(target));
      await page.keyboard.down(key);
      await t.click(target);
      await page.keyboard.up(key);
      await t.beat(600);
    };
    const editRow = async (ctx: string, name: string) => {
      await t.click(t.moduleRow(ctx, name).locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(900);
      return page.getByRole("dialog").last();
    };

    // Off camera: the library as the viewer has it, plus the $iteration rule for step 7.
    await t.tidyLibrary();
    const made = await t.h.api("/wp/api/modules", { method: "POST", body: SHOT });
    if (made.status >= 300) throw new StepError(`Couldn't add "Shot per frame" (${made.status}).`);

    const n = await t.h.step("What runs again", async () => {
      await t.go("/");
      await t.speedUp();
      const loop = await t.addNode("WP Context Loop", { x: 270, y: 170 });
      const ctx = await t.addNode("WP Context", { x: 790, y: 170 });
      await t.wire(loop, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role", "Setting", "Time of day", "Lighting from time", "Framing", "Companion"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("frame $iteration: $framing of $role $setting $time, $lighting. $companion", { cps: 40 });
      await t.click(t.node(loop).locator('[data-test="loop-iteration-internal"]'));
      const text = await t.addNode("Show Any", { x: 1340, y: 640 });
      await t.wire(asm, "prompt", text, "anything");
      const more = t.node(loop).locator('[data-widget-name="count"] button').last();
      for (let i = 0; i < 3; i++) await t.click(more);
      await t.normalSpeed();
      await t.say("A loop with count four, before a Context with six items, an Assembler, and Show Any to list every prompt. iteration is printed, so each prompt says its frame.");
      await t.waitVoice();
      await t.callout("after", [t.node(ctx), t.node(asm), t.node(text)], "Runs once per frame", 6);
      await t.say("The loop goes before your first Context. Everything after it runs once per frame: the Contexts, the Assembler, a Cleaner, Debug, and the sampler.");
      await t.waitVoice();
      await t.uncallout("after");
      await t.say("Run.");
      await t.run();
      await filled(text, /frame 4/);
      await t.callout("out", t.node(text), "Four frames, four sets of picks", 6);
      await t.waitVoice();
      await t.uncallout("out");
      return { loop, ctx, asm, text };
    });

    await t.h.step("Not ComfyUI's batch", async () => {
      await t.say("This isn't the same as ComfyUI's batch. There are three ways to get four images, and they do different things.");
      const latent = await t.addNode("Empty Latent Image", { x: 790, y: 760 });
      await t.waitVoice();
      await t.callout("bs", t.node(latent).locator('[data-widget-name="batch_size"]').first(), "One prompt, four noise seeds", 6);
      await t.say("Batch size on the latent: one prompt, one sampler pass, four noise seeds. All four images have the same picks.");
      await t.waitVoice();
      await t.uncallout("bs");
      const count = page.locator('[data-testid="batch-count-edit"], .batch-count, [aria-label*="Batch count" i]').first();
      const runBox = (await count.count()) ? count : page.getByRole("button", { name: "Run", exact: true }).first();
      await t.callout("rc", runBox, "Four separate runs", 6);
      await t.say("The run count next to Run queues four separate runs. With the seed on randomize each one rolls new picks, but no node ever sees the four together.");
      await t.waitVoice();
      await t.uncallout("rc");
      await t.callout("loop", t.node(n.loop), "One run, four frames", 6);
      await t.say("The loop is one run with four frames. Each frame has its own picks, prompt and seed, and you can edit, skip or lock it on its own.");
      await t.waitVoice();
      await t.say("And the nodes after it get all four as one list, so an Image Filter, Label and Grid or a Seed List can work across the frames.");
      await t.waitVoice();
      await t.uncallout("loop");
      await t.say("They stack, too: four frames with a batch size of two make eight images, two per prompt.");
      await t.waitVoice();
      // Off the canvas again: the rest of the video doesn't use it.
      await page.evaluate((id) => {
        const g = window.app?.graph as unknown as { getNodeById(i: string | number): unknown; remove(n: unknown): void } | undefined;
        const node = g?.getNodeById(id) ?? g?.getNodeById(Number(id));
        if (g && node) g.remove(node);
        window.app?.canvas?.setDirty(true, true);
      }, latent);
      await t.beat(500);
    });

    await t.h.step("Edit one frame", async () => {
      const chips = t.node(n.loop).locator('[data-test="loop-frames-grid"]');
      await t.callout("chips", chips, "base, then each frame", 5);
      await t.say("Edit frame has a chip per frame. Base is what every frame shares. Click a frame, and the row editors on the Context edit that frame only.");
      await t.waitVoice();
      await t.uncallout("chips");
      await t.say("Click two. Then edit Time of day, and leave only at night.");
      await t.click(chip(n.loop, 2));
      await t.beat(700);
      const modal = await editRow(n.ctx, "Time of day");
      await t.callout("banner", modal.locator('[data-test="modal-frame-banner"]'), "Only frame 2", 6);
      await t.say("The banner says it: changes here affect frame two only. Revert puts the frame back to the base.");
      await t.waitVoice();
      await t.uncallout("banner");
      for (const v of ["at dawn", "at sunset"]) {
        await t.click(modal.locator(`[data-test="opt-check"][aria-label="Use option ${v}"]`));
        await t.beat(400);
      }
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(900);
      await t.callout("ov", t.moduleRow(n.ctx, "Time of day").locator('[data-test="mod-override"]'), "Changed on frame 2", 5);
      await t.say("The row shows the override while frame two is open.");
      await t.waitVoice();
      await t.uncallout("ov");
      await t.say("Lock works per frame too. Lock Role here, and frame two keeps its role while the other frames still roll.");
      await t.click(t.moduleRow(n.ctx, "Role").locator('[data-test="row-action-lock"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.callout("grey", [t.moduleRow(n.ctx, "Role").locator('[data-test="row-action-internal"]')], undefined, 4);
      await t.say("Hide from prompt and Hold across run are greyed out on a frame: they always apply to every frame.");
      await t.waitVoice();
      await t.uncallout("grey");

      await t.say("Now frame three, and untick Lighting from time. Frame three gets no lighting.");
      await t.click(chip(n.loop, 3));
      await t.beat(600);
      await t.click(t.moduleRow(n.ctx, "Lighting from time").locator('[data-test="module-enabled"]'));
      await t.beat(700);
      await t.waitVoice();

      await t.say("It works the other way round too. On base, untick Companion. Then on frame four, tick it again: only frame four gets a companion.");
      await t.click(chip(n.loop, "base"));
      await t.beat(600);
      await t.click(t.moduleRow(n.ctx, "Companion").locator('[data-test="module-enabled"]'));
      await t.beat(600);
      await t.click(chip(n.loop, 4));
      await t.beat(600);
      await t.click(t.moduleRow(n.ctx, "Companion").locator('[data-test="module-enabled"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.click(chip(n.loop, "base"));
      await t.beat(500);
      await t.say("Run.");
      await t.run();
      await filled(n.text, /frame 4/);
      await t.callout("out", t.node(n.text), "2 at night, 3 unlit, a companion on 4", 6);
      await t.say("Frame two is at night, frame three has no lighting, and only frame four has a companion.");
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("Override Context seed", async () => {
      const sw = t.node(n.loop).locator('[data-test="loop-override-toggle"]');
      await t.callout("ov", sw, "Off: each Context keeps its seed", 4);
      await t.say("Override Context seed is off by default. Each Context keeps its own seed, and the loop changes it a little per frame.");
      await t.waitVoice();
      await t.say("Switch it on, and the loop's own seed decides every frame. Same loop seed, same batch, every time.");
      await t.click(sw);
      await t.beat(700);
      await t.waitVoice();
      await t.uncallout("ov");
      const strat = t.node(n.loop).locator('[aria-label="Seed strategy"]');
      await t.callout("st", strat, "Which numbers, not how varied", 4);
      await t.say("Strategy picks how the frame seeds are worked out: hash looks random, sequential counts up, and stride takes big even jumps. It changes the numbers, not how varied the frames are.");
      await t.click(t.node(n.loop).locator('[data-test="loop-strategy-sequential"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.uncallout("st");
      await t.say("Run, so the loop has seeds to remember.");
      await t.run();
      await filled(n.text, /frame 4/);
      await t.waitVoice();
    });

    await t.h.step("The seeds panel", async () => {
      await t.say("Per-iteration seeds lists the seed each frame will use. With sequential, they count up from the base.");
      await t.click(t.node(n.loop).locator('[data-test="loop-seeds-btn"]'));
      await t.beat(900);
      const modal = page.locator('[data-test="seed-modal"]').last();
      await t.waitVoice();
      await t.say("Lock a frame to keep its seed. Lock all and Unlock all work on the whole list.");
      await t.click(modal.locator('[data-test="seedrow-lock"]').nth(0));
      await t.beat(600);
      await t.click(modal.locator('[data-test="mx-seed-lockall"]'));
      await t.beat(700);
      await t.click(modal.locator('[data-test="mx-seed-unlockall"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.callout("cp", [modal.locator('[data-test="mx-seed-copy"]'), modal.locator('[data-test="mx-seed-paste"]')], "Move seeds between loops", 4);
      await t.say("Copy and Paste carry the seeds over as text, to another loop or a Seed List.");
      await t.waitVoice();
      await t.uncallout("cp");
      const prev = modal.locator('[data-test="seedrow-lockprev"]').nth(2);
      await t.callout("prev", prev, "The seed frame 3 used last run", 4);
      await t.say("Liked frame three last time? Prev locks the seed it used on that run, even if the list has moved on since.");
      await t.click(prev);
      await t.beat(700);
      await t.waitVoice();
      await t.uncallout("prev");
      await t.click(modal.locator('[data-test="seed-modal-done"]'));
      await t.beat(600);
    });

    await t.h.step("Skip and lock from the chips", async () => {
      // No label: it would sit on the chips the line is about.
      await t.callout("hint", t.node(n.loop).locator('[data-test="loop-frames-hint"]'), undefined, 4);
      await t.say("The chips have two shortcuts, written under them. Ctrl-click a frame to skip it. Ctrl-click four.");
      await t.waitVoice();
      await t.uncallout("hint");
      await modClick("Control", chip(n.loop, 4));
      await t.waitVoice();
      await t.say("Alt-click a frame to lock its seed. Alt-click one.");
      await modClick("Alt", chip(n.loop, 1));
      await t.waitVoice();
      await t.say("Run. Frame four makes nothing now, so the loop gives three prompts.");
      await t.run();
      await filled(n.text, /frame 3/);
      await t.callout("out", t.node(n.text), "Frame 4 skipped", 5);
      await t.waitVoice();
      await t.uncallout("out");
      await t.say("Ctrl-click it again to bring it back.");
      await modClick("Control", chip(n.loop, 4));
      await t.waitVoice();
    });

    await t.h.step("A list of values", async () => {
      await t.say("The values input takes a list. Wire in a text with one line per frame.");
      const vals = await t.addNode("Text (Multiline)", { x: 270, y: 760 });
      await t.click(t.node(vals).locator("textarea").first());
      await t.type("a lighthouse\na windmill\na stone bridge", { cps: 18 });
      await t.beat(400);
      await t.wire(vals, "STRING", n.loop, "values");
      await t.beat(700);
      await t.callout("note", t.node(n.loop).locator('[data-test="loop-values-note"]'), "One frame per line", 5);
      await t.say("Each line becomes a frame, and writes iteration value. The number of lines sets the count.");
      await t.waitVoice();
      await t.uncallout("note");
      await t.say("Add it to the prompt.");
      await t.click(t.node(n.asm).locator("textarea, [contenteditable='true']").first());
      await page.keyboard.press("End");
      await t.type(" In the background: $iteration_value.", { cps: 18 });
      await t.run();
      await filled(n.text, /stone bridge/);
      await t.callout("out", t.node(n.text), "Three lines, three frames", 5);
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("Rules on $iteration", async () => {
      await t.say("A frame edit lives on this canvas only. For a pattern you can share, write a rule on iteration. Add Shot per frame: frame one gets a wide establishing shot, the others a close-up.");
      await t.pickModules(n.ctx, ["Shot per frame"]);
      await t.waitVoice();
      await t.click(t.node(n.asm).locator("textarea, [contenteditable='true']").first());
      await page.keyboard.press("Control+Home");
      await t.type("$shot, ", { cps: 16 });
      await t.run();
      await filled(n.text, /establishing/);
      await t.callout("out", t.node(n.text), "Frame 1 wide, the rest close", 5);
      await t.say("A rule is saved in bundles and works in any loop. A frame edit is quicker for one canvas.");
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("With the other nodes", async () => {
      await t.say("A plain KSampler uses one image seed for every frame. Wire loop config into a WP Seed List, and its seed into the sampler, for one image seed per frame.");
      const sl = await t.addNode("WP Seed List", { x: 790, y: 760 });
      await t.wire(n.loop, "loop_config", sl, "loop_config");
      await t.beat(600);
      // It lands low, under the caption: bring it up into view while it's talked about.
      const back = await t.zoomOn(sl, { scale: 0.9 });
      await t.callout("ovr", t.node(sl).locator('[data-test="seedlist-override-count-toggle"]'), "Count and strategy follow the loop", 5);
      await t.say("Its count and strategy follow the loop by themselves, so frame one goes with seed one, frame two with seed two.");
      await t.waitVoice();
      await t.uncallout("ovr");
      await t.setView(back);
      await t.say("Hold across run, on a row's menu, rolls once per run and keeps that pick on every frame. Hold Setting, and all three frames share one place.");
      await t.click(t.moduleRow(n.ctx, "Setting").locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Hold across run" }));
      await t.beat(700);
      await t.run();
      await filled(n.text, /stone bridge/);
      await t.callout("out", t.node(n.text), "One place, three frames", 5);
      await t.waitVoice();
      await t.uncallout("out");
      await t.say("And Bypass loop runs a single frame without unwiring anything, handy while you build.");
      await t.click(t.node(n.loop).locator('[data-test="loop-bypass-toggle"]'));
      await t.beat(600);
      await t.run();
      await t.beat(800);
      await t.waitVoice();
      await t.click(t.node(n.loop).locator('[data-test="loop-bypass-toggle"]'));
      await t.beat(500);
      await t.say("WP Debug after the Context shows each frame's picks, and which frame had an item off. The Debug video goes through it.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for the loop when you want a set of prompts you can compare, edit and keep frame by frame. The Context Loop page in the docs has every field.");
    });
  },
);
