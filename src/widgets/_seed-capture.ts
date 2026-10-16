/**
 * Shared "previous run seed series" capture for the Context Loop + Seed List
 * widget glue. Both nodes emit their executed per-iteration series as
 * `loop_seeds` in the node UI; this stores it in the `nodePrevSeeds` stash so
 * the seed modal can offer a per-frame "lock previous" button.
 *
 * Mirrors the WP_Context capture in `context.ts`. Captured series is the run
 * that JUST finished — robust to control_after_generate rotating the live seed
 * widget to the NEXT run's value. The listener is removed with the widget host.
 */
import { nodePrevSeeds } from "../extension/_stashes";
import { listenApi, type DomWidgetHost } from "./_shared";

type ExecutedEvent = CustomEvent<{ node: string | number; output?: unknown }>;

/** ComfyUI wraps UI values in single-element arrays; probe both the top-level
 *  and the nested `ui` shape for cross-version safety. */
function pickArrayValue(obj: Record<string, unknown>, key: string): unknown {
  const direct = obj[key];
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] : direct;
  const ui = obj.ui as Record<string, unknown> | undefined;
  if (ui) {
    const fromUi = ui[key];
    if (fromUi !== undefined) return Array.isArray(fromUi) ? fromUi[0] : fromUi;
  }
  return undefined;
}

/** Attach an `executed` listener (for the host's lifetime) that captures this
 *  node's `loop_seeds` series into `nodePrevSeeds` (or clears it when the
 *  series is empty). */
export function attachLoopSeedsCapture(
  node: { id: string | number },
  host: Pick<DomWidgetHost, "onCleanup">,
): void {
  function onExecuted(ev: Event): void {
    const detail = (ev as ExecutedEvent).detail;
    if (!detail || String(detail.node) !== String(node.id)) return;
    if (!detail.output || typeof detail.output !== "object") return;
    const rawSeries = pickArrayValue(detail.output as Record<string, unknown>, "loop_seeds");
    if (!Array.isArray(rawSeries)) return;
    const series = rawSeries
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((n) => Number.isFinite(n));
    if (series.length) nodePrevSeeds.set(node, series);
    else nodePrevSeeds.delete(node);
  }
  listenApi(host, "executed", onExecuted);
}
