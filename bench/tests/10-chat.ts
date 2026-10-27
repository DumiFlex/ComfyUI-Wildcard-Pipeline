// C: the chat answering questions and helping.
import { StepError } from "watchwright";
import { prompt } from "../meta.js";
import { bench, chat, sfw } from "../shapes.js";

bench("C1", async (t) => {
  await chat()(t);
  // C12 goes on in this chat.
  await t.child("C12");
});
// C12 asks C2, C3 and C6 again in C1's chat, then its own question: does a long chat still answer?
bench(
  "C12",
  async ({ h, P }) => {
    for (const id of ["C2", "C3", "C6"]) {
      await h.step(`ask ${id} again`, async () => {
        await h.chat(prompt(id), { fresh: false });
        await h.chatShot(`again-${id}`);
      });
    }
    await h.step("send", () => h.chat(P, { fresh: false }));
    await h.step("keep the answer", async () => {
      await h.chatShot("answer");
      await h.keep("meter", '[data-test="ai-chat-meter"]');
    });
  },
  { inside: "C1" },
);
bench("C2", chat());
bench("C3", chat());
bench("C4", chat({ page: true }));
bench("C5", chat({ from: async (h) => `wildcards/${await h.idOf("wildcards", "Outfit")}/edit`, page: true }));
bench("C6", chat());
bench("C7", chat({ page: true }));
bench("C8", async ({ h, P }) => {
  await h.step("stack the modules", async () => {
    // Outfit by deep link (it runs at once), then Weather and Mood from the picker.
    await h.visit(`test?module=${await h.idOf("wildcards", "Outfit")}`);
    for (const name of ["Weather", "Mood"]) {
      await h.tap("stack-add");
      await h.type("picker-search", name);
      const options = h.page.locator('[data-test="picker-option"]').filter({ hasText: name });
      let picked = false;
      for (let i = 0; i < (await options.count()) && !picked; i++) {
        const first = ((await options.nth(i).innerText()).trim().split("\n")[0] ?? "").trim();
        if (first !== name) continue;
        await h.tapOn(options.nth(i), "picker-option");
        picked = true;
      }
      if (!picked) throw new StepError(`No ${name} in the module picker.`);
      const add = h.page.locator('[data-test="module-picker"] button:has-text("Add")').last();
      if (await add.isVisible().catch(() => false)) await h.tapOn(add, "stack-add");
      await h.wait(500);
    }
  });
  await h.step("run", async () => {
    await h.tap("run-btn");
    await h.wait(3000);
    await h.shot("run");
  });
  await h.step("ask why", async () => {
    await h.type("tr-ai-why", P);
    await h.tap("tr-ai-why-ask");
    await h.aiIdle({ expect: true });
  });
  await h.step("keep the answer", async () => {
    await h.chatShot("answer");
    await h.pageShots();
  });
});
bench("C9", async ({ h }) => {
  await h.step("select a paragraph", async () => {
    await h.visit("docs/constraints");
    const para = h.page.locator("main p").filter({ hasText: /only/i }).first();
    await para.evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await h.wait(800);
  });
  await h.step("explain it", async () => {
    await h.tap("ai-selection-explain");
    await h.aiIdle({ expect: true });
  });
  await h.step("keep the answer", () => h.chatShot("answer"));
});
bench("C10", chat({ images: sfw }));
bench("C11", async (t) => {
  await chat()(t);
  const { h } = t;
  if (await h.shows("ai-chat-open", 0)) {
    await h.step("open the pack builder", async () => {
      await h.tap("ai-chat-open", { last: true });
      await h.wait(2500);
      await h.shot("pack-builder");
    });
  }
});
