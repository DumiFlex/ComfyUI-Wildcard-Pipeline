// F: fixed values.
import { bench, chat, describe, edit, make } from "../shapes.js";

bench("F1", make("fixed-values", "fv-ai", { name: "Watercolor style" }));
bench("F2", describe("fixed-values", "Watercolor style"));
bench("F3", edit("fixed-values", "Anime style", "fv-ai"));
bench("F4", chat({ after: "apply-undo" }));
bench("F5", chat({ after: "apply-undo" }));
bench("F6", chat({ after: "delete" }), { tags: ["changes-library"] });
