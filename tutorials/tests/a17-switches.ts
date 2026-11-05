// Advanced 17: switches. Hero + Time of day → a second Context with Lighting from time → Assembler →
// Preview as Text. A WP Toggles row "Lighting" writes $use_lighting and, set to Bypass when off, drives
// the lighting Context through its dot: off = no lighting, on = lighting. Then a WP Node Group stands
// between them (one switch for many nodes), and WP Mode Relay is shown watching a node.
import { tutorial } from "../tutorial.js";

tutorial(
  "A17",
  {
    title: "Switches",
    description: "Turn parts of a workflow on and off from one place with WP Toggles, gather nodes with WP Node Group, and chain mutes with WP Mode Relay.",
    learn: "Toggle rows and their $variables, When off: mute or bypass, WP Node Group, WP Mode Relay.",
  },
  async (t) => {
    const page = t.page;
    const rowEdit = '[data-test^="tg-edit-"]:not([data-test="tg-edit-done"])';

    const nodes = await t.h.step("A workflow with a part to switch", async () => {
      await t.go("/");
      await t.say("Here's a hero at a time of day, and a second Context that adds lighting.");
      const ctx1 = await t.addNode("WP Context", { x: 900, y: 170 });
      await t.pickModules(ctx1, ["Hero", "Time of day"]);
      const ctx2 = await t.addNode("WP Context", { x: 1550, y: 170 });
      await t.wire(ctx1, "context", ctx2, "upstream");
      await t.pickModules(ctx2, ["Lighting from time"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1550, y: 600 });
      await t.wire(ctx2, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero at $time, $lighting", { cps: 16 });
      await t.beat(500);
      const text = await t.addNode("Preview as Text", { x: 900, y: 600 });
      await t.wire(asm, "prompt", text, "source");
      await t.waitVoice();
      return { ctx1, ctx2, asm, text };
    });

    const tg = await t.h.step("WP Toggles", async () => {
      await t.say("WP Toggles holds on and off switches. Select it and press the pencil to edit it.");
      const tg = await t.addNode("WP Toggles", { x: 300, y: 170 });
      const box = await t.node(tg).boundingBox();
      if (box) await t.click({ x: box.x + box.width / 2, y: box.y + 14 });
      await t.beat(500);
      await t.click(page.locator(".wp-tb-icon--edit").first().locator("xpath=ancestor::button[1]"));
      await t.beat(800);
      await t.click(t.node(tg).locator(rowEdit).first());
      await t.beat(700);
      await t.fill(t.node(tg).locator('[data-test="tg-name"] input, input[data-test="tg-name"]').first(), "Lighting", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.fill(t.node(tg).locator('[data-test="tg-var"] input, input[data-test="tg-var"]').first(), "use_lighting", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.say("Each toggle writes a true or false variable, so a derivation can branch on it, and it has a BOOLEAN output for switch nodes.");
      await t.callout("var", t.node(tg).locator('[data-test="tg-var"]'), "$use_lighting: true or false", 5);
      await t.waitVoice();
      await t.uncallout("var");
      await t.say("When off can also mute or bypass other nodes. Pick Bypass.");
      await t.click(t.node(tg).locator('[data-test="tg-control-bypass"]'));
      await t.beat(600);
      await t.click(t.node(tg).locator('[data-test="tg-done"]'));
      await t.beat(400);
      await t.click(t.node(tg).locator('[data-test="tg-edit-done"]'));
      await t.beat(800);
      await t.waitVoice();
      return tg;
    });

    const ctlInput = async (): Promise<string> =>
      t.page.evaluate((id) => {
        const n = window.app?.graph?.getNodeById(Number(id)) as { inputs?: { name: string }[] } | null | undefined;
        return n?.inputs?.find((i) => i.name.startsWith("ctl_"))?.name ?? "";
      }, tg);

    await t.h.step("Off bypasses, on runs", async () => {
      await t.say("The row now has a dot on the left. Wire the lighting Context into it.");
      await t.wire(nodes.ctx2, "context", tg, await ctlInput());
      await t.beat(800);
      await t.callout("ctx2", t.node(nodes.ctx2), "Off: bypassed", 5);
      await t.say("The toggle is off, so the lighting Context is bypassed. Run.");
      await t.waitVoice();
      await t.uncallout("ctx2");
      await t.run();
      await t.callout("out", t.node(nodes.text), "No lighting", 5);
      await t.waitVoice();
      await t.uncallout("out");
      await t.say("Switch it on, and run again.");
      await t.click(t.node(tg).locator('[data-test^="tg-ctl-"]').first());
      await t.beat(800);
      await t.run();
      await t.callout("out", t.node(nodes.text), "Lighting is back", 5);
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("WP Node Group", async () => {
      await t.say("To switch several nodes with one toggle, gather them in a WP Node Group, and wire the group into the dot.");
      const grp = await t.addNode("WP Node Group", { x: 240, y: 700 });
      await t.wire(nodes.ctx2, "context", grp, "node_1");
      await t.wire(grp, "nodes", tg, await ctlInput());
      await t.beat(800);
      await t.callout("grp", t.node(grp), "Every node wired in follows the toggle", 5);
      await t.say("Wire in as many nodes as you like. Or put the group node inside a canvas group with nothing wired, and it stands for the whole group.");
      await t.waitVoice();
      await t.uncallout("grp");
    });

    await t.h.step("WP Mode Relay", async () => {
      await t.say("WP Mode Relay chains mutes and bypasses. It watches the nodes wired into it, and when they're muted or bypassed, it does the same to the node group its output goes into.");
      const relay = await t.addNode("WP Mode Relay", { x: 650, y: 880 });
      await t.wire(nodes.ctx2, "context", relay, "node_1");
      await t.beat(800);
      await t.callout("relay", t.node(relay), "Mute a sampler, and its save branch follows", 6);
      await t.waitVoice();
      await t.uncallout("relay");
    });

    await t.h.step("Outro", async () => {
      await t.say("Toggles switch rules and nodes, Node Groups gather what one switch drives, and Mode Relay chains them. The first example workflow uses all three.");
    });
  },
);
