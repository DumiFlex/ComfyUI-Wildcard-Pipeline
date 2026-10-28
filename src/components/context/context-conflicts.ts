import { computed } from "vue";
import { scanConflicts, labelFor as conflictLabelFor, shortConflictLabel, type Conflict } from "../../extension/conflicts";
import { computeConstraintDeadEnds } from "../../extension/constraint-dead-ends";
import type { ChainModule, PairingBadge, RowPairings } from "../../extension/constraint-pairs";
import { filterByValidation } from "../../extension/settings";
import { hashes as libraryHashes } from "./drift-store";
import { lookupSiblingName } from "./module-summary";
import type { ModuleRowCtx } from "./module-row-ctx";
import type { WidgetState } from "./widget-state";

/** The widget props the conflict scan + pairing badges read. */
export interface ContextConflictProps {
  readonly nodeId: number;
  readonly upstreamVars: string[];
  readonly upstreamWildcardUuids?: string[];
  readonly downstreamWildcardUuids?: string[];
  readonly downstreamNestedReachUuids?: string[];
  readonly pairings: Map<string, RowPairings>;
  readonly chainModules?: ChainModule[];
}

/**
 * A Context node's advisory conflict scan (filtered by the validation-mode
 * setting) and the per-row reads ModuleRow badges use: severity, the short
 * badge label, the tooltip, and the cross-node pairing chips.
 */
export function useContextConflicts(state: WidgetState, props: ContextConflictProps) {
  const { value } = state;

  // Constraints that can leave a target with nothing to pick (no fallback).
  // Cross-node: reads the flattened chain + reach coverage, keyed back to this
  // node's `_uid`s. Its own computed so a conflict-free edit elsewhere in the
  // widget doesn't redo the option × option walk.
  const deadEndsByUid = computed<Map<string, string[]>>(() => {
    const out = new Map<string, string[]>();
    if (!props.chainModules?.length || !props.pairings?.size) return out;
    const prefix = `${props.nodeId}#`;
    for (const [rowKey, d] of computeConstraintDeadEnds(props.chainModules, props.pairings)) {
      if (rowKey.startsWith(prefix)) out.set(rowKey.slice(prefix.length), d.sourceValues);
    }
    return out;
  });

  const conflicts = computed<Conflict[]>(() => {
    // scanConflicts internally skips per-module via isModuleEffectivelyEnabled
    // (handles both child.enabled=false AND bundle.enabled=false). Passing the
    // full modules array preserves position semantics for constraint-target /
    // nested-ref lookups that need to know where every module sits regardless
    // of run state.
    // Build the per-uid orphan map from the cross-node pairings prop.
    // Cross-node-pairings keys are `${nodeId}#${_uid}` — strip the
    // node-id prefix so the scanner can lookup by local `_uid`. Only
    // constraint rows in this Context node carry meaningful pair data;
    // wildcard / carrier rows have no `direct` of their own here.
    const pairOrphanByUid = new Map<string, boolean>();
    const nodeIdPrefix = `${props.nodeId}#`;
    for (const [rowKey, rp] of props.pairings) {
      if (!rp.direct) continue;
      if (!rowKey.startsWith(nodeIdPrefix)) continue;
      const uid = rowKey.slice(nodeIdPrefix.length);
      pairOrphanByUid.set(uid, rp.direct.isOrphan);
    }
    const all = scanConflicts(
      value.value,
      props.upstreamVars,
      props.upstreamWildcardUuids,
      props.downstreamWildcardUuids,
      props.downstreamNestedReachUuids,
      pairOrphanByUid,
      // Live-library uuids — a nested @{} ref to any of these resolves at run
      // time (DB-expanded catalog), so it must not read as a broken ref.
      new Set(Object.keys(libraryHashes.value ?? {})),
      deadEndsByUid.value,
    );
    // Filter by user's validation-strictness preference. The accessor
    // reads from the same module-level state map the panel onChange
    // updates, so the computed picks up the new mode without manual
    // wiring (computed re-evaluates whenever its reactive deps —
    // value, props — change; the validation read is captured fresh
    // each evaluation, which is fine here because state changes
    // always coincide with a reactive trigger upstream).
    return filterByValidation(all);
  });
  const conflictsByModule = computed(() => {
    const out: Record<string, Conflict[]> = {};
    for (const c of conflicts.value) (out[c.moduleId] ??= []).push(c);
    return out;
  });

  // Pairing badge lookup — reads from the cross-node `pairings` prop
  // composed at the mount layer. Keys are `${nodeId}#${_uid}` so we have
  // to prefix the local row's `_uid` with our own `nodeId` before
  // lookup. Falls back to `id` for legacy rows that haven't been backfilled
  // with a `_uid` yet (`ensureRowUids()` normally runs on load, but a
  // barebones test mount can skip it).
  function pairingFor(rowUid: string): PairingBadge | null {
    const key = `${props.nodeId}#${rowUid}`;
    return props.pairings?.get(key)?.direct ?? null;
  }

  /** Inbound via-pairings — non-empty when this row is the CARRIER of
   *  one or more constraints reaching their target through a nested
   *  `@{uuid}` ref in this wildcard's option values. UI renders these
   *  as a collapsed `↪×N` chip beside the row's existing direct pair
   *  chip (if any), with a popover listing each. */
  function viaInboundFor(rowUid: string): PairingBadge[] {
    const key = `${props.nodeId}#${rowUid}`;
    return props.pairings?.get(key)?.viaInbound ?? [];
  }

  /** SP3 contributor cluster — every constraint whose reach covers this
   *  target-instance row, in per-target `#N` order. Reads the same
   *  cross-node `pairings` prop as `pairingFor` / `viaInboundFor`,
   *  prefixing the local `_uid` with our `nodeId`. ModuleRow renders these
   *  BEFORE the module name: ≤2 as individual `#N` chips, ≥3 as one
   *  collapsed `↥×N` chip. Empty for rows no constraint covers. */
  function contributorsFor(rowUid: string): PairingBadge[] {
    const key = `${props.nodeId}#${rowUid}`;
    return props.pairings?.get(key)?.contributors ?? [];
  }

  function severityFor(id: string): "error" | "warning" | "info" | null {
    const list = conflictsByModule.value[id];
    if (!list?.length) return null;
    if (list.some((c) => c.severity === "error")) return "error";
    if (list.some((c) => c.severity === "warning")) return "warning";
    return "info";
  }

  /**
   * Short text label for the conflict badge that sits next to the
   * `.wp-conflict-dot`. Picks the most-severe conflict on this
   * module (error > warning > info) and maps its type to a 1-2 word
   * tag so users recognise the issue without hovering for the
   * tooltip — pairs with the dot the same way the status badges
   * pair with the drift / missing / mod dots above. Returns `null`
   * if the module has no conflicts.
   *
   * Wording stays short on purpose; the full sentence form lives in
   * `conflictTooltip` for the title attribute. Constraint-specific
   * subtypes get their own short form so a constraint row with a
   * source/target wiring issue surfaces a meaningful label rather
   * than the generic "conflict".
   */
  function conflictBadgeText(id: string): string | null {
    const list = conflictsByModule.value[id];
    if (!list?.length) return null;
    // Pick the highest-severity conflict; tie-break by first occurrence
    // so the badge wording stays stable across renders. Label text comes
    // from the shared `shortConflictLabel` so module + injector rows
    // surface identical chip wording for the same conflict type.
    const order = { error: 0, warning: 1, info: 2 } as const;
    const top = [...list].sort(
      (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9),
    )[0];
    return shortConflictLabel(top.type);
  }

  function conflictTooltip(id: string): string {
    const list = conflictsByModule.value[id];
    if (!list?.length) return "";
    return list.map((c) => {
      // Constraint conflict types carry a wildcard uuid in `variable`,
      // not a $-var name. Resolve via the same sibling/preview-resolver
      // lookup constraint card labels use, so the tooltip shows
      // `$hair_color` instead of the unreadable 8-hex slug. Falls back
      // to the bare uuid only when the resolver can't find a name —
      // matches the card label's contract.
      if (c.type.startsWith("constraint_")) {
        const name = lookupSiblingName(value.value.modules, c.variable);
        const display = name ?? c.variable;
        if (c.type === "constraint_excludes_all" && c.detail) {
          return `${conflictLabelFor(c.type)}: $${display} when the source picks ${c.detail}`;
        }
        return `${conflictLabelFor(c.type)}: $${display}`;
      }
      return `${conflictLabelFor(c.type)}: $${c.variable}`;
    }).join("\n");
  }

  return {
    conflictsByModule,
    viaInboundFor,
    rowCtx: {
      pairingFor, viaInboundFor, contributorsFor,
      severityFor, conflictBadgeText, conflictTooltip,
    } satisfies Partial<ModuleRowCtx>,
  };
}
