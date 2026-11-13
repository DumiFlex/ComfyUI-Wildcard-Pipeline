// Nodes 7: WP Toggles in depth. Toggles → Context (Role) → Assembler, watched in the Assembler's
// preview (no run needed). A Lantern toggle with a Value, shown in the four styles (Switch, Check,
// Buttons with words of its own, Chip). Rain and Puddles, where Puddles needs Rain: Rain off takes
// Puddles off and Rain on brings back its choice. A label folds the weather toggles into a group.
// The other settings in a toggle's window: Upstream can set it, When off (Mute / Bypass, Invert,
// canvas groups) and the BOOLEAN output for switch nodes. A17 already shows a rule reading a toggle,
// Pick one, values and negatives, and When off with a Node Group. Prompt-only: no model.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N07",
  {
    title: "WP Toggles in depth",
    description: "Every part of WP Toggles: the four styles, toggles that need another, labels that group them, upstream presets, muting and bypassing, and BOOLEAN outputs.",
    learn: "Switch / Check / Buttons / Chip, Needs, labels and folding, Upstream can set it, When off with Invert and canvas groups, BOOLEAN outputs.",
  },
  async (t) => {
    const page = t.page;
    const win = () => page.getByRole("dialog").filter({ has: page.locator('[data-test="tg-window-done"]') }).last();
    const winField = (test: string) =>
      win().locator(`[data-test="${test}"] input, input[data-test="${test}"], [data-test="${test}"] textarea, textarea[data-test="${test}"], [data-test="${test}"] [contenteditable="true"], [data-test="${test}"][contenteditable="true"]`).first();
    const winDone = async () => {
      await t.click(win().locator('[data-test="tg-window-done"]'));
      await t.beat(500);
    };
    const row = (tg: string, name: string) => t.node(tg).locator('[data-test^="tg-row-"]').filter({ hasText: name }).first();
    const ctl = (tg: string, name: string) => row(tg, name).locator('[data-test^="tg-ctl-"]').first();
    const openEdit = async (tg: string) => {
      const box = await t.node(tg).boundingBox();
      if (box) await t.click({ x: box.x + box.width / 2, y: box.y + 14 });
      await t.beat(500);
      await t.click(page.locator(".wp-tb-icon--edit").first().locator("xpath=ancestor::button[1]"));
      await t.beat(800);
    };
    const editDone = async (tg: string) => {
      await t.click(t.node(tg).locator('[data-test="tg-edit-done"]'));
      await t.beat(700);
      await t.deselect();
    };
    // A new toggle (edit view open): its window opens; name it, write a variable, a value, and turn its globe off.
    const addToggle = async (tg: string, name: string, v: string, value: string) => {
      await t.click(t.node(tg).locator('[data-test="tg-add"]'));
      await t.beat(700);
      await t.fill(winField("tg-name"), name, { cps: 16 });
      await t.press("Tab");
      await t.fill(winField("tg-var"), v, { cps: 16 });
      await t.press("Tab");
      await t.fill(winField("tg-value"), value, { cps: 16 });
      await t.beat(300);
    };
    const openRow = async (tg: string, name: string) => {
      await t.click(row(tg, name).locator('[data-test^="tg-edit-"]').first());
      await t.beat(700);
    };
    const preview = (asm: string) => t.node(asm).locator('[data-test="asm-preview"]');
    const previewSays = async (asm: string, re: RegExp, yes: boolean) => {
      for (let i = 0; i < 20; i++) {
        if (re.test(await preview(asm).innerText().catch(() => "")) === yes) return;
        await t.beat(300);
      }
      throw new StepError(`The Assembler preview ${yes ? "never showed" : "still shows"} ${re}.`);
    };

    const n = await t.h.step("A toggle with words", async () => {
      await t.go("/");
      await t.speedUp();
      const tg = await t.addNode("WP Toggles", { x: 300, y: 170 });
      const ctx = await t.addNode("WP Context", { x: 900, y: 170 });
      await t.wire(tg, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1450, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $lantern $rain $puddles");
      await t.press("Escape");
      await t.beat(600);
      await t.normalSpeed();
      await t.say("WP Toggles at the start of a chain, a Context, and an Assembler whose prompt reads three toggles we're about to make.");
      await t.waitVoice();
      await t.say("Select the Toggles and press the pencil. Add a toggle called Lantern, with the words holding a lantern.");
      await openEdit(tg);
      await addToggle(tg, "Lantern", "lantern", "holding a lantern");
      await t.waitVoice();
      return { tg, ctx, asm };
    });

    await t.h.step("Four styles", async () => {
      const styles = win().locator('[data-test^="tg-style-"]');
      await t.callout("styles", styles.first().locator(".."), "How it looks on the node", 5);
      await t.say("Style is how the toggle looks on the node. Switch is the default.");
      await t.waitVoice();
      await t.uncallout("styles");
      await t.say("Check is a tick box.");
      await t.click(win().locator('[data-test="tg-style-checkbox"]'));
      await t.beat(800);
      await t.waitVoice();
      await t.say("Buttons shows two words of your own. Write With and Without.");
      await t.click(win().locator('[data-test="tg-style-buttons"]'));
      await t.beat(500);
      await t.fill(win().locator('[data-test="tg-on-label"] input, input[data-test="tg-on-label"]').first(), "With", { cps: 14 });
      await t.press("Tab");
      await t.fill(win().locator('[data-test="tg-off-label"] input, input[data-test="tg-off-label"]').first(), "Without", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      await t.callout("prev", win().locator('[data-test="tg-window-preview"]'), "Its look on the node", 5);
      await t.say("The window shows how it'll look.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("And Chip is a small pill that lights up while it's on. Keep the buttons.");
      await t.waitVoice();
      await winDone();
      const globe = row(n.tg, "Lantern").locator('[data-test^="tg-internal-"]').first();
      await t.say("Turn off its globe so the prompt can print it, and press Done.");
      await t.click(globe);
      await t.beat(400);
      await editDone(n.tg);
      await t.waitVoice();
      await t.say("Click With.");
      await t.click(row(n.tg, "Lantern").getByText("With", { exact: true }).first());
      await previewSays(n.asm, /holding a lantern/, true);
      await t.callout("prev", preview(n.asm), "Lantern's words", 5);
      await t.say("Its words are in the prompt. Click Without, and they're gone.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.click(row(n.tg, "Lantern").getByText("Without", { exact: true }).first());
      await previewSays(n.asm, /holding a lantern/, false);
    });

    await t.h.step("One toggle needs another", async () => {
      await t.say("Now two toggles that belong together: Rain, and Puddles, which only makes sense in the rain.");
      await openEdit(n.tg);
      await addToggle(n.tg, "Rain", "rain", "in the rain");
      await winDone();
      await addToggle(n.tg, "Puddles", "puddles", "with puddles on the ground");
      await t.waitVoice();
      const needs = win().locator('[data-test="tg-needs"]');
      await t.callout("needs", needs, "Only on while Rain is on", 5);
      await t.say("Needs makes it depend on another toggle. Pick Rain.");
      await t.click(needs);
      await t.beat(400);
      await t.click(page.getByRole("option", { name: /^Rain\b/ }).first());
      await t.beat(500);
      await t.waitVoice();
      await t.uncallout("needs");
      await winDone();
      for (const name of ["Rain", "Puddles"]) {
        await t.click(row(n.tg, name).locator('[data-test^="tg-internal-"]').first());
        await t.beat(300);
      }
      await editDone(n.tg);
      await t.say("Switch both on.");
      await t.click(ctl(n.tg, "Rain"));
      await t.beat(400);
      await t.click(ctl(n.tg, "Puddles"));
      await previewSays(n.asm, /with puddles/, true);
      await t.waitVoice();
      await t.say("Now switch Rain off. Puddles goes off with it, and the prompt drops both.");
      await t.click(ctl(n.tg, "Rain"));
      await previewSays(n.asm, /with puddles/, false);
      await t.callout("p", row(n.tg, "Puddles"), "Off, because Rain is off", 4);
      await t.waitVoice();
      await t.uncallout("p");
      await t.say("Switch Rain back on. Puddles remembers it was on, and comes back.");
      await t.click(ctl(n.tg, "Rain"));
      await previewSays(n.asm, /with puddles/, true);
      await t.waitVoice();
    });

    await t.h.step("Labels group toggles", async () => {
      await t.say("A label groups toggles under a heading. In edit view, Add label, and call it Weather.");
      await openEdit(n.tg);
      await t.click(t.node(n.tg).locator('[data-test="tg-add-label"]'));
      await t.beat(600);
      await t.type("Weather", { cps: 16 });
      await t.press("Enter");
      await t.beat(500);
      await t.waitVoice();
      await t.say("Drag it above Rain with its grip. Everything under a label belongs to it, until the next label.");
      const label = t.node(n.tg).locator('[data-test^="tg-label-"]').filter({ hasText: "Weather" }).first();
      const lb = await label.boundingBox();
      const rb = await row(n.tg, "Rain").boundingBox();
      if (lb && rb) await t.drag({ x: lb.x + 10, y: lb.y + lb.height / 2 }, { x: rb.x + 10, y: rb.y + 4 });
      await t.beat(700);
      await t.waitVoice();
      await editDone(n.tg);
      const fold = t.node(n.tg).locator('[data-test^="tg-fold-"]').first();
      await t.callout("fold", fold, "Fold the group", 4);
      await t.say("Fold it to keep a long node short. Folded toggles keep working.");
      await t.click(fold);
      await t.beat(700);
      await t.waitVoice();
      await t.uncallout("fold");
      await previewSays(n.asm, /in the rain/, true);
      await t.click(fold);
      await t.beat(500);
    });

    await t.h.step("The rest of a toggle's window", async () => {
      await openEdit(n.tg);
      await openRow(n.tg, "Lantern");
      const up = win().locator('[data-test="tg-upstream"]');
      await t.callout("up", up, "A preset can set it", 5);
      await t.say("Upstream can set it lets a Context or Injector before this node decide the switch, with a yes or no word in the same variable. That's how one preset switches many toggles.");
      await t.waitVoice();
      await t.uncallout("up");
      const control = win().locator('[data-test^="tg-control-"]').first().locator("..");
      await t.callout("ctl", control, "Also mute or bypass nodes", 5);
      await t.say("When off can also mute or bypass other nodes: wire them into the dot in front of the row, or pick canvas groups by name, with no wires.");
      await t.click(win().locator('[data-test="tg-control-bypass"]'));
      await t.beat(600);
      await t.waitVoice();
      await t.uncallout("ctl");
      await t.callout("inv", win().locator('[data-test="tg-invert"]'), "Bypass while on instead", 4);
      await t.say("Invert turns it around: bypass while on, for a branch you only want when the switch is off.");
      await t.waitVoice();
      await t.uncallout("inv");
      await t.click(win().locator('[data-test="tg-control-"]'));
      await t.beat(400);
      const pin = win().locator('[data-test="tg-pin"]');
      await t.callout("pin", pin, "A BOOLEAN socket", 4);
      await t.say("BOOLEAN output gives the toggle its own socket on the node, for any switch node from ComfyUI or another pack.");
      await t.click(pin);
      await t.beat(500);
      await t.waitVoice();
      await t.uncallout("pin");
      await winDone();
      await editDone(n.tg);
      await t.callout("out", t.node(n.tg), "Lantern's output", 4);
      await t.say("The node now has a Lantern output, true or false.");
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("Outro", async () => {
      await t.say("Toggles are your workflow's switchboard: words for the prompt, switches for rules, and a way to turn whole branches off. The WP Toggles page in the docs lists every setting.");
      await t.waitVoice();
    });
  },
);
