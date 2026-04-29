import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  createDomWidgetHost, parseWidgetJson, serializeWidgetJson, emptyContextValue,
  type ContextWidgetValue, type MountTargetNode,
} from "./_shared";
import { collectUpstreamVariables, type LiteGraphLike, type LiteNodeLike } from "../extension/graph";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";

const ContextWidget = defineAsyncComponent(() => import("../components/context/ContextWidget.vue"));

type ContextNode = LiteNodeLike & MountTargetNode;

export function create(node: ContextNode, inputName: string) {
  const initial = serializeWidgetJson(parseWidgetJson<ContextWidgetValue>("", emptyContextValue()));
  // Reactive `initialJson` prop — workflow load races (setValue can fire
  // before the async SFC chunk mounts) are handled by the SFC's watch on this
  // prop. No imperative remount, no focus loss on edits.
  const currentJson = ref(initial);

  const wrapper: Component = {
    setup() {
      const upstreamVars = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => collectUpstreamVariables(app.graph as unknown as LiteGraphLike, node),
        stringArrayEqual,
      );
      // Per-module seed reader. For each module we snapshot the
      // seed it ACTUALLY rolled with on the last queue:
      //   - locked wildcards → their `instance.locked_seed`
      //   - unlocked wildcards → the chain seed (= the Context
      //     node's `seed` widget value at the moment beforeQueued
      //     fired, before control_after_generate rotated)
      //
      // Lock-toggle defaults pull from this map so re-locking after
      // a run captures the seed THIS specific wildcard used —
      // matters when one wildcard was locked while others rolled
      // with the chain seed in the same run. Falls through to a
      // chain-level snapshot for callers without a module context.
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
        lastUsedSeedReader,
        onChange: (json: string) => host.setValue(json),
      });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: initial,
    minHeight: 80,
    minWidth: 280,
    onValueRestored: (v: string) => {
      // Workflow load — push the restored value into the reactive prop so the
      // SFC picks it up whether it has already mounted or not.
      if (v !== currentJson.value) currentJson.value = v;
    },
  });

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
