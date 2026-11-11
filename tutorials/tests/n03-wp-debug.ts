// Nodes 3: WP Debug in depth. Role, Setting, Time of day, Lighting from time and the constraint "Role
// fits the place" (last, so it reaches nothing) → WP Debug. Variables (value, who set it, filter),
// Trace (steps in order, a derivation's rules opened), Warnings (the constraint that never applied),
// Raw, and Copy.
import { tutorial } from "../tutorial.js";

tutorial(
  "N03",
  {
    title: "WP Debug in depth",
    description: "Read everything a run did: each variable and who set it, every step in order with its rules, and the warnings that explain an odd result.",
    learn: "Variables, Trace, Warnings and Raw, the filter, opening a step, copying a run.",
  },
  async (t) => {

    const dbg = await t.h.step("Debug after a Context", async () => {
      await t.go("/");
      // Build first (sped up), then name what's on screen.
      await t.speedUp();
      const ctx = await t.addNode("WP Context", { x: 480, y: 170 });
      await t.pickModules(ctx, ["Role", "Setting", "Time of day", "Lighting from time", "Role fits the place"]);
      await t.normalSpeed();
      await t.say("A Context with Role, Setting, Time of day, Lighting from time, and the constraint Role fits the place, put last on purpose.");
      await t.waitVoice();
      await t.say("Wire WP Debug after it. It changes nothing; it shows what reached that point.");
      const dbg = await t.addNode("WP Debug", { x: 1300, y: 170 });
      await t.page.evaluate((id) => {
        const n = window.app?.graph?.getNodeById(Number(id)) as { size: [number, number] } | null | undefined;
        if (n) n.size = [680, 640];
        window.app?.canvas?.setDirty(true, true);
      }, dbg);
      await t.beat(400);
      await t.wire(ctx, "context", dbg, "context");
      await t.waitVoice();
      await t.say("Run.");
      await t.run();
      await t.beat(1200);
      await t.waitVoice();
      return dbg;
    });

    const view = () => t.node(dbg);

    await t.h.step("Variables", async () => {
      await t.callout("vars", view().locator('[data-test="dbg-vars"]'), "Name, value, who set it", 6);
      await t.say("Variables lists every variable the run set, its value, and the item that set it.");
      await t.waitVoice();
      await t.uncallout("vars");
      await t.say("The filter finds one by name. Type light.");
      await t.fill(view().locator('[data-test="dbg-filter"] input, input[data-test="dbg-filter"]').first(), "light", { cps: 12 });
      await t.beat(1200);
      await t.waitVoice();
      await t.fill(view().locator('[data-test="dbg-filter"] input, input[data-test="dbg-filter"]').first(), "", { cps: 12 });
      await t.beat(500);
    });

    await t.h.step("Trace", async () => {
      await t.say("Trace is the run in order: each item, what it did, and why.");
      await t.click(view().locator('[data-test="dbg-tab-trace"]'));
      await t.beat(800);
      const lighting = view().locator('[data-test="dbg-step"]', { hasText: "Lighting" }).first();
      await t.say("Open Lighting from time. Its rules show which one matched the time that was rolled.");
      await t.click(lighting.locator(".wp-dbg-step__row"));
      await t.beat(1000);
      await t.callout("rule", lighting.locator('[data-test="dbg-step-detail"]'), "The rule that matched", 6);
      await t.waitVoice();
      await t.uncallout("rule");
      await t.click(lighting.locator(".wp-dbg-step__row"));
      await t.beat(500);
    });

    await t.h.step("Warnings", async () => {
      await t.say("Warnings explains a result that looks wrong.");
      await t.click(view().locator('[data-test="dbg-tab-warnings"]'));
      await t.beat(900);
      await t.callout("warn", view().locator('[data-test="dbg-warning"]').first(), "Never applied", 6);
      await t.say("Role fits the place sits after the Setting it should change, so the setting had already rolled: it never applied. A constraint goes before the items it changes.");
      await t.waitVoice();
      await t.uncallout("warn");
    });

    await t.h.step("Raw and copy", async () => {
      await t.click(view().locator('[data-test="dbg-tab-raw"]'));
      await t.beat(700);
      await t.say("Raw is the whole run as data.");
      await t.waitVoice();
      await t.callout("copy", view().locator('[data-test="dbg-copy"]'), "Copy this tab", 4);
      await t.say("Copy puts the open tab on the clipboard as JSON, handy for a bug report.");
      await t.waitVoice();
      await t.beat(500);
      await t.uncallout("copy");
      await t.click(view().locator('[data-test="dbg-tab-vars"]'));
      await t.beat(500);
    });

    await t.h.step("Outro", async () => {
      await t.say("Put Debug after any Context to see what it rolled, how, and what went wrong. Use as many as you like.");
    });
  },
);
