// T: templates.
import { StepError } from "watchwright";
import { bench, chat, describe, edit, make } from "../shapes.js";

// When T1's answer can't be applied, T2 and T6 still get a Bench Flux to work on.
const benchFlux = {
  name: "Bench Flux",
  description: "Stand-in saved by the bench: T1's answer had nothing to apply.",
  template_string: "A cinematic photo of $character with $hair_color hair, wearing $accessory, in $scene. Shot on $camera with a $lens lens, $style.",
  tags: ["bench"],
};

bench(
  "T1",
  make("templates", "tpl-ai", {
    name: "Bench Flux",
    standIn: async (h) => {
      const r = await h.api("/wp/api/templates", { method: "POST", body: benchFlux });
      if (r.status >= 300) throw new StepError(`Couldn't save the stand-in Bench Flux (${r.status}): ${r.text.slice(0, 200)}`);
      h.log("Saved a stand-in Bench Flux through the API.");
    },
  }),
);
bench("T2", describe("templates", "Bench Flux"));
bench("T3", edit("templates", "Bench portrait", "tpl-ai"));
bench("T4", chat());
bench("T5", chat({ after: "apply-undo" }));
bench("T6", chat({ after: "delete" }), { tags: ["changes-library"] });
