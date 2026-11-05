// K: combines.
import { bench, chat, describe, edit, make } from "../shapes.js";

bench("K1", make("combines", "cb-ai", { name: "Adventurer line", setup: (h) => h.type('[data-test="cb-output-var"] input, input[data-test="cb-output-var"]', "adventurer") }));
bench("K2", describe("combines", "Adventurer line"));
bench("K3", edit("combines", "Character phrase", "cb-ai"));
bench("K4", chat());
bench("K5", chat({ after: "apply-undo" }));
bench("K6", chat({ after: "delete" }), { tags: ["changes-library"] });
