// Nodes 11: WP Prompt Cleaner in depth (the depth standard). A messy prompt and negative typed straight
// into the Cleaner's own boxes → two Preview as Text, so each change runs without a model. The job,
// the inputs and outputs, Tags vs Text mode, Gentle / Balanced / Aggressive with the per-rule counts
// after a run, single rules (CUSTOM badge, back to a preset), the negative column and "drop negative
// tags also in prompt", the blocklist (by hand, list vs regex, and a shared word list wired into
// blocklist), the word counts and the last-run line, how it works, recipes with the Assembler, gotchas.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

const MESSY = "masterpiece, a knight ,, forest,  (best quality:1.2), (), Masterpiece, <lora:detail:0.8>,((best quality:1.1)), knight, knights";
const NEG = "blurry, , lowres, blurry, forest";

tutorial(
  "N11",
  {
    title: "WP Prompt Cleaner in depth",
    description: "Tidy every prompt before the sampler: modes, intensity, single rules, the negative column, the blocklist and a shared word list, with each change run on screen.",
    learn: "Tags vs Text, Gentle / Balanced / Aggressive, each rule and its count, the negative rules and overlap, the blocklist and the blocklist input.",
  },
  async (t) => {
    const page = t.page;
    const box = (id: string, name: string) => t.node(id).locator(`[data-widget-name="${name}"] textarea, [data-widget-name="${name}"] input`).first();
    const run = async () => {
      await t.run();
      await t.beat(900);
    };

    const n = await t.h.step("What it's for", async () => {
      await t.go("/");
      await t.speedUp();
      const cl = await t.addNode("WP Prompt Cleaner", { x: 420, y: 150 });
      const out = await t.addNode("Preview as Text", { x: 1150, y: 150 });
      const neg = await t.addNode("Preview as Text", { x: 1150, y: 560 });
      await t.wire(cl, "prompt", out, "source");
      await t.wire(cl, "negative", neg, "source");
      await t.normalSpeed();
      await t.say("Wildcards join text from many places, so a prompt picks up double commas, repeated tags, empty brackets and stray spaces. WP Prompt Cleaner tidies it before the sampler.");
      await t.waitVoice();
      return { cl, out, neg };
    });

    await t.h.step("Inputs and outputs", async () => {
      await t.say("prompt is the text to clean, usually wired from an Assembler. Here it's typed in, messy on purpose.", "Prompt is the text to clean, usually wired from an Assembler. Here it's typed in, messy on purpose.");
      await t.fill(box(n.cl, "prompt"), MESSY, { cps: 40 });
      await t.waitVoice();
      await t.say("negative is optional: a negative to clean with its own rules. Left empty, the negative output is empty too.", "Negative is optional: a negative to clean with its own rules. Left empty, the negative output is empty too.");
      await t.fill(box(n.cl, "negative"), NEG, { cps: 40 });
      await t.waitVoice();
      await t.callout("outs", [t.node(n.out), t.node(n.neg)], "prompt (out) and negative (out)", 5);
      await t.say("The two outputs go to your two CLIP Text Encodes. Here, Preview as Text shows them. Run.");
      await run();
      await t.waitVoice();
      await t.uncallout("outs");
      await t.say("Spaces, double commas, the empty brackets and the repeated tags are gone.");
      await t.waitVoice();
    });

    await t.h.step("Tags or Text", async () => {
      await t.callout("mode", t.node(n.cl).locator('[aria-label="Cleaning mode"]'), "Comma tags or sentences", 5);
      await t.say("Mode says what the prompt is. Tags, for comma-separated tags, the default. Text, for sentences.");
      await t.waitVoice();
      await t.uncallout("mode");
      await t.click(t.node(n.cl).locator('[data-test="cleaner-mode-text"]'));
      await t.beat(600);
      await t.say("In Text mode the tag rules grey out: a sentence can say the same word twice on purpose. Back to tags.");
      await t.waitVoice();
      await t.click(t.node(n.cl).locator('[data-test="cleaner-mode-tags"]'));
      await t.beat(500);
    });

    await t.h.step("Intensity", async () => {
      await t.callout("int", t.node(n.cl).locator('[aria-label="Intensity"]'), "A preset of rules", 5);
      await t.say("Intensity is a preset of rules. Balanced, the default, never changes what the prompt means.");
      await t.waitVoice();
      await t.uncallout("int");
      await t.say("Gentle only fixes spaces and commas. Run.");
      await t.click(t.node(n.cl).locator('[data-test="cleaner-intensity-gentle"]'));
      await run();
      await t.waitVoice();
      await t.say("Aggressive also merges stacked weights, and fuzzy dedupe drops near repeats: the second best quality, and knight and knights, since a knight is already there. Run.");
      await t.click(t.node(n.cl).locator('[data-test="cleaner-intensity-aggressive"]'));
      await run();
      await t.waitVoice();
      const stat = t.node(n.cl).locator('[data-test="cleaner-rule-dedupe_exact-stat"]');
      if (await stat.isVisible().catch(() => false)) {
        await t.callout("stat", stat, "Fixes this run", 4);
        await t.say("After a run, each rule shows how many fixes it made.");
        await t.waitVoice();
        await t.uncallout("stat");
      }
    });

    await t.h.step("Single rules", async () => {
      await t.say("RULES lists every rule. Whitespace and punctuation tidy spacing and commas. Empty groups drops brackets with nothing in them. Merge weights folds stacked weights into one. LoRA spacing fixes the spaces around a LoRA tag.");
      await t.waitVoice();
      await t.say("Tag dedupe drops exact repeats, in any capitals. Fuzzy dedupe drops near repeats. Blocklist removes words you list.");
      await t.waitVoice();
      await t.say("Switch one off: fuzzy dedupe, so knights stays.");
      await t.click(t.node(n.cl).locator('[data-test="cleaner-rule-fuzzy_dedupe"]'));
      await t.beat(500);
      await run();
      await t.callout("custom", t.node(n.cl).locator('[data-test="cleaner-custom-badge"]'), "Differs from the preset", 4);
      await t.say("The rule gets a dot, and CUSTOM says the rules differ from the preset. Picking an intensity again drops the change.");
      await t.waitVoice();
      await t.uncallout("custom");
      await t.click(t.node(n.cl).locator('[data-test="cleaner-intensity-balanced"]'));
      await t.beat(500);
    });

    await t.h.step("The negative column", async () => {
      const col = t.node(n.cl).locator('[data-test^="cleaner-neg-rule-"]');
      await t.callout("neg", col.first().locator("../.."), "The negative's own rules", 5);
      await t.say("The neg column is the same rules for the negative, set on their own. Fuzzy dedupe stays off there, since near repeats in a negative are usually on purpose.");
      await t.waitVoice();
      await t.uncallout("neg");
      const ov = t.node(n.cl).locator('[data-test="cleaner-drop-overlap"]');
      await t.callout("ov", ov, "Drop tags in both", 4);
      await t.say("The last one is for the negative only: drop a negative tag the prompt also has. Forest is in both: the sampler is told to draw it and not to. Tick it, and run.");
      await t.click(ov);
      await run();
      await t.waitVoice();
      await t.uncallout("ov");
      const count = t.node(n.cl).locator('[data-test="cleaner-neg-count"]');
      if (await count.isVisible().catch(() => false)) {
        await t.callout("cnt", count.locator(".."), "Words after cleaning", 4);
        await t.say("The top line counts the words and characters of the cleaned prompt, and of the negative.");
        await t.waitVoice();
        await t.uncallout("cnt");
      }
    });

    await t.h.step("The blocklist", async () => {
      await t.say("The blocklist removes words you never want. Open it.");
      await t.click(t.node(n.cl).locator('[data-test="cleaner-blocklist-btn"]'));
      await t.beat(800);
      const area = page.locator('[data-test="blocklist-textarea"] textarea, textarea[data-test="blocklist-textarea"]').first();
      await t.fill(area, "masterpiece", { cps: 14 });
      await t.waitVoice();
      await t.say("List mode takes words split by commas or new lines. Regex mode takes one pattern per line, for whole families of words. Save.");
      await t.click(page.locator('[data-test="blocklist-save"]'));
      await t.beat(600);
      await t.waitVoice();
      const blockRule = t.node(n.cl).locator('[data-test="cleaner-rule-blocklist"]');
      const ticked = () =>
        blockRule.evaluate((el) => (el.getAttribute("aria-checked") ?? el.querySelector("[aria-checked]")?.getAttribute("aria-checked")) === "true");
      await t.say("Tick the blocklist rule, and run.");
      if (!(await ticked())) await t.click(blockRule);
      await t.beat(300);
      if (!(await ticked())) throw new StepError("The blocklist rule isn't ticked.");
      await run();
      await t.waitVoice();
      await t.say("Masterpiece is gone, in every capital.");
      await t.waitVoice();
    });

    await t.h.step("A shared word list", async () => {
      await t.say("blocklist is also an input. Wire a text box into it, and several cleaners share one list.", "Blocklist is also an input. Wire a text box into it, and several cleaners share one list.");
      await t.speedUp();
      // A screen point in the free space right of the Cleaner, below the previews (x 120 lands on the Cleaner).
      const s = await t.addNode("Text (Multiline)", { x: 900, y: 700 });
      await t.click(t.node(s).locator("textarea").first());
      await t.type("lowres\nknights", { cps: 30 });
      await t.press("Escape");
      await t.normalSpeed();
      try {
        await t.wire(s, "STRING", n.cl, "blocklist");
      } catch {
        throw new StepError("The text box didn't wire into the Cleaner's blocklist.");
      }
      await t.beat(600);
      await t.waitVoice();
      await t.callout("btn", t.node(n.cl).locator('[data-test="cleaner-blocklist-btn"]'), "+ input", 4);
      await t.say("Its words join the panel's list, and the button says plus input. Run.");
      await run();
      await t.waitVoice();
      await t.uncallout("btn");
      const last = t.node(n.cl).locator('[data-test="cleaner-last-run"]');
      if (await last.isVisible().catch(() => false)) {
        await t.callout("last", last, "What this run fixed", 5);
        await t.say("The last-run line says what was fixed in the prompt and in the negative.");
        await t.waitVoice();
        await t.uncallout("last");
      }
    });

    await t.h.step("The last run, in a window", async () => {
      const last = t.node(n.cl).locator('[data-test="cleaner-last-run"]');
      if (!(await last.isVisible().catch(() => false))) throw new StepError("The Cleaner shows no last-run strip after a run.");
      await t.say("Click the last-run line, and the whole run opens in a window.");
      await t.click(last);
      const win = page.locator('[data-test="cleaner-run"]');
      try {
        await win.waitFor({ state: "visible", timeout: 5000 });
      } catch {
        throw new StepError("The last-run window didn't open.");
      }
      await t.beat(700);
      await t.waitVoice();
      const split = win.locator(".wp-diff__split").first();
      await t.callout("split", split, "Before and after", 5);
      await t.say("Before on the left, after on the right: the prompt as it came in, and as it went out.");
      await t.waitVoice();
      await t.uncallout("split");
      const rules = win.locator('[data-test^="cleaner-run-rule-"]');
      if ((await rules.count()) === 0) throw new StepError("The last-run window lists no rules.");
      await t.callout("rules", rules.first(), "One line per rule that fired", 4);
      await t.say("Below, one line per rule that changed something, with its count. Open one.");
      await t.waitVoice();
      await t.uncallout("rules");
      // Open a rule that gives reasons (blocklist or tag dedupe), not one that only tidies.
      let open = rules.first();
      for (const id of ["blocklist", "dedupe_exact"]) {
        const r = win.locator(`[data-test="cleaner-run-rule-${id}"]`);
        if (await r.isVisible().catch(() => false)) { open = r; break; }
      }
      await t.click(open);
      await t.beat(800);
      // The opened rule's own reasons: closed rules keep their clipped lists in the DOM too.
      const reasons = open
        .locator("xpath=ancestor::*[.//ul[contains(@class,'wp-cleaner-run__reasons')]][1]")
        .locator(".wp-cleaner-run__reasons")
        .first();
      if (!(await reasons.isVisible().catch(() => false))) throw new StepError("The opened rule shows no reasons.");
      {
        await t.callout("why", (await reasons.locator("li").all()).slice(0, 4), "What went, and why", 5);
        await t.say("Each change says what was dropped, in red, what the rule did, and in blue, the reason: the tag it repeated, or the blocklist word it matched.");
        await t.waitVoice();
        await t.uncallout("why");
      }
      const marks = win.locator(".wp-diff__mark");
      if (await marks.first().isVisible().catch(() => false)) {
        await t.callout("marks", (await marks.all()).slice(0, 4), "This rule's changes", 4);
        await t.say("And that rule's own changes are marked in blue in its before and after.");
        await t.waitVoice();
        await t.uncallout("marks");
      }
      const negTab = win.locator('[data-test="cleaner-run-side-negative"]');
      if (await negTab.isVisible().catch(() => false)) {
        await t.say("The negative has its own tab, with its own rules and reasons.");
        await t.click(negTab);
        await t.beat(1200);
        await t.waitVoice();
        await t.click(win.locator('[data-test="cleaner-run-side-prompt"]'));
        await t.beat(500);
      }
      await t.say("Close it with Escape. The window always shows the latest run.");
      await t.press("Escape");
      await t.beat(700);
      await t.waitVoice();
    });

    await t.h.step("How it works", async () => {
      await t.say("The Cleaner runs its rules in a fixed order on the finished text, after every variable is filled in, so it catches gaps an empty pick leaves behind. It never adds words; it only tidies and removes.");
      await t.waitVoice();
    });

    await t.h.step("Recipes and gotchas", async () => {
      await t.say("Recipe one: Assembler, then Cleaner, then CLIP Text Encode, with prompt and negative wired through. Recipe two: one word list feeding the cleaner of every branch.");
      await t.waitVoice();
      await t.say("Recipe three: in a Context Loop it runs once per frame, so every frame's prompt is tidied on its own.");
      await t.waitVoice();
      await t.say("Gotchas: Aggressive changes weights and near-duplicates, so check its result once. And text in brackets with weights only merges when it's the very same tag.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Put a Cleaner between every Assembler and its sampler, start on Balanced, and adjust single rules when you need to. The Prompt Cleaner page in the docs explains every rule.");
      await t.waitVoice();
    });
  },
);
