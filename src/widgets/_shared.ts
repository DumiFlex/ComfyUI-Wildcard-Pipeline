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
  if (options.minWidth) {
    const minWidth = options.minWidth;
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
  function pushSize(measured: number) {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const next = Math.max(baseMin, measured);
      if (next !== minHeight) minHeight = next;

      const min = resizable.computeSize?.();
      const cur = resizable.size;
      if (!min || !cur || !resizable.setSize) return;
      // Always match content size on the height axis. Width is left to the
      // user (drag wider preserved). If user wants more vertical space they
      // collapse modules / use whitespace.
      if (cur[1] !== min[1]) {
        resizable.setSize([Math.max(cur[0], min[0]), min[1]]);
        resizable.setDirtyCanvas?.(true, true);
      }
    });
  }
  // Skip the autosize observer in fill mode — node size is user-controlled,
  // content fills whatever space is given.
  const observer = options.fillHost
    ? null
    : new ResizeObserver((entries) => {
        for (const e of entries) {
          const h = Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height);
          if (h > 0) pushSize(h);
        }
      });
  if (observer) queueMicrotask(() => observer.observe(inner));

  return {
    widget,
    element: inner,
    app,
    unmount: () => {
      observer?.disconnect();
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
  return { version: 1, modules: [] };
}

export function newModuleId(): string {
  // spec §3.2 — 8-char hex
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
