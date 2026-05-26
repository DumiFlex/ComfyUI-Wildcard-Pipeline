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

/** Find every option in a wildcard module whose `value` references
 *  `targetUuid` via a nested `@{}` ref. Returns the matching option
 *  ids in order. Empty array when no options match — treat as "not a
 *  carrier of this target". */
function carrierOptionIdsFor(
  carrier: ChainModule,
  targetUuid: string,
): string[] {
  if (carrier.type !== "wildcard") return [];
  const opts = (carrier.payload as { options?: Array<{ id?: string; value?: string }> })
    .options;
  if (!Array.isArray(opts)) return [];
  const out: string[] = [];
  for (const opt of opts) {
    const value = opt?.value;
    const id = opt?.id;
    if (typeof value !== "string" || !id) continue;
    REF_REGEX_VIA.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REF_REGEX_VIA.exec(value)) !== null) {
      if (match[1] === targetUuid) {
        out.push(id);
        break;
      }
    }
  }
  return out;
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
      for (let j = cnIdx + 1; j < modules.length; j++) {
        const d = modules[j];
        // Direct match: a downstream wildcard whose id is the target uuid.
        if (d.type === "wildcard" && d.id === targetUuid && !claimedRowKeys.has(d.rowKey)) {
          claimedTarget = d;
          break;
        }
        // Nested match: a downstream wildcard with one of its option
        // values containing `@{targetUuid}`. Carriers aren't marked
        // as claimed (multiple constraints can route through them).
        const optionIds = carrierOptionIdsFor(d, targetUuid);
        if (optionIds.length > 0) {
          viaCarrier = d;
          viaOptionIds = optionIds;
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
