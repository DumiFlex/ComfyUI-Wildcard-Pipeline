// Advanced 8: the constraint matrix in depth, on Hero fits the place. Wild × castle becomes Reduce
// ×0.2, urban × city becomes Only (an allow-list row), and an exception boosts the inventor on the
// rooftop garden. The Preview table shows each change as it lands.
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
      await t.say("Back to Hero fits the place. Each cell of the matrix holds one rule for a pair of tags.");
      await t.scrollTo(T("matrix-grid"), { at: 0.3 });
      await t.callout("grid", T("matrix-grid"), "Rows: the hero's tags. Columns: the setting's.", 6);
      await t.waitVoice();
      await t.uncallout("grid");
      await t.say("Boost and reduce multiply the chance by a factor. Exclude sets it to zero. Neutral leaves it alone.");
      await t.waitVoice();
    });

    await t.h.step("Reduce", async () => {
      await t.say("Wild heroes rarely end up in castles. Click wild and castle, choose Reduce, and set the factor to point two.");
      await cellRule("cell-wild-castle", /reduce/i);
      await t.fill(page.getByLabel("Factor multiplier"), "0.2", { cps: 10 });
      await t.press("Enter");
      await t.beat(400);
      await t.press("Escape");
      await t.beat(600);
      await t.waitVoice();
      await t.scrollTo(T("constraint-preview"), { at: 0.35 });
      await t.callout("ranger", prevRow("a forest ranger"), "A ranger's castle odds drop", 6);
      await t.say("The Preview below shows each hero's chance of every place. The ranger's castle chances just fell.");
      await t.waitVoice();
      await t.uncallout("ranger");
    });

    await t.h.step("Only", async () => {
      await t.scrollTo(T("matrix-grid"), { at: 0.3 });
      await t.say("Only turns a row into a list of what's allowed. Set urban and city to Only.");
      await cellRule("cell-urban-city", /only/i);
      await t.press("Escape");
      await t.beat(600);
      await t.waitVoice();
      await t.say("Now a city hero gets the city, or a place with its own rule in that row. The wilds had none, so they're out.");
      await t.scrollTo(T("constraint-preview"), { at: 0.35 });
      await t.callout("thief", prevRow("a street thief"), "City only", 6);
      await t.waitVoice();
      await t.uncallout("thief");
    });

    await t.h.step("An exception", async () => {
      await t.say("Tags work on groups. For one pair of options, add an exception: the inventor loves the rooftop garden.");
      await t.click(T("add-exception"));
      await t.beat(600);
      await t.scrollTo(T("cn-ex-src-select"), { at: 0.4 });
      await choose("cn-ex-src-select", "an inventor");
      await choose("cn-ex-tgt-select", "a rooftop garden above the city");
      await choose("cn-ex-mode-select", /boost/i);
      await t.beat(600);
      await t.waitVoice();
      await t.scrollTo(T("constraint-preview"), { at: 0.35 });
      await t.callout("inv", prevRow("an inventor"), "Rooftop garden boosted for the inventor", 6);
      await t.say("Only the inventor's row changes. An exception beats the matrix for its pair.");
      await t.waitVoice();
      await t.uncallout("inv");
      await t.say("And when a list has an accepts group, its tags can be the rows or the columns too. Save.");
      await t.click(T("save-btn"));
      await t.beat(1500);
    });

    await t.h.step("Outro", async () => {
      await t.say("Boost, reduce, exclude and only for tag pairs, exceptions for single options, and the Preview to check the odds. Next: how far a constraint reaches.");
    });
  },
);
