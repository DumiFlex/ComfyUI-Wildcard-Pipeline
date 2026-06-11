/**
 * Compute pairing badges for the constraint + target-instance UI.
 *
 * SP3 REACH MODEL. The pre-2026-05 design had each constraint
 * EXCLUSIVELY claim the first downstream target instance (one-shot,
 * `break` after claiming). The engine moved to a reach model
 * (`engine/modules/_constraints.py::apply_constraints_for_target`): each
 * constraint carries `target_select = {mode:"first"|"next"|"all"|"pick"}`
 * (default `all`) deciding which downstream target instances it covers,
 * and MULTIPLE constraints can cover ONE instance. This badge layer
 * mirrors that statically over the flattened `modules` chain.
 *
 * The returned map keys are row uids (NOT module ids — duplicate library
 * instances share a module id but each row has its own `_uid`). Values
 * are `RowPairings`:
 *
 *   - `contributors` (authoritative): every constraint whose reach covers
 *     THIS target-instance row, in per-target `#N` registration order.
 *   - `direct`: the constraint row's own badge (carrying its `reach`), OR
 *     — for a target/carrier row — a back-compat mirror of
 *     `contributors[0]` (the flat `computePairings` map + the legacy
 *     single-`#N` chip read this). An orphan constraint badge
 *     (`isOrphan: true`) signals its selector covered ZERO downstream
 *     instances; the user still sees the slot in the sequence.
 *   - `viaInbound`: badges where this row is the CARRIER (its options host
 *     nested `@{uuid}` refs the reach travels through).
 *
 * The `colorIndex` (1..8) is hashed from `senderRowKey + ':' + targetUuid`
 * via the same djb2 used for nested-ref token coloring (`varColorIndex`
 * in `components/shared/var-color.ts`) — a constraint + the rows it
 * covers share a color; distinct (sender, target) pairs spread across the
 * palette.
 *
 * Pure data — no Vue / DOM imports. Constraints are numbered in chain
 * order, one [1], [2], … sequence per target uuid. The walker that
 * produces the input `modules` array is responsible for splicing in
 * upstream + downstream WP_Context modules so pairings work cross-node.
 *
 * See `docs/superpowers/specs/2026-05-24-constraint-first-instance-design.md`
 * (original one-shot design, superseded by the SP3 reach selector).
 */

import { varColorIndex } from "../components/shared/var-color";
import type { TargetSelect } from "../widgets/_shared";

export type { TargetSelect };

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

/** Strip the `${nodeId}#` prefix off a rowKey, yielding the bare per-
 *  instance `_uid`. A `pick` selector persists the BARE `_uid` (that's
 *  what the engine matches via `firing_uid`/`carrier_ctx` — bare, no node
 *  prefix; see engine/pipeline.py + _constraints.py). The badge layer
 *  keys its row map on the full rowKey for graph-wide uniqueness, so to
 *  test a persisted pick against an encounter row we compare the pick uid
 *  to the row's BARE suffix. `_uid` is globally unique on its own, so the
 *  strip never collides two distinct instances. Mirrors the identical
 *  helper in TargetReachSection.vue (the persistence boundary). */
function bareUid(rowKey: string): string {
  const i = rowKey.indexOf("#");
  return i >= 0 ? rowKey.slice(i + 1) : rowKey;
}

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
  /** Constraint slot whose reach selector covered ZERO downstream target
   *  instances. Renders with a `!`/`?` indicator on the constraint row;
   *  no contributor badge gets attached to any target row (there's
   *  nothing to cover). */
  isOrphan: boolean;
  /** Set on BOTH the sender's badge AND the carrier's badge when the
   *  pair is reached via a nested `@{uuid}` ref rather than a direct
   *  downstream target instance. UI renders the ↪ glyph and a popover
   *  pointing at the carrier + affected options. Undefined for the
   *  legacy direct-target case. */
  via?: PairingVia;
  /** SP3 reach selector — set ONLY on the SENDER (constraint) row's
   *  `direct` badge, copied from the constraint's `target_select`
   *  (default `{mode:"all"}` when the payload omits it). Tells the
   *  renderer which downstream instances this constraint covers (all /
   *  first / next N / explicit picks) so the sender chip can annotate
   *  its reach. Undefined on contributor / carrier badges — only the
   *  originating constraint carries its own reach. */
  reach?: TargetSelect;
}

/** What a carrier scan found: the option ids whose `value` reaches
 *  `targetUuid` (directly or transitively) plus the hop route from the
 *  first such option to the target (target last). `optionIds` empty +
 *  `routeChain` null ⇒ "not a carrier of this target". */
export interface CarrierMatch {
  optionIds: string[];
  routeChain: string[] | null;
}

/** Build the `PairingVia` describing how a constraint reaches its target
 *  through `carrier`'s nested `@{uuid}` ref(s). Pulls the carrier's
 *  display name (var_binding `$name` > meta name > library name, leading
 *  `$` stripped) so the popover can read "Via nested ref in @backdrop"
 *  without its own module lookup. Shared by the sender badge + the
 *  carrier's inbound/contributor badges so all three agree. */
function carrierViaFor(
  carrier: ChainModule,
  match: CarrierMatch,
  targetUuid: string,
): PairingVia {
  const carrierPayload = carrier.payload as { var_binding?: string; name?: string };
  const rawBinding = carrierPayload.var_binding?.trim();
  const carrierName =
    (rawBinding ? rawBinding.replace(/^\$+/, "") : "")
    || carrier.displayName?.trim()
    || carrierPayload.name?.trim()
    || undefined;
  return {
    carrierRowKey: carrier.rowKey,
    carrierName,
    optionIds: match.optionIds,
    // routeChain is non-null whenever optionIds is non-empty.
    routeChain: match.routeChain ?? [targetUuid],
  };
}

/** Does `sel` cover the `n`-th encounter of a target instance whose
 *  identity is `directUid` (top-level) or `(carrierUid, optionId)`
 *  (nested-via-carrier)? Mirrors the engine's coverage test in
 *  `apply_constraints_for_target` + `_occurrence_matches`:
 *    - `all`   → every encounter.
 *    - `first` → only n === 1.
 *    - `next`  → n <= count (count coerced, default 1).
 *    - `pick`  → the encounter's identity is in `picks` (direct uid for
 *      top-level encounters; carrier_uid + option_id for nested ones).
 *      `directUid`/`carrierUid` are the BARE per-instance `_uid`s (the
 *      caller strips the rowKey's `nodeId#` prefix), matching the engine
 *      identity the persisted picks now carry.
 *  `optionIds` carries the carrier's matching option ids so a nested
 *  `pick` matches when ANY of them is listed (the engine fires per chosen
 *  option; statically we cover the carrier if any carried option is
 *  picked). */
function reachCovers(
  sel: TargetSelect,
  n: number,
  directUid: string | null,
  carrierUid: string | null,
  optionIds: readonly string[],
): boolean {
  switch (sel.mode) {
    case "first":
      return n === 1;
    case "next": {
      const cnt = Number.isFinite(Number(sel.count)) ? Number(sel.count) : 1;
      return n <= cnt;
    }
    case "pick": {
      const picks = Array.isArray(sel.picks) ? sel.picks : [];
      for (const p of picks) {
        if (!p || typeof p !== "object") continue;
        if (carrierUid === null) {
          if (p.kind === "direct" && p.uid === directUid) return true;
        } else if (
          p.kind === "nested"
          && p.carrier_uid === carrierUid
          && optionIds.includes(p.option_id)
        ) {
          return true;
        }
      }
      return false;
    }
    default:
      // "all" + any unknown mode → cover everything (engine's else branch).
      return true;
  }
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
 *  Cycle- and depth-guarded by `reachPath`. Exported so the constraint
 *  reach-selector UI (`TargetReachSection.vue`) can enumerate nested-via-
 *  carrier target occurrences with the SAME match logic the badge layer
 *  uses — keeps the pick checklist and the rendered pairings in lockstep. */
export function carrierOptionIdsFor(
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
 *  - `direct`: the row's primary pair badge. For a constraint row it's
 *    the constraint's own badge (carrying `reach`). For a target /
 *    carrier row it's a back-compat convenience mirror of
 *    `contributors[0]` — the FIRST constraint covering this instance —
 *    so the flat `computePairings` map + the legacy single-`#N` chip
 *    keep working unchanged. New code should read `contributors`.
 *  - `viaInbound`: pair badges where this row is the CARRIER (its
 *    options host nested refs one or more constraints reach their target
 *    through). Drives the collapsed `↪×N` chip. Empty when nothing
 *    routes through this row.
 *  - `contributors` (SP3): EVERY constraint whose reach selector covers
 *    THIS target-instance row, in per-target registration (`#N`) order.
 *    The SP3 mark-all model lets multiple constraints cover one instance
 *    (no exclusive claim), so this is the authoritative per-row list the
 *    next-task badge layer renders. Empty (default `[]`) on rows no
 *    constraint covers — including every constraint/source/non-target
 *    row.
 *
 * Sender rows that target via a nested ref still go through `direct` with
 * `direct.via` set, so the constraint module itself only renders one
 * badge.
 */
export interface RowPairings {
  direct: PairingBadge | null;
  viaInbound: PairingBadge[];
  contributors: PairingBadge[];
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
      entry = { direct: null, viaInbound: [], contributors: [] };
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
    // SP3 mark-all reach. Pre-2026-05 each constraint EXCLUSIVELY claimed
    // the first downstream target instance (number it, `break`). The
    // engine moved to a REACH model (`apply_constraints_for_target`):
    // every constraint whose `target_select` covers a firing target
    // instance applies — multiple constraints can cover ONE instance, and
    // one constraint can cover MANY. We mirror that statically:
    //   1. Assign each constraint a stable `#N` (registration order in
    //      this target group), color, parsed selector, and chain index.
    //   2. Walk the chain ONCE in execution order. At each downstream
    //      target encounter (a direct top-level instance OR a transitive
    //      carrier), bump every upstream constraint's per-constraint hit
    //      counter and test coverage; push a contributor badge onto the
    //      encounter row for each covering constraint (no claim/break).
    //   3. A constraint is an orphan iff its selector covered ZERO
    //      encounters. The sender badge carries `reach` + (the first
    //      covered carrier's) `via`.
    //
    // Color hashed from `senderRowKey + ':' + targetUuid` so two
    // constraints on the SAME target land on distinct palette buckets and
    // a constraint + the rows it covers share a color (same key, same
    // pass). Distinct target uuids don't share a `#N` sequence.
    const colorFor = (senderRowKey: string): number =>
      varColorIndex(`${senderRowKey}:${targetUuid}`);

    interface Sender {
      cn: ChainModule;
      number: number;
      colorIndex: number;
      reach: TargetSelect;
      chainIdx: number;
      hits: number;
      coveredAny: boolean;
      firstVia: PairingVia | null;
    }
    const senders: Sender[] = [];
    for (const cn of cns) {
      const chainIdx = modules.findIndex((m) => m.rowKey === cn.rowKey);
      if (chainIdx < 0) continue;
      const rawSel = (cn.payload as { target_select?: unknown }).target_select;
      // Default `{mode:"all"}` mirrors the engine default for an absent
      // selector. Trust the validated shape; fall back on anything odd.
      const reach: TargetSelect =
        rawSel && typeof rawSel === "object"
          ? (rawSel as TargetSelect)
          : { mode: "all" };
      senders.push({
        cn,
        number: senders.length + 1,
        colorIndex: colorFor(cn.rowKey),
        reach,
        chainIdx,
        hits: 0,
        coveredAny: false,
        firstVia: null,
      });
    }

    // Single execution-order walk. Each encounter (direct instance or
    // carrier) is one hit per upstream constraint, exactly like the
    // engine calls `apply_constraints_for_target` once per firing target.
    for (let j = 0; j < modules.length; j++) {
      const d = modules[j];
      const isDirect = d.type === "wildcard" && d.id === targetUuid;
      // A direct top-level instance is never also scanned as a carrier;
      // otherwise probe for a transitive carrier of this target.
      const match = isDirect ? null : carrierOptionIdsFor(d, targetUuid, lookup);
      const carrierMatch = match && match.optionIds.length > 0 ? match : null;
      if (!isDirect && !carrierMatch) continue;

      // Carrier/direct identity for `pick`/`via`. A persisted `pick`
      // names the BARE per-instance `_uid` (engine identity), so we
      // compare against the row's bare suffix — NOT the full rowKey the
      // map is keyed on. This keeps the badge in lockstep with both the
      // UI-persisted pick format AND the engine's `_occurrence_matches`.
      const via = carrierMatch ? carrierViaFor(d, carrierMatch, targetUuid) : null;
      const directUid = isDirect ? bareUid(d.rowKey) : null;
      const carrierUid = carrierMatch ? bareUid(d.rowKey) : null;
      const optionIds = carrierMatch ? carrierMatch.optionIds : [];

      for (const s of senders) {
        // Reach is downstream-relative: a constraint only sees target
        // encounters AFTER its own module ran (engine: it isn't in
        // `__wp_constraints__` until then).
        if (s.chainIdx >= j) continue;
        s.hits += 1;
        if (!reachCovers(s.reach, s.hits, directUid, carrierUid, optionIds)) continue;
        s.coveredAny = true;
        if (via && s.firstVia === null) s.firstVia = via;
        const badge: PairingBadge = {
          number: s.number,
          targetUuid,
          colorIndex: s.colorIndex,
          isOrphan: false,
          ...(via ? { via } : {}),
        };
        ensure(d.rowKey).contributors.push(badge);
        // Carrier rows also feed the collapsed `↪×N` inbound chip.
        if (via) ensure(d.rowKey).viaInbound.push(badge);
      }
    }

    // Finalise each sender's own `direct` badge: number + reach + orphan
    // state + (first covered carrier's) via.
    for (const s of senders) {
      ensure(s.cn.rowKey).direct = {
        number: s.number,
        targetUuid,
        colorIndex: s.colorIndex,
        isOrphan: !s.coveredAny,
        reach: s.reach,
        ...(s.firstVia ? { via: s.firstVia } : {}),
      };
    }
  }

  // Back-compat for the flat `computePairings` map + the legacy single
  // `#N` chip: a target/carrier row's `direct` mirrors its FIRST
  // contributor. Sender rows already set `direct` above; never overwrite
  // them (a constraint row has no contributors of its own).
  for (const entry of out.values()) {
    if (entry.direct === null && entry.contributors.length > 0) {
      entry.direct = entry.contributors[0];
    }
  }
  return out;
}
