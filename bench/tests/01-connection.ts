// S: the assistant's connection test.
import { bench } from "../shapes.js";

bench(
  "S1",
  async ({ h }) => {
    await h.step("open the settings", () => h.visit("settings/ai"));
    await h.step("test the connection", async () => {
      // The first press loads the model; the second shows how it answers warm.
      await h.tap("ai-test");
      await h.aiIdle({ quiet: 1500 });
      await h.tap("ai-test");
      h.metric("seconds", Math.round(await h.aiIdle({ quiet: 1500 })), "s");
    });
    await h.step("keep the result", async () => {
      await h.keep("result", '[data-test="ai-test-result"]');
      await h.snap("result", '[data-test="ai-test-result"]');
      await h.shot("settings");
    });
  },
  { review: { drop: ["follows"] } },
);
