// Advanced 19: warnings on the canvas. A Context with Role and Lighting from time: Lighting reads $time,
// which nothing sets, so its row says MISSING VAR. An upstream Context with Time of day and Role fixes
// it, and the downstream Role row turns blue (it replaces the upstream role). The Assembler underlines a
// $mood nothing sets. Nothing stops a run; Validation strictness decides what shows.
import { tutorial } from "../tutorial.js";

tutorial(
  "A19",
  {
    title: "Warnings on the canvas",
    description: "Read the coloured dots and labels on your nodes while you build: what's missing, what's replaced, and what to do about it.",
    learn: "MISSING VAR, shadowed variables, missing template variables, colours, Validation strictness.",
  },
  async (t) => {
    const nodes = await t.h.step("A missing variable", async () => {
      await t.go("/");
      await t.say("Lighting from time reads the time variable. Put it in a Context without Time of day.");
      const ctx = await t.addNode("WP Context", { x: 1010, y: 170 });
      await t.pickModules(ctx, ["Role", "Lighting from time"]);
      await t.beat(800);
      const badge = t.moduleRow(ctx, "Lighting from time").locator(".wp-conflict-badge");
      await t.callout("miss", badge, "Nothing sets $time", 5);
      await t.say("Its row gets an amber dot and a label: missing var. Hover it for the whole message.");
      await t.hover(badge);
      await t.beat(1500);
      await t.waitVoice();
      await t.uncallout("miss");
      return { ctx };
    });

    await t.h.step("Fixed upstream", async () => {
      await t.say("Something before it has to set time. Add a Context in front with Time of day, and Role too.");
      const up = await t.addNode("WP Context", { x: 360, y: 170 });
      await t.pickModules(up, ["Time of day", "Role"]);
      await t.wire(up, "context", nodes.ctx, "upstream");
      await t.beat(1000);
      await t.say("The missing var is gone. The second Role row is blue now: it replaces the role from upstream.");
      await t.callout("blue", t.moduleRow(nodes.ctx, "Role").locator(".wp-conflict-badge").first(), "Blue: just so you know", 5);
      await t.waitVoice();
      await t.uncallout("blue");
      await t.say("Blue is for your information. Amber is worth a look. Red points at something that's gone, like a deleted wildcard.");
      await t.waitVoice();
    });

    await t.h.step("In the template", async () => {
      await t.say("The Assembler checks its template too. Type a mood nothing sets.");
      const asm = await t.addNode("WP Prompt Assembler", { x: 1480, y: 170 });
      await t.wire(nodes.ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $time, $lighting, $mood", { cps: 16 });
      await t.beat(900);
      await t.callout("mood", t.node(asm).locator('[data-test="asm-chip-mood"]'), "Prints nothing", 5);
      await t.say("Mood is flagged as missing, so it would print nothing.");
      await t.waitVoice();
      await t.uncallout("mood");
    });

    await t.h.step("Never in the way", async () => {
      await t.say("None of this stops a run. In ComfyUI's settings, Validation strictness picks what shows: everything, no blue notes, or nothing. After a run, WP Debug lists what actually happened.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Read the dot, hover for why, and fix it upstream. That ends the advanced track.");
    });
  },
);
