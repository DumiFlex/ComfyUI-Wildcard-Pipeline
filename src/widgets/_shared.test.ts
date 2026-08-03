import { describe, it, expect, afterEach } from "vitest";
import {
  createDomWidgetHost,
  emptyBundleInstance,
  emptyContextValue,
  emptyInjectorRowsValue,
  parseWidgetJsonWithRecovery,
  type BundleInstance,
  type ContextWidgetValue,
  type InjectorRowsValue,
} from "./_shared";

describe("emptyInjectorRowsValue", () => {
  it("returns version 1 + empty rows array", () => {
    expect(emptyInjectorRowsValue()).toEqual({ version: 1, rows: [] });
  });
});

describe("parseWidgetJsonWithRecovery for InjectorRowsValue", () => {
  it("parses well-formed rows", () => {
    const json = JSON.stringify({
      version: 1,
      rows: [
        { _uid: "abc", slot_name: "input_0", binding: "x", enabled: true, internal: false },
      ],
    });
    const parsed = parseWidgetJsonWithRecovery<InjectorRowsValue>(json, emptyInjectorRowsValue());
    expect(parsed.value.rows).toHaveLength(1);
    expect(parsed.value.rows[0].binding).toBe("x");
  });

  it("recovers to empty on malformed JSON", () => {
    const parsed = parseWidgetJsonWithRecovery<InjectorRowsValue>(
      "{not json",
      emptyInjectorRowsValue(),
    );
    expect(parsed.value).toEqual(emptyInjectorRowsValue());
  });
});

describe("emptyBundleInstance", () => {
  it("returns a BundleInstance with sane defaults", () => {
    const b = emptyBundleInstance("lib-abc");
    expect(b._uid).toMatch(/^[0-9a-f]{12}$/);   // newRowUid pattern
    expect(b.library_id).toBe("lib-abc");
    expect(b.start_idx).toBe(0);
    expect(b.end_idx).toBe(0);
    expect(b.enabled).toBe(true);
    expect(b.collapsed).toBe(false);
    expect(b.inserted_at_hash).toBe("");
  });

  it("generates a fresh _uid each call", () => {
    const a = emptyBundleInstance("lib-1");
    const b = emptyBundleInstance("lib-1");
    expect(a._uid).not.toBe(b._uid);
  });
});

describe("emptyContextValue with bundles", () => {
  it("includes empty bundles array", () => {
    const v = emptyContextValue();
    expect(v.version).toBe(1);
    expect(v.modules).toEqual([]);
    expect(v.bundles).toEqual([]);
  });
});

describe("parseWidgetJsonWithRecovery for ContextWidgetValue.bundles", () => {
  it("defaults bundles to [] when missing from workflow JSON (backward compat)", () => {
    const raw = JSON.stringify({ version: 1, modules: [] });
    const parsed = parseWidgetJsonWithRecovery<ContextWidgetValue>(raw, emptyContextValue());
    expect(parsed.error).toBeNull();
    expect(Array.isArray(parsed.value.bundles)).toBe(true);
    expect(parsed.value.bundles).toHaveLength(0);
  });

  it("preserves bundles[] when present in workflow JSON", () => {
    const bundleEntry: BundleInstance = {
      _uid: "abc123def456",
      library_id: "lib-coral",
      start_idx: 0,
      end_idx: 2,
      enabled: true,
      collapsed: false,
      inserted_at_hash: "hash-1",
      name: "subject_phrase",
      color: "#FB7185",
    };
    const raw = JSON.stringify({
      version: 1,
      modules: [],
      bundles: [bundleEntry],
    });
    const parsed = parseWidgetJsonWithRecovery<ContextWidgetValue>(raw, emptyContextValue());
    const bundles = parsed.value.bundles ?? [];
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toEqual(bundleEntry);
  });
});

describe("createDomWidgetHost — fillHost under the Vue renderer", () => {
  // `fillHost` relies on `height: 100%` resolving. Under Nodes 2.0 the host's
  // ancestor chain is content-sized, so it resolves to `auto` and the widget
  // grows to its payload instead of scrolling it — measured: with node.size[1]
  // pinned at 400, a 60-entry snapshot inflated the node to 1200 and the
  // scroller never engaged. These pin the renderer branch.
  function makeHostNode(id: string) {
    const widgets: Record<string, unknown>[] = [];
    return {
      id,
      size: [500, 400] as [number, number],
      addDOMWidget(name: string, type: string, el: HTMLElement, opts?: Record<string, unknown>) {
        const w = { element: el, options: opts, name, type };
        widgets.push(w);
        return w;
      },
    };
  }

  function mountNodeEl(id: string): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("data-node-id", id);
    document.body.appendChild(el);
    return el;
  }

  const Stub = { render: () => null };

  afterEach(() => {
    const lg = (globalThis as { LiteGraph?: Record<string, unknown> }).LiteGraph;
    if (lg) delete lg.vueNodesMode;
    document.body.innerHTML = "";
  });

  it("publishes our min-width on the node element — the host's own resize hook", async () => {
    // useNodeResize reads the floor from the node element's inline min-width
    // and only falls back to MIN_NODE_WIDTH (225) when it is absent.
    (globalThis as { LiteGraph?: Record<string, unknown> }).LiteGraph = { vueNodesMode: true };
    const node = makeHostNode("41");
    const nodeEl = mountNodeEl("41");
    const host = createDomWidgetHost(node as never, "w", Stub as never, {
      fillHost: true,
      minWidth: () => 372,
    });
    nodeEl.appendChild(host.widget.element);

    await new Promise((r) => requestAnimationFrame(() => r(null)));
    // 372 snapped to the 10px node grid.
    expect(nodeEl.style.minWidth).toBe("370px");
    // And we opt out of the parent's `*:flex-1`, or the pinned height is
    // ignored in the main axis.
    expect(host.widget.element.style.flexGrow).toBe("0");
    expect(host.widget.element.style.flexBasis).toBe("auto");
    host.unmount();
  });

  it("leaves the legacy renderer completely alone", async () => {
    (globalThis as { LiteGraph?: Record<string, unknown> }).LiteGraph = { vueNodesMode: false };
    const node = makeHostNode("42");
    const nodeEl = mountNodeEl("42");
    const host = createDomWidgetHost(node as never, "w", Stub as never, {
      fillHost: true,
      minWidth: () => 372,
    });
    nodeEl.appendChild(host.widget.element);

    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(nodeEl.style.minWidth).toBe("");
    expect(host.widget.element.style.flexGrow).toBe("");
    // Legacy gives the host a definite box, so the percentage still resolves.
    expect(host.widget.element.style.height).toBe("100%");
    host.unmount();
  });
});
