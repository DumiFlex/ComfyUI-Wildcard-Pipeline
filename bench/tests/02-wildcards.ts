// W: wildcards, from the editor's AI panel and from the chat.
import { PANEL, said } from "../bench.js";
import { bench, chat, describe, edit, make, sfw, tickOptions } from "../shapes.js";

bench("W1", make("wildcards", "wc-ai-draft", { mode: "add", name: "Hairstyle", varName: "hairstyle", apply: "ai-draft-add" }));
bench("W2", describe("wildcards", "Hairstyle"));
bench("W3", async (t) => {
  await edit("wildcards", "Outfit", "wc-ai-draft", { mode: "add" })(t);
  await t.child("W4");
});
// W4 refines W3's answer in the same panel.
bench(
  "W4",
  async ({ h, P }) => {
    await h.step(`Refine the answer: ${said(P)}`, async () => {
      await h.type('[data-test="ai-instruction"]:visible', P);
      await h.tap('[data-test="ai-refine"]:visible');
      await h.aiIdle();
    });
    await h.step("Keep the refined answer", async () => {
      await h.keep("answer", PANEL);
      await h.panelShot("answer");
    });
  },
  { inside: "W3" },
);
bench("W5", edit("wildcards", "Outfit", "wc-ai-draft", { mode: "add" }));
bench("W6", edit("wildcards", "Shoes", "wc-ai-draft", { mode: "add" }));
bench("W7", edit("wildcards", "Accessory", "wc-ai-draft", { mode: "add", images: sfw }));
bench("W8", edit("wildcards", "Outfit", "wc-ai-draft", { mode: "remove" }));
bench("W9", edit("wildcards", "Outfit", "wc-ai-draft", { mode: "rewrite" }));
bench("W10", edit("wildcards", "Weather", "wc-ai-draft", { mode: "rewrite", prepare: (h) => tickOptions(h, ["heavy rain", "thick fog", "thunderstorm"]) }));
bench("W11", edit("wildcards", "Outfit", "wc-ai-draft", { mode: "retag" }));
bench("W12", edit("wildcards", "Outfit", "wc-ai-draft", { mode: "reweight" }));
bench("W13", chat({ after: "apply-undo" }));
bench("W14", chat({ decide: true }));
bench("W15", chat({ after: "apply-undo" }));
bench("W16", chat());
bench("W17", chat());
bench("W18", chat({ page: true }));
bench("W19", chat({ after: "apply-undo" }));
bench("W20", async (t) => {
  await chat({ after: "apply-last" })(t);
  // W21 continues this chat, on the last attempt only (it keeps what W20 applied).
  if (t.last) await t.child("W21");
});
bench(
  "W21",
  async ({ h, P }) => {
    await h.step(`Send in the same chat: ${said(P)}`, () => h.chat(P, { fresh: false }));
    await h.step("Keep the reply", () => h.chatShot("answer"));
    await h.step("Apply the card", async () => {
      if (await h.applyCard()) await h.chatShot("applied");
    });
  },
  { inside: "W20" },
);
bench(
  "W22",
  async (t) => {
    await t.h.setAiConfig({ allow_delete: false });
    await chat()(t);
    const still = await t.h.idOf("wildcards", "Hairstyle").then(
      () => true,
      () => false,
    );
    t.h.log(still ? "Hairstyle is still there." : "Hairstyle is GONE.");
    if (!still) t.h.flag("deleted-while-off", "The chat deleted Hairstyle while deleting was off.");
  },
  { tags: ["changes-library"] },
);
bench(
  "W23",
  async (t) => {
    const { h } = t;
    await h.setAiConfig({ allow_delete: true });
    try {
      await chat()(t);
      await h.step("Confirm the Delete card, then Undo", async () => {
        if (!(await h.applyCard())) return;
        await h.chatShot("deleted");
        await h.undoCard();
        await h.chatShot("undone");
        const back = await h.idOf("wildcards", "Hairstyle").then(
          () => true,
          () => false,
        );
        h.log(back ? "Undo brought Hairstyle back." : "Undo did NOT bring Hairstyle back.");
        if (back) {
          await h.api(`/wp/api/modules/${await h.idOf("wildcards", "Hairstyle")}`, { method: "DELETE" });
          h.log("Deleted Hairstyle again (by hand).");
        }
      });
    } finally {
      await h.setAiConfig({ allow_delete: false });
    }
  },
  { tags: ["changes-library"] },
);
bench("W24", chat({ after: "delete" }), { tags: ["changes-library"] });
