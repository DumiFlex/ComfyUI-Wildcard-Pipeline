// Advanced 8: the constraint matrix in depth, on Role fits the place. Ranger × castle becomes Reduce
// ×0.2, mage × castle becomes Only (an allow-list row), and an exception boosts the inventor in the
// workshop. The Preview table shows each change as it lands.
import { tutorial } from "../tutorial.js";

tutorial(
  "A08",
  {
    title: "The constraint matrix in depth",
    description: "Use every cell rule (boost, reduce, exclude, only), set a factor, add an exception for one pair of options, and read the Preview.",
    learn: "Cell rules and factors, Only rows, exceptions, and the Preview table.",
  },
  async (t) => {
    const page = t.page;
    const T = (id: string) => page.locator(`[data-test="${id}"]`).first();
    const prevRow = (who: string) => T("constraint-preview").locator("tr").filter({ hasText: who }).first();
    const cellRule = async (cell: string, rule: RegExp) => {
      await t.click(T(cell));
      await t.beat(500);
      await t.click(page.locator(".wp-popover").last().getByRole("button", { name: rule }));
      await t.beat(500);
    };
    const choose = async (select: string, option: string | RegExp) => {
      await t.click(T(select));
      await t.beat(400);
      await t.click(page.getByRole("option", { name: option }).first());
      await t.beat(400);
    };

    await t.h.step("Every cell", async () => {
      await t.go("/wp/constraints/7ff544c2/edit");
      await t.say("Back to Role fits the place. Each cell of the matrix holds one rule for a pair of tags.");
      await t.scrollTo(T("matrix-grid"), { at: 0.3 });
      await t.callout("grid", T("matrix-grid"), "Rows: the role's tags. Columns: the setting's.", 6);
      await t.waitVoice();
      await t.uncallout("grid");
      await t.say("Boost and reduce multiply the chance by a factor. Exclude sets it to zero. Neutral leaves it alone.");
      await t.waitVoice();
    });

    await t.h.step("Reduce", async () => {
      await t.say("Rangers rarely end up in castles. Click ranger and castle, choose Reduce, and set the factor to point two.");
      await cellRule("cell-ranger-castle", /reduce/i);
      await t.fill(page.getByLabel("Factor multiplier"), "0.2", { cps: 10 });
      await t.press("Enter");
      await t.beat(400);
      await t.press("Escape");
      await t.beat(600);
      await t.waitVoice();
      await t.scrollTo(T("constraint-preview"), { at: 0.35 });
      await t.callout("ranger", prevRow("a forest ranger"), "A ranger's castle odds drop", 6);
      await t.say("The Preview below shows each role's chance of every place. The ranger's castle chances just fell.");
      await t.waitVoice();
      await t.uncallout("ranger");
    });

    await t.h.step("Only", async () => {
      await t.scrollTo(T("matrix-grid"), { at: 0.3 });
      await t.say("Only turns a row into a list of what's allowed. Set mage and castle to Only.");
      await cellRule("cell-mage-castle", /only/i);
      await t.press("Escape");
      await t.beat(600);
      await t.waitVoice();
      await t.say("Now a battle mage gets a castle, or a place with its own rule in that row. The forest and the city had none, so they're out.");
      await t.scrollTo(T("constraint-preview"), { at: 0.35 });
      await t.callout("thief", prevRow("a battle mage"), "Castle only", 6);
      await t.waitVoice();
      await t.uncallout("thief");
    });

    await t.h.step("An exception", async () => {
      await t.say("Tags work on groups. For one pair of options, add an exception: the inventor loves the workshop.");
      await t.click(T("add-exception"));
      await t.beat(600);
      await t.scrollTo(T("cn-ex-src-select"), { at: 0.4 });
      await choose("cn-ex-src-select", "a clockwork inventor");
      await choose("cn-ex-tgt-select", "in a cluttered workshop full of brass gears");
      await choose("cn-ex-mode-select", /boost/i);
      await t.beat(600);
      await t.waitVoice();
      await t.scrollTo(T("constraint-preview"), { at: 0.35 });
      await t.callout("inv", prevRow("a clockwork inventor"), "The workshop boosted for the inventor", 6);
      await t.say("Only the inventor's row changes. An exception beats the matrix for its pair.");
      await t.waitVoice();
      await t.uncallout("inv");
      await t.scrollTo(T("matrix-grid"), { at: 0.2, force: true });
      await t.callout("grid", T("matrix-grid").locator("table").first(), "Tags, or accepts groups", 6);
      await t.say("And when a list has an accepts group, its tags can be the rows or the columns too.");
      await t.waitVoice();
      await t.uncallout("grid");
      await t.say("Save.");
      await t.click(T("save-btn"));
      await t.beat(1500);
    });

    await t.h.step("Outro", async () => {
      await t.say("Boost, reduce, exclude and only for tag pairs, exceptions for single options, and the Preview to check the odds. Next: how far a constraint reaches.");
    });
  },
);
