// Nodes 8: WP Node Group in depth (the depth standard). The shared switch scene (two KSamplers, a save
// branch in the canvas group "Save branch" with a Node Group inside). Node dots that grow as you wire
// (any output), rows with title and id, the mode chip (runs → muted → bypassed), Set every node, the
// group node's own mode, Whole group and Covers, the nodes (out) into a WP Toggles control dot, how it
// works, recipes and gotchas. No run, no model.
import { StepError } from "watchwright";
import { flipUntil, modeOf, muteToggle, wireIn, buildSwitchScene } from "../switch-scene.js";
import { tutorial } from "../tutorial.js";

tutorial(
  "N08",
  {
    title: "WP Node Group in depth",
    description: "Switch many nodes at once: wire them into a WP Node Group or let it stand for a whole canvas group, set modes per node or for all, and drive it from a toggle.",
    learn: "Node dots, rows and mode chips, Run / Mute / Bypass, the group node's own mode, Whole group and Covers, nodes into a Toggles control dot.",
  },
  async (t) => {
    const n = await t.h.step("What it's for", async () => {
      const s = await buildSwitchScene(t);
      await t.say("Two samplers, and a save branch that decodes, upscales and saves. Sometimes a whole part should be off: one sampler for a quick test, or no upscale.");
      await t.waitVoice();
      await t.say("Muting nodes one by one is slow and easy to forget. WP Node Group gathers nodes so you, a toggle or a relay can switch them all at once.");
      await t.waitVoice();
      return s;
    });

    const grp = await t.h.step("Node dots", async () => {
      await t.say("Add a WP Node Group, and wire the first sampler's output into its dot.");
      const g = await t.addNode("WP Node Group", { x: 560, y: 260 });
      await wireIn(t, n.ks1, "LATENT", g);
      await t.waitVoice();
      await t.say("A new free dot appears as you wire, and a freed one goes. Wire the second sampler too. Any output works: the wire only says which node it is, nothing flows through it.");
      await wireIn(t, n.ks2, "LATENT", g);
      await t.beat(600);
      await t.waitVoice();
      const rows = t.node(g).locator('[data-test^="ng-row-"]');
      await t.callout("rows", await rows.all(), "Title, id and mode", 5);
      await t.say("Each row shows its node's title, its id, and a chip with its mode.");
      await t.waitVoice();
      await t.uncallout("rows");
      return g;
    });

    await t.h.step("Modes, one by one", async () => {
      const chip = t.node(grp).locator('[data-test^="ng-mode-"]').first();
      await t.say("Click a chip: runs becomes muted. A muted node is skipped, and so is everything that needs its output.");
      await t.click(chip);
      await t.beat(700);
      await t.waitVoice();
      await t.say("Click again: bypassed. The node is stepped over, and its input goes straight through to what comes after. Once more, and it runs.");
      await t.click(chip);
      await t.beat(700);
      await t.click(chip);
      await t.beat(700);
      await t.waitVoice();
    });

    await t.h.step("Every node at once", async () => {
      const all = t.node(grp).locator('[aria-label="Set every node"]');
      await t.callout("all", all, "Every node at once", 4);
      await t.say("Run, Mute and Bypass at the top set every node in the group at once. Mute.");
      await t.click(t.node(grp).locator('[data-test="ng-all-muted"]'));
      await t.beat(800);
      await t.waitVoice();
      await t.uncallout("all");
      if ((await modeOf(t, n.ks1)) !== 2) throw new StepError("Mute all didn't mute the first sampler.");
      await t.say("Both samplers grey out. Run.");
      await t.click(t.node(grp).locator('[data-test="ng-all-on"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.say("Muting or bypassing the Node Group node itself, with ComfyUI's own shortcuts, does the same to all its nodes, and the panel says so.");
      await t.waitVoice();
    });

    await t.h.step("A whole canvas group", async () => {
      const b = t.node(n.grpB);
      await t.callout("whole", b.locator('[data-test="ng-whole-group"]'), "Stands for the canvas group", 5);
      await t.say("This second Node Group has nothing wired in, and it sits inside the canvas group Save branch. So it stands for the whole group: Decode, Upscale, and Save Image, which has no output to wire.");
      await t.waitVoice();
      await t.uncallout("whole");
      const covers = b.locator('[aria-label="Which canvas groups it covers"]');
      await t.callout("cov", covers, "Which groups", 5);
      await t.say("Covers decides which groups. Its group: the smallest group it sits in, with any groups inside it. Not inner: that group without the groups inside. Every group: outer ones too.");
      await t.waitVoice();
      await t.uncallout("cov");
      await t.say("Set it to Bypass to see it work.");
      await t.click(b.locator('[data-test="ng-all-bypassed"]'));
      await t.beat(800);
      await t.callout("br", [t.node(n.dec), t.node(n.up), t.node(n.save)], "The whole branch", 5);
      await t.waitVoice();
      await t.uncallout("br");
      await t.click(b.locator('[data-test="ng-all-on"]'));
      await t.beat(500);
      await t.say("Move a node into the canvas group, and it joins. Wire any node into a dot, and the Node Group goes back to only the wired ones.");
      await t.waitVoice();
    });

    await t.h.step("Driven by a toggle", async () => {
      await t.say("Its nodes (out) goes into a WP Toggles control dot. Make a toggle called Samplers, with When off set to Mute: its row gets a dot in front.", "Its nodes output goes into a WP Toggles control dot. Make a toggle called Samplers, with When off set to Mute: its row gets a dot in front.");
      await t.speedUp(3);
      // A screen point right of the Save branch group (x 90 is under the sidebar).
      const { tg, ctl } = await muteToggle(t, "Samplers", { x: 1700, y: 600 });
      await t.normalSpeed();
      await t.wire(grp, "nodes", tg, ctl);
      await t.beat(700);
      await t.waitVoice();
      await t.say("Switch it off.");
      await flipUntil(t, tg, n.ks1, 2);
      await t.callout("all", [t.node(n.ks1), t.node(n.ks2)], "One switch", 5);
      await t.say("Both samplers mute together. Switch it on, and they run again.");
      await t.waitVoice();
      await t.uncallout("all");
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("A Node Group sets ComfyUI's own node modes on the canvas, as you'd do by hand, the moment you click. Nothing about it runs with the prompt, and the modes save with the workflow.");
      await t.waitVoice();
      await t.say("Recipes: a canvas group per stage, each with a Node Group, driven by a Toggles control panel. A Mode Relay watching the samplers, driving the save branch's group, as the first example workflow does.");
      await t.waitVoice();
      await t.say("Gotchas: bypass only works where a node's input and output have the same type, otherwise mute it. And a Node Group with a wire in it no longer stands for its canvas group.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Use a Node Group for any set of nodes you switch together. The Node Group page in the docs has every option.");
      await t.waitVoice();
    });
  },
);
