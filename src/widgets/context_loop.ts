/**
 * Lazy-loaded glue between ComfyUI's widget pipeline and the
 * ContextLoopWidget Vue SFC. Registered via
 * `getCustomWidgets["WP_CONTEXT_LOOP_CONFIG"]` in `src/main.ts`.
 *
 * Mirrors the WP_PromptCleaner pattern: widget value is a JSON string
 * holding the full `ContextLoopConfig`. `host.setValue` writes the
 * canonical serialised form on every SFC update so ComfyUI's widget
 * state matches what `execute()` sees.
 */
import { defineAsyncComponent, h, ref, watch, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type DomWidgetHost, type MountTargetNode } from "./_shared";
import { attachLoopSeedsCapture } from "./_seed-capture";
import { reactiveFromGraph } from "../extension/reactive";
import {
  emptyContextLoopConfig,
  parseContextLoopConfig,
  serializeContextLoopConfig,
  sweepFrameCount,
  type ContextLoopConfig,
} from "../components/context-loop/types";
import type { SweepSourceRaw } from "../components/context-loop/sweep-candidates";
import { assignCodenames, baseCodename } from "../extension/node-codename";
import {
  collectDownstreamContextNodes,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";

const ContextLoopWidget = defineAsyncComponent(
  () => import("../components/context-loop/ContextLoopWidget.vue"),
);

interface ContextLoopHostNode extends MountTargetNode, LiteNodeLike {
  mode?: number;
  properties?: Record<string, unknown>;
}

export function create(node: ContextLoopHostNode, inputName: string) {
  /**
   * Frame-grid collapse, persisted so it survives a workflow save.
   *
   * `node.properties` is the serialization root — transient session state
   * belongs in a WeakMap, but this has to come back on reload or the toggle is
   * pointless. Keyed `wp_*` per the extension-isolation convention.
   *
   * The ref is the source of truth for rendering (so a toggle repaints
   * immediately) and writes through to properties. `syncChipsCollapsed` re-reads
   * them after ComfyUI restores a workflow, because `create()` runs before the
   * saved properties are applied — without it a collapsed grid would come back
   * open.
   */
  const CHIPS_COLLAPSED_KEY = "wp_frame_chips_collapsed";

  function readChipsCollapsed(): boolean {
    return !!(node.properties ?? {})[CHIPS_COLLAPSED_KEY];
  }
  const chipsCollapsed = ref<boolean>(readChipsCollapsed());
  function syncChipsCollapsed(): void {
    chipsCollapsed.value = readChipsCollapsed();
  }
  function onChipsCollapsed(next: boolean): void {
    chipsCollapsed.value = next;
    node.properties = node.properties ?? {};
    node.properties[CHIPS_COLLAPSED_KEY] = next;
  }
  const initialRaw = "";
  const config = ref<ContextLoopConfig>(
    parseContextLoopConfig(initialRaw) ?? emptyContextLoopConfig(),
  );

  // Track ComfyUI's litegraph mode (0 / 2 / 4) so the SFC dims visually
  // on mute / bypass. Mirrors WP_VarTo* + WP_Cleaner widget patterns.
  const nodeMode = reactiveFromGraph(node, () => node.mode ?? 0, Object.is);

  // Read the stock seed + count widgets reactively so the seed modal
  // preview updates whenever the user edits those widgets.
  const baseSeed = reactiveFromGraph(
    node,
    () => Number((node.widgets ?? []).find((w) => w.name === "seed")?.value ?? 0),
    Object.is,
  );
  const count = reactiveFromGraph(
    node,
    () => Number((node.widgets ?? []).find((w) => w.name === "count")?.value ?? 1),
    Object.is,
  );

  // The Loop's per-iteration seed series from the PREVIOUS run, captured in
  // `onExecuted` below. Drives the seed modal's "lock previous" button.
  // Reactive so an open modal refreshes the instant a run lands; `onExecuted`
  // assigns a fresh array each run, so ref equality detects the change.
  const previousSeeds = reactiveFromGraph(
    node,
    () => (node as unknown as { __wp_prev_seeds__?: number[] }).__wp_prev_seeds__ ?? null,
    Object.is,
  );

  // Sweep mode: the WP_Context nodes downstream of this loop, as
  // (codename, raw module JSON) pairs. Re-walked on graph edits + the poll, so a
  // wildcard added to a Context shows up in the "Sweep a wildcard" list
  // without a reload. The SFC parses these into candidates, which keeps
  // that code in its lazy chunk instead of boot.
  const sweepSources = reactiveFromGraph<SweepSourceRaw[]>(
    node,
    () => {
      const startGraph =
        (node as unknown as { graph?: LiteGraphLike }).graph
        ?? (app.graph as unknown as LiteGraphLike | undefined);
      if (!startGraph) return [];
      const downstream = collectDownstreamContextNodes(findRootGraph(startGraph), node);
      const names = assignCodenames(downstream.map((n) => n.id));
      return downstream.map((n) => {
        const w = (n.widgets ?? []).find((x) => x.name === "wp_modules");
        return {
          label: names.get(String(n.id)) ?? baseCodename(n.id),
          raw: typeof w?.value === "string" ? w.value : "",
        };
      });
    },
    (a, b) =>
      a.length === b.length && a.every((x, i) => x.label === b[i].label && x.raw === b[i].raw),
  );

  // While a sweep is on, the frame count comes from the combinations, so
  // keep the stock `count` widget in step: the frame chips, seed list and
  // Seed List node all read it. The Python node recomputes the same number
  // from the config, so a stale widget can't change what runs.
  watch(
    [() => sweepFrameCount(config.value), count],
    ([frames]) => {
      const w = (node.widgets ?? []).find((x) => x.name === "count");
      if (w && syncCountToSweep(w, frames)) {
        (node as unknown as { setDirtyCanvas?: (fg: boolean, bg: boolean) => void })
          .setDirtyCanvas?.(true, true);
      }
    },
    { immediate: true },
  );

  let host: DomWidgetHost | null = null;

  const wrapper: Component = {
    setup() {
      function onUpdate(next: ContextLoopConfig): void {
        config.value = next;
        // Keep ComfyUI's widget state in sync so getValue (which feeds
        // execute kwargs) returns the canonical JSON.
        host?.setValue(serializeContextLoopConfig(next));
      }
      return () =>
        h(ContextLoopWidget, {
          modelValue: config.value,
          nodeMode: nodeMode.value,
          baseSeed: baseSeed.value,
          count: count.value,
          previousSeeds: previousSeeds.value,
          sweepSources: sweepSources.value,
          "onUpdate:modelValue": onUpdate,
          chipsCollapsed: chipsCollapsed.value,
          "onUpdate:chipsCollapsed": onChipsCollapsed,
        });
    },
  };

  loopEditors.set(node, (edit) => {
    const next = edit(config.value);
    config.value = next;
    host?.setValue(serializeContextLoopConfig(next));
    (node as unknown as { setDirtyCanvas?: (fg: boolean, bg: boolean) => void })
      .setDirtyCanvas?.(true, true);
  });

  host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeContextLoopConfig(config.value),
    onValueRestored: (raw: string) => {
      // Saved properties land with the workflow, after `create()` ran.
      syncChipsCollapsed();
      // ComfyUI restored the widget value from workflow JSON. Re-parse
      // through the recovery layer so a corrupt save still loads.
      config.value = parseContextLoopConfig(raw);
    },
    minHeight: 140,
    minWidth: 240,
  });

  // Capture the Loop's executed `loop_seeds` series for the modal's "lock
  // previous" button (see _seed-capture).
  attachLoopSeedsCapture(node);

  return host;
}

/**
 * Keep the stock `count` widget in step with a sweep: while a sweep sets the
 * frame count (`frames` not null) the widget shows it and is locked, since
 * typing a count there would do nothing. Returns true when the widget changed.
 */
export function syncCountToSweep(
  w: { value?: unknown; disabled?: boolean },
  frames: number | null,
): boolean {
  const locked = frames != null;
  const changed = !!w.disabled !== locked || (locked && w.value !== frames);
  w.disabled = locked;
  if (locked) w.value = frames;
  return changed;
}

type LoopEdit = (cfg: ContextLoopConfig) => ContextLoopConfig;

/** Per-node config editors, so other UI (the Image Filter picker) can change a
 *  loop's settings the same way its own widget does. */
const loopEditors = new WeakMap<object, (edit: LoopEdit) => void>();

/** Apply `edit` to a Context Loop node's config; false when the node has no
 *  loop widget (not a loop, or not built yet). */
export function editLoopConfig(node: object, edit: LoopEdit): boolean {
  const apply = loopEditors.get(node);
  if (!apply) return false;
  apply(edit);
  return true;
}
