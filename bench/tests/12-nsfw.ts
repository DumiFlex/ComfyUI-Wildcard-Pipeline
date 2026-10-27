// Z: NSFW items, chat and packs. They run in the bench page's order: Z1 to Z15, the image tests
// Z20 to Z22, then Z16 to Z19.
import { bench, chat, describe, edit, make, nsfwImage, organize, pack } from "../shapes.js";

bench("Z1", make("wildcards", "wc-ai-draft", { mode: "add", name: "Lingerie", varName: "lingerie", apply: "ai-draft-add", nsfw: true }));
bench("Z2", describe("wildcards", "Lingerie"));
bench("Z3", edit("wildcards", "Lingerie", "wc-ai-draft", { mode: "add" }));
bench("Z4", make("wildcards", "wc-ai-draft", { mode: "add", name: "Pose", varName: "pose", apply: "ai-draft-add", nsfw: true }));
bench("Z5", edit("wildcards", "Lingerie", "wc-ai-draft", { mode: "retag" }));
bench("Z6", edit("wildcards", "Pose", "wc-ai-draft", { mode: "add" }));
bench(
  "Z7",
  make("constraints", "cn-ai", {
    name: "Lingerie → pose",
    nsfw: true,
    setup: async (h) => {
      await h.choose("source-wildcard-select", "Lingerie");
      await h.choose("target-wildcard-select", "Pose");
    },
  }),
);
bench("Z8", make("derivations", "drv-ai", { name: "Nude rules", nsfw: true }));
bench("Z9", make("fixed-values", "fv-ai", { name: "Pony explicit", nsfw: true }));
bench("Z10", make("templates", "tpl-ai", { name: "Boudoir Pony" }));
bench("Z11", chat({ after: "apply-last" }));
bench("Z12", chat());
bench("Z13", chat());
bench("Z14", chat());
// Lingerie, Pose and the bedroom wildcard Z11 made: every wildcard rated NSFW.
bench(
  "Z15",
  organize({ names: async (h) => (await h.library()).modules.filter((m) => m.type === "wildcard" && m.content_rating === "nsfw").map((m) => m.name) }),
);
bench("Z20", edit("wildcards", "Lingerie", "wc-ai-draft", { mode: "add", images: nsfwImage }));
bench("Z21", chat({ images: nsfwImage }));
bench("Z22", pack({ nsfw: true, images: nsfwImage }));
bench(
  "Z16",
  async (t) => {
    await t.h.setAiConfig({ allow_delete: true });
    try {
      await chat({ after: "delete" })(t);
    } finally {
      await t.h.setAiConfig({ allow_delete: false });
    }
  },
  { tags: ["changes-library"] },
);
bench("Z17", pack({ nsfw: true }));
bench("Z18", pack({ nsfw: true }));
bench("Z19", pack({ nsfw: true, sample: true }));
