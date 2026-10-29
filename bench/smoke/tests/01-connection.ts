import { check, noAiError, smoke } from "../smoke.js";

smoke(
  "A1",
  { title: "Test connection answers", section: "Connection", description: "Settings › AI assistant › Test connection says Connected, with JSON answers working." },
  async ({ h }) => {
    await h.visit("settings/ai");
    await h.tap("ai-test");
    await h.aiIdle({ quiet: 1500, expect: true });
    const text = await h.keep("result", '[data-test="ai-test-result"]');
    await h.snap("result", '[data-test="ai-test-result"]');
    check(h, /Connected/.test(text), "no-answer", `the test says "${text.replace(/\s+/g, " ").slice(0, 120)}"`);
    check(h, /JSON answers ✓/.test(text), "ai-error", "JSON answers work");
    await noAiError(h);
  },
);
