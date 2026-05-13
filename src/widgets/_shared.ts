import { createApp, type App, type Component } from "vue";

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
  /** Force the parent node to be at least this wide (px). LoRA Manager docs §4.3. */
  minWidth?: number;
  /**
   * Fill the host's allocated height instead of growing the node to fit
   * content. Use for read-only viewers (debug snapshot) where the node size
   * should drive the viewer, not the other way around. Disables autosize
   * observation; component CSS should set `height: 100%` on its root.
   */
  fillHost?: boolean;
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

  let state = options.initialValue ?? "";
  const baseMin = options.minHeight ?? 80;
  let minHeight = baseMin;
  const baseMinWidth = options.minWidth ?? 0;
  let minWidth = baseMinWidth;

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
  // Force a minimum node width if requested. LoRA Manager docs §4.3 — only
  // way to widen the node from a DOM widget is overriding computeLayoutSize.
  // The width is a LIVE getter (not a captured constant) so the auto-grow
  // observer below can ratchet minWidth up as row content gets wider —
  // e.g. injector conflict badge text "duplicate variable" needs more room.
  if (baseMinWidth) {
    widget.computeLayoutSize = () => ({ minWidth, minHeight });
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
  function pushSize(measuredH: number, growthDelta: number) {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const nextH = Math.max(baseMin, measuredH);
      if (nextH !== minHeight) minHeight = nextH;
      // Width grows monotonically and ONLY when content actually
      // overflowed the container — growthDelta is the px the content
      // exceeded clientWidth by, so adding it bumps minWidth just
      // enough to swallow the overflow. Without this gate the node
      // would grow infinitely: each ResizeObserver tick reports
      // scrollWidth which converges-to-but-tracks clientWidth, so
      // any sub-pixel rounding gets amplified into a positive
      // feedback loop. User-initiated drag past minWidth is
      // preserved because we never shrink below minWidth.
      if (baseMinWidth && growthDelta > 0) {
        // Hard caps as runaway insurance: per-tick growth is bounded
        // so a pathological overflow source can't widen the node by
        // hundreds of pixels in a single observer fire; absolute cap
        // at 3x base prevents the node from growing unbounded across
        // many ticks even if the per-tick gate misfires. 3x covers
        // every realistic conflict-badge / long-binding scenario.
        const cappedDelta = Math.min(growthDelta, 64);
        const absoluteCap = baseMinWidth * 3;
        const nextW = Math.min(minWidth + cappedDelta, absoluteCap);
        if (nextW > minWidth) minWidth = nextW;
      }

      const min = resizable.computeSize?.();
      const cur = resizable.size;
      if (!min || !cur || !resizable.setSize) return;
      // Height axis: always match content. Width axis: grow if content
      // needs more room than current width, never shrink below user's
      // manual drag-wider.
      const targetH = min[1];
      const targetW = Math.max(cur[0], min[0]);
      if (cur[1] !== targetH || cur[0] < targetW) {
        resizable.setSize([targetW, targetH]);
        resizable.setDirtyCanvas?.(true, true);
      }
    });
  }
  // Skip the autosize observer in fill mode — node size is user-controlled,
  // content fills whatever space is given.
  function measure(): { h: number; growthDelta: number } {
    // Width-growth signal: only fire when content has actually
    // overflowed the container. `scrollWidth > clientWidth` is the
    // canonical overflow check. 2px tolerance absorbs subpixel
    // rounding so a stable state doesn't slow-creep grow.
    const overflowPx = inner.scrollWidth - inner.clientWidth;
    const growthDelta = overflowPx > 2 ? Math.ceil(overflowPx) : 0;
    const h = Math.ceil(inner.getBoundingClientRect().height);
    return { h, growthDelta };
  }

  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  if (!options.fillHost) {
    // ResizeObserver covers the height path — content getting taller
    // (more rows, taller widget) trips it.
    resizeObserver = new ResizeObserver(() => {
      const { h, growthDelta } = measure();
      if (h > 0) pushSize(h, growthDelta);
    });
    // MutationObserver covers the width path. Inserting a conflict
    // badge or expanding row content doesn't change `inner`'s box
    // (inner is width:100% — fills whatever the host gives it), so
    // ResizeObserver never fires for that case. MutationObserver
    // fires on every DOM change in the Vue subtree, which is the
    // precise signal we need: re-measure scrollWidth vs clientWidth
    // after the new children are in place.
    mutationObserver = new MutationObserver(() => {
      const { h, growthDelta } = measure();
      if (h > 0) pushSize(h, growthDelta);
    });
    queueMicrotask(() => {
      resizeObserver?.observe(inner);
      mutationObserver?.observe(inner, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
    });
  }

  return {
    widget,
    element: inner,
    app,
    unmount: () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      app.unmount();
    },
    getValue: () => state,
    setValue: (v) => {
      state = v;
    },
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
  /** When false, every module inside `[start_idx..end_idx]` gets
   *  `enabled: false` cascaded at engine-write time. */
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
}

/** Module kind discriminator. Same six kinds the SPA library carries. */
export type ModuleEntryKind =
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint"
  | "pipeline";

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
     * Sub-category names allowed in the option pool. `null` / empty =
     * no filter (every sub-category eligible). When set, only options
     * whose `sub_category` field is in the list survive — options
     * without a sub_category get excluded by an explicit filter.
     * Combines with `enabled_options` (intersection).
     */
    category_filter?: string[] | null;
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
     * UI-scratch namespace. Single-underscore prefix signals "not engine
     * input"; engine handlers ignore the entire `_ui` subtree. Persisted
     * across workflow save/load but excluded from drift hash and engine
     * reads. See spec §2 for the lifecycle invariant.
     */
    _ui?: {
      /** Restore-on-toggle-on memory for the lock seed input. */
      last_locked_seed?: number;
    };
  };
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

export interface InjectorRow {
  /** Stable per-row UID for v-for keying. Independent of slot reorder. */
  _uid: string;
  /** ComfyUI input slot name this row binds to (e.g. "input_0").
   *  Engine reads slot by NAME, not index, so reordering rows in the
   *  widget doesn't break value lookup at execute time. */
  slot_name: string;
  /** Variable name written to ctx. Empty = unset; row renders with
   *  warn-color placeholder until user types a name. */
  binding: string;
  /** Toggle off skips the ctx write that run. */
  enabled: boolean;
  /** True = mark binding for assembler chip strip skip (still writes
   *  to ctx, just hidden from the chip strip UI). */
  internal: boolean;
}

export function emptyInjectorRowsValue(): InjectorRowsValue {
  return { version: 1, rows: [] };
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
