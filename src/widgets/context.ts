import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  createDomWidgetHost, parseWidgetJson, serializeWidgetJson, emptyContextValue,
  type ContextWidgetValue, type MountTargetNode,
} from "./_shared";
import { attachThemeDetector } from "../extension/theme-detector";
import {
  collectDownstreamWildcardUuids,
  collectLocalResolvedForModule,
  collectUpstreamResolved,
  collectUpstreamVariables,
  collectUpstreamWildcardUuids,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { collectCrossNodePairings } from "../extension/cross-node-pairings";
import type { PairingBadge } from "../extension/constraint-pairs";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";

/** Shallow-equal map comparator for `reactiveFromGraph` so the
 *  upstream-resolved snapshot only triggers a re-render when its
 *  contents actually change (not just object identity). */
function stringMapEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

/** Shallow-equal comparator for pairing-badge Map — re-renders only on
 *  actual entry diff (gate prevents per-frame poll churn re-rendering
 *  every ContextWidget when nothing's changed). */
function pairingMapEqual(
  a: Map<string, PairingBadge>,
  b: Map<string, PairingBadge>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, av] of a) {
    const bv = b.get(k);
    if (!bv) return false;
    if (
      av.number !== bv.number ||
      av.targetUuid !== bv.targetUuid ||
      av.colorIndex !== bv.colorIndex ||
      av.isOrphan !== bv.isOrphan
    ) return false;
  }
  return true;
}

const ContextWidget = defineAsyncComponent(() => import("../components/context/ContextWidget.vue"));

type ContextNode = LiteNodeLike & MountTargetNode;

export function create(node: ContextNode, inputName: string) {
  const initial = serializeWidgetJson(parseWidgetJson<ContextWidgetValue>("", emptyContextValue()));
  // Reactive `initialJson` prop — workflow load races (setValue can fire
  // before the async SFC chunk mounts) are handled by the SFC's watch on this
  // prop. No imperative remount, no focus loss on edits.
  const currentJson = ref(initial);

  // State-driven minWidth, updated by ContextWidget's
  // `onRequestMinWidth` callback (formula based on conflict + state-
  // badge presence). Initial value covers the footer-driven baseline
  // before Vue mounts and emits. Pull-based via computeLayoutSize;
  // see injector.ts + _shared.ts for the architecture.
  let dynamicMinWidth = 380;

  const wrapper: Component = {
    setup() {
      const upstreamVars = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          // `app.graph` is the *currently visible* graph in ComfyUI —
          // when the user double-clicks into a subgraph it shifts to
          // that subgraph, leaving cross-graph upstream walks broken
          // for any WP_Context still mounted in the (no-longer-active)
          // root. Climb from `node.graph` (the LGraph this node
          // actually belongs to) up to the topmost graph so the
          // walker's `getNodeById(upstream_id)` always hits the right
          // node space, regardless of canvas focus state.
          const startGraph =
            (node as unknown as { graph?: LiteGraphLike }).graph
            ?? (app.graph as unknown as LiteGraphLike);
          const rootGraph = findRootGraph(startGraph);
          const result = collectUpstreamVariables(rootGraph, node);
          // Diagnostic: when `window.__wp_walker_log__` is set, log every
          // walker output for this node. Use to debug "cross-node
          // missing-var false positive": pin the dot to a Context node
          // visibly upstream-wired, set the flag, and read the console
          // to see what root-graph identity the walker got + what it
          // returned. Production is silent unless the flag is on.
          const dbg = (window as unknown as { __wp_walker_log__?: boolean }).__wp_walker_log__;
          if (dbg) {
            // eslint-disable-next-line no-console
            console.log("[wp-walker]", {
              nodeId: node.id,
              nodeGraphId: startGraph?.id ?? "root",
              appGraphId: (app.graph as unknown as { id?: string })?.id ?? "root",
              rootGraphId: rootGraph?.id ?? "root",
              firstInputLink: node.inputs?.[0]?.link ?? null,
              upstreamVars: result,
            });
          }
          return result;
        },
        stringArrayEqual,
      );
      // Per-module seed reader. For each module we snapshot the
      // seed it ACTUALLY rolled with on the last queue:
      //   - locked module → its `instance.locked_seed`
      //   - unlocked module → the chain seed (= the Context node's
      //     `seed` widget value at the moment beforeQueued fired,
      //     before control_after_generate rotated)
      //
      // Kind-agnostic: the engine pipeline emits a `seed` field on
      // every trace entry (engine/pipeline.py:181-193), and
      // WP_Context's `module_seeds` UI payload derives the per-module
      // map from those traces. So wildcard / combine / fixed_values
      // modules all flow through the SAME path — there's no kind-
      // gated branch here. Lock-toggle defaults pull from this map
      // so re-locking after a run captures the seed THIS specific
      // module used. Falls through to chain-level snapshot for
      // callers without a module context.
      // Mirror the upstream-vars walker for wildcard uuids — needed so
      // the conflict scanner can validate constraint source/target
      // references against modules in the upstream chain. Same
      // reactivity story (poll + onConnectionsChange + graph-loaded).
      const upstreamUuids = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const startGraph =
            (node as unknown as { graph?: LiteGraphLike }).graph
            ?? (app.graph as unknown as LiteGraphLike);
          const rootGraph = findRootGraph(startGraph);
          return collectUpstreamWildcardUuids(rootGraph, node);
        },
        stringArrayEqual,
      );

      // Same idea, downstream — lets the scanner distinguish
      // target-in-downstream (good) from target-missing (bad), and
      // emit `constraint_source_in_downstream` instead of the
      // catch-all "source missing" when the user wired the source
      // wildcard into a future Context node.
      const downstreamUuids = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const startGraph =
            (node as unknown as { graph?: LiteGraphLike }).graph
            ?? (app.graph as unknown as LiteGraphLike);
          const rootGraph = findRootGraph(startGraph);
          return collectDownstreamWildcardUuids(rootGraph, node);
        },
        stringArrayEqual,
      );

      // Cross-node pairing badges. Flat map keyed by `${nodeId}#${_uid}`
      // so duplicate library instances + cross-node rows don't collide.
      // Polled via the same `reactiveFromGraph` machinery the other
      // chain-derived props use so the badge updates on graph edits +
      // workflow loads without manual wiring. The comparator does a
      // shallow map equality check by entry — re-rendering only when a
      // badge appears, disappears, or changes shape.
      const pairingsRef = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const startGraph =
            (node as unknown as { graph?: LiteGraphLike }).graph
            ?? (app.graph as unknown as LiteGraphLike);
          const rootGraph = findRootGraph(startGraph);
          return collectCrossNodePairings(rootGraph, node);
        },
        pairingMapEqual,
      );

      // Per-name resolved snapshot — drives the combine modal's
      // live-preview pane so the user sees `red portrait` instead of
      // `$style portrait` while editing. Same walker the assembler
      // preview uses, so the modal preview matches the canvas
      // assembler text. Static fallback only — when an API-backed
      // resolution is available it'd shadow this; for now this is
      // the same map AssemblerHelper renders before its async
      // /wp/api/preview/resolve roll settles.
      const upstreamResolved = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const startGraph =
            (node as unknown as { graph?: LiteGraphLike }).graph
            ?? (app.graph as unknown as LiteGraphLike);
          const rootGraph = findRootGraph(startGraph);
          return collectUpstreamResolved(rootGraph, node);
        },
        stringMapEqual,
      );

      // Litegraph mode poll — when the user mutes (mode 2) or bypasses
      // (mode 4) a Context node, the body of the DOM widget should
      // visually dim so the muted state is obvious. Litegraph dims the
      // title/border natively but leaves DOM-rendered widget content at
      // full opacity. Cheap to track here via the same polling fallback
      // that already drives upstreamVars — modes only change on user
      // action, but litegraph doesn't fire an event we can hook.
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => (node as unknown as { mode?: number }).mode ?? 0,
        Object.is,
      );

      /** Resolved-var map from THIS module's perspective — includes
       *  upstream-chain bindings AND sibling bindings produced
       *  earlier in the same node, while excluding the asking module
       *  itself (so it doesn't read its own about-to-be-emitted
       *  binding). Drives the combine modal's live-preview pane.
       *  Function (vs static prop) because the answer depends on
       *  which module the modal is currently editing. */
      function localResolvedReader(moduleId?: string): Record<string, string> {
        const startGraph =
          (node as unknown as { graph?: LiteGraphLike }).graph
          ?? (app.graph as unknown as LiteGraphLike);
        const rootGraph = findRootGraph(startGraph);
        return collectLocalResolvedForModule(rootGraph, node, moduleId);
      }

      function lastUsedSeedReader(moduleId?: string): number | null {
        const perModule = (node as unknown as {
          __wp_last_used_per_module__?: Record<string, number>;
        }).__wp_last_used_per_module__;
        if (moduleId && perModule && typeof perModule[moduleId] === "number") {
          return perModule[moduleId];
        }
        const v = (node as unknown as { __wp_last_used_seed__?: number })
          .__wp_last_used_seed__;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      }
      return () => h(ContextWidget, {
        nodeId: node.id,
        initialJson: currentJson.value,
        upstreamVars: upstreamVars.value,
        upstreamResolved: upstreamResolved.value,
        localResolvedReader,
        upstreamWildcardUuids: upstreamUuids.value,
        downstreamWildcardUuids: downstreamUuids.value,
        pairings: pairingsRef.value,
        nodeMode: nodeMode.value,
        lastUsedSeedReader,
        onChange: (json: string) => host.setValue(json),
        onRequestMinWidth: (w: number) => {
          if (w === dynamicMinWidth) return;
          dynamicMinWidth = w;
          host.requestRelayout();
        },
      });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: initial,
    minHeight: 80,
    // Pull-based — getter reads the latest dynamicMinWidth on every
    // litegraph relayout. ContextWidget's `onRequestMinWidth` updates
    // the var + calls host.requestRelayout when conflict / state-badge
    // presence changes.
    minWidth: () => dynamicMinWidth,
    // Height tracks content. Without this, a user-dragged tall node
    // sticks at that height and the collapse-modules animation can't
    // shrink the node back down. Width still preserves user drag.
    autoHeight: true,
    onValueRestored: (v: string) => {
      // Workflow load — push the restored value into the reactive prop so the
      // SFC picks it up whether it has already mounted or not.
      if (v !== currentJson.value) currentJson.value = v;
    },
  });
  attachThemeDetector(host.widget.element, app);

  // No `beforeQueued` per-module snapshot anymore. That path read
  // `seedWidget.value` which is:
  //   - WRONG when the seed input is link-driven (rgthree, etc.) —
  //     the local widget value is just a stale fallback, not the
  //     seed actually used.
  //   - STALE on rotate-after-fixed setups — by the second run,
  //     the local widget might already hold the next-up seed
  //     instead of the just-used one.
  // Both cases caused the lock toggle to capture a seed the user
  // never saw used. Per-module map is now populated only by
  // `onExecuted` below — that channel reads the engine's
  // `module_seeds` ui payload, which is the authoritative seed
  // each wildcard actually rolled with regardless of source.
  // Cold-start (no run yet this session) → lock toggle falls
  // through to `last_locked_seed` then 0.

  // ComfyUI's `executed` event fires per-node after the backend
  // finishes running it. WP_Context emits two values via its UI
  // payload that we capture here — these are AUTHORITATIVE because
  // the engine sees the real seed even when the input is link-
  // driven (rgthree, control nodes, etc.) and the local widget
  // value is just a stale fallback.
  //
  //   - `seed`         : actual chain seed used this run.
  //   - `module_seeds` : { moduleId → effectiveSeedUsed } for every
  //                       module that ran. Effective = locked_seed
  //                       when locked, chain seed otherwise. Direct
  //                       map — no need to re-derive on the client.
  //
  // ComfyUI wraps UI values in single-element arrays; both paths
  // (top-level vs nested under `ui`) are probed for cross-version
  // safety.
  type ExecutedEvent = CustomEvent<{
    node: string | number;
    output?: unknown;
  }>;
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
  function onExecuted(ev: Event) {
    const detail = (ev as ExecutedEvent).detail;
    if (!detail || String(detail.node) !== String(node.id)) return;
    if (!detail.output || typeof detail.output !== "object") return;
    const out = detail.output as Record<string, unknown>;

    const rawSeed = pickArrayValue(out, "seed");
    const seedNum = typeof rawSeed === "number" ? rawSeed : Number(rawSeed);
    if (Number.isFinite(seedNum)) {
      (node as unknown as { __wp_last_used_seed__?: number }).__wp_last_used_seed__ =
        Math.floor(seedNum);
    }

    const rawMap = pickArrayValue(out, "module_seeds");
    if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
      const perModule: Record<string, number> = {};
      for (const [mid, v] of Object.entries(rawMap as Record<string, unknown>)) {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n)) perModule[mid] = Math.floor(n);
      }
      (node as unknown as { __wp_last_used_per_module__?: Record<string, number> })
        .__wp_last_used_per_module__ = perModule;
    }
    // No fallback when `module_seeds` is missing — the chain-level
    // `__wp_last_used_seed__` already updated above gives the
    // toggle a sensible fallback via the chain-level reader path,
    // and we'd rather have no per-module data than re-introduce
    // the local-widget-value heuristic that produced wrong locks
    // for link-driven seed inputs.
  }
  const apiObj = (app as unknown as { api?: {
    addEventListener: (n: string, fn: (e: Event) => void) => void;
    removeEventListener: (n: string, fn: (e: Event) => void) => void;
  } }).api;
  apiObj?.addEventListener("executed", onExecuted);

  // No widget.onRemove monkey-patch — wrapping ComfyUI's internal
  // `onRemove` callback was breaking the `this` binding their code
  // relies on (manifested as "TypeError: can't access property 'id',
  // this is undefined" during graph.clear() / loadGraphData). The
  // engineering rule here: don't interfere with ComfyUI / other-
  // nodes lifecycle — patch ours only.
  //
  // The leak from skipping listener cleanup is bounded: the
  // `executed` handler filters by `detail.node === node.id` and
  // returns early when the node is gone, so a stale closure costs
  // one filter check per executed event. If a future workflow
  // churn pattern makes that meaningful we'll revisit via a
  // node-level chainCallback or move the listener into Vue's
  // scope-dispose, but for now the simplest path is no cleanup.
  return host;
}
