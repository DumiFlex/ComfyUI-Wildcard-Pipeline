/**
 * usePanelAction — the chat's `use_panel` in an editor: open one of the
 * item's AI panels (Describe, the wildcard's Add / Remove / Rewrite / Retag /
 * Weights, the other editors' Draft with AI) and ask there, as if the user
 * typed the request. The answer stays in the panel for the user to review;
 * nothing is applied or saved by the chat.
 *
 * Each editor lists the panels it has; the server already checked that the
 * panel fits the item's kind (`engine/ai/client_tools.py::PANELS`).
 */
import { nextTick, type Ref } from "vue";
import { registerAiAction } from "./useAiActions";
import { useAiConfig } from "./useAiConfig";

type Runner = (text: string) => Promise<string>;

/** Something with a `run(text)` (an AI panel), or a describe-able card. */
interface PanelLike { run: Runner }
interface DescribeLike { describe: Runner }

/** Open the panel behind `open`, wait for it to mount, and ask it. */
export function viaPanel(open: Ref<boolean>, panel: Ref<PanelLike | null>): Runner {
  return async (text) => {
    open.value = true;
    await nextTick();
    await nextTick();
    return panel.value ? panel.value.run(text) : "couldn't: the AI panel didn't open";
  };
}

export function usePanelAction(opts: {
  /** The open item's id; the chat only acts on a saved item it named. */
  id: () => string | undefined | null;
  identity: Ref<DescribeLike | null>;
  panels: Record<string, Runner>;
}): void {
  const ai = useAiConfig();
  registerAiAction("use_panel", async (args) => {
    if (!ai.config.value?.enabled) return "couldn't: the assistant is off";
    const panel = String(args.panel ?? "");
    const text = String(args.request ?? "");
    if (panel === "describe") {
      return opts.identity.value
        ? opts.identity.value.describe(text) : "couldn't: Describe isn't on this page";
    }
    const run = opts.panels[panel];
    if (!run) return `couldn't: this editor has no ${panel} panel`;
    return run(text);
  }, (args) => !!opts.id() && args.id === opts.id());
}
