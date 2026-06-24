import { createApp, type App, type Component } from "vue";

import { nodeCollapseAnimating } from "../extension/_stashes";
import { installClipboardShield } from "./clipboard-shield";

export interface DomWidget {
  element: HTMLElement;
  options?: Record<string, unknown>;
}

export interface DomWidgetHost {
  widget: DomWidget;
  element: HTMLElement;
  app: App;
  unmount: () => void;
  getValue: () => string;
  setValue: (v: string) => void;
  /** Trigger a node relayout — runs the canonical 3-step
   *  (`computeSize → setSize → setDirtyCanvas`) once. Callers invoke
   *  this when their state has changed in a way that affects the
   *  width returned by their `minWidth` getter. Re-entrant calls
   *  collapse via an internal flag, so a burst of state changes
   *  yields exactly one setSize. */
  requestRelayout: () => void;
}

export interface MountTargetNode {
  addDOMWidget(name: string, type: string, el: HTMLElement, opts?: Record<string, unknown>): DomWidget & {
    computeLayoutSize?: (n: unknown) => { minWidth: number; minHeight: number };
  };
}

export interface CreateDomWidgetHostOptions<P extends Record<string, unknown>> {
  initialValue?: string;
  /** Notified whenever ComfyUI's value setter is invoked — e.g. workflow load. */
  onValueRestored?: (v: string) => void;
  componentProps?: P;
  /** Minimum widget height in pixels. Skips per-frame DOM measurement. */
  minHeight?: number;
  /** Force the parent node to be at least this wide (px). LoRA Manager
   *  docs §4.3. Accepts either a static number OR a getter function
   *  — the function is called every time litegraph queries
   *  computeLayoutSize during relayout, so callers can return a value
   *  that depends on current widget state (e.g. wider when a conflict
   *  badge is rendered, narrower when it isn't). */
  minWidth?: number | (() => number);
  /**
   * Fill the host's allocated height instead of growing the node to fit
   * content. Use for read-only viewers (debug snapshot) where the node size
   * should drive the viewer, not the other way around. Disables autosize
   * observation; component CSS should set `height: 100%` on its root.
   */
  fillHost?: boolean;
  /**
   * When true, ignore user height-drag and ALWAYS follow content min
   * height. Width still preserves user drag (per-axis policy). Use for
   * widgets where the content has a well-defined natural height that
   * the user shouldn't override — collapse/expand animations break when
   * the node is stuck at a manually-set tall height. Defaults to
   * `false` (current behavior: preserve user height drag).
   */
  autoHeight?: boolean;
}

/** LiteGraph snaps node size to this grid by default. Mirror it when
 *  we set sizes programmatically so auto-grow lands on the same grid
 *  the user gets when they drag, rather than off-by-a-pixel drift. */
const NODE_SIZE_GRID = 10;

function snapToGrid(n: number): number {
  return Math.round(n / NODE_SIZE_GRID) * NODE_SIZE_GRID;
}

interface ResizableNode {
  size?: number[];
  computeSize?: () => [number, number] | number[];
  setSize?: (size: [number, number] | number[]) => void;
  setDirtyCanvas?: (foreground: boolean, background: boolean) => void;
}

export function createDomWidgetHost<P extends Record<string, unknown>>(
  node: MountTargetNode,
  widgetName: string,
  component: Component<P>,
  options: CreateDomWidgetHostOptions<P> = {},
): DomWidgetHost {
  const host = document.createElement("div");
  host.classList.add("wp-widget");
  host.style.width = "100%";
  host.style.boxSizing = "border-box";

  // Inner element receives Vue's mount. Its natural (content) height is what
  // we feed back as the node's required height. Observing the outer host
  // would only ever report ComfyUI's own assigned height (== getMinHeight),
  // which gives a tautology — height never grows because we measure the
  // value we just set.
  const inner = document.createElement("div");
  inner.classList.add("wp-widget__inner");
  inner.style.width = "100%";
  inner.style.boxSizing = "border-box";
  if (options.fillHost) {
    // Stretch to whatever ComfyUI gives us so the component can flex into the
    // available space.
    inner.style.height = "100%";
    host.style.height = "100%";
  }
  host.appendChild(inner);

  // Clipboard-shortcut shield (on-node inputs). Stops Ctrl+A/C/X/V/Z/Y +
  // copy/cut/paste from bubbling out of the widget to ComfyUI's canvas
  // handlers when the focused target is editable, so the input gets the native
  // text op (not node select/copy/paste). Bubble-phase + no preventDefault, so
  // the input's own handlers still run. The same util backs the global
  // body-level shield (main.ts) that covers Teleported modals (Injector
  // binding field, instance-edit modals, etc.). See widgets/clipboard-shield.ts.
  installClipboardShield(inner);

  let state = options.initialValue ?? "";
  // baseMin pre-snapped so the initial `getMinHeight` answer + every
  // subsequent floor enforcement land on the LiteGraph grid. Without
  // this, the first paint reports a raw min, ComfyUI sizes the node
  // to it, then our autosize snaps a moment later — visible as a
  // two-step resize.
  const baseMin = snapToGrid(options.minHeight ?? 80);
  let minHeight = baseMin;

  const widgetOpts: Record<string, unknown> = {
    socketless: true,
    getValue: () => state,
    setValue: (v: string) => {
      state = v;
      options.onValueRestored?.(v);
    },
    // Cached number so ComfyUI skips per-frame getComputedStyle (perf hint
    // from LoRA Manager's DOM widget guide).
    getMinHeight: () => minHeight,
  };

  const widget = node.addDOMWidget(widgetName, "wp-dom", host, widgetOpts);
  // Force a minimum node width if requested. LoRA Manager docs §4.3 —
  // only way to widen the node from a DOM widget is overriding
  // computeLayoutSize. `minWidth` accepts either a static number or
  // a getter; the getter is called each layout pass, so callers can
  // recompute from their own state (e.g. width depends on whether a
  // conflict badge is rendered). This is the "pull-based" pattern
  // documented in the Comfy-Org frontend source — layout asks us,
  // we don't push back via setSize. No observer cascade is possible
  // because nothing observes the DOM.
  let minWidthGetter: (() => number) | null = null;
  if (typeof options.minWidth === "function") {
    minWidthGetter = options.minWidth;
  } else if (typeof options.minWidth === "number") {
    const captured = options.minWidth;
    minWidthGetter = () => captured;
  }
  if (minWidthGetter) {
    const getter = minWidthGetter;
    // Snap the reported minWidth so ComfyUI's first layout pass already
    // sees a grid-aligned value. If we returned the raw getter result,
    // litegraph would size to that, then our setSize call below would
    // round to the next grid step — perceived as a two-step resize.
    widget.computeLayoutSize = () => ({ minWidth: snapToGrid(getter()), minHeight });
  }
  // createApp's prop overload requires the second arg's keys to extend the
  // component's prop keys. With componentProps?: P (defaulting to {}), TS
  // won't narrow back to P at this call site. Cast through `unknown` once
  // here — the public API on createDomWidgetHost is still strict in P.
  const app = createApp(component, (options.componentProps ?? {}) as unknown as P);
  app.mount(inner);

  // Observe inner content height. When Vue grows the DOM, bump minHeight (so
  // ComfyUI's getMinHeight callback returns the right value) and grow the node
  // ONLY when its current height is below what the content needs.
  //
  // Important: never call setSize unconditionally. computeSize() returns the
  // *minimum* layout size; calling setSize(computeSize()) on every observer
  // fire would (a) override the user's manual drag-larger, and (b) override
  // the saved-workflow size when ComfyUI restores it on page load.
  const resizable = node as unknown as ResizableNode;
  let scheduled = false;
  function pushSize(measured: number) {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      // While a collapse animation is tweening node.size[1], skip
      // observer-driven setSize. The tween captured startH before
      // Vue's v-if removed the rows; a setSize here would snap the
      // node to the collapsed target instantly, the tween's next rAF
      // would override back to start, and the user would see a
      // snap-then-animate two-step. Resuming after the tween (the
      // animation clears the flag in its final rAF) is safe because
      // snapToSize at the tween's end already lands the node at the
      // correct target.
      if (nodeCollapseAnimating.has(node as object)) return;
      // Snap before storing: minHeight feeds both ComfyUI's
      // getMinHeight callback AND our own min[1] read below. Keeping
      // it grid-aligned at the source means setSize never has to
      // correct an off-grid value after the fact.
      const next = snapToGrid(Math.max(baseMin, measured));
      if (next !== minHeight) minHeight = next;

      const min = resizable.computeSize?.();
      const cur = resizable.size;
      if (!min || !cur || !resizable.setSize) return;
      // Height axis policy:
      //  - `autoHeight` option set → always follow content min. User
      //    drag is ignored (use case: Context / Injector / Assembler
      //    where the natural height matters more than a user-stuck
      //    tall size that breaks collapse autosizing).
      //  - default → delta-check user's drag and preserve it. Only
      //    grow when content demands more room.
      const userControlsHeight =
        !options.autoHeight
        && lastAutoSetHeight !== 0
        && Math.abs(cur[1] - lastAutoSetHeight) > 1;
      const rawTargetH = userControlsHeight
        ? Math.max(cur[1], min[1])
        : min[1];
      // Width axis: always preserve user drag (current behavior).
      const userControlsWidth =
        lastAutoSetWidth !== 0 && Math.abs(cur[0] - lastAutoSetWidth) > 1;
      const rawTargetW = userControlsWidth ? Math.max(cur[0], min[0]) : Math.max(cur[0], min[0]);
      // Snap both axes to LiteGraph's 10px node-size grid so auto-grow
      // lands on the same grid the user gets when they drag the corner.
      const targetW = snapToGrid(rawTargetW);
      const targetH = snapToGrid(rawTargetH);
      if (Math.abs(cur[0] - targetW) < 1 && Math.abs(cur[1] - targetH) < 1) return;
      resizable.setSize([targetW, targetH]);
      lastAutoSetWidth = targetW;
      lastAutoSetHeight = targetH;
      resizable.setDirtyCanvas?.(true, true);
    });
  }
  // Skip the autosize observer in fill mode — node size is user-controlled,
  // content fills whatever space is given.
  const resizeObserver = options.fillHost
    ? null
    : new ResizeObserver((entries) => {
        for (const e of entries) {
          const h = Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height);
          if (h > 0) pushSize(h);
        }
      });
  if (resizeObserver) queueMicrotask(() => resizeObserver.observe(inner));

  // Pull-based relayout. Reentrancy flag short-circuits if litegraph's
  // response to our setSize triggers (via some plugin or observer) a
  // synchronous re-entry. 32ms release matches rgthree's _tempWidth
  // debouncer — long enough to outlive a single paint cycle, short
  // enough that real successive state changes still apply promptly.
  //
  // Size preservation: track BOTH axes independently via the KJNodes-
  // style "delta-check" pattern. We record `lastAutoSetWidth` /
  // `lastAutoSetHeight` whenever WE call setSize; on the next
  // requestRelayout we compare cur to those values. Match → the
  // change came from us, safe to follow min up OR down. Mismatch →
  // the user (or another extension) resized that axis manually; we
  // preserve their value and only grow if min demands more room.
  //
  // Why each axis individually: the user might drag the node wider
  // (preserve width on tab-change) while autosize legitimately wants
  // to shrink the height (snapshot cleared, viewport collapsed). The
  // two states are independent.
  let relayouting = false;
  let lastAutoSetWidth = 0;
  let lastAutoSetHeight = 0;
  function requestRelayout(): void {
    if (relayouting) return;
    relayouting = true;
    try {
      // See pushSize comment — same reason: skip while the collapse
      // tween owns node.size[1].
      if (nodeCollapseAnimating.has(node as object)) return;
      const min = resizable.computeSize?.();
      const cur = resizable.size;
      if (!min || !cur || !resizable.setSize) return;
      const userControlsWidth =
        lastAutoSetWidth !== 0 && Math.abs(cur[0] - lastAutoSetWidth) > 1;
      const rawTargetW = userControlsWidth
        ? Math.max(cur[0], min[0])  // preserve drag; grow only if needed
        : min[0];                    // we own width; follow min up OR down
      // Height policy:
      //   - autoHeight option (Context / Injector / Assembler) →
      //     always follow content min. Never preserve drag.
      //   - fillHost (Debug): height is 100% user-controlled. No
      //     ResizeObserver fires to seed `lastAutoSetHeight`, so the
      //     delta-check would always read "we own height" on first
      //     call and snap the node back to min. Preserve cur[1] but
      //     respect the floor.
      //   - default: delta-check user drag, preserve when matched.
      let userControlsHeight: boolean;
      if (options.autoHeight) {
        userControlsHeight = false;
      } else if (options.fillHost) {
        userControlsHeight = true;
      } else {
        userControlsHeight =
          lastAutoSetHeight !== 0 && Math.abs(cur[1] - lastAutoSetHeight) > 1;
      }
      const rawTargetH = userControlsHeight
        ? Math.max(cur[1], min[1])
        : min[1];
      const targetW = snapToGrid(rawTargetW);
      const targetH = snapToGrid(rawTargetH);
      if (Math.abs(cur[0] - targetW) < 1 && Math.abs(cur[1] - targetH) < 1) return;
      resizable.setSize([targetW, targetH]);
      // Record what WE asked for on both axes. Even if litegraph
      // clamps slightly (subpixel rounding, snap-to-grid), the
      // reverse delta check tolerates ±1px so a small clamp doesn't
      // get misread as a user drag.
      lastAutoSetWidth = targetW;
      lastAutoSetHeight = targetH;
      resizable.setDirtyCanvas?.(true, true);
    } finally {
      setTimeout(() => { relayouting = false; }, 32);
    }
  }

  return {
    widget,
    element: inner,
    app,
    unmount: () => {
      resizeObserver?.disconnect();
      app.unmount();
    },
    getValue: () => state,
    setValue: (v) => {
      state = v;
    },
    requestRelayout,
  };
}

export interface ContextWidgetValue {
  version: 1;
  /**
   * Every picked / inline-created module renders as one entry here —
   * regardless of kind. The picker appends entries from the
   * `/api/modules/embed-bundle` response; the inline "New fixed
   * values" path appends a fresh `fixed_values` entry the same way.
   * The widget renders these uniformly as cards in a single list,
   * the WP_Context node executes them in order at run time, and the
   * subset typed `wildcard` doubles as the `__wp_catalog__` for
   * `@{uuid}` ref resolution.
   */
  modules: ModuleEntry[];
  /**
   * Library-tracked groupings wrapping a contiguous range of
   * `modules[]`. The engine ignores this field entirely — bundle
   * metadata is presentation-only. ContextWidget renders a colored
   * frame around `[start_idx..end_idx]` for each entry.
   *
   * Bundles are intentionally **snapshot packages**: when a bundle
   * is inserted, the library entry's child snapshots get spliced
   * into `modules[]` as ordinary modules (with `bundle_origin`
   * stamped) and one entry is added here. Library updates to the
   * snapshotted children do NOT propagate into existing
   * `BundleInstance`s — drift detection is per-child via the
   * existing per-kind logic.
   *
   * Optional in workflow JSON for backward compat — when missing,
   * `parseWidgetJsonWithRecovery` defaults this to `[]` so old
   * workflows load unchanged. Marked optional at the TS level too
   * so inline literal fallbacks (`{version:1, modules:[]}` scattered
   * across the codebase) don't have to be updated en masse — consumers
   * read with `value.bundles ?? []`.
   */
  bundles?: BundleInstance[];
}

/** A bundle instance pinned to one Context node. Stable across
 *  workflow save/load. Range integrity is the ContextWidget's
 *  responsibility — drag-in/drag-out of children adjusts
 *  start_idx/end_idx; dropping the last child dissolves the
 *  bundle (frame disappears, library entry preserved). */
export interface BundleInstance {
  /** Per-Context stable UID, used as Vue `:key` + cross-reference
   *  target for child `bundle_origin` fields. Separate from
   *  `library_id` since the same library entry can be inserted
   *  multiple times into one Context. 12-char hex (matches
   *  `newRowUid()` pattern used by module `_uid`). */
  _uid: string;
  /** Pointer to the bundle library entry. May fail to resolve if
   *  the entry was deleted from the library — surfaces as a
   *  missing-state on the bundle header. */
  library_id: string;
  /** Indices over `ContextWidgetValue.modules[]`, both inclusive.
   *  `end_idx < start_idx` is invalid — drop the BundleInstance
   *  entirely when the last child leaves the range. */
  start_idx: number;
  end_idx: number;
  /** Bundle-level enable gate. NOT cascaded onto children — child
   *  `instance.enabled` state is preserved independently so toggling
   *  the bundle off and back on restores each child to its previous
   *  individual on/off. Effective enabled = bundle.enabled AND
   *  child.enabled. Applied at the engine boundary
   *  (`wp_nodes/types.py:deserialize_node_input`) for execution, and
   *  via `isModuleEffectivelyEnabled` for every frontend reader
   *  (conflict scanner, graph walkers, assembler preview). */
  enabled: boolean;
  /** When true, ContextWidget renders only the bundle header row
   *  and hides children. */
  collapsed: boolean;
  /** Library payload_hash at insert time. Used to detect when the
   *  bundle library entry has been updated since this instance was
   *  inserted — informational only, not a conflict. */
  inserted_at_hash: string;
  /** Bundle name denormalized from the library entry at insert time.
   *  Carried on the instance so the bundle header can render
   *  immediately without waiting for a library fetch — and so saved
   *  workflows still show the right name even if the library entry
   *  got renamed or deleted later (bundles are frozen snapshots). */
  name: string;
  /** Bundle frame color (hex) at insert time. Same denormalization
   *  rationale as `name`. Optional / nullable — when missing, the
   *  frame uses the `--wp-bundle-default` token. */
  color?: string | null;
  /** Tier-2 nesting: when this BundleInstance is itself a child of
   *  another bundle (a bundle reference expanded at insert time),
   *  `parent_uid` points at the outer instance's `_uid`. Top-level
   *  bundles have `parent_uid === null` (or omitted, treated as null).
   *
   *  The tier-2 API cap (wp_api/bundles.py:_validate_bundle_refs)
   *  guarantees this chain is at most one hop deep — an inner bundle
   *  cannot itself contain bundle children. The frame renderer
   *  groups bundles by `parent_uid` to render the nested frame
   *  recursively (one level), and the engine/frontend enabled gate
   *  ANDs up the chain so disabling the outer disables every leaf in
   *  every inner. */
  parent_uid?: string | null;
  /** Content-fingerprint of the bundle's children at the last
   *  insert/save/reset moment. Compared against the live fingerprint
   *  via `bundleSnapshotModified` to power the bundle-level "modified"
   *  indicator (this instance has unsaved local edits since insert).
   *
   *  Optional / missing on workflows saved before MOD detection
   *  landed — `bundleSnapshotModified` treats absent as "clean
   *  baseline" so existing bundles never spuriously light up after
   *  upgrade. A backfill pass on initial parse stamps a fingerprint
   *  from current state so subsequent edits flip the bundle modified
   *  correctly. */
  snapshot_fingerprint?: string;
  /** UID of an ancestor bundle whose master-internal ON cascade
   *  flipped THIS bundle's master internal state from not-all to
   *  on. Set when an outer master ON propagates inward; cleared
   *  when that outer's master OFF fires or when this bundle's own
   *  master button is clicked directly (user takes ownership).
   *
   *  Purpose: distinguishes "outer chained me on" from "I was
   *  already on (user manually set me)". Outer's OFF only
   *  propagates to inner when this tag matches outer's `_uid`,
   *  preserving inner master toggles the user set independently.
   *  Optional / missing on legacy workflows + on bundles never
   *  reached by a chain. */
  master_internal_chained_by?: string | null;
  /** Mirror of `master_internal_chained_by` for the seed-lock
   *  master chain. Same lifecycle rules. */
  master_lock_chained_by?: string | null;
}

/** Module kind discriminator — the five kinds the SPA library carries. */
export type ModuleEntryKind =
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint";

/** SP3 reach selector — decides which downstream instances of a
 *  constraint's `target_wildcard_id` it covers. Mirrors the engine's
 *  `target_select` (`engine/modules/_constraints.py`):
 *   - `all`   — every downstream target occurrence (default when absent).
 *   - `first` — only the 1st encounter (per-constraint hit counter == 1).
 *   - `next`  — the first `count` encounters (hit counter <= count).
 *   - `pick`  — the explicitly-listed occurrences. A `direct` pick names
 *     a top-level instance by its per-instance `uid`; a `nested` pick
 *     names a one-hop carrier occurrence by `(carrier_uid, option_id)`.
 *
 *  Lives at instance level on the constraint (`payload.target_select` /
 *  the `instance.target_select` override). Shape is engine-validated;
 *  the type-only schema treats it as an opaque `dict`. */
export interface TargetSelect {
  mode: "first" | "next" | "all" | "pick";
  count?: number;
  picks?: Array<
    | { kind: "direct"; uid: string }
    | { kind: "nested"; carrier_uid: string; option_id: string }
  >;
}

export interface ModuleEntry {
  /**
   * For library-picked modules: the canonical 8-hex uuid (matches the
   * source library row's `id`). For inline-created `fixed_values`
   * entries: a fresh local id from `newModuleId()` — they don't have
   * a library row to point at yet.
   */
  id: string;
  /**
   * Per-instance stable UI key, used as Vue `:key` for the row. Phase B
   * (2026-05-10): siblings share `m.id` (same library uuid, multiple
   * instances), so id alone can't disambiguate v-for entries. The
   * composite `${id}|${idx}` would change on every reorder/insert and
   * break TransitionGroup move animations. `_uid` is stamped at module-
   * creation time and survives across reorders. Optional in the type so
   * legacy workflows without it still parse; ContextWidget backfills on
   * load via `ensureRowUids()`.
   */
  _uid?: string;
  type: ModuleEntryKind;
  enabled: boolean;
  /** UI-only: persists collapsed state so cards stay collapsed across reload. */
  collapsed?: boolean;
  /** Display metadata. `name` doubles as the card title.
   *  `library_name` is the original name set when the module was first
   *  picked from the library — denormalized onto the snapshot so
   *  "reset overrides" can restore the user-edited `name` to its
   *  library default without having to re-fetch from the server.
   *  Inline-created modules (no library link) leave it undefined. */
  meta: { name: string; library_name?: string; description?: string; tags?: string[] };
  /**
   * Inline-edited `fixed_values` entries. Always present (default
   * `[]` for non-fixed_values kinds) so existing scan logic
   * (`scanConflicts`, upstream-vars walkers, conflict store) doesn't
   * have to null-check it. Library-picked non-fixed kinds keep this
   * empty and round-trip their data through `payload` instead.
   */
  entries: { variable_name: string; value: string }[];
  /**
   * Full library payload (for picked, non-fixed_values kinds). Holds
   * the snapshot the WP_Context node executes at run time + the
   * resolver consults via `__wp_catalog__`. Inline `fixed_values`
   * entries don't set this; they round-trip through the `entries`
   * field so the existing inline editor keeps working.
   */
  payload?: Record<string, unknown>;
  /**
   * Drift-detection hash for picked entries. Matches the
   * `payload_hash` the server returned at pick time — diffs against
   * a live re-fetch surface as the drift badge in 5.5.5.
   */
  payload_hash?: string;
  /**
   * Per-instance overrides applied on top of the library snapshot at
   * run time. Engine merges these onto the canonical `_fresh_instance`
   * defaults (engine/modules/snapshot.py). Currently used for
   * `wildcard` kind — option enable/disable + per-option weight
   * replacement. Other kinds may grow their own override fields.
   *
   * Optional + nullable members so the modal only persists the
   * fields the user actually touched.
   */
  instance?: {
    /**
     * Override for the wildcard's emit-to-variable name. When set, the
     * wildcard binds its picked value to this var name instead of the
     * library default `payload.var_binding`. Empty/null = use library
     * default. Engine reads this in `wildcard_handler.py:216`.
     */
    variable_binding?: string | null;
    /**
     * Subset of `payload.options[].id` allowed to be picked. `null` /
     * absent = all options enabled (engine default). Empty list = all
     * options disabled (engine returns empty binding).
     */
    enabled_options?: string[] | null;
    /**
     * Per-option-id weight overrides. Replaces (not multiplies) the
     * library weight for matching ids. Missing ids fall through to
     * the library weight.
     */
    option_weights?: Record<string, number> | null;
    /**
     * Boolean sub-category filter expression (SP1; `and`/`or`/`not`/
     * parens, comma = or). `null` / empty = no filter (every option
     * eligible). An option survives when its `sub_categories` tag set
     * satisfies the expression. Combines with `enabled_options`
     * (intersection).
     */
    category_filter?: string | null;
    /**
     * Exclude the null option from the pool (SP1). Separate flag — the
     * `category_filter` expression never applies to the null option.
     */
    exclude_null?: boolean;
    /**
     * SP2a multi-select: pick N options (without replacement) per resolution
     * into a list-valued variable. `pick_min`..`pick_max` is the count range
     * (anything other than 1..1 activates multi-pick; min may be 0 for "maybe
     * nothing"); `pick_separator` joins the list for a bare `$var`.
     */
    pick_min?: number;
    pick_max?: number;
    pick_separator?: string;
    /** SP2c: multi-pick draws WITH replacement (repeats allowed) when true,
     *  unique (without replacement) when false/absent. Mirrors inline `~`. */
    pick_independent?: boolean;
    /**
     * Pick mode for this instance:
     *   - `random` / unset — weighted RNG (library default).
     *   - `subcategory`    — same as random engine-side; surfaces
     *     `enabled_options` as the user-facing "pick subset" UI.
     *   - `pinned`         — short-circuits the RNG and always
     *     returns the option whose id matches `pinned_option_id`.
     *     Falls through to random if the pinned id is missing.
     */
    mode?: "random" | "subcategory" | "pinned" | null;
    /**
     * Target option id for `mode === "pinned"`. Ignored otherwise.
     */
    pinned_option_id?: string | null;
    /**
     * Lock — derives a stable per-instance RNG seed from
     * `(locked_seed, var_binding)` so the wildcard's pick stays the
     * same across runs even when the Context node's seed rotates.
     * `null` / missing = roll with the chain seed (default).
     * Reproduces the "lock this slot" affordance from the original
     * project, adapted to our `_fresh_instance` shape.
     */
    locked_seed?: number | null;
    /** Iteration seed scope: "hold" pins this module's RNG to the run base
     *  seed (identical across loop iterations, re-rolls per run); "vary"
     *  (default/absent) rides the per-iteration seed. `locked_seed` wins. */
    seed_scope?: "vary" | "hold";
    /**
     * Internal — when true, every binding this module produces is
     * marked engine-only. Downstream modules in the same chain can
     * still read the value; the public PIPELINE_CONTEXT socket
     * payload omits it. Useful for "scratch" vars that drive a
     * derivation/combine but shouldn't surface in prompts.
     */
    internal?: boolean;
    /**
     * Fixed-values per-instance overrides. Library-tracked
     * fixed_values keep `payload.values` immutable as the library
     * snapshot; user edits land here as a full-replacement list.
     * Engine reads overrides when the array is non-empty, falls back
     * to `payload.values` otherwise. Modified-state + the modal's
     * "reset to library" button both pivot on this field.
     *
     * Inline-created fixed_values (no `payload_hash`) never write to
     * this field — their edits go straight into `payload.values`
     * because there's no library state to preserve.
     */
    values_overrides?: Array<{ id: string; name: string; value: string }> | null;
    /**
     * Combine per-instance template override. When set, the engine
     * reads this string in place of `payload.template`. Empty/null =
     * use library default. Modal collapses to null when input matches
     * library template. Engine reads in `combine_handler.py:64-65`.
     */
    template_override?: string | null;
    /**
     * Per-instance disable list for derivation rules. Engine skips rules
     * whose `id` matches any entry. Null/absent = all rules active.
     */
    disabled_rule_ids?: string[] | null;
    /**
     * Per-instance disable list for derivation BRANCHES inside a rule.
     * Each entry is `"{rule_id}:{branch_idx}"` for ELIF or
     * `"{rule_id}:else"` for ELSE. IF (branch_idx=0) is never listed —
     * disabling IF would be redundant with `disabled_rule_ids`.
     * Engine reads in `derivation_handler.py` per the 2026-05-10 cycle.
     */
    disabled_branch_keys?: string[] | null;
    /**
     * Per-instance action.value overrides for derivation branches.
     * Shape: `{ [rule_id]: { [branch_idx_or_"else"]: value } }`.
     * Engine reads override before payload value at resolve time.
     * Null/absent = all action values come from library payload.
     */
    action_value_overrides?: Record<string, Record<string, string>> | null;
    /**
     * Per-instance condition.value overrides for derivation branches.
     * Shape: `{ [rule_id]: { [branch_idx]: value } }`. Only IF + ELIF
     * branches (ELSE has no condition). Engine reads override before
     * payload value at compare time.
     */
    condition_value_overrides?: Record<string, Record<string, string>> | null;
    /**
     * Per-instance rule reorder list for derivation. Engine evaluates
     * rules in this order; missing rule_ids fall through at the end in
     * library order. Library `payload.rules` order untouched. Drag-to-
     * reorder UI emits a fresh list on every drop.
     */
    rule_order_override?: string[] | null;
    /**
     * Per-instance disable list for constraint exceptions. Composite key
     * via `encodeKey([source, target])` — JSON 2-string-array, stable
     * across reorder. Null/absent = all exceptions active.
     */
    disabled_exception_keys?: string[] | null;
    /**
     * Per-instance disable list for constraint matrix cells. Composite
     * key via `encodeKey([src_subcat, tgt_subcat])`. Null/absent = all cells active.
     */
    disabled_matrix_cells?: string[] | null;
    /**
     * Per-instance per-cell mode override. Keys via
     * `encodeKey([src_subcat, tgt_subcat])`. Sparse — only keys
     * with overrides present. Engine reads override before payload
     * value at resolve time.
     */
    cell_mode_overrides?: Record<string, "allow" | "exclude" | "boost" | "reduce"> | null;
    /**
     * Per-instance per-cell factor override. Same keying as
     * `cell_mode_overrides`. Numbers >= 0; engine rejects negatives
     * with the same message shape as payload validation.
     */
    cell_factor_overrides?: Record<string, number> | null;
    /**
     * Per-instance per-exception mode override. Keys via
     * `encodeKey([source_value, target_value])`. Sparse — same
     * semantics as cell overrides but for the exceptions list.
     */
    exception_mode_overrides?: Record<string, "allow" | "exclude" | "boost" | "reduce"> | null;
    /**
     * Per-instance per-exception factor override. Same keying as
     * `exception_mode_overrides`.
     */
    exception_factor_overrides?: Record<string, number> | null;
    /**
     * Instance-only additional exceptions. Appended to the library
     * exceptions at resolve. Never written back to library — these
     * live entirely in the instance.
     */
    extra_exceptions?: Array<{
      source_value: string;
      target_value: string;
      mode: "allow" | "exclude" | "boost" | "reduce";
      factor: number;
    }> | null;
    /**
     * SP3 per-instance constraint reach override. Decides which downstream
     * instances of the constraint's `target_wildcard_id` this instance
     * covers (`first` / `next N` / `all` / explicit `pick`). `null` /
     * absent = inherit `payload.target_select`, which itself defaults to
     * `{mode:"all"}`. Engine reads this in
     * `engine/modules/_constraints.py`; the pairings layer mirrors it
     * statically via `computePairingsFull`. Shape is engine-validated.
     */
    target_select?: TargetSelect | null;
    /**
     * UI-scratch namespace. Single-underscore prefix signals "not engine
     * input"; engine handlers ignore the entire `_ui` subtree. Persisted
     * across workflow save/load but excluded from drift hash and engine
     * reads. See spec §2 for the lifecycle invariant.
     */
    _ui?: {
      /** Restore-on-toggle-on memory for the lock seed input. */
      last_locked_seed?: number;
      /** True when the bundle master internal toggle was the thing
       *  that turned `instance.internal` on for this child. Lets the
       *  master OFF action revert ONLY the children it turned on —
       *  rows the user had marked internal individually keep their
       *  state. Cleared by any per-card internal toggle (the user is
       *  now hand-managing this row) and by the master OFF op itself.
       *  Belongs in `_ui` because it's a session/UX marker, not
       *  semantic engine state. */
      master_internal?: boolean;
      /** UID of the BundleInstance that claimed this row via its master
       *  internal toggle. Lets nested bundles avoid stomping on each
       *  other's markers — an outer bundle's master OFF (in
       *  preserve-manual mode) only clears rows whose
       *  `master_internal_by` matches its own `_uid`. Rows claimed by
       *  an inner bundle keep their internal state through an outer
       *  OFF; the inner clears them via its own master toggle. Legacy
       *  data carries only `master_internal: true` without this tag —
       *  treated as "owned by unknown" so an outer OFF doesn't sweep
       *  pre-tag-era markers either. */
      master_internal_by?: string;
      /** Mirror of `master_internal` for the seed-lock master toggle.
       *  Same lifecycle: set by master ON for rows it locked, cleared
       *  by individual lock toggles or master OFF. */
      master_lock?: boolean;
      /** Mirror of `master_internal_by` for the seed-lock master
       *  toggle — owner-tag so nested bundles don't unlock each
       *  other's rows. */
      master_lock_by?: string;
    };
  };
  /** Per-frame override patches: stringified 0-based iteration index ->
   *  partial instance merged onto this module's instance for that frame. */
  iteration_overrides?: Record<string, Partial<NonNullable<ModuleEntry["instance"]>>>;
  /** 0-based loop indices on which this module is suppressed. The module's
   *  base `enabled` flag is unaffected; this is a frame-local skip list.
   *  Absent or empty means the module runs on every frame. */
  disabled_frames?: number[];
}

export function parseWidgetJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as T;
  } catch {
    // fall through to default
  }
  return fallback;
}

export interface ParseRecovery<T> {
  /** Parsed value, or the fallback if parsing failed / shape was wrong. */
  value: T;
  /** Human-readable error message, or null on success. */
  error: string | null;
  /** Original raw input — preserved so a "View raw" UI can show the bad data. */
  raw: string;
}

/**
 * Parse with recovery info attached. Use when the widget needs to surface a
 * "corrupt workflow" panel: callers branch on `error` and render a
 * View raw / Reset UI without throwing away the original payload.
 *
 * Empty input is NOT an error — fresh nodes have no value yet and should
 * just receive the fallback silently.
 */
function migrateLegacyLastLockedSeed(modules: unknown): void {
  if (!Array.isArray(modules)) return;
  for (const m of modules) {
    if (!m || typeof m !== "object") continue;
    const inst = (m as Record<string, unknown>).instance;
    if (!inst || typeof inst !== "object") continue;
    const instRec = inst as Record<string, unknown>;
    if (typeof instRec.last_locked_seed === "number") {
      const ui = (instRec._ui as Record<string, unknown> | undefined) ?? {};
      if (ui.last_locked_seed === undefined) {
        ui.last_locked_seed = instRec.last_locked_seed;
      }
      instRec._ui = ui;
      delete instRec.last_locked_seed;
    }
  }
}

export function parseWidgetJsonWithRecovery<T>(raw: string, fallback: T): ParseRecovery<T> {
  if (!raw) return { value: fallback, error: null, raw };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      // Migrate legacy instance.last_locked_seed to instance._ui.last_locked_seed
      const parsedRecord = parsed as Record<string, unknown>;
      migrateLegacyLastLockedSeed(parsedRecord.modules);
      // Backfill `bundles: []` so older workflows (saved before the
      // bundle system shipped) match the new ContextWidgetValue
      // shape. ContextWidget code consumes `value.bundles` directly;
      // without this default it would crash on `value.bundles.map`.
      if (parsedRecord.bundles === undefined) {
        parsedRecord.bundles = [];
      }
      return { value: parsed as T, error: null, raw };
    }
    return { value: fallback, error: `Expected an object, got ${typeof parsed}.`, raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { value: fallback, error: msg, raw };
  }
}

export function serializeWidgetJson(value: unknown): string {
  return JSON.stringify(value);
}

export function emptyContextValue(): ContextWidgetValue {
  return { version: 1, modules: [], bundles: [] };
}

/** Generates a per-Context bundle instance with a fresh 12-char hex
 *  `_uid` + sane defaults. Caller fills in `start_idx` / `end_idx`
 *  after splicing children into `modules[]` + sets
 *  `inserted_at_hash` from the library entry's `payload_hash`. */
export function emptyBundleInstance(library_id: string): BundleInstance {
  return {
    _uid: newRowUid(),
    library_id,
    start_idx: 0,
    end_idx: 0,
    enabled: true,
    collapsed: false,
    inserted_at_hash: "",
    name: "",
    color: null,
  };
}

/** Per-row state for the WP_ContextInjector widget. Mirrors
 *  ContextWidgetValue's shape (version + flat array) so the same
 *  parseWidgetJsonWithRecovery + serializeWidgetJson helpers work
 *  unchanged. */
export interface InjectorRowsValue {
  version: 1;
  rows: InjectorRow[];
}

/** Row kind discriminator for the two-tier injector model.
 *   - `"socket"` (default / absent): auto-created per connected
 *     `input_N` socket. Binds one socket to a `$variable`; its optional
 *     template substitutes ONLY its OWN `$input_N`. Reconciled to live
 *     connections — removed when its socket is severed.
 *   - `"general"`: user-added, durable. NOT tied to a socket; survives
 *     socket disconnect/reconnect. Has a free template resolved AFTER
 *     all socket rows, referencing both raw sockets (`$input_N`) and the
 *     variables produced by socket rows (`$test`). */
export type InjectorRowKind = "socket" | "general";

export interface InjectorRow {
  /** Stable per-row UID for v-for keying. Independent of slot reorder. */
  _uid: string;
  /** Row kind. Absent = `"socket"` (backward compat with workflows saved
   *  before the two-tier model). */
  kind?: InjectorRowKind;
  /** ComfyUI input slot name this row binds to (e.g. "input_0").
   *  Engine reads slot by NAME, not index, so reordering rows in the
   *  widget doesn't break value lookup at execute time. General rows
   *  carry an empty string here — they aren't tied to a socket. */
  slot_name: string;
  /** Variable name written to ctx. Empty = unset; row renders with
   *  warn-color placeholder until user types a name. */
  binding: string;
  /** Toggle off skips the ctx write that run. */
  enabled: boolean;
  /** True = mark binding for assembler chip strip skip (still writes
   *  to ctx, just hidden from the chip strip UI). */
  internal: boolean;
  /** When true, the row's summary line is hidden (default = expanded
   *  = false). Mirrors ModuleRow's per-row collapse pattern so users
   *  can hide the preview chrome on rows whose configuration is
   *  stable. Persists in the widget JSON via the same `change` emit
   *  the other field updates use. */
  _collapsed?: boolean;
  /** Optional binding template. Scope depends on `kind`:
   *   - SOCKET row: when set + non-empty, the engine writes the
   *     substituted template into ctx[binding] instead of the raw
   *     socket value. Substitutes ONLY this row's OWN `$<slot_name>`
   *     (e.g. `"i love $input_0"` on the input_0 row). Other sockets are
   *     out of scope — rows resolve top-to-bottom. Empty / null =
   *     pass-through (ctx[binding] = raw socket value).
   *   - GENERAL row: REQUIRED. Resolved after all socket rows against
   *     both the raw sockets (`$input_N`) AND the variables produced by
   *     socket rows (e.g. `$test`). Empty = the row produces nothing.
   *  The InjectorBindingModal manages this field for socket rows; the
   *  inline row template input manages it for general rows. Engine
   *  plumbing lives in wp_nodes/injector_node.py. */
  template?: string | null;
}

export function emptyInjectorRowsValue(): InjectorRowsValue {
  return { version: 1, rows: [] };
}

/** Build a fresh general-template row: no slot, empty binding + template,
 *  enabled, collapsed by default. Durable — not reconciled against
 *  connected sockets. */
export function newGeneralInjectorRow(): InjectorRow {
  return {
    _uid: newRowUid(),
    kind: "general",
    slot_name: "",
    binding: "",
    template: "",
    enabled: true,
    internal: false,
    _collapsed: true,
  };
}

export function newModuleId(): string {
  // spec §3.2 — 8-char hex
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a fresh `_uid` for a new module instance — stable per-row
 *  Vue v-for key when siblings share `m.id`. 12-char hex; collision
 *  probability across a single workflow is negligible. */
export function newRowUid(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pre-built bundle lookup tables used by isModuleEffectivelyEnabled.
 *  enabled: per-bundle enabled flag.
 *  parent:  per-bundle parent_uid (or null/undefined for top-level).
 *  Both keyed by BundleInstance._uid. */
export interface BundleEnabledIndex {
  enabled: Map<string, boolean>;
  parent: Map<string, string | null>;
}

/** Build a per-Context lookup from bundles[]. Used by every reader
 *  that walks the same modules list multiple times — building the
 *  map once per walk avoids the inner O(N) scan over bundles[] per
 *  lookup. Returns both `enabled` and `parent` maps because the
 *  tier-2 gate walks the parent chain to AND through. */
export function buildBundleEnabledMap(
  bundles: readonly BundleInstance[] | undefined,
): BundleEnabledIndex {
  const enabled = new Map<string, boolean>();
  const parent = new Map<string, string | null>();
  if (!bundles) return { enabled, parent };
  for (const b of bundles) {
    if (!b || typeof b._uid !== "string") continue;
    enabled.set(b._uid, b.enabled !== false);
    parent.set(b._uid, typeof b.parent_uid === "string" ? b.parent_uid : null);
  }
  return { enabled, parent };
}

/** Resolves the effective enabled state of a module, taking the bundle
 *  gate into account. `bundle.enabled` is a non-destructive gate that
 *  ANDs over the child's own `enabled` — toggling a bundle off NEVER
 *  mutates child state; the gate is just applied at every read site
 *  (engine, conflict scanner, graph walkers, assembler preview).
 *
 *  Effective enabled = child.enabled AND immediate-bundle.enabled AND
 *  every ancestor bundle's enabled along the parent_uid chain.
 *
 *  When `module.enabled` is falsy → not enabled regardless of bundles.
 *  When `module.bundle_origin` resolves to a bundle whose chain
 *  contains any disabled ancestor → not enabled.
 *  Orphan bundle_origin (uid not in the index) passes through with the
 *  child's own enabled, matching the engine-side fallback.
 *
 *  Pass either the raw `bundles[]` array (one-shot calls) or a
 *  pre-built BundleEnabledIndex from `buildBundleEnabledMap`
 *  (hot-path walks).
 */
export function isModuleEffectivelyEnabled(
  module: { enabled?: boolean; bundle_origin?: string | null } | undefined | null,
  bundlesOrIndex: readonly BundleInstance[] | BundleEnabledIndex | undefined,
): boolean {
  if (!module) return false;
  if (module.enabled === false) return false;
  const origin = module.bundle_origin;
  if (typeof origin !== "string" || !origin) return true;
  const index = isBundleIndex(bundlesOrIndex)
    ? bundlesOrIndex
    : buildBundleEnabledMap(bundlesOrIndex);
  if (!index.enabled.has(origin)) return true; // orphan
  // Walk the parent chain. Tier-2 API cap → at most 2 hops; defensive
  // depth limit absorbs corrupt cycles.
  const seen = new Set<string>();
  let cur: string | null | undefined = origin;
  let depth = 0;
  while (cur != null && !seen.has(cur) && depth < 8) {
    seen.add(cur);
    if (index.enabled.get(cur) === false) return false;
    cur = index.parent.get(cur) ?? null;
    depth++;
  }
  return true;
}

function isBundleIndex(x: unknown): x is BundleEnabledIndex {
  return !!x
    && typeof x === "object"
    && "enabled" in (x as Record<string, unknown>)
    && (x as { enabled: unknown }).enabled instanceof Map;
}
