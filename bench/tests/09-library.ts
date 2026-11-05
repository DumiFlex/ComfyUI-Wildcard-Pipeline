// L: tidying the library (Organize with AI and the chat).
import { bench, chat, organize } from "../shapes.js";

bench("L1", organize());
bench("L2", chat({ after: "apply" }), { tags: ["changes-library"] });
bench("L3", chat({ after: "apply-undo" }));
bench("L4", chat({ after: "apply" }), { tags: ["changes-library"] });
bench("L5", chat({ after: "apply" }), { tags: ["changes-library"] });
bench("L6", chat());
bench("L7", chat({ after: "apply-undo" }));
bench("L8", chat({ after: "delete" }), { tags: ["changes-library"] });
bench("L9", chat({ after: "delete" }), { tags: ["changes-library"] });
bench("L10", chat({ after: "delete" }), { tags: ["changes-library"] });
