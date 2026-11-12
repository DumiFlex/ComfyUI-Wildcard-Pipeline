// Advanced 17: switches, node groups and relays, variables first. Role + Time → a second Context with
// Lighting from time and "Lights on or off" (in the tutorial library: when $use_lighting is false, $lighting
// is emptied) → Assembler → Preview as Text. A WP Toggles row "Lighting" writes $use_lighting into the
// chain, so the rule follows the switch. A second WP Toggles in Pick one mode writes $time itself
// (Dawn / Sunset / Night). Then the same Lighting toggle bypasses the lighting Context instead, a
// WP Node Group stands between them (one switch for many nodes), and WP Mode Relay is shown.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";


tutorial(
  "A17",
  {
    title: "Switches",
    description: "Write true or false variables for your rules with WP Toggles, let a toggle pick the words itself, and switch nodes on and off with WP Node Group and WP Mode Relay.",
    learn: "Toggle variables for derivations, Pick one, When off: mute or bypass, WP Node Group, WP Mode Relay.",
  },
  async (t) => {
    const page = t.page;
    const rowEdit = '[data-test^="tg-edit-"]:not([data-test="tg-edit-done"])';
    const field = (node: string, test: string) => t.node(node).locator(`[data-test="${test}"] input, input[data-test="${test}"]`).first();
    // A toggle's own settings open in a window (kit Modal) over the canvas, not inside the node.
    const win = () => page.getByRole("dialog").filter({ has: page.locator('[data-test="tg-window-done"]') }).last();
    const winField = (test: string) =>
      win().locator(`[data-test="${test}"] input, input[data-test="${test}"], [data-test="${test}"] textarea, textarea[data-test="${test}"], [data-test="${test}"] [contenteditable="true"], [data-test="${test}"][contenteditable="true"]`).first();
    const winDone = async () => {
      await t.click(win().locator('[data-test="tg-window-done"]'));
      await t.beat(500);
    };
    // Selects a Toggles node and opens its edit view with the pencil above it.
    const openEdit = async (node: string) => {
      const box = await t.node(node).boundingBox();
      if (box) await t.click({ x: box.x + box.width / 2, y: box.y + 14 });
      await t.beat(500);
      await t.click(page.locator(".wp-tb-icon--edit").first().locator("xpath=ancestor::button[1]"));
      await t.beat(800);
    };
    const editItem = async (ctx: string, name: string) => {
      await t.click(t.moduleRow(ctx, name).locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      return page.getByRole("dialog").last();
    };


    const nodes = await t.h.step("A workflow with a part to switch", async () => {
      await t.go("/");
      // The setup earlier videos taught: sped up, then the line over what it built.
      await t.speedUp();
      const ctx1 = await t.addNode("WP Context", { x: 900, y: 170 });
      await t.pickModules(ctx1, ["Role", "Time of day"]);
      const ctx2 = await t.addNode("WP Context", { x: 1550, y: 170 });
      await t.wire(ctx1, "context", ctx2, "upstream");
      await t.pickModules(ctx2, ["Lighting from time", "Lights on or off"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1550, y: 600 });
      await t.wire(ctx2, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $time, $lighting", { cps: 16 });
      await t.beat(500);
      const text = await t.addNode("Preview as Text", { x: 900, y: 600 });
      await t.wire(asm, "prompt", text, "source");
      await t.normalSpeed();
      await t.moveTo({ x: 1200, y: 960 });
      await t.say("Here's a role at a time of day, and a second Context with the lighting rule and a rule called Lights on or off.");
      await t.waitVoice();
      return { ctx1, ctx2, asm, text };
    });

    // The node's text, its fields' values included (innerText skips what a textarea holds).
    const textOf = () =>
      t.node(nodes.text)
        .evaluate((el) => `${(el as HTMLElement).innerText} ${[...el.querySelectorAll("textarea, input")].map((f) => (f as HTMLInputElement).value).join(" ")}`)
        .catch(() => "");
    const shown = async (re: RegExp) => {
      for (let i = 0; i < 60; i++) {
        if (re.test(await textOf())) break;
        await t.beat(250);
      }
      if (!re.test(await textOf())) throw new StepError(`The preview never showed ${re}.`);
      await t.beat(400);
    };
    const runFor = (re: RegExp) =>
      t.fastForward(async () => {
        await t.run();
        await shown(re);
      }, 8);
    const LIT = /moonlight|rim light|morning light/;

    const tg = await t.h.step("A switch for your rules", async () => {
      await t.say("WP Toggles holds on and off switches for your rules. Put it at the start of the chain, then select it and press the pencil.");
      const tg = await t.addNode("WP Toggles", { x: 300, y: 170 });
      await t.wire(tg, "context", nodes.ctx1, "upstream");
      await openEdit(tg);
      await t.click(t.node(tg).locator(rowEdit).first());
      await t.beat(700);
      await t.fill(winField("tg-name"), "Lighting", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.fill(winField("tg-var"), "use_lighting", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      await t.callout("var", win().locator('[data-test="tg-var"]').first(), "$use_lighting: true or false", 5);
      await t.say("Each toggle writes its variable into the context as true or false, for every node after it. It's for rules only, so it never prints in the prompt.");
      await t.waitVoice();
      await t.uncallout("var");
      await winDone();
      await t.click(t.node(tg).locator('[data-test="tg-edit-done"]'));
      await t.beat(800);
      await t.deselect();
      return tg;
    });

    await t.h.step("A rule reads it", async () => {
      await t.say("Lights on or off is the rule that reads it. Open it.");
      const modal = await editItem(nodes.ctx2, "Lights on or off");
      // Just the rule's head (it shows the condition; the rule opens collapsed), not the whole dialog.
      await t.callout("rule", modal.locator('[data-test="rule-head-b17a0ff2"]'), "When $use_lighting is false: empty $lighting", 6);
      await t.say("When use lighting equals false, it replaces lighting with nothing.");
      await t.waitVoice();
      await t.uncallout("rule");
      await t.press("Escape");
      await t.beat(600);
      await t.say("The toggle is off. Run.");
      await runFor(/A painting of/);
      if (LIT.test(await textOf())) throw new StepError("The lighting stayed with the toggle off.");
      await t.callout("out", t.node(nodes.text), "No lighting", 5);
      await t.say("The role and the time, and no light.");
      await t.waitVoice();
      await t.uncallout("out");
      await t.say("Switch the toggle on, and run again.");
      await t.click(t.node(tg).locator('[data-test^="tg-ctl-"]').first());
      await t.beat(500);
      await runFor(LIT);
      await t.callout("out", t.node(nodes.text), "Lighting is back", 5);
      await t.say("Now the rule leaves the lighting alone, and it's back in the prompt.");
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("Pick one", async () => {
      await t.say("A toggle can also pick the words itself. Add a second WP Toggles after the first, and set it to Pick one.");
      const tg2 = await t.addNode("WP Toggles", { x: 300, y: 470 });
      await t.wire(tg, "context", tg2, "upstream");
      await t.wire(tg2, "context", nodes.ctx1, "upstream");
      await openEdit(tg2);
      await t.click(t.node(tg2).locator('[data-test="tg-mode-one"]'));
      await t.beat(600);
      await t.waitVoice();
      await t.say("It writes time, the picked toggle's value, and Show in Assembler lets it print.");
      await t.fill(field(tg2, "tg-group-var"), "time", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.click(t.node(tg2).locator('[data-test="tg-group-visible"]'));
      await t.beat(400);
      await t.waitVoice();
      await t.say("Three toggles: Dawn, Sunset and Night, each with the words it writes.");
      // The first row is there already; each added row opens its own editor.
      const rows: [string, string][] = [
        ["Dawn", "at dawn"],
        ["Sunset", "at sunset"],
        ["Night", "at night"],
      ];
      for (const [i, [name, value]] of rows.entries()) {
        // Typing the three rows plays sped up (4x keeps the hand easy to follow).
        if (i === 0) await t.speedUp(4);
        if (i === 0) await t.click(t.node(tg2).locator(rowEdit).first());
        else await t.click(t.node(tg2).locator('[data-test="tg-add"]'));
        await t.beat(600);
        await t.fill(winField("tg-name"), name, { cps: 14 });
        await t.press("Tab");
        await t.beat(300);
        await t.fill(winField("tg-value"), value, { cps: 14 });
        await t.press("Tab");
        await t.beat(300);
        await winDone();
      }
      await t.normalSpeed();
      await t.click(t.node(tg2).locator('[data-test="tg-edit-done"]'));
      await t.beat(800);
      await t.deselect();
      await t.waitVoice();
      await t.say("Switch off Time of day on the first Context, so the toggle decides the time, and pick Night.");
      await t.click(t.moduleRow(nodes.ctx1, "Time of day").locator('[data-test="module-enabled"]'));
      await t.beat(500);
      await t.click(t.node(tg2).locator('[data-test^="tg-row-"]').filter({ hasText: "Night" }).locator('[data-test^="tg-ctl-"]').first());
      await t.beat(500);
      await t.waitVoice();
      await t.say("Run.");
      await runFor(/at night[\s\S]*moonlight/);
      await t.callout("out", t.node(nodes.text), "Night, and the night light", 5);
      await t.say("At night, and the lighting rule follows: moonlight and lantern glow.");
      await t.waitVoice();
      await t.uncallout("out");
    });

    const ctlInput = await t.h.step("Switching nodes too", async () => {
      await t.say("A toggle can also switch nodes. Edit the Lighting toggle and set When off to Bypass.");
      await openEdit(tg);
      await t.click(t.node(tg).locator(rowEdit).first());
      await t.beat(700);
      await t.click(win().locator('[data-test="tg-control-bypass"]'));
      await t.beat(600);
      await winDone();
      await t.click(t.node(tg).locator('[data-test="tg-edit-done"]'));
      await t.beat(800);
      await t.deselect();
      await t.waitVoice();
      const ctl = await t.page.evaluate((id) => {
        const n = window.app?.graph?.getNodeById(Number(id)) as { inputs?: { name: string }[] } | null | undefined;
        return n?.inputs?.find((i) => i.name.startsWith("ctl_"))?.name ?? "";
      }, tg);
      await t.say("The row now has a dot on the left. Wire the lighting Context into it, and switch the toggle off.");
      await t.wire(nodes.ctx2, "context", tg, ctl);
      await t.beat(500);
      await t.click(t.node(tg).locator('[data-test^="tg-ctl-"]').first());
      await t.beat(800);
      await t.waitVoice();
      await t.callout("ctx2", t.node(nodes.ctx2), "Off: bypassed", 5);
      await t.say("The lighting Context turns purple: it's bypassed, so runs go straight past it. The toggle also has a true or false output for switch nodes.");
      await t.waitVoice();
      await t.uncallout("ctx2");
      return ctl;
    });

    await t.h.step("WP Node Group", async () => {
      await t.say("To switch several nodes with one toggle, gather them in a WP Node Group, and wire the group into the dot.");
      const grp = await t.addNode("WP Node Group", { x: 240, y: 780 });
      await t.wire(nodes.ctx2, "context", grp, "node_1");
      await t.wire(grp, "nodes", tg, ctlInput);
      await t.beat(800);
      await t.waitVoice();
      await t.callout("grp", t.node(grp), "Every node wired in follows the toggle", 5);
      await t.say("Wire in as many nodes as you like. Or put the group node inside a canvas group with nothing wired, and it stands for the whole group.");
      await t.waitVoice();
      await t.uncallout("grp");
    });

    await t.h.step("WP Mode Relay", async () => {
      await t.say("WP Mode Relay chains mutes and bypasses. Wire into it the nodes it should watch.");
      const relay = await t.addNode("WP Mode Relay", { x: 620, y: 780 });
      await t.wire(nodes.ctx2, "context", relay, "node_1");
      await t.beat(800);
      await t.waitVoice();
      // The box comes up with the line that explains it, after the wiring.
      await t.callout("relay", t.node(relay), "Mute a sampler, and its save branch follows", 6);
      await t.say("When the nodes it watches are muted or bypassed, it does the same to the node group its output goes into.");
      await t.waitVoice();
      await t.beat(400);
      await t.uncallout("relay");
      // Out of the way of the outro caption.
      await t.moveTo({ x: 1200, y: 500 });
    });

    await t.h.step("Outro", async () => {
      // Zoom out a little from the top-left, so the group and relay rows rise above the caption.
      const v = await page.evaluate(() => {
        const ds = (window.app as unknown as { canvas: { ds: { scale: number; offset: [number, number] } } }).canvas.ds;
        return { scale: ds.scale, offset: [ds.offset[0], ds.offset[1]] as [number, number] };
      });
      await t.setView({ scale: v.scale * 0.85, offset: v.offset });
      await t.say("Toggles write true or false for your rules, or pick the words themselves. Node Groups and Mode Relay switch whole parts of a workflow. The first example workflow uses all three.");
    });
  },
);
