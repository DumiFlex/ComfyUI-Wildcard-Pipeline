// AI 3: the pack builder. Describe a pack, the recommended settings, Plan (Decide all on questions),
// the plan, Build (the check plays it), Install as one bundle with Undo, then the bundle on a Context
// with the pack's own template in an Assembler, run into a real picture.
import { StepError } from "watchwright";
import { aiWait, showcase, showcasing, tutorial } from "../tutorial.js";

const field = (id: string) => `textarea[data-test="${id}"], [data-test="${id}"] textarea, input[data-test="${id}"], [data-test="${id}"] input`;

tutorial(
  "AI3",
  {
    title: "AI assistant: the pack builder",
    description: "Describe a pack in plain words and the assistant plans it, builds every item, checks it and installs it as one bundle.",
    learn: "Describe, settings, the plan and its questions, Build and its check, Install and Undo.",
  },
  async (t) => {
    const page = t.page;
    let clean = true;
    const shows = (id: string) => page.locator(`[data-test="${id}"]:visible`).first().isVisible().catch(() => false);

    await t.h.step("Describe it", async () => {
      await t.go("/wp/pack-builder");
      if (await shows("pack-reset")) {
        await page.locator('[data-test="pack-reset"]').click();
        await t.beat(500);
      }
      await t.say("The pack builder makes a whole pack from a description. Say what the pictures are about.");
      await t.fill(page.locator(field("pack-request")).first(), "Tavern scenes in a fantasy town: a patron, what they drink, and the mood of the room.", { cps: 26 });
      await t.click(page.locator('[data-test="pack-next"]'));
      await aiWait(t, { quiet: 2000 });
      if (await shows("pack-use-recommended")) {
        await t.say("It recommends settings for the request. Use them, or pick your own.");
        await t.click(page.locator('[data-test="pack-use-recommended"]'));
        await t.beat(800);
        await t.waitVoice();
      }
    });

    await t.h.step("The plan", async () => {
      await t.say("Plan writes out the items it will make, and how they work together.");
      await t.click(page.locator('[data-test="pack-plan"]'));
      await aiWait(t, { timeout: 40 * 60_000 });
      for (let i = 0; i < 4 && (await shows("pack-decide-all")); i++) {
        if (i === 0) {
          await t.callout("q", page.locator('[data-test="pack-questions"]'), "Questions about your pack", 5);
          await t.say("When something isn't clear it asks. Answer, or let it decide.");
          await t.waitVoice();
          await t.uncallout("q");
        }
        await t.click(page.locator('[data-test="pack-decide-all"]'));
        await aiWait(t, { timeout: 40 * 60_000 });
      }
      await t.callout("plan", page.locator('[data-test="pack-plan-list"]'), "Every item, before it's built", 6);
      await t.say("Here's the plan. You can change any item, add one, or ask for changes in words before anything is built.");
      await t.waitVoice();
      await t.uncallout("plan");
    });

    await t.h.step("Build and check", async () => {
      await t.say("Build makes every item, then plays the pack to check it rolls the way you asked.");
      await t.click(page.locator('[data-test="pack-build"]'));
      await aiWait(t, { timeout: 90 * 60_000, quiet: 5000 });
      await t.waitVoice();
      // The test run's warnings ("reads $subject, which no run set", a broken rule): Fix all with AI
      // rebuilds those items and tests again, up to twice. The take says what's left, never that a
      // pack with warnings passed.
      const problems = page.locator('[data-test="pack-problems"]:visible');
      for (let round = 0; round < 2 && (await problems.isVisible().catch(() => false)); round++) {
        const fixAll = page.locator('[data-test="pack-problems-fix-all"]:visible');
        if (!(await fixAll.isVisible().catch(() => false))) break;
        if (round === 0) {
          await t.callout("found", problems, "What the test run found", 5);
          await t.say("The test run lists anything that doesn't roll right. Fix all with AI rebuilds those items and tests again.");
          await t.waitVoice();
          await t.uncallout("found");
        }
        await t.click(fixAll);
        await aiWait(t, { timeout: 60 * 60_000, quiet: 5000 });
      }
      clean = !(await problems.isVisible().catch(() => false));
      const ok = page.locator('[data-test="pack-ok"]:visible');
      if (clean && (await ok.isVisible().catch(() => false))) {
        await t.callout("ok", ok, "No warnings", 5);
        await t.say("No warnings now: every variable is set and the rules hold.");
        await t.waitVoice();
        await t.uncallout("ok");
      }
    });

    // What the library held before Install, to find the pack's bundle and template after it.
    const before = await t.h.library();
    const had = new Set([...before.bundles, ...before.templates].map((x) => x.id));
    let installed = false;

    await t.h.step("Install", async () => {
      const install = page.locator('[data-test="pack-install"]');
      if (await install.isEnabled().catch(() => false)) {
        // Install sits low on the page: bring it up out of the caption's band first.
        await t.scrollTo(install, { at: 0.45 });
        await t.say(clean
          ? "Install puts it in your library as one bundle, ready for a Context."
          : "A warning or two can stay: Install puts it in your library as one bundle, and you fix the rest in its editors.");
        await t.click(install);
        await aiWait(t, { quiet: 2000 });
        installed = true;
        await t.callout("undo", page.locator('[data-test="pack-undo"]'), "One Undo takes it all back", 4);
        await t.waitVoice();
        await t.uncallout("undo");
      } else {
        await t.say("When the check is happy, Install puts it in your library as one bundle.");
        await t.waitVoice();
      }
    });

    // The pack at work: its bundle on a Context, its template in an Assembler, and a picture.
    if (installed && showcasing(t)) await t.h.step("Use it", async () => {
      const after = await t.h.library();
      // A pack with sections installs a bundle per section inside the pack's own bundle: pick the
      // top one, the new bundle no other new bundle holds (the first new one can be a section).
      const fresh = after.bundles.filter((x) => !had.has(x.id));
      const held = (id: string) => fresh.some((o) => o.id !== id && JSON.stringify((o as { children?: unknown }).children ?? []).includes(`"${id}"`));
      const bundle = fresh.find((x) => !held(x.id)) ?? fresh[0];
      const tpl = after.templates.find((x) => !had.has(x.id));
      if (!bundle) throw new StepError("Install made no new bundle.");
      await t.go("/");
      await t.say("Now use it. On the canvas, a Context takes the whole pack.");
      const ctx = await t.addNode("WP Context", { x: 420, y: 170 });
      await t.waitVoice();
      await t.click(t.node(ctx).locator('[data-testid="open-bundle-picker"]').first());
      await t.beat(700);
      const row = page.locator(`[data-testid="bundle-picker-row-${bundle.id}"]`);
      // The box comes up with its own line (it used to come after the line, in silence).
      await t.callout("row", row, "The pack you just built", 6);
      await t.say("Add Bundle, and pick the pack you just built.");
      await t.waitVoice();
      await t.click(row);
      await t.uncallout("row");
      await t.beat(900);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1000, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      if (tpl) {
        await t.say("The pack also made a prompt template. Load it into the Assembler with the folder button.");
        await t.click(t.node(asm).locator('[data-test="asm-load-template"]'));
        await t.beat(800);
        await t.click(page.locator('[data-test="load-tpl-row"]').filter({ hasText: tpl.name }).first());
        await t.beat(1200);
        await t.waitVoice();
      } else {
        throw new StepError("The pack installed no template to load.");
      }
      await t.say("Run it, and the pack rolls a new tavern scene every time.");
      await showcase(t, { from: asm, preview: { x: 1440, y: 150, width: 450, height: 780 }, chain: { x: 1820, y: 960 }, runs: 2, between: () => t.click(t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first()) });
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Describe, plan, build, install, and run. Next: web search and tag lookup.");
    });
  },
);
