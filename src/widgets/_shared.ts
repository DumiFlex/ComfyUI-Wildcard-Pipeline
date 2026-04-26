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
  modules: ModuleEntry[];
}

export interface ModuleEntry {
  id: string;
  type: "fixed_values";
  enabled: boolean;
  /** UI-only: persists collapsed state so cards stay collapsed across reload. */
  collapsed?: boolean;
  meta: { name: string; description?: string; tags?: string[] };
  entries: { variable_name: string; value: string }[];
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
export function parseWidgetJsonWithRecovery<T>(raw: string, fallback: T): ParseRecovery<T> {
  if (!raw) return { value: fallback, error: null, raw };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return { value: parsed as T, error: null, raw };
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
