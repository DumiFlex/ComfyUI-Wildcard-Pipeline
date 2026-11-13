// Nodes 3: WP Debug in depth (the depth standard). A Context with Role, Setting, Time of day,
// Lighting from time and the constraint "Role fits the place" put last on purpose → WP Debug.
// The job first (why did this roll?), then the input, every tab in full (Variables with sources,
// negatives and the filter; Trace grouped per node, a wildcard's odds, a derivation's rules, Expand
// all; Warnings; Raw, Copy, Download), the fix for the warning (the constraint dragged above Setting,
// then "Re-weighted by" in Trace), how it works (a snapshot at its point, every run), recipes (one
// Debug per stage of a chain, a Context Loop's frames) and gotchas. Prompt-only: no model.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N03",
  {
    title: "WP Debug in depth",
    description: "Read everything a run did: every variable and who set it, each step in order with its odds and rules, warnings and their fixes, and Debug across a chain and a loop.",
    learn: "Variables, Trace, Warnings and Raw in full, the filter, Expand all, fixing a constraint that never applied, several Debug nodes, loop frames.",
  },
  async (t) => {
    const page = t.page;
    const resize = (id: string, w: number, h: number) =>
      page.evaluate(
        ([nid, ww, hh]) => {
          const g = window.app?.graph;
          const n = (g?.getNodeById(nid) ?? g?.getNodeById(Number(nid))) as { size: [number, number] } | null | undefined;
          if (n) n.size = [ww, hh];
          window.app?.canvas?.setDirty(true, true);
        },
        [id, w, h] as const,
      );
    const view = (id: string) => t.node(id);
    const tab = async (id: string, name: "vars" | "trace" | "warnings" | "raw") => {
      await t.click(view(id).locator(`[data-test="dbg-tab-${name}"]`));
      await t.beat(700);
    };
    const step = (id: string, name: string) => view(id).locator('[data-test="dbg-step"]', { hasText: name }).first();
    const open = async (id: string, name: string) => {
      await t.click(step(id, name).locator(".wp-dbg-step__row").first());
      await t.beat(900);
    };

    const n = await t.h.step("What it's for", async () => {
      await t.go("/");
      await t.speedUp();
      const ctx = await t.addNode("WP Context", { x: 420, y: 170 });
      await t.pickModules(ctx, ["Role", "Setting", "Time of day", "Lighting from time", "Role fits the place"]);
      await t.normalSpeed();
      await t.say("A run put a role in a place that doesn't suit it, and you want to know why. WP Debug answers that: what every variable holds, who set it, and every step that led there.");
      await t.waitVoice();
      await t.say("Here, a Context with Role, Setting, Time of day, Lighting from time, and the constraint Role fits the place, which should keep each role in a place that suits it.");
      await t.waitVoice();
      return { ctx };
    });

    const dbg = await t.h.step("Where it goes", async () => {
      await t.say("Add WP Debug and wire the Context into its one input, context.");
      const d = await t.addNode("WP Debug", { x: 1120, y: 150 });
      await resize(d, 700, 660);
      await t.wire(n.ctx, "context", d, "context");
      await t.waitVoice();
      await t.callout("dbg", view(d), "No output, changes nothing", 5);
      await t.say("Any WP node's context output fits: a Context, an Injector, a Loop, Toggles or Model Info. Debug has no output and changes nothing. Drag its corner to make it bigger.");
      await t.waitVoice();
      await t.uncallout("dbg");
      await t.say("It fills in when the run reaches it. Run.");
      await t.run();
      await t.beat(1200);
      await t.waitVoice();
      const head = view(d).locator('[data-test="dbg-head"]');
      if (await head.isVisible().catch(() => false)) {
        await t.callout("head", head, "Seed and a summary", 4);
        await t.say("The top line has the seed this run used, click it to copy it, and a summary: a clean run, or how many warnings there are.");
        await t.waitVoice();
        await t.uncallout("head");
      }
      return d;
    });

    await t.h.step("Variables", async () => {
      await t.callout("vars", view(dbg).locator('[data-test="dbg-vars"]'), "Name, value, who set it", 6);
      await t.say("Variables lists every variable at this point, its value, and the item that set it.");
      await t.waitVoice();
      await t.uncallout("vars");
      const card = view(dbg).locator('[data-test="dbg-var-section-head"]').first();
      if (await card.isVisible().catch(() => false)) {
        await t.callout("card", card, "One card per Context node", 4);
        await t.say("Each Context node gets its own card, headed by its name and codename, so you can tell which node set what.");
        await t.waitVoice();
        await t.uncallout("card");
      }
      const src =view(dbg).locator('[data-test="dbg-var-src"]').first();
      if (await src.isVisible().catch(() => false)) {
        await t.callout("src", src, "The item that set it", 4);
        await t.say("The icon and colour on the left say what kind of item set it: a wildcard, a rule, Toggles, Model Info, a Loop or an Injector.");
        await t.waitVoice();
        await t.uncallout("src");
      }
      await t.say("Negative words show under a value in red, with the item they came from when it's another one.");
      await t.waitVoice();
      const filter = view(dbg).locator('[data-test="dbg-filter"] input, input[data-test="dbg-filter"]').first();
      await t.say("The filter finds a variable by name, on every tab. Type light.");
      await t.fill(filter, "light", { cps: 12 });
      await t.beat(1000);
      await t.waitVoice();
      await t.fill(filter, "", { cps: 12 });
      await t.beat(400);
    });

    await t.h.step("Trace", async () => {
      await t.say("Trace is the run in order, grouped by the node it ran in.");
      await tab(dbg, "trace");
      await t.waitVoice();
      await t.say("Open Setting. A wildcard shows every option with its chance, and the one it rolled.");
      await open(dbg, "Setting");
      const opts = step(dbg, "Setting").locator('[data-test="dbg-options"]');
      if (await opts.isVisible().catch(() => false)) await t.callout("opts", opts, "Every option and its chance", 6);
      await t.waitVoice();
      await t.uncallout("opts");
      await t.say("Nothing re-weighted it, though: the constraint that should have narrowed it ran later.");
      await t.waitVoice();
      await open(dbg, "Setting");
      await t.say("Open Lighting from time. A rule shows each branch, and which one matched the time that was rolled.");
      await open(dbg, "Lighting");
      const detail = step(dbg, "Lighting").locator('[data-test="dbg-step-detail"]');
      await t.callout("rule", detail, "The branch that ran", 6);
      await t.waitVoice();
      await t.uncallout("rule");
      await open(dbg, "Lighting");
      const all = view(dbg).locator('[data-test="dbg-expand-all"]');
      if (await all.isVisible().catch(() => false)) {
        await t.callout("all", all, "Open every step", 4);
        await t.say("Expand all opens every step at once, and each step also lists the negative it left.");
        await t.waitVoice();
        await t.uncallout("all");
      }
    });

    await t.h.step("Warnings", async () => {
      await t.say("Warnings explains a result that looks wrong. Look here first.");
      await tab(dbg, "warnings");
      const warn = view(dbg).locator('[data-test="dbg-warning"]').first();
      await warn.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
        throw new StepError("Debug shows no warning for the constraint placed last.");
      });
      await t.callout("warn", warn, "Never applied", 6);
      await t.say("Role fits the place never applied: it sits after the Setting it should change, so the setting had already rolled.");
      await t.waitVoice();
      await t.uncallout("warn");
      await t.say("Others you'll meet: a missing variable, a constraint that reached fewer rows than asked, a fallback that was used, and a match variable with no match. Each says which item it's about.");
      await t.waitVoice();
    });

    await t.h.step("Fix it and check", async () => {
      await t.say("The fix: a constraint goes after its source and before what it changes. Drag it up, between Role and Setting.");
      const handle = t.moduleRow(n.ctx, "Role fits the place").locator(".wp-drag-handle");
      const target = t.moduleRow(n.ctx, "Setting");
      const hb = await handle.boundingBox();
      const tb = await target.boundingBox();
      if (!hb || !tb) throw new StepError("The constraint's handle or the Setting row isn't on screen.");
      await t.drag({ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2, y: tb.y + 4 });
      await t.beat(900);
      await t.waitVoice();
      await t.say("Run again.");
      await t.run();
      await t.beat(1200);
      await t.waitVoice();
      const ok = view(dbg).locator('[data-test="dbg-head-ok"]');
      if (await ok.isVisible().catch(() => false)) {
        await t.callout("ok", ok, "A clean run", 4);
        await t.say("Clean run.");
        await t.waitVoice();
        await t.uncallout("ok");
      }
      await tab(dbg, "trace");
      await open(dbg, "Setting");
      const by = step(dbg, "Setting").locator('[data-test="dbg-applied-constraint"]').first();
      if (await by.isVisible().catch(() => false)) await t.callout("by", by, "Re-weighted by the constraint", 6);
      await t.say("And Setting now says it was re-weighted by Role fits the place, with the odds it ended up with.");
      await t.waitVoice();
      await t.uncallout("by");
      await open(dbg, "Setting");
    });

    await t.h.step("Raw, Copy and Download", async () => {
      await tab(dbg, "raw");
      await t.say("Raw is everything as data.");
      await t.waitVoice();
      await t.callout("copy", [view(dbg).locator('[data-test="dbg-copy"]'), view(dbg).locator('[data-test="dbg-download"]')], "Copy or save it", 4);
      await t.say("Copy puts the open tab on the clipboard, and Download saves the whole run as a file. Both are handy for a bug report.");
      await t.waitVoice();
      await t.uncallout("copy");
      await tab(dbg, "vars");
    });

    await t.h.step("How it works", async () => {
      await t.say("Debug is a snapshot of the context at the point where it's wired. It sees everything before it and nothing after it, and it runs again on every run, so it always shows the latest one.");
      await t.waitVoice();
    });

    await t.h.step("Recipe: one per stage", async () => {
      await t.setView({ scale: 0.7, offset: [0, 0] });
      await t.say("Recipe one: a Debug after each stage of a chain. Add a second Context after the first, with its own Role, and a second Debug after it.");
      await t.speedUp();
      const c2 = await t.addNode("WP Context", { x: 560, y: 720 });
      await t.wire(n.ctx, "context", c2, "upstream");
      await t.pickModules(c2, ["Role"]);
      // Tall enough for both Context sections; the "After" step zooms in on it so the replaced role shows.
      const d2 = await t.addNode("WP Debug", { x: 1150, y: 700 });
      await resize(d2, 700, 620);
      await t.wire(c2, "context", d2, "context");
      await t.say("Run.");
      await t.fastForward(async () => {
        await t.run();
        await t.beat(1200);
      });
      await t.waitVoice();
      const roles = [view(dbg).locator('[data-test="dbg-var"]', { hasText: "role" }).first(), view(d2).locator('[data-test="dbg-var"]', { hasText: "role" }).first()];
      await t.callout("before", roles[0], "Before", 4);
      await t.say("The first Debug shows the role as the first Context left it.");
      await t.waitVoice();
      await t.uncallout("before");
      // At 70% the second Debug's role row (under the second Context's section) was too small to read,
      // and sat under the caption: zoom in on it, then glide back for the loop recipe.
      const back = await t.zoomOn(d2, { scale: 1.0, top: 110 });
      await t.beat(600);
      await roles[1].scrollIntoViewIfNeeded().catch(() => undefined);
      await t.callout("after", roles[1], "After", 4);
      await t.say("The second shows the one that replaced it. Put Debugs between stages to see where a value appeared, or changed.");
      await t.waitVoice();
      await t.uncallout("after");
      await t.setView(back);
    });

    await t.h.step("Recipe: a loop's frames", async () => {
      await t.say("Recipe two: with a Context Loop before the chain, every frame has its own picks. Add one with three frames, and wire it into the first Context's upstream.");
      await t.speedUp();
      // addNode centres the node on the point: x 260 keeps the Loop clear of the sidebar.
      const loop = await t.addNode("WP Context Loop", { x: 260, y: 560 });
      await t.wire(loop, "context", n.ctx, "upstream");
      await t.fill(t.node(loop).locator('[data-widget-name="count"] input').first(), "3", { cps: 10 });
      await t.press("Tab");
      await t.normalSpeed();
      await t.run();
      await t.beat(1500);
      await t.waitVoice();
      const iter = view(dbg).locator('[data-test="dbg-iter-label"]');
      if (await iter.isVisible().catch(() => false)) {
        await t.callout("iter", iter.locator(".."), "One frame at a time", 5);
        await t.say("Debug now has a frame picker. Step through the frames to see what each one rolled, and which rows were switched off on a frame.");
        await t.click(view(dbg).locator('[data-test="dbg-iter-next"]'));
        await t.beat(900);
        await t.waitVoice();
        await t.uncallout("iter");
      } else {
        await t.say("Debug then gets a frame picker, to step through what each frame rolled.");
        await t.waitVoice();
      }
    });

    await t.h.step("Gotchas", async () => {
      await t.say("Two things to know. An empty Debug just hasn't run yet: it fills in on the next run. And a Debug before a node can't see what that node does: move it after the last one you care about.");
      await t.waitVoice();
      await t.say("Debug never changes a pick, so leave as many in the workflow as you like.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for Debug whenever a result surprises you: Variables for what, Trace for why, Warnings for what went wrong. The WP Debug page in the docs explains every warning.");
      await t.waitVoice();
    });
  },
);
