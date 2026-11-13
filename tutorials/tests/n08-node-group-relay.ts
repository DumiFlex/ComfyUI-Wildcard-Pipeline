// Nodes 8: WP Node Group and WP Mode Relay in depth (the depth standard). Core nodes as stand-ins for
// a real workflow, never run: two KSamplers, and a save branch (VAE Decode → Upscale Image By → Save
// Image) in a canvas group. Node Group: dots that grow as you wire, rows with titles and ids, the mode
// chip, Set every node, the group node's own mode, Whole group (a Node Group inside the canvas group)
// and Covers. Mode Relay: watch dots, the three rows (All muted / All bypassed / Any runs), drives →
// the save branch's Node Group, the status line. Then the chain with WP Toggles (When off: Mute on the
// samplers' group), how it works, recipes and gotchas. No run, no model.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N08",
  {
    title: "WP Node Group and Mode Relay in depth",
    description: "Switch whole parts of a workflow: gather nodes or a canvas group in a WP Node Group, and let WP Mode Relay pass a mute or bypass on to another part.",
    learn: "Node dots, mode chips, Run / Mute / Bypass, Whole group and Covers; watch dots, All muted / All bypassed / Any runs, drives; a Toggles chain.",
  },
  async (t) => {
    const page = t.page;
    const modeOf = (id: string) =>
      page.evaluate((nid) => {
        const g = window.app?.graph;
        const n = (g?.getNodeById(nid) ?? g?.getNodeById(Number(nid))) as { mode?: number } | null | undefined;
        return n?.mode ?? -1;
      }, id);
    const freeDot = (id: string) =>
      page.evaluate((nid) => {
        const g = window.app?.graph;
        const n = (g?.getNodeById(nid) ?? g?.getNodeById(Number(nid))) as { inputs?: { name: string; link: unknown }[] } | null | undefined;
        return n?.inputs?.find((i) => i.name.startsWith("node_") && i.link == null)?.name ?? "node_1";
      }, id);
    const wireIn = async (from: string, out: string, to: string) => wireTo(from, out, to, await freeDot(to));
    const wireTo = (from: string, out: string, to: string, inp: string) => t.wire(from, out, to, inp);

    const n = await t.h.step("What they're for", async () => {
      await t.go("/");
      await t.setView({ scale: 0.8, offset: [0, 0] });
      await t.speedUp();
      const ks1 = await t.addNode("KSampler", { x: 90, y: 110 });
      const ks2 = await t.addNode("KSampler", { x: 90, y: 560 });
      const dec = await t.addNode("VAE Decode", { x: 1000, y: 150 });
      const up = await t.addNode("Upscale Image By", { x: 1000, y: 330 });
      const save = await t.addNode("Save Image", { x: 1400, y: 150 });
      await t.wire(ks1, "LATENT", dec, "samples");
      await t.wire(dec, "IMAGE", up, "image");
      await t.wire(up, "IMAGE", save, "images");
      const grpB = await t.addNode("WP Node Group", { x: 1060, y: 560 });
      // The canvas group around the save branch and its Node Group.
      await page.evaluate((ids) => {
        type N = { pos: [number, number]; size: [number, number] };
        const w = window as unknown as { LiteGraph?: { LGraphGroup?: new (title: string) => { pos: number[]; size: number[]; title: string } }; app?: { graph?: { getNodeById(i: number): N | null; add(x: unknown): void }; canvas?: { setDirty(a: boolean, b: boolean): void } } };
        const g = w.app?.graph;
        const nodes = ids.map((i) => g?.getNodeById(Number(i))).filter((x): x is N => !!x);
        const x0 = Math.min(...nodes.map((x) => x.pos[0])) - 30;
        const y0 = Math.min(...nodes.map((x) => x.pos[1])) - 80;
        const x1 = Math.max(...nodes.map((x) => x.pos[0] + x.size[0])) + 30;
        const y1 = Math.max(...nodes.map((x) => x.pos[1] + x.size[1])) + 30;
        const Ctor = w.LiteGraph?.LGraphGroup;
        if (!Ctor || !g) return;
        const grp = new Ctor("Save branch");
        grp.pos = [x0, y0];
        grp.size = [x1 - x0, y1 - y0];
        g.add(grp);
        w.app?.canvas?.setDirty(true, true);
      }, [dec, up, save, grpB]);
      await t.normalSpeed();
      await t.say("Two samplers, and a save branch that decodes, upscales and saves. Sometimes you want a whole part of this off: no upscale for a quick test, or one sampler only.");
      await t.waitVoice();
      await t.say("Muting nodes one by one is slow and easy to forget. WP Node Group switches many nodes at once, and WP Mode Relay passes a switch on from one part to another.");
      await t.waitVoice();
      return { ks1, ks2, dec, up, save, grpB };
    });

    const grpA = await t.h.step("Node Group: wiring nodes in", async () => {
      await t.say("Add a WP Node Group, and wire the first sampler's output into its dot.");
      const g = await t.addNode("WP Node Group", { x: 560, y: 260 });
      await wireIn(n.ks1, "LATENT", g);
      await t.waitVoice();
      await t.say("A new free dot appears as you wire. Wire the second sampler too. Any output works: the wire only says which node it is.");
      await wireIn(n.ks2, "LATENT", g);
      await t.beat(600);
      await t.waitVoice();
      const rows = t.node(g).locator('[data-test^="ng-row-"]');
      await t.callout("rows", rows, "Title, id and mode", 5);
      await t.say("Each row shows its node's title and id, and a chip with its mode.");
      await t.waitVoice();
      await t.uncallout("rows");
      return g;
    });

    await t.h.step("Node Group: modes", async () => {
      const chip = t.node(grpA).locator('[data-test^="ng-mode-"]').first();
      await t.say("Click a chip: runs, then muted, then bypassed.");
      await t.click(chip);
      await t.beat(700);
      await t.waitVoice();
      await t.say("Muted skips the node and everything that needs it. Click again for bypassed: the node is stepped over, and its input goes straight through. Once more, and it runs.");
      await t.click(chip);
      await t.beat(700);
      await t.click(chip);
      await t.beat(700);
      await t.waitVoice();
      const all = t.node(grpA).locator('[aria-label="Set every node"]');
      await t.callout("all", all, "Every node at once", 4);
      await t.say("Run, Mute and Bypass up top set every node in the group at once. Mute.");
      await t.click(t.node(grpA).locator('[data-test="ng-all-muted"]'));
      await t.beat(800);
      await t.waitVoice();
      await t.uncallout("all");
      if ((await modeOf(n.ks1)) !== 2) throw new StepError("Mute all didn't mute the first sampler.");
      await t.say("Both samplers grey out. Run them again.");
      await t.click(t.node(grpA).locator('[data-test="ng-all-on"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.say("Muting or bypassing the Node Group node itself does the same to all its nodes, and the panel says so.");
      await t.waitVoice();
    });

    await t.h.step("Node Group: a whole canvas group", async () => {
      const b = t.node(n.grpB);
      await t.callout("whole", b.locator('[data-test="ng-whole-group"]'), "Stands for the canvas group", 5);
      await t.say("This second Node Group has nothing wired in, and it sits in the canvas group Save branch. So it stands for the whole group: Decode, Upscale and Save, which has no output to wire.");
      await t.waitVoice();
      await t.uncallout("whole");
      const covers = b.locator('[aria-label="Which canvas groups it covers"]');
      await t.callout("cov", covers, "Which groups", 5);
      await t.say("Covers decides which groups: its group with any inside it, Not inner to leave out groups inside it, or Every group it sits in, outer ones too.");
      await t.waitVoice();
      await t.uncallout("cov");
      await t.say("Add a node to the canvas group, and it joins. Wire any node into a dot, and the Node Group goes back to only the wired ones.");
      await t.waitVoice();
    });

    const relay = await t.h.step("Mode Relay", async () => {
      await t.say("Now, when both samplers are off, the save branch has nothing to save. WP Mode Relay can switch it off with them. Add one, and wire both samplers into its watch dots.");
      const r = await t.addNode("WP Mode Relay", { x: 560, y: 700 });
      await wireIn(n.ks1, "LATENT", r);
      await wireIn(n.ks2, "LATENT", r);
      await t.beat(600);
      await t.waitVoice();
      await t.say("Its drives output goes into a Node Group. Wire it into the save branch's group.");
      await wireTo(r, "drives", n.grpB, await freeDot(n.grpB));
      await t.beat(700);
      await t.waitVoice();
      await t.callout("rows", t.node(r).locator(".wp-mr__row"), "What to send", 6);
      await t.say("Three rows say what to send. All muted: when every watched node is muted. All bypassed: when every one is bypassed. Any runs: when at least one still runs.");
      await t.waitVoice();
      await t.uncallout("rows");
      await t.say("Each can send Run, Mute, Bypass, or nothing. Set All muted to Mute, All bypassed to Mute too, and Any runs to Run.");
      await t.click(t.node(r).locator('[data-test="mr-muted-mute"]'));
      await t.beat(300);
      await t.click(t.node(r).locator('[data-test="mr-bypassed-mute"]'));
      await t.beat(300);
      await t.click(t.node(r).locator('[data-test="mr-on-run"]'));
      await t.beat(500);
      await t.waitVoice();
      await t.say("Mute both samplers from the first group.");
      await t.click(t.node(grpA).locator('[data-test="ng-all-muted"]'));
      await t.beat(1000);
      await t.callout("branch", [t.node(n.dec), t.node(n.up), t.node(n.save)], "Muted by the relay", 5);
      await t.say("The relay sees both muted, and mutes the save branch.");
      await t.waitVoice();
      await t.uncallout("branch");
      await t.callout("st", t.node(r).locator('[data-test="mr-status"]'), "What it sees", 4);
      await t.say("Its status line says what it sees and what it sent.");
      await t.waitVoice();
      await t.uncallout("st");
      await t.say("Let one sampler run again, and the branch comes back.");
      await t.click(t.node(grpA).locator('[data-test^="ng-mode-"]').first());
      await t.beat(300);
      await t.click(t.node(grpA).locator('[data-test^="ng-mode-"]').first());
      await t.beat(300);
      await t.click(t.node(grpA).locator('[data-test^="ng-mode-"]').first());
      await t.beat(900);
      await t.waitVoice();
      await t.click(t.node(grpA).locator('[data-test="ng-all-on"]'));
      await t.beat(500);
      return r;
    });

    await t.h.step("A chain with Toggles", async () => {
      await t.say("Last, the switch itself. A WP Toggles row with When off set to Mute has a dot in front of it. Wire the samplers' Node Group into that dot.");
      await t.speedUp();
      const tg = await t.addNode("WP Toggles", { x: 90, y: 1000 });
      const tb = await t.node(tg).boundingBox();
      if (tb) await t.click({ x: tb.x + tb.width / 2, y: tb.y + 14 });
      await t.beat(400);
      await t.click(page.locator(".wp-tb-icon--edit").first().locator("xpath=ancestor::button[1]"));
      await t.beat(700);
      await t.click(t.node(tg).locator('[data-test="tg-add"]'));
      await t.beat(700);
      const win = page.getByRole("dialog").filter({ has: page.locator('[data-test="tg-window-done"]') }).last();
      await t.fill(win.locator('[data-test="tg-name"] input, input[data-test="tg-name"]').first(), "Samplers", { cps: 30 });
      await t.press("Tab");
      await t.click(win.locator('[data-test="tg-control-mute"]'));
      await t.beat(400);
      await t.click(win.locator('[data-test="tg-window-done"]'));
      await t.beat(500);
      await t.click(t.node(tg).locator('[data-test="tg-edit-done"]'));
      await t.beat(500);
      await t.deselect();
      await t.normalSpeed();
      const ctl = await page.evaluate((id) => {
        const g = window.app?.graph;
        const nn = (g?.getNodeById(id) ?? g?.getNodeById(Number(id))) as { inputs?: { name: string }[] } | null | undefined;
        return nn?.inputs?.find((i) => i.name.startsWith("ctl_"))?.name ?? "";
      }, tg);
      if (!ctl) throw new StepError("The Samplers toggle has no control dot.");
      await t.wire(grpA, "nodes", tg, ctl);
      await t.beat(700);
      await t.waitVoice();
      await t.say("Switch it off.");
      const sw = t.node(tg).locator('[data-test^="tg-ctl-"]').first();
      await t.click(sw);
      await t.beat(400);
      if ((await modeOf(n.ks1)) !== 2) await t.click(sw);
      await t.beat(1000);
      await t.callout("all", [t.node(n.ks1), t.node(n.ks2), t.node(n.save)], "One switch, both parts", 6);
      await t.say("The toggle mutes the samplers' group, the relay sees them muted, and mutes the save branch. One switch, a whole branch, with no node touched by hand. The first example workflow is built this way.");
      await t.waitVoice();
      await t.uncallout("all");
      if (!(await t.node(relay).isVisible().catch(() => false))) throw new StepError("The relay left the screen.");
    });

    await t.h.step("How it works and gotchas", async () => {
      await t.say("Both set ComfyUI's own node modes on the canvas, as you'd do by hand, before a run starts. Nothing about them runs with the prompt.");
      await t.waitVoice();
      await t.say("Gotchas. A muted node also stops everything that needs its output; a bypassed one lets its input through, so bypass only works where input and output match. And a relay with nothing wired into its watch dots does nothing.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Use a Node Group for any set of nodes you switch together, and a Mode Relay to let one part follow another. The Node Group and Mode Relay pages in the docs have more.");
      await t.waitVoice();
    });
  },
);
