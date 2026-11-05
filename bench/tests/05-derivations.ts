// R: derivations.
import { bench, chat, describe, edit, make } from "../shapes.js";

bench("R1", make("derivations", "drv-ai", { name: "Season from weather" }));
bench("R2", describe("derivations", "Season from weather"));
bench("R3", edit("derivations", "Light from weather", "drv-ai"));
bench("R4", edit("derivations", "Season from weather", "drv-ai"));
bench("R5", chat());
bench("R6", chat({ after: "apply-undo" }));
bench("R7", chat({ after: "delete" }), { tags: ["changes-library"] });
