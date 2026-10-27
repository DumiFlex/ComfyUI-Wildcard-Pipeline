// N: the optional web tests (run with the `web` parameter on).
import { bench, chat, edit, pack } from "../shapes.js";

bench("N1", edit("wildcards", "Outfit", "wc-ai-draft", { mode: "add" }));
bench("N2", chat());
bench("N3", chat());
bench("N4", chat());
bench("N5", pack({ research: true }));
