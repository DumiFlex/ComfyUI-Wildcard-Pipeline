// B: bundles.
import { bench, chat, describe } from "../shapes.js";

bench("B1", describe("bundles", "Bench character", { apply: false }));
bench("B2", async ({ h }) => {
  await h.step("Open Bench character", () => h.open("bundles", "Bench character"));
  await h.step("Split › Suggest a split with AI", async () => {
    await h.tap("bd-split-btn", { done: () => h.shows("split-suggest", 0) });
    await h.tap("split-suggest", { done: () => h.busy() });
    h.metric("seconds", Math.round(await h.aiIdle()), "s");
  });
  await h.step("Keep the suggestion", async () => {
    await h.keep("answer", '[role="dialog"]');
    await h.snap("answer", '[role="dialog"]');
    await h.press("Escape");
  });
});
bench("B3", chat({ after: "apply-last" }));
bench("B4", chat({ after: "apply-undo" }));
bench("B5", chat());
bench("B6", chat());
bench("B7", chat({ after: "delete" }), { tags: ["changes-library"] });
