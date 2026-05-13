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
export const nodeBadgeSeverity: WeakMap<object, string | null> = new WeakMap();

/** Cleanup function returned by the badge syncer's onConnectionsChange
 *  override + interval, called on node removal to detach handlers.
 *  Replaces `_wpBadgeCleanup`. */
export const nodeBadgeCleanup: WeakMap<object, () => void> = new WeakMap();
