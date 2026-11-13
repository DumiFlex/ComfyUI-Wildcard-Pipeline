// Nodes 16: WP Mode Relay in depth (the depth standard). The shared switch scene plus a Node Group
// holding both samplers (built sped up). Watch dots, drives (out) into the save branch's Node Group,
// the three rows (All muted / All bypassed / Any runs) and their four answers, the status line, then
// mute both samplers (the branch follows), one back (it comes back), bypass both, a Toggles switch at
// the head of the chain, how it works, recipes and gotchas. No run, no model.
import { flipUntil, muteToggle, wireIn, buildSwitchScene } from "../switch-scene.js";
import { tutorial } from "../tutorial.js";

tutorial(
  "N16",
  {
    title: "WP Mode Relay in depth",
    description: "Let one part of a workflow follow another: watch nodes with WP Mode Relay and pass a mute, bypass or run on to a Node Group.",
    learn: "Watch dots, drives, All muted / All bypassed / Any runs, Run / Mute / Bypass / nothing, the status line, chaining with Toggles.",
  },
  async (t) => {
    const n = await t.h.step("What it's for", async () => {
      const s = await buildSwitchScene(t);
      await t.speedUp(4);
      const grpA = await t.addNode("WP Node Group", { x: 560, y: 260 });
      await wireIn(t, s.ks1, "LATENT", grpA);
      await wireIn(t, s.ks2, "LATENT", grpA);
      await t.normalSpeed();
      await t.say("Two samplers in a Node Group, and a save branch with its own Node Group, standing for the canvas group around it.");
      await t.waitVoice();
      await t.say("When both samplers are off, the save branch has nothing to save, and ComfyUI complains about it. WP Mode Relay watches nodes and passes their state on, so the branch follows by itself.");
      await t.waitVoice();
      return { ...s, grpA };
    });

    const relay = await t.h.step("Watch dots and drives", async () => {
      await t.say("Add a WP Mode Relay, and wire both samplers into its watch dots. Like a Node Group's, a free dot appears as you wire, and any output works.");
      const r = await t.addNode("WP Mode Relay", { x: 560, y: 700 });
      await wireIn(t, n.ks1, "LATENT", r);
      await wireIn(t, n.ks2, "LATENT", r);
      await t.beat(600);
      await t.waitVoice();
      await t.say("drives (out) goes into a Node Group: the relay sets that group's nodes. Wire it into the save branch's group.", "Its drives output goes into a Node Group: the relay sets that group's nodes. Wire it into the save branch's group.");
      await wireIn(t, r, "drives", n.grpB);
      await t.beat(700);
      await t.waitVoice();
      await t.say("The group still stands for its canvas group: a relay's wire doesn't count as a node.");
      await t.waitVoice();
      return r;
    });

    await t.h.step("The three rows", async () => {
      await t.callout("rows", await t.node(relay).locator(".wp-mr__row").all(), "What to send, and when", 6);
      await t.say("Three rows say what to send. All muted: every watched node is muted. All bypassed: every one is bypassed. Any runs: at least one still runs.");
      await t.waitVoice();
      await t.uncallout("rows");
      await t.say("Each can send Run, Mute, Bypass, or nothing, the dash, which leaves the group as it is. Set All muted to Mute, All bypassed to Bypass, and Any runs to Run.");
      await t.click(t.node(relay).locator('[data-test="mr-muted-mute"]'));
      await t.beat(300);
      await t.click(t.node(relay).locator('[data-test="mr-bypassed-bypass"]'));
      await t.beat(300);
      await t.click(t.node(relay).locator('[data-test="mr-on-run"]'));
      await t.beat(500);
      await t.waitVoice();
      await t.callout("st", t.node(relay).locator('[data-test="mr-status"]'), "What it sees", 4);
      await t.say("The status line says what it sees now, and the row that applies lights up.");
      await t.waitVoice();
      await t.uncallout("st");
    });

    await t.h.step("Watch it follow", async () => {
      await t.say("Mute both samplers from their group.");
      await t.click(t.node(n.grpA).locator('[data-test="ng-all-muted"]'));
      await t.beat(1000);
      await t.callout("branch", [t.node(n.dec), t.node(n.up), t.node(n.save)], "Muted by the relay", 5);
      await t.say("All muted, so the relay mutes the save branch.");
      await t.waitVoice();
      await t.uncallout("branch");
      await t.say("Let one sampler run again.");
      const chip = t.node(n.grpA).locator('[data-test^="ng-mode-"]').first();
      for (let i = 0; i < 2; i++) {
        await t.click(chip);
        await t.beat(300);
      }
      await t.beat(800);
      await t.say("Any runs, so the branch runs too: one sampler still has something to save.");
      await t.waitVoice();
      await t.say("Now bypass both.");
      await t.click(t.node(n.grpA).locator('[data-test="ng-all-bypassed"]'));
      await t.beat(1000);
      await t.say("All bypassed, so the branch is bypassed too.");
      await t.waitVoice();
      await t.click(t.node(n.grpA).locator('[data-test="ng-all-on"]'));
      await t.beat(500);
    });

    await t.h.step("A switch at the head", async () => {
      await t.say("Put a Toggles switch at the head of the chain. A toggle called Samplers with When off set to Mute, and the samplers' group in its dot.");
      await t.speedUp(3);
      // A screen point right of the Save branch group (x 90 is under the sidebar).
      const { tg, ctl } = await muteToggle(t, "Samplers", { x: 1700, y: 600 });
      await t.wire(n.grpA, "nodes", tg, ctl);
      await t.normalSpeed();
      await t.waitVoice();
      await t.say("Switch it off.");
      await flipUntil(t, tg, n.ks1, 2);
      await t.callout("all", [t.node(n.ks1), t.node(n.ks2), t.node(n.save)], "One switch, both parts", 6);
      await t.say("The toggle mutes the samplers, the relay sees them muted and mutes the save branch. One switch, a whole branch, no node touched by hand.");
      await t.waitVoice();
      await t.uncallout("all");
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("The relay checks its watched nodes whenever a mode changes on the canvas, and sets its Node Group right away, before any run. Relays can chain: a relay can watch nodes another relay sets.");
      await t.waitVoice();
      await t.say("Recipes: a save or upscale branch that follows its sampler, a detailer that follows the face model's loader, a preview branch that only runs when the full branch is off, with Any runs sending Mute.");
      await t.waitVoice();
      await t.say("Gotchas: a relay with nothing in its watch dots does nothing, a dash leaves the group as you set it by hand, and a relay drives only a Node Group, never a node directly.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Use a Mode Relay whenever one part should follow another. The Mode Relay page in the docs has every option.");
      await t.waitVoice();
    });
  },
);
