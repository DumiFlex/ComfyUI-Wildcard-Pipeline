// Advanced 7: derivations in depth. A new "Royal crest" rule: IF $hero matches knight|mage AND NOT
// $setting contains forest, THEN append a crest to $hero and, as a second action, set $eyes to
// "@color eyes" (a reference inside an action). AND flips to OR and back. Then on the canvas.
import { tutorial } from "../tutorial.js";

tutorial(
  "A07",
  {
    title: "Derivations in depth",
    description: "Build a rule with two conditions, NOT, a regex, Append, a second action and a wildcard reference inside an action.",
    learn: "AND / OR, NOT, contains and matches, Append / Prepend, several actions in one branch, and @ references in actions.",
  },
  async (t) => {
    const page = t.page;
    const T = (id: string) => page.locator(`[data-test="${id}"]`).first();
    const pick = async (select: string, option: string) => {
      await t.click(T(select));
      await t.beat(400);
      await t.click(page.getByRole("option", { name: option, exact: true }).first());
      await t.beat(400);
    };
    const varField = async (id: string, name: string) => {
      await t.click(T(id));
      await t.type(name, { cps: 14 });
      await t.beat(300);
      await t.press("Tab");
      await t.beat(300);
    };

    await t.h.step("Two conditions", async () => {
      await t.go("/wp/derivations/new");
      await t.say("Let's build a rule: knights and mages wear a royal crest, but not out in the forest.");
      await t.fill(T("identity-name"), "Royal crest");
      await t.click(T("add-rule"));
      await t.beat(700);
      await t.click(page.locator('[data-test="rule-0"]').getByText("Rule 1").first());
      await t.beat(600);
      if (!(await T("cond-var-0-0").isVisible())) {
        await t.click(T("toggle-branch-0-0"));
        await t.beat(500);
      }
      await t.scrollTo(T("branch-0-0"));
      await t.waitVoice();
      await t.say("When hero matches knight or mage. Matches takes a regular expression: the bar means or.");
      await varField("cond-var-0-0", "hero");
      await pick("cond-op-0-0", "matches (regex)");
      await t.click(T("cond-value-0-0"));
      await t.type("knight|mage", { cps: 14 });
      await t.beat(500);
      await t.waitVoice();
      await t.say("Add a second condition. Setting contains forest, and switch on NOT.");
      await t.click(T("cond-add-0-0"));
      await t.beat(600);
      await varField("cond-var-0-0-1", "setting");
      await pick("cond-op-0-0-1", "contains");
      await t.click(T("cond-value-0-0-1"));
      await t.type("forest", { cps: 14 });
      await t.beat(400);
      await t.click(T("cond-not-0-0-1"));
      await t.beat(600);
      await t.callout("cond", T("cond-group-0-0"), "Knight or mage, and not in a forest", 6);
      await t.waitVoice();
      await t.uncallout("cond");
      await t.say("Both must hold, so the join says AND. Click it for OR, when either one is enough. We want AND, so click it back.");
      await t.click(T("cond-match-0-0-1"));
      await t.beat(900);
      await t.click(T("cond-match-0-0-1"));
      await t.beat(600);
      await t.waitVoice();
      await t.callout("group", T("cond-add-group-0-0"), "Group: brackets for mixed AND / OR", 4);
      await t.say("Group adds a bracket of conditions, for mixes like this and, this or that.");
      await t.waitVoice();
      await t.uncallout("group");
    });

    await t.h.step("Two actions", async () => {
      await t.scrollTo(T("act-block-0-0"));
      await t.say("Then: Append to hero, so the crest goes after the pick. Prepend puts text in front.");
      await varField("act-target-0-0", "hero");
      await pick("act-mode-0-0", "Append");
      await t.click(T("act-value-0-0"));
      await t.type(" wearing a royal crest", { cps: 16 });
      await t.beat(500);
      await t.waitVoice();
      await t.say("One branch can do several things. Add an action: eyes become a fresh roll of Colors, written with an at reference, like in a list.");
      await t.click(T("act-add-0-0"));
      await t.beat(600);
      await varField("act-target-0-0-1", "eyes");
      await t.click(T("act-value-0-0-1"));
      await t.type("@colo", { cps: 12 });
      await t.beat(700);
      await t.press("Enter");
      await t.beat(700);
      await t.type(" eyes", { cps: 14 });
      await t.beat(500);
      await t.callout("acts", [T("act-block-0-0"), T("act-block-0-0-1")], "Run in order, top to bottom", 6);
      await t.waitVoice();
      await t.uncallout("acts");
      await t.say("Save it.");
      await t.click(T("save-btn"));
      await t.beat(1500);
    });

    await t.h.step("On the canvas", async () => {
      await t.go("/");
      await t.say("On the canvas, pick Hero, Eyes, Setting and the new rule, which goes after the lists it reads.");
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Hero", "Eyes", "Setting", "Royal crest"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero with $eyes, in $setting", { cps: 16 });
      await t.beat(600);
      await t.waitVoice();
      const prev = t.node(asm).locator('[data-test="asm-preview"]');
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      await t.say("Roll until a knight or a mage turns up away from the forest.");
      for (let i = 0; i < 14; i++) {
        await t.click(plus);
        await t.beat(800);
        if (/crest/.test(((await prev.count()) > 0 ? ((await prev.textContent()) ?? "") : ""))) break;
      }
      await t.callout("prev", prev, "Crest appended, eyes rolled", 6);
      await t.say("There's the crest, and the eyes are a color. Any other hero keeps the plain Eyes roll.");
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("Outro", async () => {
      await t.say("Conditions with AND, OR and NOT, text tests and regex, and actions that append, prepend and roll lists. Next: the constraint matrix in depth.");
    });
  },
);
