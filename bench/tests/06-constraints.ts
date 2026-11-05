// X: constraints.
import { bench, chat, describe, edit, make } from "../shapes.js";

bench(
  "X1",
  make("constraints", "cn-ai", {
    name: "Class → weapon",
    setup: async (h) => {
      await h.choose("source-wildcard-select", "Class");
      await h.choose("target-wildcard-select", "Weapon");
    },
  }),
);
bench("X2", describe("constraints", "Class → weapon"));
bench("X3", edit("constraints", "Race → class", "cn-ai"));
bench("X4", chat());
bench("X5", chat({ after: "apply-undo" }));
bench("X6", chat());
bench("X7", chat({ after: "delete" }), { tags: ["changes-library"] });
