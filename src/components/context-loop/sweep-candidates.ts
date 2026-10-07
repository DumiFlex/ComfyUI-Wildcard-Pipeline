/**
 * Wildcards a Context Loop can sweep: every enabled wildcard instance in the
 * WP_Context nodes downstream of the loop. Pure — the widget glue walks the
 * graph and hands each node's parsed module list in here.
 */
import {
  buildBundleEnabledMap,
  isModuleEffectivelyEnabled,
  parseWidgetJson,
  type ContextWidgetValue,
} from "../../widgets/_shared";
import type { SweepAxis } from "./types";

export interface SweepOption {
  id: string;
  /** Option text, or "(nothing)" for the null option. */
  label: string;
}

export interface SweepCandidate {
  uid: string;
  /** Card title in the Context node. */
  name: string;
  /** The variable the wildcard writes, without `$`. */
  binding: string;
  /** Codename of the Context node holding it. */
  nodeLabel: string;
  options: SweepOption[];
  /** What a new axis selects: the options this instance can roll today
   *  (its enabled set, null option left out). */
  defaultIds: string[];
}

/** A downstream Context node as the widget glue reads it off the graph. */
export interface SweepSourceRaw {
  /** Codename of the Context node. */
  label: string;
  /** The node's `wp_modules` widget value (module list JSON). */
  raw: string;
}

/** Parse the raw downstream nodes' module lists. */
export function sweepSourcesFromRaw(nodes: readonly SweepSourceRaw[]): SweepSourceNode[] {
  return nodes.map((n) => ({
    label: n.label,
    value: parseWidgetJson<ContextWidgetValue>(n.raw, { version: 1, modules: [] }),
  }));
}

export interface SweepSourceNode {
  label: string;
  value: ContextWidgetValue;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function collectSweepCandidates(nodes: readonly SweepSourceNode[]): SweepCandidate[] {
  const out: SweepCandidate[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const bundles = buildBundleEnabledMap(n.value.bundles);
    for (const m of n.value.modules ?? []) {
      if (m.type !== "wildcard" || !m._uid || seen.has(m._uid)) continue;
      if (!isModuleEffectivelyEnabled(m, bundles)) continue;
      const payload = m.payload ?? {};
      const rawOptions = Array.isArray(payload.options) ? payload.options : [];
      const options: SweepOption[] = [];
      const defaults: string[] = [];
      const enabled = m.instance?.enabled_options;
      const enabledSet = Array.isArray(enabled) ? new Set(enabled) : null;
      for (const o of rawOptions) {
        if (!o || typeof o !== "object") continue;
        const opt = o as Record<string, unknown>;
        const id = str(opt.id);
        if (!id) continue;
        const isNull = opt.is_null === true;
        options.push({ id, label: isNull ? "(nothing)" : str(opt.value) });
        if (!isNull && (!enabledSet || enabledSet.has(id))) defaults.push(id);
      }
      if (!options.length) continue;
      seen.add(m._uid);
      out.push({
        uid: m._uid,
        name: m.meta?.name || str(payload.var_binding) || "wildcard",
        binding: m.instance?.variable_binding || str(payload.var_binding),
        nodeLabel: n.label,
        options,
        defaultIds: defaults.length ? defaults : options.map((o) => o.id),
      });
    }
  }
  return out;
}

/** How an axis lines up with what is downstream right now. `missing` means
 *  its wildcard is gone (the loop would repeat frames for nothing);
 *  `staleIds` are picked options the wildcard no longer has (those frames
 *  roll normally instead of pinning). */
export interface AxisStatus {
  candidate: SweepCandidate | null;
  missing: boolean;
  staleIds: string[];
}

export function axisStatus(
  axis: SweepAxis,
  candidates: readonly SweepCandidate[],
): AxisStatus {
  const candidate = candidates.find((c) => c.uid === axis.uid) ?? null;
  if (!candidate) return { candidate, missing: true, staleIds: [] };
  const known = new Set(candidate.options.map((o) => o.id));
  return {
    candidate,
    missing: false,
    staleIds: axis.option_ids.filter((id) => !known.has(id)),
  };
}
