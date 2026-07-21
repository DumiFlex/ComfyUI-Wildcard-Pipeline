/**
 * Lazy-loaded glue between ComfyUI's widget pipeline and the
 * SeedListWidget Vue SFC. Registered via
 * `getCustomWidgets["WP_SEED_LIST_CONFIG"]` in `src/main.ts`.
 *
 * Mirrors the WP_ContextLoop pattern: widget value is a JSON string
 * holding the full `SeedListConfig`. `host.setValue` writes the
 * canonical serialised form on every SFC update so ComfyUI's widget
 * state matches what `execute()` sees.
 */
import { defineAsyncComponent, h, ref, watch, type Component } from "vue";
import { createDomWidgetHost, type DomWidgetHost, type MountTargetNode } from "./_shared";
import { attachLoopSeedsCapture } from "./_seed-capture";
import { reactiveFromGraph } from "../extension/reactive";
import {
  emptySeedListConfig,
  parseSeedListConfig,
  serializeSeedListConfig,
  type SeedListConfig,
} from "../components/seed-list/types";
import { resolveSeedListPreview, type SeriesParams } from "../components/seed-list/preview";
import { parseContextLoopConfig } from "../components/context-loop/types";
import type { LiteNodeLike, LiteGraphLike } from "../extension/graph";

const SeedListWidget = defineAsyncComponent(
  () => import("../components/seed-list/SeedListWidget.vue"),
);

interface SeedListHostNode extends MountTargetNode, LiteNodeLike {
  mode?: number;
  graph?: LiteGraphLike;
}

export function create(node: SeedListHostNode, inputName: string) {
  const initialRaw = "";
  const config = ref<SeedListConfig>(
    parseSeedListConfig(initialRaw) ?? emptySeedListConfig(),
  );

  // Track ComfyUI's litegraph mode (0 / 2 / 4) so the SFC dims visually
  // on mute / bypass. Mirrors WP_VarTo* + WP_ContextLoop widget patterns.
  const nodeMode = reactiveFromGraph(node, () => node.mode ?? 0, Object.is);

  // Read the stock base_seed + count widgets reactively so the seed modal
  // preview updates whenever the user edits those widgets.
  const baseSeed = reactiveFromGraph(
    node,
    () => Number((node.widgets ?? []).find((w) => w.name === "base_seed")?.value ?? 0),
    Object.is,
  );
  const count = reactiveFromGraph(
    node,
    () => Number((node.widgets ?? []).find((w) => w.name === "count")?.value ?? 1),
    Object.is,
  );

  // The node's per-iteration seed series from the PREVIOUS run, captured in
  // `onExecuted` below. Drives the seed modal's "lock previous" button.
  // Reactive so an open modal refreshes the instant a run lands; `onExecuted`
  // assigns a fresh array each run, so ref equality detects the change.
  const previousSeeds = reactiveFromGraph(
    node,
    () => (node as unknown as { __wp_prev_seeds__?: number[] }).__wp_prev_seeds__ ?? null,
    Object.is,
  );

  // Loop series params + the loop's bypassed frames (for the read-only
  // bypass mirror in the Seed List modal).
  type LoopSeries = SeriesParams & { bypassFrames: number[] };

  // Walk the `loop_config` input to its upstream WP_ContextLoop node and
  // read its stock `seed` + `count` widgets plus `wp_context_loop_config`
  // strategy + bypass_frames. Returns null when unwired. Reactive so the
  // preview updates
  // whenever the wire or upstream widgets change (same poll+event model
  // as the baseSeed/count reads above).
  function readLoopSeries(): LoopSeries | null {
    const inputs = (node as { inputs?: Array<{ name?: string; link?: number | null }> }).inputs;
    if (!inputs) return null;
    const slot = inputs.find((i) => i.name === "loop_config");
    if (!slot || slot.link == null) return null;
    const graph = node.graph;
    if (!graph) return null;
    const link = graph.links[slot.link];
    if (!link) return null;
    const origin = graph.getNodeById(link.origin_id);
    if (!origin) return null;
    const widgets = origin.widgets ?? [];
    const loopBase = Number(widgets.find((w) => w.name === "seed")?.value ?? 0);
    const loopCount = Number(widgets.find((w) => w.name === "count")?.value ?? 1);
    const rawCfg = widgets.find((w) => w.name === "wp_context_loop_config")?.value;
    const loopCfg = parseContextLoopConfig(typeof rawCfg === "string" ? rawCfg : null);
    return {
      base: loopBase, count: loopCount, strategy: loopCfg.strategy,
      bypassFrames: loopCfg.bypass_frames,
    };
  }

  function loopParamsEqual(a: LoopSeries | null, b: LoopSeries | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.base === b.base && a.count === b.count && a.strategy === b.strategy
      && a.bypassFrames.length === b.bypassFrames.length
      && a.bypassFrames.every((v, i) => v === b.bypassFrames[i]);
  }

  const loopSeries = reactiveFromGraph(node, readLoopSeries, loopParamsEqual);

  /** Toggle the `disabled` flag on a stock litegraph widget by name.
   *  Litegraph greys the widget out + blocks input when `disabled` is
   *  true. Returns silently when the named widget isn't on the node yet
   *  (the widget mount races the stock-widget creation — `setTimeout(0)`
   *  the first call to guarantee they're built). */
  function setStockWidgetDisabled(name: string, disabled: boolean): void {
    const widgets = (node as { widgets?: Array<{ name?: string; disabled?: boolean }> }).widgets;
    if (!widgets) return;
    const w = widgets.find((wgt) => wgt.name === name);
    if (!w) return;
    w.disabled = disabled;
  }

  /** Sync the disabled state of the stock `base_seed` and `count`
   *  widgets to the current override toggles. The strategy chip lives
   *  inside the DOM widget itself (not a stock widget) so its lock is
   *  handled by the SFC via `strategyLocked` computed.
   *
   *  Setting `setDirtyCanvas(true, true)` after the toggle so litegraph
   *  repaints the widget's disabled-state styling on the same tick
   *  instead of waiting for the next user interaction. */
  function syncStockWidgetGates(): void {
    setStockWidgetDisabled("base_seed", config.value.override_seed);
    setStockWidgetDisabled("count", config.value.override_count);
    (node as { setDirtyCanvas?: (a: boolean, b: boolean) => void }).setDirtyCanvas?.(true, true);
  }

  let host: DomWidgetHost | null = null;

  const wrapper: Component = {
    setup() {
      function onUpdate(next: SeedListConfig): void {
        config.value = next;
        // Keep ComfyUI's widget state in sync so getValue (which feeds
        // execute kwargs) returns the canonical JSON.
        host?.setValue(serializeSeedListConfig(next));
        // Re-apply the stock-widget gates whenever a toggle flips.
        syncStockWidgetGates();
      }
      return () => {
        const localSeries: SeriesParams = {
          base: baseSeed.value,
          count: count.value,
          strategy: config.value.strategy,
        };
        const flags = {
          override_seed: config.value.override_seed,
          override_count: config.value.override_count,
          override_strategy: config.value.override_strategy,
        };
        const effective = resolveSeedListPreview(localSeries, flags, loopSeries.value);
        // Mirror the loop's bypass ONLY when the count comes from the loop —
        // that's when this node's frames align 1:1 with the loop's.
        const loopBypass =
          config.value.override_count && loopSeries.value
            ? loopSeries.value.bypassFrames
            : [];
        return h(SeedListWidget, {
          modelValue: config.value,
          nodeMode: nodeMode.value,
          baseSeed: effective.baseSeed,
          count: effective.count,
          previewStrategy: effective.strategy,
          previousSeeds: previousSeeds.value,
          bypassedFrames: loopBypass,
          "onUpdate:modelValue": onUpdate,
        });
      };
    },
  };

  host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeSeedListConfig(config.value),
    onValueRestored: (raw: string) => {
      // ComfyUI restored the widget value from workflow JSON. Re-parse
      // through the recovery layer so a corrupt save still loads.
      config.value = parseSeedListConfig(raw);
      // A loaded workflow may already have one or both overrides on —
      // immediately reflect that on the stock widgets so the canvas
      // doesn't open with editable inputs that the engine will ignore.
      syncStockWidgetGates();
    },
    minHeight: 120,
    minWidth: 240,
  });

  // First gate pass. The stock `base_seed` / `count` widgets are added
  // by ComfyUI's schema BEFORE our custom-widget factory fires, so they
  // already exist when this function runs. Defer one microtask just in
  // case (some V3 paths attach widgets after the factory returns).
  queueMicrotask(syncStockWidgetGates);

  // Auto-on UX: when the `loop_config` socket transitions from
  // unwired → wired, flip override_count + override_strategy ON. The
  // natural intent of wiring a Loop in is "the loop is now in charge
  // of the series shape" — defaulting both to OFF would silently
  // ignore the wire. override_seed stays an explicit opt-in because
  // mixing seed sources (loop's count/strategy + own sampler seed)
  // is common.
  //
  // We only act on the rising edge so the user can still flip the
  // toggles OFF without us re-arming them on the next graph tick. If
  // the wire is later removed and re-added, we re-arm — that's the
  // documented "reset to default" gesture.
  const hasLoopLink = reactiveFromGraph(
    node,
    () => {
      const inputs = (node as { inputs?: Array<{ name?: string; link?: number | null }> }).inputs;
      if (!inputs) return false;
      const slot = inputs.find((i) => i.name === "loop_config");
      return slot != null && slot.link != null;
    },
    Object.is,
  );
  let prevHasLink = hasLoopLink.value;
  watch(hasLoopLink, (now) => {
    if (now && !prevHasLink) {
      const next: SeedListConfig = {
        ...config.value,
        override_count: true,
        override_strategy: true,
      };
      config.value = next;
      host?.setValue(serializeSeedListConfig(next));
      syncStockWidgetGates();
    }
    prevHasLink = now;
  });

  // Capture the node's executed `loop_seeds` series for the modal's "lock
  // previous" button (see _seed-capture).
  attachLoopSeedsCapture(node);

  return host;
}
