/**
 * Module-private metadata stashes for extension state we attach to
 * shared LiteGraph objects (nodes, slots). Using WeakMap instead of
 * string-keyed properties (`node._wpSomething = ...`) means:
 *
 *   1. No collision risk — another extension can't accidentally
 *      overwrite our state by using the same string key. The WeakMap
 *      instance is module-private; only this codebase can read or
 *      write through it.
 *   2. Zero serialization footprint — WeakMap entries never appear in
 *      JSON.stringify, for...in, or Object.keys, so transient session
 *      state can't accidentally bleed into the saved workflow.
 *   3. Automatic cleanup — when a node/slot is garbage-collected, the
 *      WeakMap entry vanishes with it. No manual `delete` rituals to
 *      avoid memory leaks.
 *
 * Persistent state (i.e. anything that must survive workflow save +
 * reload) still belongs on `node.properties` (a plain object that
 * litegraph serializes). The collapse_connections flag is the canonical
 * example — it lives on properties, not in here.
 *
 * The keys exported below are typed unknown-by-default; each consumer
 * module narrows them at the call site (or wraps with helper getters).
 * Keep the types loose here so the file stays a single source of
 * truth for "what state we attach where" without becoming a
 * monorepo-of-types.
 */

/** Original `slot.label` snapshot taken when entering the collapse
 *  state. Used by collapse-connections to restore the user-visible
 *  label on expand. Cleared after restore so the next collapse
 *  cycle re-snapshots fresh (preserves any user edits made while
 *  expanded). */
export const slotOrigLabel: WeakMap<object, string | undefined> = new WeakMap();

/** "Has this slot been stashed?" marker — distinct from slotOrigLabel
 *  because the snapshot value can legitimately be `undefined` (slot
 *  had no explicit label, relied on litegraph's name-fallback). The
 *  WeakMap's `has()` answers the question without confusing
 *  "stashed undefined" with "never stashed". */
export const slotLabelStashed: WeakSet<object> = new WeakSet();

/** Marker placed on a node the first time collapse machinery is
 *  attached, so re-attach calls no-op. Replaces the previous string
 *  property `__wpCollapseAttached`. */
export const nodeCollapseAttached: WeakSet<object> = new WeakSet();

/** Per-node config object passed to attachCollapsableConnections.
 *  setCollapsed reads this back so callers don't need to re-supply
 *  the config every toggle. Replaces the previous string property
 *  `__wpCollapseConfig`. */
export const nodeCollapseConfig: WeakMap<object, unknown> = new WeakMap();

/** Subgraph-badge instance attached to a SubgraphNode by the badge
 *  syncer. Replaces the previous string property `_wpBadge`. */
export const nodeBadge: WeakMap<object, unknown> = new WeakMap();

/** Last computed severity for the subgraph badge — used to skip
 *  unnecessary repaints when the inner-graph conflict scan returns
 *  the same severity twice in a row. Replaces `_wpBadgeSeverity`. */
export const nodeBadgeSeverity: WeakMap<object, "info" | "warning" | "error" | null> = new WeakMap();

/** Cleanup function returned by the badge syncer's onConnectionsChange
 *  override + interval, called on node removal to detach handlers.
 *  Replaces `_wpBadgeCleanup`. */
export const nodeBadgeCleanup: WeakMap<object, () => void> = new WeakMap();

/** Active collapse-animation token (a monotonic number per node).
 *  setCollapsed bumps the token and reads it on each rAF tick;
 *  when a fresh toggle bumps again, the old tween's check fails and
 *  it bails. Prevents "double animation" jitter when the user
 *  toggles rapidly. */
export const nodeCollapseAnimToken: WeakMap<object, number> = new WeakMap();

/** Active subgraph-badge pulse token. Same pattern as the collapse
 *  token — bumped each time a fresh pulse starts so a previous in-flight
 *  rAF loop bails on its next tick. Prevents two pulses fighting over
 *  the same badge's geometry when severity changes back-to-back. */
export const nodeBadgePulseToken: WeakMap<object, number> = new WeakMap();
/** Set membership during an active collapse animation. Added when
 *  `animateResize` schedules its first rAF, deleted when the final
 *  rAF tick falls through to `snapToSize`. Read by the widget
 *  autosize machinery (`pushSize`, `requestRelayout` in
 *  `widgets/_shared.ts`) to suppress observer-driven setSize while
 *  the node height is being tweened — otherwise pushSize would
 *  instantly snap the node to its collapsed target the moment Vue
 *  removes the rows from the DOM, and the animation would visibly
 *  start from the collapsed state instead of tweening down from the
 *  expanded one. The token map alone can't carry this signal: tokens
 *  persist across animations (last value retained), so `.has(node)`
 *  is true forever after the first collapse. */
export const nodeCollapseAnimating: WeakSet<object> = new WeakSet();
