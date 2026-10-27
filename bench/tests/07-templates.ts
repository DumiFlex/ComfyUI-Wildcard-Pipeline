// T: templates.
import { bench, chat, describe, edit, make } from "../shapes.js";

bench("T1", make("templates", "tpl-ai", { name: "Bench Flux" }));
bench("T2", describe("templates", "Bench Flux"));
bench("T3", edit("templates", "Bench portrait", "tpl-ai"));
bench("T4", chat());
bench("T5", chat({ after: "apply-undo" }));
bench("T6", chat({ after: "delete" }), { tags: ["changes-library"] });
