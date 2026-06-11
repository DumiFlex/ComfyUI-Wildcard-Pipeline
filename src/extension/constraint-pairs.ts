/**
 * Compute pairing badges for the constraint + target-instance UI.
 *
 * Each constraint is paired with the downstream target wildcard
 * instance it will claim at runtime (per the 2026-05-24 first-instance
 * one-shot semantic). The returned map keys are row uids (NOT module
 * ids — duplicate library instances share a module id but each row has
 * its own `_uid`) and the values are
 * `{ number, targetUuid, colorIndex, isOrphan }`:
 *
 *   - Constraint module row → badge of its claimed target instance, OR
 *     an orphan badge (`isOrphan: true`) if no downstream instance is
 *     available — the user still sees the slot it would have occupied
 *     in the sequence so the chain semantic stays visible.
 *   - Target instance module row → matching badge from the constraint
 *     that claimed it.
 *   - Targets WITHOUT a paired constraint never get a badge.
 *
 * The `colorIndex` (1..8) is hashed from the target uuid via the same
 * djb2 used for nested-ref token coloring (`varColorIndex` in
 * `components/shared/var-color.ts`). Distinct target wildcards get
 * distinct colors so two co-existing pair sets (e.g. mood pairs vs
 * style pairs) read at a glance without their numbers colliding.
 *
 * Pure data — no Vue / DOM imports. Pairs are assigned in chain order,
 * one [1], [2], … sequence per target uuid. The walker that produces
 * the input `modules` array is responsible for splicing in upstream +
 * downstream WP_Context modules so pairings work cross-node.
 *
 * See `docs/superpowers/specs/2026-05-24-constraint-first-instance-design.md`.
 */

import { varColorIndex } from "../components/shared/var-color";

// Mirrors the engine tokenize.py + dep-graph.ts twin. Uuid is captured;
// name + subcat segments are non-capturing because the via-carrier
// detection only matches on uuid.
const REF_REGEX_VIA = /@\{([0-9a-f]{8})(?:#[^#:}@{]*)?(?::[^}]*)?\}/g;

/** Module types whose option values can host an `@{uuid}` ref the
 *  badge walk should follow. SP3 seam: a future "derivation" type
 *  (whose body refs wildcards) gets added here without touching the
 *  reachability walk. Today only `wildcard` modules carry refs. */
export const CARRIER_TYPES = new Set(["wildcard"]);

/** Reachability hop cap. The runtime engine resolves `@{}` to any
 *  depth, but a static badge walk must bound itself against deep /
 *  adversarial chains. 8 hops comfortably exceeds any hand-authored
 *  nesting while keeping the walk O(modules · options · 8). */
const MAX_REF_HOPS = 8;

/** Every uuid referenced by `@{}` inside `value`, in source order.
 *  `m[1]` is the captured 8-hex uuid (REF_REGEX_VIA has the `g` flag,
 *  required for matchAll). */
function refsIn(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(REF_REGEX_VIA)) out.push(m[1]);
  return out;
}

/** Does `start` reach `targetUuid` within MAX_REF_HOPS? Returns the hop
 *  path (uuids AFTER `start`, ending at the target) or null. Cycle-
 *  guarded via `seen`; depth-capped so a deep/adversarial ref chain
 *  can't blow the stack. `lookup` yields a wildcard's option `value`
 *  strings (empty for uuids not in the flattened chain — best-effort,
 *  runtime is authoritative). */
function reachPath(
  start: string,
  targetUuid: string,
  lookup: (uuid: string) => string[],
  seen: Set<string>,
  depth: number,
): string[] | null {
  if (depth > MAX_REF_HOPS || seen.has(start)) return null;
  seen.add(start);
  for (const value of lookup(start)) {
    for (const ref of refsIn(value)) {
      if (ref === targetUuid) return [ref];
      const sub = reachPath(ref, targetUuid, lookup, seen, depth + 1);
      if (sub) return [ref, ...sub];
    }
  }
  return null;
}

export interface ChainModule {
  /** Module id — uuid that constraint.target_wildcard_id matches against. */
  id: string;
  /** Row-unique key — survives library-deduped chains where two rows
   *  share the same module id. Used as the pairings Map key. Falls back
   *  to `id` when the caller can't supply a per-row uid (tests, etc). */
  rowKey: string;
  type: string;
  payload: Record<string, unknown>;
  /** Per-row display label, pulled from `meta.name` at flatten time.
   *  Used to populate `PairingVia.carrierName` so popovers can say
   *  "Via nested ref in @backdrop" without needing the renderer to
   *  hold its own modules-list mirror. Optional — tests + legacy
   *  callers may omit. */
  displayName?: string;
  /** Identity of the WP_Context node this module was flattened from —
   *  the node's user-set `node_label`, or an auto upstream→downstream
   *  letter (A, B, C…) when unset. Stamped by `collectFullChainModules`
   *  so cross-node UI (constraint reach pick-list, pair popovers) can
   *  name WHICH node a target instance lives in. Purely additive /
   *  presentation-only; the pairing math never reads it. Optional —
   *  tests + legacy callers may omit. */
  nodeLabel?: string;
}

/** When a pair lands on a wildcard that doesn't match the target uuid
 *  directly but contains an `@{targetUuid}` nested ref in one of its
 *  option values, the carrier rendering needs to know which options
 *  carry the ref so the editor modal can flag the right rows. The
 *  sender (constraint) badge gets `via: true` so its UI can show the
 *  ↪ glyph and route hover/click to the carrier instead of nothing. */
export interface PairingVia {
  /** rowKey of the wildcard whose options host the nested ref. UI
   *  resolves to a display name via its own module lookup so this
   *  interface stays renderer-agnostic. */
  carrierRowKey: string;
  /** Display label for the carrier wildcard — `var_binding` (the
   *  canonical `$`-name) when set, falling back to the library `name`.
   *  Pre-resolved at compute time so the popover doesn't need its own
   *  module list to render `Via nested ref in @backdrop`. Undefined
   *  when neither field is populated (broken / stub payload). */
  carrierName?: string;
  /** 8-hex option ids inside the carrier whose `value` contains the
   *  `@{targetUuid}` ref. Stable per-option ids — matches what the
   *  WildcardEditor row keys against. Empty when option ids weren't
   *  available (legacy rows). */
  optionIds: string[];
  /** Hop path from the carrier option to the target uuid, target LAST.
   *  One-hop (the carrier option refs the target directly) → just
   *  `[targetUuid]`. Multi-hop (the option refs an intermediate
   *  wildcard that, recursively, reaches the target) → the full chain
   *  of intermediate uuids ending at the target, e.g. `[bUuid, tUuid]`.
   *  Lets the popover render the route a constraint travels to reach a
   *  nested target. Undefined only on legacy direct-target badges where
   *  there is no carrier route at all. */
  routeChain?: string[];
}

export interface PairingBadge {
  number: number;
  targetUuid: string;
  colorIndex: number;
  /** Constraint slot whose downstream target instance is missing.
   *  Renders with a `?` indicator on the constraint row; no badge gets
   *  attached to any target row (because there isn't one). */
  isOrphan: boolean;
  /** Set on BOTH the sender's badge AND the carrier's badge when the
   *  pair is reached via a nested `@{uuid}` ref rather than a direct
   *  downstream target instance. UI renders the ↪ glyph and a popover
   *  pointing at the carrier + affected options. Undefined for the
   *  legacy direct-target case. */
  via?: PairingVia;
}

/** What a carrier scan found: the option ids whose `value` reaches
 *  `targetUuid` (directly or transitively) plus the hop route from the
 *  first such option to the target (target last). `optionIds` empty +
 *  `routeChain` null ⇒ "not a carrier of this target". */
interface CarrierMatch {
  optionIds: string[];
  routeChain: string[] | null;
}

/** Find every option in a carrier module whose `value` reaches
 *  `targetUuid` — directly (`@{targetUuid}`) OR transitively (the
 *  option refs `@{X}` and `X`, recursively through its own options'
 *  refs, reaches the target). Mirrors the runtime engine, which already
 *  resolves `@{}` to any depth, so the static badge matches what fires.
 *
 *  `lookup` yields a wildcard's option `value` strings (used to walk
 *  the transitive closure). Returns the matching option ids in order
 *  plus the route chain captured from the FIRST matching ref — one-hop
 *  refs yield `[targetUuid]`, multi-hop yield `[X, …, targetUuid]`.
 *  Cycle- and depth-guarded by `reachPath`. */
function carrierOptionIdsFor(
  carrier: ChainModule,
  targetUuid: string,
  lookup: (uuid: string) => string[],
): CarrierMatch {
  if (!CARRIER_TYPES.has(carrier.type)) return { optionIds: [], routeChain: null };
  const opts = (carrier.payload as { options?: Array<{ id?: string; value?: string }> })
    .options;
  if (!Array.isArray(opts)) return { optionIds: [], routeChain: null };
  const out: string[] = [];
  let routeChain: string[] | null = null;
  for (const opt of opts) {
    const value = opt?.value;
    const id = opt?.id;
    if (typeof value !== "string" || !id) continue;
    let optionRoute: string[] | null = null;
    for (const ref of refsIn(value)) {
      if (ref === targetUuid) {
        // Direct one-hop: this option refs the target itself.
        optionRoute = [targetUuid];
        break;
      }
      // Transitive: chase the ref's own refs for the target. A fresh
      // `seen` per ref scan keeps unrelated options independent; the
      // guard inside reachPath protects against cycles within a scan.
      const sub = reachPath(ref, targetUuid, lookup, new Set(), 1);
      if (sub) {
        optionRoute = [ref, ...sub];
        break;
      }
    }
    if (optionRoute) {
      out.push(id);
      // Capture the route from the first carrying option; later
      // carrying options reach the same target so one route suffices.
      if (routeChain === null) routeChain = optionRoute;
    }
  }
  return { optionIds: out, routeChain };
}

/** Bundle of pair data the renderer needs per row:
 *  - `direct`: the row's primary pair badge (constraint's own pair OR
 *    a directly-claimed target's badge). Same shape the renderer used
 *    before via-nested support landed.
 *  - `viaInbound`: pair badges where this row is the CARRIER (its
 *    options host nested refs the pair reaches through). Multiple
 *    constraints can land here so this is always a list. Empty when
 *    nothing routes through this row.
 *
 * Renderer reads both: direct → existing `#N` chip; viaInbound → the
 * collapsed `↪×N` chip with popover. Sender rows that target via a
 * nested ref still go through `direct` with `direct.via` set, so the
 * constraint module itself only renders one badge.
 */
export interface RowPairings {
  direct: PairingBadge | null;
  viaInbound: PairingBadge[];
}

export function computePairings(modules: ChainModule[]): Map<string, PairingBadge> {
  const full = computePairingsFull(modules);
  const out = new Map<string, PairingBadge>();
  for (const [k, v] of full) {
    if (v.direct) out.set(k, v.direct);
  }
  return out;
}

export function computePairingsFull(modules: ChainModule[]): Map<string, RowPairings> {
  const out = new Map<string, RowPairings>();
  function ensure(rowKey: string): RowPairings {
    let entry = out.get(rowKey);
    if (!entry) {
      entry = { direct: null, viaInbound: [] };
      out.set(rowKey, entry);
    }
    return entry;
  }

  // Transitive-ref lookup: uuid → that wildcard's option `value`
  // strings. Built once from the flattened `modules` so the reachability
  // walk (`reachPath`) can chase `@{X}` refs to any depth without re-
  // scanning. Keyed by module `id` (the uuid `@{}` refs resolve to);
  // duplicate library instances share an id + identical option values,
  // so first-seen wins (later dups would only re-add the same strings).
  // A ref to a uuid NOT in `modules` (cross-Context instance outside the
  // flattened set) yields `[]` — best-effort, runtime is authoritative;
  // never throws.
  const refValuesByUuid = new Map<string, string[]>();
  for (const m of modules) {
    if (!CARRIER_TYPES.has(m.type) || refValuesByUuid.has(m.id)) continue;
    const opts = (m.payload as { options?: Array<{ value?: string }> }).options;
    if (!Array.isArray(opts)) continue;
    const values: string[] = [];
    for (const opt of opts) {
      if (typeof opt?.value === "string") values.push(opt.value);
    }
    refValuesByUuid.set(m.id, values);
  }
  const lookup = (uuid: string): string[] => refValuesByUuid.get(uuid) ?? [];

  // Group constraints by target uuid. Within each group the badge
  // numbering is its own [1], [2], … sequence — distinct target
  // wildcards don't share a sequence.
  const constraintsByTarget = new Map<string, ChainModule[]>();
  for (const m of modules) {
    if (m.type !== "constraint") continue;
    const t = (m.payload as { target_wildcard_id?: string }).target_wildcard_id;
    if (!t) continue;
    const existing = constraintsByTarget.get(t);
    if (existing) existing.push(m);
    else constraintsByTarget.set(t, [m]);
  }

  for (const [targetUuid, cns] of constraintsByTarget) {
    // Each constraint claims the next unclaimed downstream target
    // slot. Slots = top-level chain modules at index > constraint's
    // index whose id matches the target uuid. Solo cases (1 constraint
    // + 1 target) also get badges so the user sees the pairing
    // sequence — clarity beats minimalism here.
    const claimedRowKeys = new Set<string>();
    let badgeNumber = 0;
    // Color hashed from `senderRowKey + ':' + targetUuid`. Each pair
    // gets a key that is unique to its (sender, target) combination, so:
    //   - two constraints targeting the SAME wildcard land on different
    //     palette buckets (collision rate ~1/8 vs ~certain with the old
    //     target-only hash),
    //   - two constraints targeting DIFFERENT wildcards no longer collide
    //     just because their target uuids happen to hash to the same
    //     bucket on 8 slots (the screenshot bug — `hair_style` + `style`
    //     both ending up `c2`),
    //   - the sender's badge + its matched receiver/carrier badge still
    //     share a color because both are stamped from the same key in
    //     the same iteration of this loop.
    function colorFor(senderRowKey: string): number {
      return varColorIndex(`${senderRowKey}:${targetUuid}`);
    }
    for (const cn of cns) {
      const cnIdx = modules.findIndex((m) => m.rowKey === cn.rowKey);
      if (cnIdx < 0) continue;
      // Single forward scan — first match WINS, regardless of route.
      // Previous code preferred direct targets over via-nested even when
      // a via-nested target came earlier in the chain. That was wrong:
      // the engine fires constraints against the first downstream
      // instance it encounters at run time (whether the source is a
      // standalone wildcard instance or appears inside a carrier's
      // `@{uuid}` ref), so the badge model must match.
      let claimedTarget: ChainModule | null = null;
      let viaCarrier: ChainModule | null = null;
      let viaOptionIds: string[] = [];
      let viaRouteChain: string[] = [];
      for (let j = cnIdx + 1; j < modules.length; j++) {
        const d = modules[j];
        // Direct match: a downstream wildcard whose id is the target uuid.
        if (d.type === "wildcard" && d.id === targetUuid && !claimedRowKeys.has(d.rowKey)) {
          claimedTarget = d;
          break;
        }
        // Nested match: a downstream carrier with an option value that
        // reaches `@{targetUuid}` directly OR transitively (through that
        // ref's own options, to any depth). Carriers aren't marked as
        // claimed (multiple constraints can route through them).
        const match = carrierOptionIdsFor(d, targetUuid, lookup);
        if (match.optionIds.length > 0) {
          viaCarrier = d;
          viaOptionIds = match.optionIds;
          // routeChain is non-null whenever optionIds is non-empty.
          viaRouteChain = match.routeChain ?? [targetUuid];
          break;
        }
      }
      badgeNumber++;
      const colorIndex = colorFor(cn.rowKey);
      if (claimedTarget !== null) {
        // Direct downstream target — original first-instance path.
        claimedRowKeys.add(claimedTarget.rowKey);
        ensure(cn.rowKey).direct = { number: badgeNumber, targetUuid, colorIndex, isOrphan: false };
        ensure(claimedTarget.rowKey).direct = { number: badgeNumber, targetUuid, colorIndex, isOrphan: false };
        continue;
      }
      if (viaCarrier !== null) {
        const carrierPayload = viaCarrier.payload as {
          var_binding?: string;
          name?: string;
        };
        // Priority: var_binding (canonical `$name`) > meta display name
        // (e.g. "backdrop") > library payload name. UI prefixes with `@`
        // when rendering; the leading `$` from a var_binding gets
        // stripped so the popover reads `@backdrop` uniformly.
        const rawBinding = carrierPayload.var_binding?.trim();
        const carrierName =
          (rawBinding ? rawBinding.replace(/^\$+/, "") : "")
          || viaCarrier.displayName?.trim()
          || carrierPayload.name?.trim()
          || undefined;
        const via: PairingVia = {
          carrierRowKey: viaCarrier.rowKey,
          carrierName,
          optionIds: viaOptionIds,
          routeChain: viaRouteChain,
        };
        // Sender (constraint) row — its primary badge carries `via`
        // so the renderer knows to flip on the ↪ glyph + popover.
        ensure(cn.rowKey).direct = {
          number: badgeNumber, targetUuid, colorIndex, isOrphan: false, via,
        };
        // Carrier wildcard — append to viaInbound so the row picks up
        // the collapsed ↪×N chip. Stacks naturally for multiple
        // constraints routed through the same carrier.
        ensure(viaCarrier.rowKey).viaInbound.push({
          number: badgeNumber, targetUuid, colorIndex, isOrphan: false, via,
        });
        continue;
      }

      // Orphan — no downstream instance AND no via-nested carrier.
      // Constraint still gets a slot so the user sees the sequence.
      ensure(cn.rowKey).direct = { number: badgeNumber, targetUuid, colorIndex, isOrphan: true };
    }
  }
  return out;
}
