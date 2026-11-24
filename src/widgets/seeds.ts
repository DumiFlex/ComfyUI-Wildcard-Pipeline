import { defineAsyncComponent, h, ref, watchEffect, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  collectDownstreamContextNodes,
  collectLoopFrames,
  findRootGraph,
  upstreamLoopSeed,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { attachRowOutputs, queueRowOutputs, type RowOutputNode } from "../extension/row-outputs";
import { createDomWidgetHost, isMirrorBuild, parseWidgetJson, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { listenApi } from "./_listen";
import { nodeEditors } from "../extension/_stashes";
import { reactiveFromGraph } from "../extension/reactive";
import {
  defaultSeedsConfig,
  nameKey,
  normalizeOuts,
  outputSlots,
  parseSeedsConfig,
  planOutputs,
  randomSeed,
  rerollRandom,
  seedFromRow,
  type SeedsConfig,
} from "../extension/seeds";
import type { LastRun } from "../components/seeds/types";

const SeedsWidget = defineAsyncComponent(() => import("../components/seeds/SeedsWidget.vue"));

interface SeedOutput {
  name: string;
  type: string;
  label?: string;
  localized_name?: string;
  links?: number[] | null;
}

interface NumberWidget {
  name: string;
  value: unknown;
  disabled?: boolean;
  callback?: (v: unknown) => void;
}

export interface SeedsHostNode extends MountTargetNode, RowOutputNode {
  mode?: number;
  title?: string;
  outputs?: SeedOutput[];
  widgets?: NumberWidget[];
  addOutput?: (name: string, type: string) => unknown;
  removeOutput?: (slot: number) => void;
}

/** Output names the rows drive (`seed_1` … `seed_16`). */
export const isSeedOutput = (name: string): boolean => /^seed_\d+$/.test(name);

function fitOutputs(node: SeedsHostNode, cfg: SeedsConfig): void {
  const outs = node.outputs;
  if (!outs || !outs.length) return;
  const want = outputSlots(cfg).length + 1;
  while (outs.length > want) {
    if (node.graph && node.removeOutput) node.removeOutput(outs.length - 1);
    else outs.pop();
  }
  while (outs.length < want && node.addOutput) node.addOutput(`seed_${outs.length}`, "INT");
  relabel(node, cfg);
}

function relabel(node: SeedsHostNode, cfg: SeedsConfig): void {
  const outs = node.outputs ?? [];
  for (const r of outputSlots(cfg)) {
    const slot = outs[r.out];
    if (!slot) continue;
    slot.name = `seed_${r.out}`;
    slot.type = "INT";
    slot.label = r.name;
    slot.localized_name = r.name;
  }
}

function baseSeedOf(node: SeedsHostNode): number {
  const v = node.widgets?.find((w) => w.name === "base_seed")?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Downstream Contexts set to read one of this node's rows: row key → titles. */
function readersOf(root: LiteGraphLike, node: SeedsHostNode): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const ctx of collectDownstreamContextNodes(root, node as unknown as LiteNodeLike)) {
    const raw = (ctx as { widgets?: NumberWidget[] }).widgets?.find((w) => w.name === "wp_modules")?.value;
    const value = parseWidgetJson<{ seed_from?: unknown }>(typeof raw === "string" ? raw : "", {});
    const row = typeof value.seed_from === "string" ? seedFromRow(value.seed_from) : null;
    if (row === null) continue;
    const title = (ctx as { title?: string }).title || "WP Context";
    (out[nameKey(row)] ??= []).push(title);
  }
  return out;
}

function sameReaders(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Mount glue for WP_Seeds' widget (`WP_SEEDS`). The value is the JSON
 * `SeedsConfig` the node parses at run time.
 *
 * Owns the node's INT outputs (one per pinned row, labelled with its name,
 * dot level with the row via `extension/row-outputs.ts`), rerolls Random rows
 * after each queue (`afterQueued`, like a seed set to randomize) and keeps
 * what the last run used per frame (lock buttons) and each row's start seed
 * ("Use last run's seed"). With "Base seed from Loop" on and a Loop upstream
 * the `base_seed` widget is greyed out and the rows preview with the Loop's.
 */
export function create(node: SeedsHostNode, inputName: string) {
  const mirrored = isMirrorBuild(node);
  const config = ref<SeedsConfig>(defaultSeedsConfig());
  const lastRun = ref<LastRun>({});
  const lastBases = ref<Record<string, number>>({});
  const editRequest = ref(0);
  if (!mirrored) {
    nodeEditors.set(node, () => {
      editRequest.value += 1;
    });
  }

  function store(next: SeedsConfig): void {
    config.value = next;
    host.setValue(serializeWidgetJson(next));
  }

  function reconcile(): void {
    const fixed = normalizeOuts(config.value);
    fitOutputs(node, fixed);
    if (JSON.stringify(fixed) !== JSON.stringify(config.value)) store(fixed);
    node.setDirtyCanvas?.(true, true);
    queueRowOutputs();
  }

  function onUpdate(next: SeedsConfig): void {
    const plan = planOutputs(config.value, next);
    for (const slot of plan.remove) node.removeOutput?.(slot);
    for (let i = 0; i < plan.add; i++) node.addOutput?.(`seed_${node.outputs?.length ?? 1}`, "INT");
    relabel(node, plan.config);
    store(plan.config);
    node.setDirtyCanvas?.(true, true);
    queueRowOutputs();
  }

  function rerollBase(): void {
    const w = node.widgets?.find((x) => x.name === "base_seed");
    if (!w) return;
    w.value = randomSeed();
    w.callback?.(w.value);
    node.setDirtyCanvas?.(true, true);
  }

  const rootGraph = (): LiteGraphLike | null => {
    const start = (node as unknown as { graph?: LiteGraphLike }).graph ?? (app.graph as unknown as LiteGraphLike);
    return start ? findRootGraph(start) : null;
  };

  const wrapper: Component = {
    setup() {
      const graphNode = node as unknown as Parameters<typeof reactiveFromGraph>[0];
      const nodeMode = reactiveFromGraph(graphNode, () => node.mode ?? 0, Object.is);
      const ownBase = reactiveFromGraph(graphNode, () => baseSeedOf(node), Object.is);
      const loopSeed = reactiveFromGraph(graphNode, () => {
        const g = rootGraph();
        return g ? upstreamLoopSeed(g, node as unknown as LiteNodeLike) : null;
      }, Object.is);
      // The stock base_seed widget does nothing while the Loop's seed is used.
      watchEffect(() => {
        const w = node.widgets?.find((x) => x.name === "base_seed");
        const off = !!config.value.base_from_loop && loopSeed.value !== null;
        if (w && !!w.disabled !== off) {
          w.disabled = off;
          node.setDirtyCanvas?.(true, true);
        }
      });
      const frames = reactiveFromGraph(graphNode, () => {
        const g = rootGraph();
        return (g && collectLoopFrames(g, node as unknown as LiteNodeLike)?.count) || 1;
      }, Object.is);
      const usedBy = reactiveFromGraph(graphNode, () => {
        const g = rootGraph();
        return g ? readersOf(g, node) : {};
      }, sameReaders);
      return () =>
        h(SeedsWidget, {
          modelValue: config.value,
          baseSeed: config.value.base_from_loop && loopSeed.value !== null ? loopSeed.value : ownBase.value,
          loopSeed: loopSeed.value,
          lastBases: lastBases.value,
          frames: frames.value,
          lastRun: lastRun.value,
          usedBy: usedBy.value,
          nodeMode: nodeMode.value,
          editRequest: editRequest.value,
          nodeTitle: node.title ?? "",
          "onUpdate:modelValue": onUpdate,
          onRerollBase: rerollBase,
        });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 60,
    sizing: { width: { min: 320, content: true }, height: "content", container: true },
    onValueRestored: (raw: string) => {
      const parsed = normalizeOuts(parseSeedsConfig(raw));
      if (JSON.stringify(parsed) === JSON.stringify(config.value)) return;
      config.value = parsed;
      if (!mirrored) reconcile();
    },
  });

  if (mirrored) return host;

  // Random rows get a new seed once the prompt is queued (the run keeps the
  // one it was queued with), the way ComfyUI's control_after_generate works.
  (host.widget as { afterQueued?: () => void }).afterQueued = () => {
    const next = rerollRandom(config.value);
    if (next !== config.value) store(next);
  };

  // What each frame used, for "lock last run": one `seed_frames` entry per
  // frame the node ran (ComfyUI joins a list run's UI outputs).
  listenApi(host, "executed", (ev: Event) => {
    const detail = (ev as CustomEvent<{ node?: unknown; output?: Record<string, unknown> }>).detail;
    if (!detail || String(detail.node) !== String((node as { id?: unknown }).id)) return;
    const frames = detail.output?.seed_frames;
    if (!Array.isArray(frames)) return;
    const next: LastRun = {};
    const bases: Record<string, number> = {};
    for (const f of frames) {
      if (!f || typeof f !== "object") continue;
      const { frame, seeds, bases: b } = f as { frame?: unknown; seeds?: unknown; bases?: unknown };
      if (b && typeof b === "object") {
        for (const [id, s] of Object.entries(b as Record<string, unknown>)) if (typeof s === "number") bases[id] ??= s;
      }
      if (typeof frame !== "number" || !seeds || typeof seeds !== "object") continue;
      const row: Record<string, number> = {};
      for (const [id, s] of Object.entries(seeds as Record<string, unknown>)) {
        if (typeof s === "number") row[id] = s;
      }
      next[String(frame)] = row;
    }
    lastRun.value = next;
    lastBases.value = bases;
  });

  queueMicrotask(reconcile);
  host.onCleanup(attachRowOutputs(node, host.element, inputName, isSeedOutput));
  return host;
}
