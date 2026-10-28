// P: the pack builder.
import { StepError } from "watchwright";
import { prompt } from "../meta.js";
import { bench, fixFindings, pack, sfw, skipResearch, type BenchContext } from "../shapes.js";

/** Every test that builds a pack: P12 runs inside the first of them whose check shows problems. */
export const PACK_TESTS = ["P1", "P2", "P6", "P7", "P8", "P9", "P10", "P11", "P13", "Z22", "Z17", "Z18", "Z19", "N5"];

const ASK = '[data-test="%"] textarea, textarea[data-test="%"], input[data-test="%"]';
const ask = (test: string) => ASK.replaceAll("%", test);

bench("P1", pack({ install: true }), { tags: ["changes-library"] });
bench(
  "P2",
  pack({
    afterPlan: async (t) => {
      await t.child("P3");
      await t.child("P4");
      await t.child("P5");
    },
  }),
);
// P3 to P5 change P2's plan, in P2's pack builder.
bench(
  "P3",
  async ({ h, P }) => {
    await h.step("change one item", async () => {
      const items = h.page.locator('[data-test="pack-item"]');
      // The shoes item, else the last one.
      const shoes = items.filter({ hasText: /shoe|footwear/i }).first();
      const item = (await shoes.count()) ? shoes : items.last();
      const open = item.locator('[data-test="pack-item-open"]');
      await h.tapOn((await open.count()) ? open : item, "pack-item-open");
      await h.type(ask("pack-item-ask"), P);
      await h.tap("pack-item-change");
      h.metric("Change s", Math.round(await h.aiIdle({ expect: true })), "s");
    });
    await h.step("keep the plan", async () => {
      await h.keep("plan", '[data-test="pack-plan-list"]');
      await h.shot("changed");
    });
  },
  { inside: "P2" },
);
bench(
  "P4",
  async ({ h, P }) => {
    await h.step("add an item", async () => {
      await h.tap("pack-add");
      await h.type(ask("pack-add-ask"), P);
      await h.tap("pack-add-ai");
      h.metric("Change s", Math.round(await h.aiIdle({ expect: true })), "s");
    });
    await h.step("keep the plan", async () => {
      await h.keep("plan", '[data-test="pack-plan-list"]');
      await h.shot("added");
    });
  },
  { inside: "P2" },
);
bench(
  "P5",
  async ({ h, P }) => {
    await h.step("update the plan", async () => {
      await skipResearch(h);
      await h.type("pack-edit", P);
      // Update plan stays grey until the typed text lands (and while a search offer waits).
      const refine = h.page.locator('[data-test="pack-refine"]').first();
      for (let i = 0; i < 20 && !(await refine.isEnabled().catch(() => false)); i++) {
        if (i === 5) {
          await skipResearch(h);
          await h.type("pack-edit", P);
        }
        await h.wait(500);
      }
      await h.tap("pack-refine");
      h.metric("Plan s", Math.round(await h.aiIdle({ expect: true, timeout: 40 * 60_000 })), "s");
    });
    await h.step("keep the plan", async () => {
      await h.keep("plan", '[data-test="pack-plan-list"]');
      await h.shot("updated");
    });
  },
  { inside: "P2" },
);
bench("P6", pack());
bench("P7", pack());
bench("P8", pack());
bench("P9", pack({ sample: true }));
bench("P10", pack({ images: sfw }));
// P11 extends the bundle P1 installed: the newest bundle that isn't from the bench library.
bench(
  "P11",
  async (t: BenchContext) => {
    const { h } = t;
    const mine = async () =>
      (await h.library()).bundles
        .filter((b) => !/^b0000/.test(b.id))
        .sort((a, b) => String(b.created_at ?? b.updated_at ?? "").localeCompare(String(a.created_at ?? a.updated_at ?? "")));
    if ((await mine()).length === 0) {
      h.log("No pack bundle yet: building and installing P1's pack first (its shots come first).");
      await pack({ install: true, request: prompt("P1") })({ ...t, last: true });
    }
    await pack({
      install: true,
      extend: async () => {
        const [newest] = await mine();
        if (!newest) throw new StepError("No installed pack bundle to extend (installing P1's pack didn't add one).");
        return newest.id;
      },
    })(t);
  },
  { tags: ["changes-library"] },
);
bench("P12", fixFindings, { inside: PACK_TESTS });
bench("P13", pack({ nsfw: true }));
