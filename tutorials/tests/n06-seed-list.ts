// Nodes 6: WP Seed List in depth (the depth standard). Alone first: base_seed and count, seed (out)
// into a KSampler (with the showcase model, one prompt run once per seed: four images). The seeds
// panel: what each strategy gives (hash / sequential / stride), a lock, Lock all / Unlock all,
// Copy / Paste, typing or rolling one seed, Prev after a run; the frame chips. Then with a Context
// Loop: loop_config in, the three Override switches (count and strategy switch on by themselves), a
// skipped loop frame shown on the Seed List. How it works, recipes, gotchas. The runs need a model, so
// they are only recorded with showcase on; the field tour runs without.
import { StepError } from "watchwright";
import { showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "N06",
  {
    title: "WP Seed List in depth",
    description: "Give every frame its own image seed you can repeat: base seed, count, the three strategies, locking and copying seeds, and following a Context Loop.",
    learn: "base_seed, count, Strategy, Per-iteration seeds (lock, Lock all, Copy / Paste, Prev), the Override switches, loop_config, seed into a KSampler.",
  },
  async (t) => {
    const page = t.page;
    const sl = (id: string) => t.node(id);
    const num = (id: string, name: string) => sl(id).locator(`[data-widget-name="${name}"] input`).first();
    const modal = () => page.locator('[data-test="seed-modal"]').last();
    const openSeeds = async (id: string) => {
      await t.click(sl(id).locator('[data-test="seedlist-seeds-btn"]'));
      await t.beat(900);
      await modal().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
        throw new StepError("The seeds panel didn't open.");
      });
    };
    const closeSeeds = async () => {
      await t.click(page.locator('[data-test="seed-modal-done"]').last());
      await t.beat(600);
    };

    const n = await t.h.step("What it's for", async () => {
      await t.go("/");
      await t.say("A KSampler takes one seed, so one run gives one image per prompt. WP Seed List hands it a list of seeds instead: one run, several images, each seed known and repeatable.");
      const s = await t.addNode("WP Seed List", { x: 420, y: 150 });
      await t.waitVoice();
      const ks = await t.addNode("KSampler", { x: 1000, y: 150 });
      await t.say("Its one output, seed, goes into a KSampler's seed. ComfyUI then runs the sampler once per seed in the list.", "Its one output, seed, goes into a KSampler's seed. ComfyUI then runs the sampler once per seed in the list.");
      await t.wire(s, "seed", ks, "seed");
      await t.waitVoice();
      return { s, ks };
    });

    await t.h.step("base_seed and count", async () => {
      await t.callout("base", sl(n.s).locator('[data-widget-name="base_seed"]'), "Where the list starts", 4);
      await t.say("base_seed is where the list starts. Same base, same seeds, every time.", "Base seed is where the list starts. Same base, same seeds, every time.");
      await t.fill(num(n.s, "base_seed"), "1000", { cps: 10 });
      await t.press("Tab");
      await t.waitVoice();
      await t.uncallout("base");
      await t.callout("count", sl(n.s).locator('[data-widget-name="count"]'), "How many seeds", 4);
      await t.say("count is how many seeds: four.", "Count is how many seeds: four.");
      await t.fill(num(n.s, "count"), "4", { cps: 10 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      await t.uncallout("count");
    });

    await t.h.step("Strategy", async () => {
      await t.callout("st", sl(n.s).locator('[data-test="seedlist-strategy"]'), "How the seeds are worked out", 5);
      await t.say("Strategy is how the seeds are worked out from the base. Open Per-iteration seeds to see them.");
      await t.waitVoice();
      await t.uncallout("st");
      await openSeeds(n.s);
      await t.say("Hash, the default, scatters them: four unrelated numbers.");
      await t.waitVoice();
      await closeSeeds();
      await t.say("Sequential counts up: the base, plus one, plus two.");
      await t.click(sl(n.s).locator('[data-test="seedlist-strategy-sequential"]'));
      await t.beat(400);
      await openSeeds(n.s);
      await t.waitVoice();
      await closeSeeds();
      await t.say("Stride steps by a big fixed jump. The strategy changes which numbers you get, not how varied the images are. Keep sequential: it's the easiest to read.");
      await t.waitVoice();
    });

    await t.h.step("Per-iteration seeds", async () => {
      await openSeeds(n.s);
      await t.say("Each row is one frame. Lock one to keep its seed while the others change with the base. Lock frame two.");
      await t.click(modal().locator('[data-test="seedrow-lock"]').nth(1));
      await t.beat(600);
      await t.waitVoice();
      await t.say("A locked row also takes a seed you type, or a random one from the dice.");
      // Only a locked row has the seed box and the dice (an unlocked one shows its derived seed): frame two's.
      await t.callout("row", [modal().locator('[data-test="seedrow-input"]').first(), modal().locator('[data-test="seedrow-roll"]').first()], "Type or roll", 4);
      await t.waitVoice();
      await t.uncallout("row");
      await t.say("Lock all and Unlock all work on the whole list.");
      await t.click(modal().locator('[data-test="mx-seed-lockall"]'));
      await t.beat(600);
      await t.click(modal().locator('[data-test="mx-seed-unlockall"]'));
      await t.beat(600);
      await t.waitVoice();
      await t.callout("cp", [modal().locator('[data-test="mx-seed-copy"]'), page.locator('[data-test="mx-seed-paste"]').last()], "Seeds as text", 4);
      await t.say("Copy and Paste carry the seeds as text, to another Seed List or a Context Loop.");
      await t.waitVoice();
      await t.uncallout("cp");
      await t.say("After a run, each row's Prev locks the seed that frame used last time, even if the list has moved on.");
      await t.waitVoice();
      await closeSeeds();
      const chips = sl(n.s).locator('[data-test^="seedlist-frame-"]');
      await t.callout("chips", chips.first().locator(".."), "One chip per seed", 4);
      await t.say("The chips under the button show the same frames, with a lock mark on the locked ones.");
      await t.waitVoice();
      await t.uncallout("chips");
    });

    if (showcasing(t)) {
      await t.h.step("Four seeds, four images", async () => {
        await t.say("Give the KSampler a model, a prompt and a latent, folded down here, and run.");
        const lat = await t.addNode(t.params.unet ? "Empty Flux 2 Latent" : "Empty Latent Image", { x: 1000, y: 620 });
        await t.wire(lat, "LATENT", n.ks, "latent_image");
        await showcase(t, { prompt: "A painting of a lighthouse on a cliff at dusk.", sampler: n.ks, preview: { x: 1380, y: 120, width: 520, height: 520 }, chain: { x: 1820, y: 960 }, runs: 1 });
        await t.waitVoice();
        await t.say("One prompt, four seeds, four images. Run again with the same base and the same strategy, and you get the same four.");
        await t.waitVoice();
      });
    }

    await t.h.step("With a Context Loop", async () => {
      await t.say("Its real partner is the Context Loop, where every frame has its own prompt. Add one, and wire its loop_config into the Seed List.", "Its real partner is the Context Loop, where every frame has its own prompt. Add one, and wire its loop config into the Seed List.");
      const loop = await t.addNode("WP Context Loop", { x: 150, y: 560 });
      await t.wire(loop, "loop_config", n.s, "loop_config");
      await t.beat(800);
      await t.waitVoice();
      const ov = [
        sl(n.s).locator('[data-test="seedlist-override-seed-toggle"]'),
        sl(n.s).locator('[data-test="seedlist-override-count-toggle"]'),
        sl(n.s).locator('[data-test="seedlist-override-strategy-toggle"]'),
      ];
      await t.callout("ov", ov, "Taken from the loop", 6);
      await t.say("Three switches take the base seed, the count and the strategy from the loop. Count and strategy switched on by themselves, so there's one seed per frame. The base seed stays yours unless you switch it on.");
      await t.waitVoice();
      await t.uncallout("ov");
      await t.say("Frame one of the loop gets seed one, frame two seed two, so a prompt and its image seed stay paired, and a frame you lock in one stays matched in the other.");
      await t.waitVoice();
      await t.say("Ctrl-click a frame on the loop to skip it. The Seed List shows it bypassed too.");
      await page.keyboard.down("Control");
      await t.click(t.node(loop).locator('[data-test="loop-frame-2"]'));
      await page.keyboard.up("Control");
      await t.beat(800);
      const badge = sl(n.s).locator('[data-test="seedlist-seeds-bypass-badge"]');
      if (await badge.isVisible().catch(() => false)) await t.callout("b", badge, "Skipped on the loop", 4);
      await t.waitVoice();
      await t.uncallout("b");
    });

    await t.h.step("How it works", async () => {
      await t.say("Seed List outputs a list. ComfyUI runs everything after it once per entry, so a KSampler after it makes one image per seed, and with a loop, one per frame, each with its own prompt.");
      await t.waitVoice();
    });

    await t.h.step("Recipes and gotchas", async () => {
      await t.say("Recipe one: Context Loop, Seed List and Image Filter. Pick the keepers, Send to Loop, and the next run repeats only them with the same seeds. Recipe two: Copy the seeds of a good batch and Paste them into another workflow.");
      await t.waitVoice();
      await t.say("Gotchas. If base seed is set to randomize after each run, the list changes every run: fix it to repeat a batch. And without a loop, count decides how many images; with Override count on, the loop's frames do.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Use a Seed List whenever one run should make several images you can repeat, and always beside a Context Loop. The Seeds and loops page in the docs explains the strategies.");
      await t.waitVoice();
    });
  },
);
